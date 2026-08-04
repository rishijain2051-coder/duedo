import { NextResponse } from "next/server";
import { resolveSession, type AuthUser } from "./auth";

export type { AuthUser };

/** Throw from a handler to return a specific status + message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The request body as an object, for handlers that run inside `json`/`jsonAdmin`.
 *
 * Three cases, deliberately distinguished:
 *   * no body at all  →  `{}`, because several routes are called bodyless and mean
 *     "nothing to change" (the Snooze action on a notification, for one)
 *   * valid JSON      →  the object
 *   * present but not JSON  →  400
 *
 * The last case is the reason this exists. `await req.json()` throws a SyntaxError
 * on a mangled body, which `run` below can only report as a 500 — so a client bug
 * looked like a server outage in the logs, and the caller was told "Internal
 * server error" about their own malformed request. Swallowing it with
 * `.catch(() => ({}))` instead goes too far the other way: a truncated payload
 * would then be silently treated as an empty one and quietly do nothing.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    // A bare `null`, string or array is not something any handler here expects.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new HttpError(400, "The request body was not valid JSON.");
  }
}

/**
 * Runs a handler for a PROTECTED data route: requires a valid login session
 * (401 otherwise), then returns JSON and maps HttpError / unknown errors.
 *
 * The resolved caller is handed to the handler, which is what makes scoping
 * ergonomic — every data route filters by `user.id`, so it is passed in rather
 * than fetched again. Public endpoints (auth, cron, health, version) build their
 * NextResponse directly and do not use this helper.
 */
export async function json<T>(
  fn: (user: AuthUser) => Promise<T>,
  okStatus = 200,
): Promise<NextResponse> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  return run(() => fn(session.user), okStatus);
}

/** As `json`, but 403s anyone who isn't an admin. */
export async function jsonAdmin<T>(
  fn: (user: AuthUser) => Promise<T>,
  okStatus = 200,
): Promise<NextResponse> {
  const session = await resolveSession();
  if (!session) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { message: "Only an admin can do that." },
      { status: 403 },
    );
  }
  return run(() => fn(session.user), okStatus);
}

async function run<T>(fn: () => Promise<T>, okStatus: number) {
  try {
    const data = await fn();
    return NextResponse.json(data as object, { status: okStatus });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("[api] unhandled error:", err);
    return NextResponse.json(
      { message: (err as Error)?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * The caller, or null. Resolving also enforces expiry, the inactivity timeout
 * and account status, and refreshes lastSeenAt.
 */
export async function currentUser(): Promise<AuthUser | null> {
  return (await resolveSession())?.user ?? null;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await resolveSession()) !== null;
}
