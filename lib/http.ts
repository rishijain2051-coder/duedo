import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from "./session";

/** Throw from a handler to return a specific status + message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Runs a handler, returning JSON and mapping HttpError / unknown errors to responses. */
export async function json<T>(
  fn: () => Promise<T>,
  okStatus = 200,
): Promise<NextResponse> {
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

/** Reads the logged-in member from the session cookie (route handlers only). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
