import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bearerFrom, userForApiToken } from "@/lib/api-token";
import { parseDictation } from "@/lib/dictation";
import { HttpError } from "@/lib/http";
import { sanitizeReminderInput } from "@/lib/reminder-logic";
import { assertReminderDestination, assertReminderFields } from "@/lib/reminder-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCLUDE = {
  category: true,
  family: { select: { id: true, name: true } },
} as const;

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
    return NextResponse.json(
      { message: "Not authorised", spoken: "That shortcut isn't linked to an account any more." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { message: "Body was not valid JSON", spoken: "I couldn't read that." },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json(
      { message: "Nothing to add", spoken: "I didn't catch that." },
      { status: 400 },
    );
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
    defaultTime: user.defaultTime,
    categories,
  });

  if (!parsed.title) {
    return NextResponse.json(
      {
        message: "No title in that",
        spoken: "I heard a date but nothing to be reminded about.",
      },
      { status: 400 },
    );
  }

  try {
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
      user.defaultTime,
    );
    assertReminderFields(data, true);
    await assertReminderDestination(data, user.id, null, true);

    const reminder = await prisma.reminder.create({
      // Ownership from the token's account, never from the body — the same rule the
      // cookie-authenticated route follows.
      data: { ...data, userId: user.id } as never,
      include: INCLUDE,
    });

    return NextResponse.json(
      {
        id: reminder.id,
        title: reminder.title,
        dueAt: reminder.dueAt,
        understood: parsed.understood,
        dateAssumed: parsed.dateAssumed,
        spoken: speak(parsed.title, parsed.understood),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(
        { message: err.message, spoken: err.message },
        { status: err.status },
      );
    }
    console.error("[ingest] could not add:", err);
    return NextResponse.json(
      { message: "Could not add that", spoken: "Something went wrong saving that." },
      { status: 500 },
    );
  }
}

/** A sentence Siri can read back. Only mentions what was actually recognised. */
function speak(title: string, understood: string[]): string {
  const [when, ...extras] = understood;
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
export async function GET() {
  return NextResponse.json(
    {
      message: "POST a JSON body of { text } with your API token.",
      spoken: "That shortcut is set up wrong.",
    },
    { status: 405 },
  );
}
