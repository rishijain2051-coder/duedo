import { NextRequest, NextResponse } from "next/server";
import { confirmContact } from "@/lib/external-contacts";
import { escapeHtml } from "@/lib/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC — the yes/no in a consent email.
 *
 * Deliberately reachable without a session: the person answering is not a user of this app
 * and never will be. The token is the whole credential, which is why it is CSPRNG-generated
 * and stored only as an HMAC.
 *
 * Answers with a small HTML page rather than redirecting into the app. Sending someone who
 * declined to a login screen would be absurd, and they have no account to land in.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const answer = req.nextUrl.searchParams.get("answer") ?? "yes";
  const result = await confirmContact(token, answer);
  const appName = process.env.APP_NAME || "DueDo";

  if (!result.ok) {
    return page(
      appName,
      "That link has already been used",
      "Nothing has changed. If you meant to block this address and it is still receiving mail, reply to one of the messages and the sender can remove you.",
      400,
    );
  }

  return result.answer === "yes"
    ? page(
        appName,
        "Thanks — you're set",
        `${result.email} will now get a message only when something the sender asked about is overdue. Nothing else, and no account was created for you.`,
      )
    : page(
        appName,
        "Blocked",
        `${result.email} will never be contacted through ${appName} again, by anyone. No further action is needed.`,
      );
}

/**
 * Inline HTML rather than a React route.
 *
 * This is read once, by someone who has never seen the app, usually in a webmail preview
 * pane. Shipping the whole client bundle to render two sentences would be slower and no
 * clearer.
 */
function page(appName: string, heading: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(heading)} · ${escapeHtml(appName)}</title>
<style>
  body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;
       margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;background:#f9fafb}
  main{max-width:32rem;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px}
  h1{margin:0 0 8px;font-size:20px}
  p{margin:0;color:#374151}
  small{display:block;margin-top:20px;color:#9ca3af}
</style>
</head><body><main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(body)}</p>
<small>${escapeHtml(appName)}</small>
</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
