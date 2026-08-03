import { jsonAdmin } from "@/lib/http";
import { deliveryHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Default limit (3). The failure counters and the last-run error cover the
  // whole picture; the list is just the most recent evidence.
  return jsonAdmin(() => deliveryHealth());
}
