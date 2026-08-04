import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registers (or refreshes) a device's push subscription for the caller. Upserted
 * on endpoint so re-granting permission on the same device updates the keys
 * instead of piling up duplicate rows — iOS rotates these fairly readily.
 *
 * `silent: true` marks the automatic re-registration the app performs on every
 * load. That must NOT resurrect a device the same user revoked from Settings,
 * otherwise revoking is meaningless. Only a deliberate "enable notifications" tap
 * on the device itself (silent omitted/false) clears the block.
 *
 * The multi-user wrinkle: a browser has exactly one push endpoint, so if somebody
 * else was signed in here before, the row already exists under *their* id. It gets
 * reassigned to the caller — including clearing any block, which belonged to the
 * previous owner and says nothing about this one. Not reassigning would be the
 * real bug: their private reminders would keep pushing to a device someone else is
 * now holding.
 */
export async function POST(req: NextRequest) {
  return json(async (user) => {
    const body = await readJson(req);
    const endpoint = body.endpoint;
    const keys = (body.keys ?? {}) as Record<string, unknown>;
    const p256dh = keys.p256dh;
    const auth = keys.auth;

    if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
      throw new HttpError(400, "A valid https push endpoint is required.");
    }
    if (typeof p256dh !== "string" || typeof auth !== "string") {
      throw new HttpError(400, "Subscription is missing its p256dh/auth keys.");
    }

    const silent = body?.silent === true;
    const label = typeof body.label === "string" ? body.label.slice(0, 80) : null;

    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
      select: { userId: true, blockedAt: true },
    });

    const isHandover = existing !== null && existing.userId !== user.id;

    // Only the owner's own block stands in the way of a silent refresh.
    if (silent && existing?.blockedAt && !isHandover) {
      return { subscribed: false, blocked: true };
    }

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.id, endpoint, p256dh, auth, label },
      update: {
        userId: user.id,
        p256dh,
        auth,
        label,
        failures: 0,
        blockedAt: null,
      },
    });
    return { id: sub.id, subscribed: true, blocked: false };
  }, 201);
}
