// The sync engine: what a queued write is, and what happens when it finally lands.
//
// Deliberately free of React, IndexedDB, fetch and `window`, so scripts/smoke-offline.mjs
// can drive the whole thing under Node against a fake network. The interesting parts of
// offline sync are all decisions — who wins a double completion, whether a stale edit is
// applied — and a decision that can only be exercised by turning off someone's wifi is a
// decision that never gets tested.

/** What kinds of write can be queued. The set the conflict rules below cover. */
export type MutationKind =
  | "create"
  | "update"
  | "delete"
  | "complete"
  | "snooze"
  | "acknowledge"
  | "comment";

export interface Mutation {
  /** Client-minted uuid, and the key in the store. */
  id: string;
  /** Which account queued this. A queue is never replayed under a different session. */
  owner: string;
  kind: MutationKind;
  /** The reminder it concerns. For a create, the id the reminder will be given. */
  reminderId: string;
  /** When it was queued. Replay order, and "queued 3 minutes ago" in the UI. */
  at: number;
  /** The request body, already in the shape the route expects. */
  payload: Record<string, unknown>;
  /** How it reads in the queue — "Complete Water bill", not a blob of JSON. */
  label: string;
  /** Attempts so far. */
  tries: number;
  /** Why it last failed, if it did. */
  error?: string;
  /**
   * Set when the server refused it for a reason retrying cannot fix. Kept in the queue
   * and shown, never retried: a queue that silently holds someone's completion is worse
   * than being told the write failed.
   */
  blocked?: boolean;
}

export interface OutboxStore {
  all(): Promise<Mutation[]>;
  put(m: Mutation): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SentRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export interface SentResponse {
  /** 0 for "never reached the server". */
  status: number;
  message?: string;
}

export interface Transport {
  send(request: SentRequest): Promise<SentResponse>;
}

export type OutcomeResult =
  /** Landed. Removed from the queue. */
  | "applied"
  /**
   * The server had already settled this, or the thing it concerned is gone. Dropped
   * with a message — this is where "first completion wins" is realised.
   */
  | "superseded"
  /** Refused for a reason retrying won't fix. Kept, shown, and discardable by hand. */
  | "refused"
  /** Couldn't be attempted or the server faulted. Kept, tried again later. */
  | "deferred"
  /** Held back because an earlier write on the same reminder didn't land. */
  | "held";

export interface Outcome {
  id: string;
  kind: MutationKind;
  label: string;
  result: OutcomeResult;
  message?: string;
}

export interface ReplayReport {
  outcomes: Outcome[];
  applied: number;
  /** Dropped as already-settled or no-longer-applicable. */
  superseded: number;
  refused: number;
  deferred: number;
  /** True when the replay stopped early: the connection went, or the session lapsed. */
  interrupted: boolean;
  /** Set when the session is the reason. The caller sends the user to the lock screen. */
  sessionLapsed: boolean;
}

/**
 * The HTTP request a mutation becomes.
 *
 * Pure and exported so the suite asserts the actual paths and bodies rather than a
 * paraphrase of them. Every body here carries whatever the matching route needs to
 * make a replay idempotent: a client-minted id, the cycle a completion settles, or
 * the version an edit was based on.
 */
export function requestFor(m: Mutation): SentRequest {
  switch (m.kind) {
    case "create":
      return { method: "POST", path: "/reminders", body: { ...m.payload, id: m.reminderId } };
    case "update":
      return { method: "PATCH", path: `/reminders/${m.reminderId}`, body: m.payload };
    case "delete":
      return { method: "DELETE", path: `/reminders/${m.reminderId}` };
    case "complete":
      return {
        method: "POST",
        path: `/reminders/${m.reminderId}/complete`,
        body: m.payload,
      };
    case "snooze":
      return { method: "POST", path: `/reminders/${m.reminderId}/snooze`, body: m.payload };
    case "acknowledge":
      return { method: "POST", path: `/reminders/${m.reminderId}/acknowledge` };
    case "comment":
      return {
        method: "POST",
        path: `/reminders/${m.reminderId}/comments`,
        body: { ...m.payload, id: m.id },
      };
  }
}

/**
 * How one response is read. The conflict rules, in one place.
 *
 * | status  | meaning                                       | outcome |
 * | ------- | --------------------------------------------- | ------- |
 * | 2xx     | landed                                        | applied |
 * | 404     | the reminder is gone                          | delete: applied — it wanted it gone. Otherwise superseded: an edit to something deleted has nowhere to land. |
 * | 409     | somebody got there first, or the row moved on | superseded for a completion (first wins); refused for an edit, because overwriting somebody's change silently is the one outcome nobody can detect afterwards |
 * | 401     | the session lapsed                            | the whole replay stops and nothing is dropped — losing writes because a login expired would be inexcusable |
 * | 4xx     | the server won't take it                      | refused |
 * | 5xx / 0 | fault, or never sent                          | deferred |
 */
export function readResponse(m: Mutation, res: SentResponse): Omit<Outcome, "id" | "kind" | "label"> {
  const { status, message } = res;

  if (status >= 200 && status < 300) return { result: "applied" };

  if (status === 0 || status >= 500) {
    return { result: "deferred", message: message || "Couldn't reach the server." };
  }

  if (status === 401) return { result: "deferred", message: "Your session expired." };

  if (status === 404) {
    // Asking to delete something that is already gone is a wish granted.
    if (m.kind === "delete") return { result: "applied" };
    return {
      result: "superseded",
      message: "That reminder no longer exists, so this was dropped.",
    };
  }

  if (status === 409) {
    if (m.kind === "update") {
      return { result: "refused", message: message || "It changed elsewhere after you edited it." };
    }
    // A completion, an acknowledgement or a replayed create: somebody — possibly this
    // same queue, twice — already settled it. Nothing to merge and nothing to warn about.
    return { result: "superseded", message: message };
  }

  return { result: "refused", message: message || `The server refused this (${status}).` };
}

/**
 * Replays the queue in order.
 *
 * Ordering matters within a reminder and nowhere else: a create has to land before the
 * completion of the thing it created. So a write that doesn't land holds back later
 * writes *on the same reminder* — replaying those would 404 and be dropped, quietly
 * losing them — while everything about other reminders carries on. Stopping the lot at
 * the first refusal, which is what the plan for this said, would let one rejected edit
 * strand five unrelated completions behind it.
 *
 * A lost connection or a lapsed session does stop everything, because neither is about
 * the item being sent.
 */
export async function replay(
  store: OutboxStore,
  transport: Transport,
  owner: string,
): Promise<ReplayReport> {
  const queue = (await store.all()).filter((m) => m.owner === owner && !m.blocked);
  const outcomes: Outcome[] = [];
  /** Reminders with an unresolved write earlier in the queue. */
  const stalled = new Set<string>();
  let interrupted = false;
  let sessionLapsed = false;

  for (const m of queue) {
    const describe = { id: m.id, kind: m.kind, label: m.label };

    if (stalled.has(m.reminderId)) {
      outcomes.push({ ...describe, result: "held" });
      continue;
    }

    let res: SentResponse;
    try {
      res = await transport.send(requestFor(m));
    } catch (e) {
      res = { status: 0, message: (e as Error).message };
    }

    const read = readResponse(m, res);

    if (read.result === "applied" || read.result === "superseded") {
      await store.remove(m.id);
      outcomes.push({ ...describe, ...read });
      continue;
    }

    if (read.result === "refused") {
      // Kept, flagged, and never retried — it needs a person, not another attempt.
      await store.put({ ...m, tries: m.tries + 1, error: read.message, blocked: true });
      stalled.add(m.reminderId);
      outcomes.push({ ...describe, ...read });
      continue;
    }

    // Deferred: nothing wrong with the write itself.
    await store.put({ ...m, tries: m.tries + 1, error: read.message });
    outcomes.push({ ...describe, ...read });
    interrupted = true;
    if (res.status === 401) sessionLapsed = true;
    break;
  }

  const count = (r: OutcomeResult) => outcomes.filter((o) => o.result === r).length;
  return {
    outcomes,
    applied: count("applied"),
    superseded: count("superseded"),
    refused: count("refused"),
    deferred: count("deferred"),
    interrupted,
    sessionLapsed,
  };
}
