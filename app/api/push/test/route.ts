import { json, HttpError } from "@/lib/http";
import { sendTestPush } from "@/lib/dispatch";
import { isPushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return json(async (user) => {
    if (!isPushConfigured()) {
      throw new HttpError(
        503,
        "Push is not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
      );
    }
    const result = await sendTestPush(user.id);
    if (result.subscriptions === 0) {
      throw new HttpError(
        400,
        "No device of yours is subscribed yet. Enable notifications on your phone first.",
      );
    }
    return result;
  });
}
