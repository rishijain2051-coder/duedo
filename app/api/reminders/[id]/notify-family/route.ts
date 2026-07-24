import { NextRequest } from "next/server";
import { HttpError, json } from "@/lib/http";
import { notifyFamilyAboutReminder } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return json(async () => {
    const { id } = await ctx.params;
    const result = await notifyFamilyAboutReminder(id);
    if (!result) throw new HttpError(404, "Reminder not found");
    return result;
  });
}
