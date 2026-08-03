import webpush, { type WebPushError } from "web-push";
import { prisma } from "./db";

// Node-only (web-push uses node:crypto). Import from route handlers, never from
// client components.
//
// Everything here is scoped to one user: reminders are private, so a push must
// only ever reach the devices belonging to the account that owns the reminder.

const MAX_CONSECUTIVE_FAILURES = 5;

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidReady = false;
function configureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@example.com",
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    vapidReady = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Collapse key — a later push with the same tag replaces the earlier one. */
  tag?: string;
  reminderId?: string;
  kind?: "lead" | "due" | "overdue" | "test";
  /** Rendered on the Home Screen icon by the service worker. */
  badge?: number;
  url?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  pruned: number;
  subscriptions: number;
}

/**
 * Fans a notification out to every device registered by `userId`.
 *
 * A 404/410 from the push service means the subscription is permanently gone, so
 * the row is deleted immediately. Other errors are transient (network, 5xx), so
 * they only bump a counter and the row is dropped once it has failed
 * MAX_CONSECUTIVE_FAILURES times in a row.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  // Revoked devices keep their row (so the block survives the app's self-repair)
  // but must never be sent to.
  const subs = await prisma.pushSubscription.findMany({
    where: { userId, blockedAt: null },
  });
  const result: PushResult = {
    sent: 0,
    failed: 0,
    pruned: 0,
    subscriptions: subs.length,
  };
  if (!configureVapid() || subs.length === 0) return result;

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          // iOS is stricter than Chrome: a high-urgency push with a real TTL is
          // far more likely to wake an installed PWA promptly.
          { TTL: 60 * 60, urgency: "high" },
        );
        result.sent++;
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastOkAt: new Date(), failures: 0 },
        });
      } catch (err) {
        result.failed++;
        const status = (err as WebPushError)?.statusCode;
        const gone = status === 404 || status === 410;
        if (gone || sub.failures + 1 >= MAX_CONSECUTIVE_FAILURES) {
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .then(() => {
              result.pruned++;
            })
            .catch(() => {
              /* already removed by a concurrent run */
            });
        } else {
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { failures: { increment: 1 } },
          });
        }
        if (!gone) {
          console.error(
            `[push] send failed (status ${status ?? "?"}) for ${sub.endpoint.slice(0, 48)}…`,
          );
        }
      }
    }),
  );

  return result;
}

/** This user's devices that can actually be reached. Reported even on an idle run. */
export function countSubscriptions(userId: string): Promise<number> {
  return prisma.pushSubscription.count({
    where: { userId, blockedAt: null },
  });
}

// The Home Screen badge count lives in lib/recipients.ts as countOutstandingFor(),
// not here: once a family reminder can be addressed to someone who didn't create
// it, "what am I on the hook for" is an audience question rather than an ownership
// one, and it has to agree with whatever the dispatcher decided.
