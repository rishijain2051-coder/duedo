import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which push service an endpoint belongs to — enough to recognise a device. */
function serviceOf(endpoint: string): string {
  if (endpoint.includes("web.push.apple.com")) return "Apple (iPhone/iPad)";
  if (endpoint.includes("fcm.googleapis.com")) return "Google (Chrome/Android)";
  if (endpoint.includes("mozilla")) return "Mozilla (Firefox)";
  if (endpoint.includes("notify.windows.com")) return "Microsoft (Edge)";
  return "Other";
}

export async function GET() {
  return json(async (user) => {
    const rows = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      service: serviceOf(r.endpoint),
      // Enough of the endpoint to tell two devices apart, without shipping the
      // whole capability URL to the client.
      fingerprint: r.endpoint.slice(-12),
      failures: r.failures,
      lastOkAt: r.lastOkAt,
      createdAt: r.createdAt,
      blocked: r.blockedAt !== null,
    }));
  });
}

/**
 * DELETE ?id=<row>          revoke one device
 * DELETE ?id=<row>&purge=1  forget it entirely
 * DELETE ?all=1             revoke every device
 *
 * Revoking *blocks* rather than deletes. The app re-registers each device on
 * every load, so a deleted row would simply reappear the next time that device
 * was opened; a blocked row is kept precisely so the block sticks. Only an
 * explicit "enable notifications" on that device lifts it.
 *
 * Every branch is filtered by the caller, so these can't touch anyone else's
 * devices.
 */
export async function DELETE(req: NextRequest) {
  return json(async (user) => {
    const params = req.nextUrl.searchParams;
    const now = new Date();
    const mine = { userId: user.id };

    if (params.get("all") === "1") {
      const res = await prisma.pushSubscription.updateMany({
        where: { ...mine, blockedAt: null },
        data: { blockedAt: now },
      });
      return { blocked: res.count, purged: 0 };
    }

    const id = params.get("id");
    if (!id) throw new HttpError(400, "Pass ?id= or ?all=1");

    // Purging is for a device that's genuinely gone — nothing will re-register
    // it, so there's no block to preserve.
    if (params.get("purge") === "1") {
      const res = await prisma.pushSubscription.deleteMany({ where: { ...mine, id } });
      return { blocked: 0, purged: res.count };
    }

    const res = await prisma.pushSubscription.updateMany({
      where: { ...mine, id },
      data: { blockedAt: now },
    });
    return { blocked: res.count, purged: 0 };
  });
}
