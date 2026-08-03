import { NextResponse } from "next/server";
import { currentUser } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session probe used by the app shell to decide whether to redirect. */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
  });
}
