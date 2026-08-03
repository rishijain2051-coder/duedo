import { jsonAdmin } from "@/lib/http";
import { deliveryHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonAdmin(() => deliveryHealth(40));
}
