"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Plus,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  Loader2,
  BellOff,
  BellRing,
  Hand,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DateField } from "@/components/ui/date-field";
import { useApp } from "@/components/app-context";
import { ScopeTabs } from "@/components/scope-tabs";
import { ReminderThread } from "@/components/reminder-thread";
import { EscalationEditor } from "@/components/escalation-editor";
import { useCached } from "@/lib/cache";
import {
  mintReminderId,
  projectReminders,
  sendOrQueue,
  useOutbox,
} from "@/lib/offline";
import { api } from "@/services/api";
import {
  formatCurrency,
  formatDateTime,
  reminderStatus,
  toDateKey,
  toDateTimeInputValue,
} from "@/lib/format";
import { MAX_DESCRIPTION, MAX_REMARKS, MAX_TITLE } from "@/lib/reminder-logic";
import { LEAD_OFFSET_OPTIONS, UNTIMED_LEAD_MINUTES } from "@/lib/time";
import {
  AUDIENCE_OPTIONS,
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
  SNOOZE_OPTIONS,
  type Audience,
  type Category,
  type EscalationStep,
  type Reminder,
} from "@/types";

const STATUS_FILTERS = ["all", "active", "completed", "archived"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const emptyForm = {
  title: "",
  categoryId: "",
  /** Split from a single datetime-local: the date is nearly always today, the time
      nearly never is, and one control made you re-pick both every time. */
  dueDate: "",
  dueTime: "",
  amount: "",
  recurrenceRule: "One Time",
  priority: "normal",
  description: "",
  leadOffsets: [] as number[],
  /** null = the personal list. */
  familyId: null as string | null,
  assignedToId: "",
  audience: "owner" as Audience,
  escalation: [] as EscalationStep[],
};

/** Stable identities, so empty results don't invalidate hook deps every render. */
const NO_REMINDERS: Reminder[] = [];
const NO_CATEGORIES: Category[] = [];

/** Default lead times for a brand-new reminder: a day ahead and an hour ahead. */
const DEFAULT_LEADS = [1440, 60];

/** The instant a reminder saved right now with no time chosen would land on. */
const soon = () => new Date(Date.now() + UNTIMED_LEAD_MINUTES * 60_000);

/** "HH:mm" in the user's zone, for <input type="time">. */
const toClockValue = (d: Date, timeZone?: string) =>
  toDateTimeInputValue(d, timeZone).slice(11);

function isSnoozed(r: Reminder): boolean {
  return Boolean(r.snoozedUntil && new Date(r.snoozedUntil) > new Date());
}

export default function RemindersPage() {
  // `scope` is shared app state, not local: picking a family here and then opening the
  // dashboard used to put you silently back on your personal list.
  const { timeZone, syncBadge, families, scope, setScope } = useApp();
  const activeFamily = families.find((f) => f.id === scope) ?? null;

  // Cached per scope so switching tabs doesn't re-spinner, and a repeat visit
  // paints before the request lands. Categories come scoped too, so a family
  // reminder can only be filed under that family's own categories.
  const {
    data,
    loading,
    error: loadError,
    refresh: load,
  } = useCached(`reminders-${scope}`, async () => {
    const [rem, cats] = await Promise.all([
      api.reminders.list(scope),
      api.categories.list(scope),
    ]);
    return { rem, cats };
  });
  // Anything queued while offline is laid over the list, so a bill marked paid looks
  // paid. Without it the write is safely queued, the refetch behind it fails, the row
  // sits there still due — and the user taps Complete again.
  const { items: queued } = useOutbox();
  const categories = data?.cats ?? NO_CATEGORIES;
  const reminders = useMemo(() => {
    const projected = projectReminders(data?.rem ?? NO_REMINDERS, queued, timeZone);
    // A reminder created offline holds only the categoryId it was filed under — the
    // joined category comes back with the server's copy. Resolved from the list already
    // on screen so a new row shows "Bills" rather than an em dash.
    return projected.map((r) =>
      r.category ? r : { ...r, category: categories.find((c) => c.id === r.categoryId) },
    );
  }, [data?.rem, categories, queued, timeZone]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("active");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [completing, setCompleting] = useState<Reminder | null>(null);
  const [completeAmount, setCompleteAmount] = useState("");
  const [completeRemarks, setCompleteRemarks] = useState("");
  const [snoozing, setSnoozing] = useState<Reminder | null>(null);
  const [thread, setThread] = useState<Reminder | null>(null);
  const shortcutHandled = useRef(false);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      // No category pre-selected. Leaving it blank files the reminder under "Others",
      // so the common case is one less decision rather than a wrong guess to correct.
      categoryId: "",
      // Today, and ten minutes from now — the same rule the server applies when no
      // time is given, so what the form shows is what would happen if you left it
      // alone. It used to prefill 05:30, which meant a reminder added mid-afternoon
      // and saved without a thought was booked for the small hours.
      dueDate: toDateKey(soon(), timeZone),
      dueTime: toClockValue(soon(), timeZone),
      // Only the ones that fit. With the due instant ten minutes out that is none of
      // them, which is the honest answer — a day's notice of something happening in
      // ten minutes is not an alert anybody can be given.
      leadOffsets: DEFAULT_LEADS.filter(
        (m) => soon().getTime() - m * 60_000 > Date.now(),
      ),
      // New reminders land on whichever list you're looking at, and a family one
      // defaults to telling the whole family — the common case for a shared bill.
      familyId: scope === "mine" ? null : scope,
      audience: scope === "mine" ? "owner" : "family",
    });
    setFormOpen(true);
  }, [scope, timeZone]);

  // Home Screen shortcut: /reminders?new=1 opens the form directly. Read straight
  // off the URL rather than via useSearchParams, which would force this whole page
  // behind a Suspense boundary just for a client-only nicety.
  useEffect(() => {
    // Waits on neither categories nor settings any more: categories are optional, and
    // the default time is now computed from the clock rather than read from the
    // account, so there is nothing left to arrive first.
    if (shortcutHandled.current || loading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      shortcutHandled.current = true;
      openCreate();
      window.history.replaceState(null, "", "/reminders");
      return;
    }
    // From the Assign action on a push notification. A notification's buttons are fixed
    // when it is sent, so no picker can live inside one — this opens the reminder with the
    // assignee field in front of the user instead. One tap to the picker.
    const assign = params.get("assign");
    if (assign) {
      shortcutHandled.current = true;
      const target = reminders.find((r) => r.id === assign);
      window.history.replaceState(null, "", "/reminders");
      if (target) {
        openEdit(target);
      } else {
        // The list on screen holds one scope, and the service worker only offers Assign
        // on a *family* push — so the reminder it names is usually on a list the user
        // isn't currently looking at. Finding nothing used to end here silently: the
        // notification opened the app and then nothing happened, which is the common
        // case rather than the edge one. Fetching it by id and switching to its list is
        // what makes the button do what it says.
        void (async () => {
          try {
            const one = await api.reminders.get(assign);
            setScope(one.familyId ?? "mine");
            openEdit(one);
          } catch {
            setError("That reminder isn't there any more — it may have been deleted.");
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, openCreate, reminders, setScope]);

  const visible = reminders.filter((r) =>
    filter === "all" ? true : r.status === filter,
  );

  function openEdit(r: Reminder) {
    setEditingId(r.id);
    setForm({
      title: r.title,
      categoryId: r.categoryId,
      // "yyyy-mm-ddThh:mm" split back into the two controls.
      dueDate: toDateKey(r.dueAt, timeZone),
      dueTime: r.hasTime === false ? "" : toDateTimeInputValue(r.dueAt, timeZone).slice(11),
      amount: r.amount ? String(r.amount) : "",
      recurrenceRule: r.recurrenceRule ?? "One Time",
      priority: r.priority ?? "normal",
      description: r.description ?? "",
      leadOffsets: r.leadOffsets ?? [],
      familyId: r.familyId ?? null,
      assignedToId: r.assignedToId ?? "",
      audience: r.audience ?? "owner",
      escalation: r.escalation ?? [],
    });
    setFormOpen(true);
  }

  /**
   * Which advance alerts the chosen due instant still leaves room for.
   *
   * A lead point already in the past is never sent — planFires refuses to back-fill,
   * so adding "1 week before" to something due tomorrow fires nothing. The form used
   * to show those ticked anyway, and after untimed reminders started landing ten
   * minutes out that was the normal case: a new reminder offered "1 day before" and
   * "1 hour before" pre-selected, neither of which could ever happen.
   */
  const leadFits = useCallback(
    (minutes: number) => {
      if (!form.dueDate) return true;
      const due = new Date(
        form.dueTime ? `${form.dueDate}T${form.dueTime}` : `${form.dueDate}T23:59`,
      );
      if (Number.isNaN(due.getTime())) return true;
      return due.getTime() - minutes * 60_000 > Date.now();
    },
    [form.dueDate, form.dueTime],
  );

  // Drop any that stop fitting when the due instant moves. Done here rather than at
  // submit so the tick disappears as the date is changed — a checkbox that silently
  // means nothing is worse than one that is visibly unavailable.
  useEffect(() => {
    setForm((f) => {
      const kept = f.leadOffsets.filter((m) => leadFits(m));
      return kept.length === f.leadOffsets.length ? f : { ...f, leadOffsets: kept };
    });
  }, [leadFits]);

  function toggleLead(minutes: number) {
    setForm((f) => ({
      ...f,
      leadOffsets: f.leadOffsets.includes(minutes)
        ? f.leadOffsets.filter((m) => m !== minutes)
        : [...f.leadOffsets, minutes],
    }));
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.dueDate) {
      setError("A title and a due date are required.");
      return;
    }
    setSaving(true);
    try {
      // dueAt is sent as wall-clock text; the server resolves it in your zone, and
      // places it ten minutes out when no time was picked.
      const payload = {
        title: form.title,
        // null, not "", when nothing was picked: the server reads null as "file it
        // under Others" and would treat an empty string as a malformed id.
        categoryId: form.categoryId || null,
        // Recombined into the wall-clock text the server already parses. No time
        // given means the date alone, which it fills with your default.
        dueAt: form.dueTime ? `${form.dueDate}T${form.dueTime}` : form.dueDate,
        amount: form.amount ? Number(form.amount) : 0,
        recurrenceRule: form.recurrenceRule,
        priority: form.priority,
        description: form.description || null,
        leadOffsets: form.leadOffsets,
        familyId: form.familyId,
        // Both are meaningless on a personal reminder; the server normalises them
        // away too, but sending null keeps the intent obvious in the request.
        assignedToId: form.familyId ? form.assignedToId || null : null,
        audience: form.familyId ? form.audience : "owner",
        // An empty list is sent as null, so a reminder with no chain stores nothing and
        // takes exactly the paths it did before escalation existed.
        escalation: form.escalation.length > 0 ? form.escalation : null,
      };
      if (editingId) {
        // The version this edit was composed against. The server refuses the write if
        // the reminder has moved on since — the one conflict that is undetectable
        // afterwards, so it is the one that is refused rather than merged.
        const basedOn = reminders.find((r) => r.id === editingId)?.updatedAt;
        const queued = await sendOrQueue(
          {
            kind: "update",
            reminderId: editingId,
            label: `Edit “${form.title}”`,
            payload: { ...payload, ...(basedOn ? { basedOn } : {}) },
          },
          () => api.reminders.update(editingId, { ...payload, basedOn }),
        );
        if (queued) setNotice("Saved on this device. It'll sync when you're back online.");
      } else {
        // The id is minted here rather than by the server, so a create made offline can
        // be replayed onto its own row instead of making a second reminder.
        const id = mintReminderId();
        const queued = await sendOrQueue(
          {
            kind: "create",
            reminderId: id,
            label: `Add “${form.title}”`,
            payload,
          },
          () => api.reminders.create({ ...payload, id }),
        );
        if (queued) setNotice("Saved on this device. It'll sync when you're back online.");
      }
      setFormOpen(false);
      setError(null);
      await load();
      await syncBadge();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function doComplete() {
    if (!completing) return;
    setSaving(true);
    try {
      const body = {
        amount: completeAmount ? Number(completeAmount) : undefined,
        remarks: completeRemarks || undefined,
        // Which cycle this settles. Carried so a completion replayed later settles the
        // occurrence the user actually saw, not whichever one is due by then — and so
        // the server can tell a replay from a second person paying the same bill.
        cycleDueAt: completing.dueAt,
      };
      const queued = await sendOrQueue(
        {
          kind: "complete",
          reminderId: completing.id,
          label: `Complete “${completing.title}”`,
          payload: body,
        },
        () => api.reminders.complete(completing.id, body),
      );
      if (queued) setNotice("Marked done on this device. It'll sync when you're online.");
      setCompleting(null);
      setCompleteAmount("");
      setCompleteRemarks("");
      await load();
      await syncBadge();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function doSnooze(minutes: number) {
    if (!snoozing) return;
    setSaving(true);
    try {
      const label = SNOOZE_OPTIONS.find((o) => o.minutes === minutes)?.label;
      const queued = await sendOrQueue(
        {
          kind: "snooze",
          reminderId: snoozing.id,
          label: `Snooze “${snoozing.title}” for ${label}`,
          payload: { minutes },
        },
        () => api.reminders.snooze(snoozing.id, minutes),
      );
      setNotice(
        queued
          ? `"${snoozing.title}" snoozed on this device — it'll sync when you're online.`
          : `"${snoozing.title}" snoozed for ${label}.`,
      );
      setSnoozing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Reminder) {
    if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    try {
      await sendOrQueue(
        { kind: "delete", reminderId: r.id, label: `Delete “${r.title}”` },
        () => api.reminders.remove(r.id),
      );
      await load();
      await syncBadge();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const noCategories = categories.length === 0;

  function leadSummary(r: Reminder): string | null {
    if (!r.leadOffsets?.length) return null;
    const labels = [...r.leadOffsets]
      .sort((a, b) => b - a)
      .map(
        (m) =>
          LEAD_OFFSET_OPTIONS.find((o) => o.minutes === m)?.label.replace(
            " before",
            "",
          ) ?? `${m}m`,
      );
    return labels.join(", ");
  }

  // Size comes from the shared Button "icon" size (44px on phones, 36px with a
  // mouse) — deliberately not overridden here, since these are the controls most
  // likely to be tapped in a hurry.
  function actions(r: Reminder) {
    return (
      <>
        {r.status === "active" && (
          <Button
            variant="ghost"
            size="icon"
            title="Complete"
            className="text-green-500 hover:bg-green-500/10"
            onClick={() => {
              setCompleting(r);
              setCompleteAmount(r.amount ? String(r.amount) : "");
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
          </Button>
        )}
        {r.status === "active" && (
          <Button
            variant="ghost"
            size="icon"
            title={isSnoozed(r) ? "Snoozed — change" : "Snooze notifications"}
            className={`${isSnoozed(r) ? "text-amber-500" : "text-blue-400"} hover:bg-blue-500/10`}
            onClick={() => setSnoozing(r)}
          >
            {isSnoozed(r) ? (
              <BellOff className="h-4 w-4" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
          </Button>
        )}
        {/* Only on a shared list. A thread of one is a notes field, and the reminder
            already has a description for that. */}
        {r.familyId && (
          <Button
            variant="ghost"
            size="icon"
            title={r.acknowledgedAt ? "Someone is handling this" : "Notes and who's handling it"}
            className={r.acknowledgedAt ? "text-green-500" : ""}
            onClick={() => setThread(r)}
          >
            {r.acknowledgedAt ? (
              <Hand className="h-4 w-4" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(r)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Delete"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => remove(r)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </>
    );
  }

  return (
    <div className="flex-1 space-y-3 p-4 md:space-y-4 md:p-8">
      <div className="flex items-center justify-between gap-2">
        {/* min-w-0 so a long heading can never push the button off-screen */}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight md:text-3xl">
            Reminders
          </h2>
          <p className="text-xs text-muted-foreground md:hidden">
            {loading
              ? "…"
              : `${visible.length} ${filter === "all" ? "total" : filter}`}
          </p>
        </div>
        {/* aria-label because the text beside the icon is hidden on a phone, which
            left the page's primary action with no accessible name at all. */}
        <Button
          onClick={openCreate}
          disabled={noCategories}
          className="shrink-0"
          aria-label="New reminder"
          data-tour="rem-new"
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Reminder</span>
        </Button>
      </div>

      {(error ?? loadError) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error ?? loadError}
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-400">
          {notice}
        </div>
      )}

      {noCategories && !loading && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
          Create a category first on the{" "}
          <Link href="/categories" className="text-primary underline">
            Categories
          </Link>{" "}
          page — every reminder belongs to one.
        </div>
      )}

      {/* Wrapped rather than given the attribute, because ScopeTabs is shared with
          Spending and the anchor belongs to this page's tour, not to the component. */}
      <div data-tour="rem-scope">
        <ScopeTabs />
      </div>

      {scope !== "mine" && activeFamily && (
        <p className="text-xs text-muted-foreground">
          Everyone in {activeFamily.name} can see this list.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pb-1" data-tour="rem-filters">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex shrink-0 items-center rounded-full px-4 text-sm font-medium capitalize transition-colors min-h-11 md:min-h-0 md:py-1.5 ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : visible.length === 0 ? (
        <Card>
          {/* An empty state that says which empty it is. "No reminders here yet" under
              the Completed filter reads as data loss; it only means nothing has been
              completed on this list. */}
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-muted-foreground">
              {filter === "active"
                ? scope === "mine"
                  ? "Nothing on your list yet."
                  : `Nothing on ${activeFamily?.name ?? "this"} list yet.`
                : `No ${filter} reminders on this list.`}
            </p>
            {filter === "active" && !noCategories && (
              <Button variant="outline" size="sm" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" /> Add the first one
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Phones get a plain list. Wrapping these cards in another Card just
              nests padding and burns ~100px of vertical space above the fold. */}
          <div className="space-y-2 md:hidden">
            {visible.map((r) => {
              const st = reminderStatus(r);
              const color = r.category?.color ?? "#64748b";
              const leads = leadSummary(r);
              return (
                <div key={r.id} className="rounded-lg border bg-card/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* min-w-0 lets the title shrink instead of forcing the row wide */}
                    <div className="min-w-0 flex-1">
                      <h4 className="line-clamp-2 font-medium leading-snug">
                        {r.title}
                      </h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span
                          className="rounded-full px-2 py-0.5 font-semibold"
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          {r.category?.name ?? "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatDateTime(r.dueAt, r.hasTime, timeZone)}
                        </span>
                        {r.amount ? <span>{formatCurrency(r.amount)}</span> : null}
                        {r.familyId && (
                          <span>
                            {r.assignedTo ? `for ${r.assignedTo.name}` : "unassigned"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`text-xs font-semibold ${st.className}`}>
                        {st.label}
                      </span>
                      {/* The row reflects a change that hasn't reached the server. Said
                          plainly, because a row that merely *looks* done is how someone
                          ends up believing a bill was paid when nothing was sent. */}
                      {r.pendingKinds && (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          waiting to sync
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-1">
                    <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                      {isSnoozed(r) ? (
                        <span className="text-amber-500">
                          Snoozed to {formatDateTime(r.snoozedUntil!, true, timeZone)}
                        </span>
                      ) : leads ? (
                        `Alerts ${leads} before`
                      ) : (
                        "No advance alerts"
                      )}
                    </p>
                    <div className="flex shrink-0 items-center">{actions(r)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Alerts before</th>
                  <th className="px-4 py-3 font-medium">Recurrence</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => {
                  const st = reminderStatus(r);
                  const color = r.category?.color ?? "#64748b";
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">
                        {r.title}
                        {isSnoozed(r) && (
                          <span className="ml-2 text-xs text-amber-500">snoozed</span>
                        )}
                        {r.pendingKinds && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            waiting to sync
                          </span>
                        )}
                        {r.familyId && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {r.assignedTo ? `for ${r.assignedTo.name}` : "unassigned"}
                            {r.audience === "family" && " · notifies everyone"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="rounded-full px-2 py-1 text-xs font-semibold"
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          {r.category?.name ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {formatDateTime(r.dueAt, r.hasTime, timeZone)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {leadSummary(r) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.recurrenceRule}
                      </td>
                      <td className={`px-4 py-3 font-medium ${st.className}`}>
                        {st.label}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">{actions(r)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Create / Edit */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "Edit Reminder" : "New Reminder"}
      >
        <form onSubmit={submitForm} className="space-y-4">
          {/* Save sits at the top, not after the optional half of the form. Everything
              below Time is optional, so the old bottom-anchored button meant scrolling
              past six fields you had already decided to skip in order to reach it.
              Sticky, so it stays reachable once the form is long enough to scroll. */}
          <div className="sticky top-0 z-10 -mx-1 flex items-center justify-end gap-2 border-b border-border bg-card px-1 pb-3">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} aria-label={editingId ? "Save changes" : "Create reminder"} data-tour="form-save">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {/* Icon-only on a phone, where the words cost a line of width the
                      title field needs more. */}
                  <Plus className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">
                    {editingId ? "Save changes" : "Create reminder"}
                  </span>
                </>
              )}
            </Button>
          </div>

          <Field label="Title *" data-tour="form-title">
            {/* Mirrors the server's cap (lib/reminder-logic.ts), so the field stops
                accepting text instead of the save quietly shortening it. */}
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Car Insurance"
              maxLength={MAX_TITLE}
              autoFocus
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Due date *" data-tour="form-date">
              {/* Not <Input type="date">. That renders in the browser's locale, so on
                  an en-US machine this one field read 08/10/2026 while every other date
                  in the app read 10/08/2026 — two real dates, two months apart, with
                  nothing on screen saying which was meant. */}
              <DateField
                value={form.dueDate}
                onChange={(dueDate) => setForm({ ...form, dueDate })}
              />
            </Field>
            <Field label="Time">
              <Input
                type="time"
                value={form.dueTime}
                onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Category">
              <Select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">Others</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount (₹)">
              <Input
                type="number"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0"
              />
            </Field>
          </div>

          <div data-tour="form-lead">
            <p className="text-sm font-medium mb-1.5">Remind me before</p>
            <div className="grid grid-cols-2 gap-2">
              {LEAD_OFFSET_OPTIONS.map((o) => {
                const on = form.leadOffsets.includes(o.minutes);
                // Already in the past for this due instant, so it can never be sent —
                // offered as unavailable rather than as a tick that quietly does
                // nothing. See leadFits.
                const fits = leadFits(o.minutes);
                return (
                  <button
                    key={o.minutes}
                    type="button"
                    disabled={!fits}
                    title={fits ? undefined : "Too late for this due time"}
                    onClick={() => toggleLead(o.minutes)}
                    className={`flex min-h-11 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors md:min-h-0 md:py-2 ${
                      !fits
                        ? "cursor-not-allowed border-border/50 text-muted-foreground/40 line-through"
                        : on
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              You always get one at the due time. These are extra
              {LEAD_OFFSET_OPTIONS.some((o) => !leadFits(o.minutes)) &&
                ", and the ones already past for this due time are struck out"}
              .
            </p>
          </div>

          {/* Family-only controls. Hidden entirely on a personal reminder, where
              there is nobody to assign to and nobody else to notify. */}
          {form.familyId && (
            <div className="space-y-4 rounded-md border border-border p-3">
              <p className="text-sm font-medium">
                Shared with {families.find((f) => f.id === form.familyId)?.name}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Assign to">
                  <Select
                    value={form.assignedToId}
                    onChange={(e) =>
                      setForm({ ...form, assignedToId: e.target.value })
                    }
                  >
                    <option value="">Nobody in particular</option>
                    {(families.find((f) => f.id === form.familyId)?.members ?? []).map(
                      (m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.self ? " (you)" : ""}
                        </option>
                      ),
                    )}
                  </Select>
                </Field>
                <Field label="Notify">
                  <Select
                    value={form.audience}
                    onChange={(e) =>
                      setForm({ ...form, audience: e.target.value as Audience })
                    }
                  >
                    {AUDIENCE_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                {AUDIENCE_OPTIONS.find((o) => o.id === form.audience)?.hint}
                {form.audience === "assignee" &&
                  !form.assignedToId &&
                  " Nobody is assigned, so this will come to you."}
              </p>
            </div>
          )}

          <div className="border-t border-border pt-4" data-tour="form-escalate">
            <EscalationEditor
              isFamily={Boolean(form.familyId)}
              steps={form.escalation}
              onChange={(escalation) => setForm((f) => ({ ...f, escalation }))}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Recurrence">
              <Select
                value={form.recurrenceRule}
                onChange={(e) =>
                  setForm({ ...form, recurrenceRule: e.target.value })
                }
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o} value={o} className="capitalize">
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional details…"
              maxLength={MAX_DESCRIPTION}
            />
          </Field>
        </form>
      </Modal>

      {/* Complete */}
      <Modal
        open={!!completing}
        onClose={() => setCompleting(null)}
        title={`Complete: ${completing?.title ?? ""}`}
      >
        <div className="space-y-4">
          {/* Only when there is something non-obvious to say. "Complete" doing what
              the word means needs no caption; a reminder that comes straight back
              does. */}
          {completing?.recurrenceRule && completing.recurrenceRule !== "One Time" && (
            <p className="text-sm text-muted-foreground">
              Recurring ({completing.recurrenceRule}) — this rolls forward to the next
              due date and re-arms its alerts.
            </p>
          )}
          <Field label="Amount paid (₹)">
            <Input
              type="number"
              min="0"
              value={completeAmount}
              onChange={(e) => setCompleteAmount(e.target.value)}
            />
          </Field>
          <Field label="Remarks">
            <Input
              value={completeRemarks}
              onChange={(e) => setCompleteRemarks(e.target.value)}
              placeholder="Optional"
              maxLength={MAX_REMARKS}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCompleting(null)}>
              Cancel
            </Button>
            <Button
              onClick={doComplete}
              disabled={saving}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark complete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Snooze */}
      <Modal
        open={!!snoozing}
        onClose={() => setSnoozing(null)}
        title={`Snooze: ${snoozing?.title ?? ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pauses alerts. It stays on the list and in the badge count.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {SNOOZE_OPTIONS.map((o) => (
              <Button
                key={o.minutes}
                variant="outline"
                disabled={saving}
                onClick={() => doSnooze(o.minutes)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Acknowledgement, nudges and notes for one shared reminder. */}
      <ReminderThread
        reminder={thread}
        onClose={() => setThread(null)}
        onChanged={(patch) => {
          setThread((t) => (t ? { ...t, ...patch } : t));
          void load();
        }}
        onError={setError}
      />
    </div>
  );
}
