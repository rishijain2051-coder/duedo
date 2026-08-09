"use client";

import { useCallback, useEffect, useState } from "react";
import { SYNCED_EVENT } from "@/lib/cache";
import {
  allMutations,
  clearOutbox,
  outboxAvailable,
  putMutation,
  removeMutation,
} from "@/lib/idb";
import { isOffline, isOfflineError, markOffline, markOnline } from "@/lib/net";
import { computeNextDueAt } from "@/lib/reminder-logic";
import { parseDueAt } from "@/lib/time";
import { replay, type Mutation, type MutationKind, type ReplayReport } from "@/lib/sync";
import type { Reminder } from "@/types";

// The queue, as the app sees it: what goes in, what the screen looks like while it
// waits, and when it drains.
//
// Switchable off. NEXT_PUBLIC_OFFLINE_WRITES=0 turns queueing off and leaves the
// offline *reads* untouched, which is the whole reason the two halves shipped as
// separate commits: a sync problem should cost the newer feature, not the app's
// ability to open on a train.

export const OFFLINE_WRITES_ENABLED =
  process.env.NEXT_PUBLIC_OFFLINE_WRITES !== "0";


const EMPTY: Mutation[] = [];

let cache: Mutation[] = EMPTY;
/** `cache` narrowed to the signed-in account, held so `pending()` returns a stable array. */
let view: Mutation[] = EMPTY;
let owner: string | null = null;
let loaded = false;
let flushing = false;
const listeners = new Set<() => void>();

function emit(): void {
  view = owner ? cache.filter((m) => m.owner === owner) : EMPTY;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function reload(): Promise<void> {
  try {
    cache = await allMutations();
  } catch {
    cache = [];
  }
  loaded = true;
  emit();
}

/**
 * Binds the queue to an account and reads it back off disk.
 *
 * Called from the shell once the session is known, alongside setCacheOwner. A queue is
 * only ever replayed for the account that filled it: replaying it under somebody else's
 * session would either 404 or, far worse, write one person's completion into another
 * person's list.
 */
export async function adoptOutbox(userId: string): Promise<void> {
  if (owner === userId && loaded) return;
  owner = userId;
  await reload();
  // A queue left by a different account on this browser. It can never be replayed —
  // it needed that person's session — so holding it is holding their data for no
  // benefit. This is the account-switch case; an idle lock keeps its own queue,
  // because that is the same person coming back.
  const foreign = cache.filter((m) => m.owner !== userId);
  if (foreign.length > 0) {
    for (const m of foreign) await removeMutation(m.id);
    await reload();
  }
}

/** Everything queued for the current account, oldest first. */
export function pending(): Mutation[] {
  return view;
}

export function pendingFor(reminderId: string): Mutation[] {
  return pending().filter((m) => m.reminderId === reminderId);
}

function newId(): string {
  // randomUUID needs a secure context, which localhost and https both are. The
  // fallback exists for an http origin on a LAN, where it would otherwise throw.
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    out +=
      i === 8 || i === 13 || i === 18 || i === 23
        ? "-"
        : i === 14
          ? "4"
          : i === 19
            ? hex[8 + Math.floor(Math.random() * 4)]
            : hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** A uuid for a reminder about to be created offline, so its create can be replayed. */
export const mintReminderId = newId;

export interface QueueRequest {
  kind: MutationKind;
  reminderId: string;
  label: string;
  payload?: Record<string, unknown>;
}

/**
 * Adds a write to the queue.
 *
 * Throws if the queue is unavailable — private browsing with IndexedDB blocked, say.
 * The caller must surface that rather than report a save that never happened.
 */
export async function queue(req: QueueRequest): Promise<Mutation> {
  if (!owner) throw new Error("Not signed in.");
  if (!OFFLINE_WRITES_ENABLED) throw new Error("Offline changes are turned off.");
  if (!(await outboxAvailable())) {
    throw new Error("This browser won't let the app save changes for later.");
  }
  const m: Mutation = {
    id: newId(),
    owner,
    kind: req.kind,
    reminderId: req.reminderId,
    at: Date.now(),
    payload: req.payload ?? {},
    label: req.label,
    tries: 0,
  };
  await putMutation(m);
  await reload();
  return m;
}

/**
 * Sends now, or queues for later.
 *
 * The one place a page has to think about being offline. It also covers the awkward
 * middle case the flag alone doesn't: a request that leaves while the connection is
 * still up and dies on the way. That failure arrives as an OfflineError, and treating
 * it as a plain error would tell the user their tap did nothing when in fact nothing
 * is known either way — so it is queued as well, and the routes were made idempotent
 * precisely so that a write which did land can be replayed harmlessly.
 *
 * Returns true when the write was queued rather than sent.
 */
export async function sendOrQueue(
  req: QueueRequest,
  send: () => Promise<unknown>,
): Promise<boolean> {
  if (!OFFLINE_WRITES_ENABLED) {
    await send();
    return false;
  }
  if (isOffline()) {
    await queue(req);
    return true;
  }
  try {
    await send();
    return false;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    await queue(req);
    return true;
  }
}

/** Throws a queued write away at the user's request. */
export async function discard(id: string): Promise<void> {
  await removeMutation(id);
  await reload();
}

/** Sign-out. See clearOutbox for why nothing is kept for the next person. */
export async function forgetOutbox(): Promise<void> {
  await clearOutbox();
  owner = null;
  cache = [];
  emit();
}

/**
 * Sends everything queued, in order.
 *
 * The decisions all live in lib/sync.ts; this supplies the storage and the network and
 * announces the result. One flush at a time, because two overlapping replays would
 * send the same mutation twice — which the routes now tolerate, but only because they
 * were made to, and relying on that here would be sloppy.
 */
export async function flush(): Promise<ReplayReport | null> {
  if (!owner || flushing || !OFFLINE_WRITES_ENABLED) return null;
  if (pending().filter((m) => !m.blocked).length === 0) return null;
  flushing = true;
  emit();
  try {
    const report = await replay(
      { all: allMutations, put: putMutation, remove: removeMutation },
      {
        async send({ method, path, body }) {
          try {
            const res = await fetch(`/api${path}`, {
              method,
              headers: { "Content-Type": "application/json" },
              cache: "no-store",
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            // Same rule as services/api.ts: any answer proves the server was reached.
            // It matters here because the flush interval is often the first thing to
            // discover the connection is back, and without this the app would keep
            // saying "offline" over writes it had just successfully sent.
            markOnline();
            let message: string | undefined;
            if (!res.ok) {
              try {
                const parsed = await res.json();
                if (parsed?.message) {
                  message = Array.isArray(parsed.message)
                    ? parsed.message.join(", ")
                    : String(parsed.message);
                }
              } catch {
                /* non-JSON error body */
              }
            }
            return { status: res.status, message };
          } catch (e) {
            // status 0 is "never left the device", which lib/sync reads as deferred.
            markOffline();
            return { status: 0, message: (e as Error).message };
          }
        },
      },
      owner,
    );
    await reload();
    // Anything that landed changed data every cached page may be showing. The pages
    // listen for this and re-read rather than sitting on the optimistic copy.
    if (report && report.applied + report.superseded > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(SYNCED_EVENT));
    }
    return report;
  } finally {
    flushing = false;
    emit();
  }
}

// ------------------------------------------------------------------- projection

/**
 * What the reminder list looks like with the queue applied on top.
 *
 * Without this, completing a bill offline changes nothing on screen: the mutation is
 * safely queued, the refetch behind it fails, and the reminder sits there still due.
 * The user taps again. And again. So the same transitions the server would make are
 * applied locally — including rolling a recurring reminder to its next date, using the
 * very function the route uses.
 *
 * Pending writes are marked so the UI can say "waiting to sync" rather than implying
 * the change is safely on the server.
 */
export interface Projected extends Reminder {
  /** Set when a queued write is what you are looking at. */
  pendingKinds?: MutationKind[];
}

export function projectReminders(
  list: Reminder[],
  queued: Mutation[],
  /**
   * The viewer's zone, so an offline create is placed exactly where the server will
   * place it. Optional only so a caller without it still works — Intl then falls back
   * to the device's own zone, which is nearly always the same thing.
   */
  timeZone?: string,
): Projected[] {
  if (queued.length === 0) return list;

  const byId = new Map<string, Projected>(list.map((r) => [r.id, { ...r }]));
  const mark = (r: Projected, kind: MutationKind) => {
    r.pendingKinds = [...(r.pendingKinds ?? []), kind];
  };

  for (const m of queued) {
    if (m.kind === "create") {
      // Built from the payload the form submitted. `dueAt` is wall-clock text there —
      // the server resolves it in the user's zone — so it is shown as given rather
      // than guessed at, which is right for a date with no time on it anyway.
      const p = m.payload as Record<string, unknown>;
      const raw = String(p.dueAt ?? "");
      // Resolved with the very function the route uses, rather than approximated here.
      // It used to read a date with no time as local noon, which was close enough while
      // the server filled in a fixed default hour — but the server now places an
      // untimed reminder ten minutes out, so the optimistic row said midday and the
      // real one said quarter past four. Two implementations of one rule, and this was
      // the copy nobody would think to update.
      let resolved: { dueAt: Date; hasTime: boolean };
      try {
        resolved = parseDueAt(raw, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        // Unparseable text is the server's 400 to give, not a reason to drop the row
        // from the list it was just added to.
        resolved = { dueAt: new Date(), hasTime: false };
      }
      const created: Projected = {
        id: m.reminderId,
        userId: m.owner,
        title: String(p.title ?? "Untitled"),
        categoryId: String(p.categoryId ?? ""),
        priority: (p.priority as Reminder["priority"]) ?? "normal",
        status: "active",
        dueAt: resolved.dueAt.toISOString(),
        hasTime: resolved.hasTime,
        leadOffsets: Array.isArray(p.leadOffsets) ? (p.leadOffsets as number[]) : [],
        recurrenceRule: (p.recurrenceRule as string) ?? "One Time",
        amount: typeof p.amount === "number" ? p.amount : 0,
        description: (p.description as string) ?? null,
        familyId: (p.familyId as string) ?? null,
        assignedToId: (p.assignedToId as string) ?? null,
        audience: (p.audience as Reminder["audience"]) ?? "owner",
      };
      mark(created, "create");
      byId.set(created.id, created);
      continue;
    }

    const r = byId.get(m.reminderId);
    if (!r) continue; // queued against something this list doesn't hold

    switch (m.kind) {
      case "delete":
        byId.delete(m.reminderId);
        break;
      case "update": {
        const p = m.payload as Record<string, unknown>;
        Object.assign(r, {
          ...(p.title !== undefined ? { title: String(p.title) } : {}),
          ...(p.categoryId !== undefined ? { categoryId: String(p.categoryId) } : {}),
          ...(p.amount !== undefined ? { amount: Number(p.amount) } : {}),
          ...(p.dueAt !== undefined
            ? { dueAt: new Date(String(p.dueAt)).toISOString() }
            : {}),
          ...(p.recurrenceRule !== undefined
            ? { recurrenceRule: String(p.recurrenceRule) }
            : {}),
          ...(p.priority !== undefined
            ? { priority: p.priority as Reminder["priority"] }
            : {}),
        });
        mark(r, "update");
        break;
      }
      case "complete": {
        const next = computeNextDueAt(new Date(r.dueAt), r.recurrenceRule ?? null);
        if (next) {
          r.dueAt = next.toISOString();
          r.status = "active";
          r.snoozedUntil = null;
          r.acknowledgedAt = null;
        } else {
          r.status = "completed";
          r.completedAt = new Date(m.at).toISOString();
          r.snoozedUntil = null;
          r.acknowledgedAt = null;
        }
        mark(r, "complete");
        break;
      }
      case "snooze": {
        const mins = Number((m.payload as { minutes?: number }).minutes ?? 60);
        const until = new Date(m.at + mins * 60_000).toISOString();
        // The later value wins here too, matching the route, so the screen agrees with
        // what the server will end up storing.
        if (!r.snoozedUntil || r.snoozedUntil < until) r.snoozedUntil = until;
        mark(r, "snooze");
        break;
      }
      case "acknowledge":
        if (!r.acknowledgedAt) {
          r.acknowledgedAt = new Date(m.at).toISOString();
          r.acknowledgedById = m.owner;
        }
        mark(r, "acknowledge");
        break;
      case "comment":
        // Nothing on the reminder row itself changes; the thread renders its own
        // pending notes. Marked so the row can show there is something waiting.
        mark(r, "comment");
        break;
    }
  }

  return [...byId.values()];
}

// ------------------------------------------------------------------------ hooks

export interface OutboxView {
  items: Mutation[];
  /** Waiting to be sent. Excludes the ones the server has already refused. */
  waiting: number;
  /** Refused, and needing a decision from the user. */
  blocked: number;
  syncing: boolean;
  ready: boolean;
  flush: () => Promise<void>;
  discard: (id: string) => Promise<void>;
}

/**
 * Re-renders whenever the queue changes.
 *
 * A plain subscription rather than useSyncExternalStore: `syncing` and `ready` change
 * without the item list changing identity, and a store snapshot compared by identity
 * would miss both. The queue is a handful of rows, so re-rendering on every change is
 * cheaper than being clever about it.
 */
export function useOutbox(): OutboxView {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump((n) => n + 1)), []);
  const items = pending();

  return {
    items,
    waiting: items.filter((m) => !m.blocked).length,
    blocked: items.filter((m) => m.blocked).length,
    syncing: flushing,
    ready: loaded,
    flush: useCallback(async () => {
      await flush();
    }, []),
    discard: useCallback(async (id: string) => {
      await discard(id);
    }, []),
  };
}

/**
 * Drains the queue when there is any prospect of it working.
 *
 * Three triggers: the connection returning, the app coming back to the foreground —
 * a phone that was asleep never fires an `online` event — and a slow poll for the
 * case where neither happens because the network never technically went away.
 */
export function useOutboxFlush(): void {
  useEffect(() => {
    if (!OFFLINE_WRITES_ENABLED) return;

    // Deliberately not gated on isOffline(). The flag is only ever cleared by something
    // reaching the server, so gating on it meant a device that came back into coverage
    // without firing an `online` event — a phone waking from sleep, a captive portal
    // finally letting traffic through — sat there believing it was still offline and
    // never tried. An attempt with no connection costs a fetch that fails immediately
    // and is read as deferred, so nothing is lost by trying; and flush() returns
    // straight away when the queue is empty, so the idle case costs nothing at all.
    const attempt = () => void flush();
    attempt();

    const onVisible = () => {
      if (document.visibilityState === "visible") attempt();
    };
    window.addEventListener("online", attempt);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(attempt, 60_000);
    return () => {
      window.removeEventListener("online", attempt);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
}
