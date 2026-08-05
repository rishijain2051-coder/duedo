"use client";

import { useCallback, useEffect, useState } from "react";
import { Hand, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useApp } from "@/components/app-context";
import { api, type ReminderComment } from "@/services/api";
import { formatDateTime } from "@/lib/format";
import { isOfflineError } from "@/lib/net";
import { sendOrQueue, useOutbox } from "@/lib/offline";
import type { Reminder } from "@/types";

/**
 * Acknowledgement and comments for one reminder, in a sheet.
 *
 * These two belong together because they answer the same question from opposite ends: "is
 * anybody dealing with this?" A tap says yes; a comment says when, or why not. Without
 * them a shared list can only ever show that something is due, and the rest of the
 * conversation happens in WhatsApp — which is the back-and-forth the shared list was meant
 * to remove.
 */
export function ReminderThread({
  reminder,
  onClose,
  onChanged,
  onError,
}: {
  reminder: Reminder | null;
  onClose: () => void;
  onChanged: (updated: Partial<Reminder>) => void;
  onError: (message: string) => void;
}) {
  const { timeZone, user, families } = useApp();
  const [comments, setComments] = useState<ReminderComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * Messages shown *inside* the sheet.
   *
   * They used to go to the page's banner, which renders at the top of the reminders list —
   * behind this modal. Pressing Nudge with nudges switched off therefore looked like
   * nothing happened at all, and the explanation was under the sheet the whole time.
   */
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const { items: queued } = useOutbox();

  const id = reminder?.id ?? null;
  const queuedNotes = queued.filter((m) => m.kind === "comment" && m.reminderId === id);

  const load = useCallback(async () => {
    if (!id) return;
    setComments(null);
    try {
      setComments(await api.reminders.comments(id));
    } catch (e) {
      // Emptied rather than left null. `null` is the loading state, so a failed fetch
      // used to spin forever — which offline is every single time you open this sheet.
      setComments([]);
      if (isOfflineError(e)) {
        setMessage({ text: "Notes can't be loaded while you're offline.", bad: false });
      } else {
        onError((e as Error).message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!reminder) return null;

  const family = families.find((f) => f.id === reminder.familyId) ?? null;
  const claimedBy = reminder.acknowledgedById
    ? (family?.members.find((m) => m.id === reminder.acknowledgedById)?.name ??
      "someone")
    : null;
  const mine = reminder.acknowledgedById === user?.id;

  /**
   * Whether this alert was actually addressed to the person reading it.
   *
   * Mirrors recipientsFor() in lib/recipients.ts, and it has to: only a recipient may
   * acknowledge, so without this the button appears for the creator of an
   * assignee-addressed reminder and comes back 403 — offering an action the server will
   * refuse is worse than not offering it.
   */
  const isRecipient =
    !reminder.familyId || reminder.audience === "owner"
      ? reminder.userId === user?.id
      : reminder.audience === "assignee"
        ? (reminder.assignedToId ?? reminder.userId) === user?.id
        : Boolean(family?.members.some((m) => m.id === user?.id));
  // `family.flags.allowNudges` is the piece that was missing: the route refuses when the
  // household hasn't switched nudges on, so without it the button appeared for every
  // family and came back 403.
  const nudgeable =
    Boolean(reminder.familyId) &&
    family?.flags.allowNudges === true &&
    Boolean(reminder.assignedToId) &&
    reminder.assignedToId !== user?.id &&
    !reminder.acknowledgedAt &&
    new Date(reminder.dueAt) <= new Date();

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: (e as Error).message, bad: true });
      // Still reported upwards, so the failure survives closing the sheet.
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} title={reminder.title}>
      <div className="space-y-4">
        {message && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              message.bad
                ? "border-destructive/40 bg-destructive/10 text-red-700 dark:text-red-400"
                : "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
            }`}
          >
            {message.text}
          </div>
        )}
        {reminder.familyId && (
          <div className="space-y-2 rounded-md border border-border p-3">
            {claimedBy ? (
              <p className="text-sm">
                <span className="font-medium">
                  {mine ? "You said you'd handle this" : `${claimedBy} is handling this`}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(reminder.acknowledgedAt!, true, timeZone)} · escalation is
                  paused
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nobody has said they&apos;re dealing with this yet.
                {!isRecipient && " This one isn't addressed to you."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!claimedBy && isRecipient && (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    act("ack", async () => {
                      const queued = await sendOrQueue(
                        {
                          kind: "acknowledge",
                          reminderId: reminder.id,
                          label: `Claim “${reminder.title}”`,
                        },
                        async () => onChanged(await api.reminders.acknowledge(reminder.id)),
                      );
                      if (queued) {
                        // Shown as claimed straight away. The route is first-wins and
                        // idempotent, so if somebody beat you to it the replay is simply
                        // dropped and the next read shows their name instead.
                        onChanged({
                          acknowledgedAt: new Date().toISOString(),
                          acknowledgedById: user?.id ?? null,
                        });
                        setMessage({
                          text: "Saved on this device — it'll sync when you're online.",
                          bad: false,
                        });
                      }
                    })
                  }
                >
                  {busy === "ack" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Hand className="mr-1 h-3.5 w-3.5" />
                  )}
                  I&apos;ll handle it
                </Button>
              )}
              {mine && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    act("unack", async () => {
                      const res = await api.reminders.unacknowledge(reminder.id);
                      onChanged(res);
                    })
                  }
                >
                  Actually, I can&apos;t
                </Button>
              )}
              {/* Only offered when the family allows it and it is genuinely late — the
                  route refuses otherwise, and a button that always 403s is worse than
                  no button. */}
              {nudgeable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    act("nudge", async () => {
                      const res = await api.reminders.nudge(reminder.id);
                      setMessage({ text: `Nudged ${res.nudged}.`, bad: false });
                    })
                  }
                >
                  Nudge {reminder.assignedTo?.name ?? "them"}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Notes</p>
          {comments === null ? (
            <div className="flex items-center py-4 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : comments.length === 0 && queuedNotes.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="max-h-60 space-y-2 overflow-y-auto">
              {comments.map((c) => (
                <li key={c.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.self ? "You" : c.author}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt, true, timeZone)}
                      {c.self && (
                        <button
                          title="Delete"
                          className="text-destructive"
                          onClick={() =>
                            act(`del-${c.id}`, async () => {
                              await api.reminders.removeComment(reminder.id, c.id);
                              await load();
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
                </li>
              ))}
              {/* Written offline and still in the queue. Shown in the thread so the note
                  is visible where it was written, and labelled so it isn't mistaken for
                  something the rest of the family can already read. */}
              {queuedNotes.map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">You</span>
                    <span className="text-xs text-muted-foreground">waiting to sync</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words">
                    {String((m.payload as { body?: string }).body ?? "")}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="I'll pay this on Monday…"
              rows={2}
            />
            <Button
              size="icon"
              title="Add note"
              disabled={busy !== null || draft.trim().length === 0}
              onClick={() =>
                act("say", async () => {
                  const body = draft.trim();
                  const queued = await sendOrQueue(
                    {
                      kind: "comment",
                      reminderId: reminder.id,
                      label: `Note on “${reminder.title}”`,
                      payload: { body },
                    },
                    () => api.reminders.comment(reminder.id, body),
                  );
                  setDraft("");
                  // Queued notes render from the outbox below, so there is nothing to
                  // refetch — and the refetch would fail anyway.
                  if (!queued) await load();
                })
              }
            >
              {busy === "say" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
