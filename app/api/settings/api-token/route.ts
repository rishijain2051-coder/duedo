import { json } from "@/lib/http";
import { apiTokenStatus, mintApiToken, revokeApiToken } from "@/lib/api-token";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The token behind the Siri / Shortcuts capture path.
 *
 * GET says whether one exists and when it was last used; it can never return the token
 * itself, because only a hash is stored. POST issues a fresh one — which is also how an
 * old one is revoked, since there is only ever one per account.
 *
 * Session-authenticated like every other settings route: minting a credential is not
 * something the credential itself may do.
 */
export async function GET() {
  return json((user) => apiTokenStatus(user.id));
}

export async function POST() {
  return json(async (user) => {
    const token = await mintApiToken(user.id);
    await audit({
      actorId: user.id,
      action: "user.api-token.create",
      entity: "user",
      entityId: user.id,
    });
    // The only time the plain value leaves the server.
    return { token };
  }, 201);
}

export async function DELETE() {
  return json(async (user) => {
    await revokeApiToken(user.id);
    await audit({
      actorId: user.id,
      action: "user.api-token.revoke",
      entity: "user",
      entityId: user.id,
    });
    return { revoked: true };
  });
}
