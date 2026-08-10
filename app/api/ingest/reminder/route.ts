import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bearerFrom, userForApiToken } from "@/lib/api-token";
import { parseDictation } from "@/lib/dictation";
import { HttpError } from "@/lib/http";
import { formatTimeInZone } from "@/lib/time";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { assertReminderDestination, assertReminderFields } from "@/lib/reminder-scope";
import { assertReminderRoom, hasFeature, PLAN_LIMIT_STATUS } from "@/lib/plan-guard";
import { REMINDER_INCLUDE } from "@/lib/reminder-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * JSON, or just the sentence when the caller asks for text.
 *
 * A Shortcut speaks the reply, and digging the sentence out of a JSON field needs an
 * extra action whose input is easy to wire wrong — and wrong there means silence, with
 * the screen off and no way to tell a failed capture from a quiet one. `Accept:
 * text/plain` makes the body the sentence itself, so Speak Text can take the response
 * directly and the shortcut is three actions instead of four.
 *
 * Errors answer the same way. An error nobody can hear is the exact failure this
 * endpoint exists to avoid.
 */
function reply(
  req: NextRequest,
  status: number,
  body: Record<string, unknown> & { spoken: string },
): NextResponse {
  if ((req.headers.get("accept") ?? "").includes("text/plain")) {
    return new NextResponse(body.spoken, {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(body, { status });
}

/**
 * PUBLIC by token — one spoken sentence in, one reminder out.
 *
 * Built for Apple Shortcuts: Dictate Text feeds `text`, and the reply is read back
 * aloud. That shapes two decisions:
 *
 *   * it does not use `json()`. That helper resolves a session cookie, and a Shortcut
 *     has no cookie jar — it carries a bearer token instead. Auth is therefore done by
 *     hand, and is the first thing in the function;
 *   * every failure answers with a `spoken` sentence as well as a status, because a
 *     shortcut that fails silently is indistinguishable from one that worked. The
 *     screen is off; the sentence is the only feedback there is.
 *
 * The token authorises this route and nothing else — see lib/api-token.ts.
 */
export async function POST(req: NextRequest) {
  const token =
    bearerFrom(req.headers.get("authorization")) ||
    // Shortcuts can set headers, but the body is fewer taps to configure and people
    // get the header wrong. Same credential either way.
    (await peekToken(req));

  const user = await userForApiToken(token);
  if (!user) {
    return reply(req, 401, {
      message: "Not authorised",
      spoken: "That shortcut isn't linked to an account any more.",
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply(req, 400, {
      message: "Body was not valid JSON",
      spoken: "I couldn't read that.",
    });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return reply(req, 400, { message: "Nothing to add", spoken: "I didn't catch that." });
  }

  // Voice is a paid feature, checked here as well as where the token is issued.
  // The token never expires by design, so a shortcut outlives a lapse — this is what
  // makes the entitlement lapse with it. Checked before the category lookup below so
  // an unentitled call costs one query rather than three.
  if (!hasFeature(user, "voice")) {
    return reply(req, PLAN_LIMIT_STATUS, {
      message: "Adding reminders by voice is a paid feature.",
      spoken: "Adding by voice needs a paid plan. Open the app to upgrade.",
    });
  }

  // Which list. `scope` is optional and defaults to personal, so the common shortcut
  // sends only `text`. A family id is verified by assertReminderDestination below, so
  // one supplied here cannot reach a list this account isn't in.
  const scope = typeof body.scope === "string" && body.scope !== "mine" ? body.scope : null;

  // Categories are matched by name, so only the ones this scope can actually use are
  // offered to the parser — otherwise a spoken "under Bills" could match a category
  // belonging to a family the reminder isn't going to.
  const categories = await prisma.category.findMany({
    where: scope ? { familyId: scope } : { userId: user.id },
    select: { id: true, name: true },
  });

  const parsed = parseDictation({
    text,
    now: new Date(),
    timeZone: user.timezone,
    categories,
  });

  if (!parsed.title) {
    return reply(req, 400, {
      message: "No title in that",
      spoken: "I heard a date but nothing to be reminded about.",
    });
  }

  try {
    // The same cap the form enforces. This route is a create path that does not go
    // through the form, which is exactly the door a paywall gets walked around.
    // HttpError from here is spoken back by the catch below.
    await assertReminderRoom(user);

    const data = sanitizeReminderInput(
      {
        title: parsed.title,
        dueAt: parsed.dueAt,
        categoryId: parsed.categoryId ?? null,
        amount: parsed.amount ?? 0,
        recurrenceRule: parsed.recurrenceRule,
        priority: parsed.priority,
        description: parsed.description ?? null,
        familyId: scope,
        audience: scope ? "family" : "owner",
      },
      true,
      user.timezone,
    );
    assertReminderFields(data, true);
    await assertReminderDestination(data, user.id, null, true);

    const reminder = await prisma.reminder.create({
      // Ownership from the token's account, never from the body — the same rule the
      // cookie-authenticated route follows.
      data: { ...data, userId: user.id } as never,
      include: REMINDER_INCLUDE,
    });

    return reply(req, 201, {
      id: reminder.id,
      title: reminder.title,
      dueAt: reminder.dueAt.toISOString(),
      understood: parsed.understood,
      dateAssumed: parsed.dateAssumed,
      // The time comes from the saved row, not from what was heard. With no time
      // spoken the reminder lands ten minutes out, and a reply that said only "today"
      // would leave the one fact worth hearing unsaid.
      spoken: speak(
        parsed.title,
        `${parsed.datePhrase} at ${formatTimeInZone(reminder.dueAt, user.timezone)}`,
        parsed.understood,
      ),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return reply(req, err.status, { message: err.message, spoken: err.message });
    }
    console.error("[ingest] could not add:", err);
    return reply(req, 500, {
      message: "Could not add that",
      spoken: "Something went wrong saving that.",
    });
  }
}

/** A sentence Siri can read back. Only mentions what was actually recognised. */
function speak(title: string, when: string, extras: string[]): string {
  const tail = extras.length > 0 ? `, ${extras.join(", ")}` : "";
  return `Added ${title}, ${when}${tail}.`;
}

/**
 * The token from the body, for a shortcut configured without a header.
 *
 * Reads the request twice, which is why it clones: the caller still needs the body.
 */
async function peekToken(req: NextRequest): Promise<string> {
  try {
    const copy = req.clone();
    const parsed = (await copy.json()) as Record<string, unknown>;
    return typeof parsed?.token === "string" ? parsed.token : "";
  } catch {
    return "";
  }
}

/** Kept unused-method-safe: anything but POST is a mistake worth naming. */
export async function GET(req: NextRequest) {
  return reply(req, 405, {
    message: "POST a JSON body of { text } with your API token.",
    spoken: "That shortcut is set up wrong.",
  });
}
