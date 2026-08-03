import { NextRequest } from "next/server";
import { HttpError, json } from "@/lib/http";
import {
  listSessions,
  resolveSession,
  destroySessionById,
  revokeOtherSessions,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own active logins, with the current one marked. */
export async function GET() {
  return json(async (user) => {
    const [sessions, current] = await Promise.all([
      listSessions(user.id),
      resolveSession(),
    ]);
    return sessions.map((s) => ({ ...s, current: s.id === current?.id }));
  });
}

/**
 * DELETE ?id=<session>  revokes one of the caller's logins
 * DELETE ?others=1      revokes every login except the caller's
 *
 * Revoking your own session is allowed — it's just a logout — but the client has
 * to clear the cookie too, so it's reported back. Every delete is scoped to the
 * caller, so an id belonging to somebody else simply revokes nothing.
 */
export async function DELETE(req: NextRequest) {
  return json(async (user) => {
    const current = await resolveSession();
    if (!current) throw new HttpError(401, "Not authenticated");

    if (req.nextUrl.searchParams.get("others") === "1") {
      return {
        revoked: await revokeOtherSessions(user.id, current.id),
        selfRevoked: false,
      };
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new HttpError(400, "Pass ?id= or ?others=1");

    const revoked = await destroySessionById(id, user.id);
    return { revoked, selfRevoked: id === current.id };
  });
}
