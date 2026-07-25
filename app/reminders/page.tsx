"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  CheckCircle2,
  CalendarIcon,
  Pencil,
  Trash2,
  Loader2,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useMembers } from "@/components/member-context";
import { api } from "@/services/api";
import { formatCurrency, formatDate, reminderStatus, toDateInputValue } from "@/lib/format";
import {
  PRIORITY_OPTIONS,
  RECURRENCE_OPTIONS,
  type Category,
  type Reminder,
} from "@/types";

const STATUS_FILTERS = ["all", "active", "completed", "archived"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const emptyForm = {
  title: "",
  categoryId: "",
  assignedToId: "",
  dueDate: "",
  amount: "",
  recurrenceRule: "One Time",
  priority: "normal",
  description: "",
};

export default function RemindersPage() {
  const { members, currentMember } = useMembers();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rem, cats] = await Promise.all([
        api.reminders.list(),
        api.categories.list(),
      ]);
      setReminders(rem);
      setCategories(cats);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = reminders.filter((r) =>
    filter === "all" ? true : r.status === filter,
  );

  function openCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      assignedToId: currentMember?.id ?? members[0]?.id ?? "",
      categoryId: categories[0]?.id ?? "",
    });
    setFormOpen(true);
  }

  function openEdit(r: Reminder) {
    setEditingId(r.id);
    setForm({
      title: r.title,
      categoryId: r.categoryId,
      assignedToId: r.assignedToId,
      dueDate: toDateInputValue(r.dueDate),
      amount: r.amount ? String(r.amount) : "",
      recurrenceRule: r.recurrenceRule ?? "One Time",
      priority: r.priority ?? "normal",
      description: r.description ?? "",
    });
    setFormOpen(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.categoryId || !form.assignedToId || !form.dueDate) {
      setError("Title, category, family member and due date are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        categoryId: form.categoryId,
        assignedToId: form.assignedToId,
        dueDate: new Date(form.dueDate).toISOString(),
        amount: form.amount ? Number(form.amount) : 0,
        recurrenceRule: form.recurrenceRule,
        priority: form.priority as Reminder["priority"],
        description: form.description || null,
      };
      if (editingId) await api.reminders.update(editingId, payload);
      else await api.reminders.create(payload);
      setFormOpen(false);
      await load();
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
      await api.reminders.complete(completing.id, {
        amount: completeAmount ? Number(completeAmount) : undefined,
        remarks: completeRemarks || undefined,
      });
      setCompleting(null);
      setCompleteAmount("");
      setCompleteRemarks("");
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
      await api.reminders.remove(r.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function notifyFamily(r: Reminder) {
    if (!confirm(`Email the whole family about "${r.title}" now?`)) return;
    setNotice(null);
    setError(null);
    try {
      const res = await api.reminders.notifyFamily(r.id);
      setNotice(
        `Family notified about "${res.title}" — ${res.emailed} email${res.emailed === 1 ? "" : "s"} sent to ${res.notified} member${res.notified === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const noMembers = members.length === 0;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Reminders</h2>
        <Button onClick={openCreate} disabled={noMembers}>
          <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">New </span>Reminder
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-400">
          {notice}
        </div>
      )}

      {noMembers && !loading && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
          Add a family member first on the{" "}
          <Link href="/family" className="text-primary underline">
            Family
          </Link>{" "}
          page — reminders are assigned to people.
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {filter === "all" ? "All" : filter[0].toUpperCase() + filter.slice(1)}{" "}
            Reminders ({visible.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No reminders here yet.
            </p>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="space-y-3 md:hidden">
                {visible.map((r) => {
                  const st = reminderStatus(r);
                  const color = r.category?.color ?? "#64748b";
                  return (
                    <div key={r.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium leading-tight">{r.title}</h4>
                        <span className={`shrink-0 text-xs font-medium ${st.className}`}>
                          {st.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className="rounded-full px-2 py-0.5 font-semibold"
                          style={{ backgroundColor: `${color}22`, color }}
                        >
                          {r.category?.name ?? "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {formatDate(r.dueDate)}
                        </span>
                        {r.amount ? <span>{formatCurrency(r.amount)}</span> : null}
                        {r.assignedTo?.name && <span>· {r.assignedTo.name}</span>}
                      </div>
                      <div className="flex justify-end gap-1 pt-1 border-t border-border/50">
                        {r.status === "active" && (
                          <Button variant="ghost" size="icon" title="Complete" className="h-8 w-8 text-green-500 hover:bg-green-500/10" onClick={() => { setCompleting(r); setCompleteAmount(r.amount ? String(r.amount) : ""); }}>
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title="Notify family" className="h-8 w-8 text-blue-500 hover:bg-blue-500/10" onClick={() => notifyFamily(r)}>
                          <Send className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Edit" className="h-8 w-8" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => remove(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
                      <th className="px-4 py-3 font-medium">Member</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Due</th>
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
                          <td className="px-4 py-3 font-medium">{r.title}</td>
                          <td className="px-4 py-3">
                            <span
                              className="rounded-full px-2 py-1 text-xs font-semibold"
                              style={{ backgroundColor: `${color}22`, color }}
                            >
                              {r.category?.name ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {r.assignedTo?.name ?? "—"}
                          </td>
                          <td className="px-4 py-3">{formatCurrency(r.amount)}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2">
                              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                              {formatDate(r.dueDate)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {r.recurrenceRule}
                          </td>
                          <td className={`px-4 py-3 font-medium ${st.className}`}>
                            {st.label}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-1">
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
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Notify whole family"
                                className="text-blue-500 hover:bg-blue-500/10"
                                onClick={() => notifyFamily(r)}
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Edit"
                                onClick={() => openEdit(r)}
                              >
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
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? "Edit Reminder" : "New Reminder"}
      >
        <form onSubmit={submitForm} className="space-y-4">
          <Field label="Title *">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Car Insurance"
              autoFocus
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Category *">
              <Select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">Select…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Family member *">
              <Select
                value={form.assignedToId}
                onChange={(e) =>
                  setForm({ ...form, assignedToId: e.target.value })
                }
              >
                <option value="">Select…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Due date *">
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
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
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Optional details…"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save changes" : "Create reminder"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Complete */}
      <Modal
        open={!!completing}
        onClose={() => setCompleting(null)}
        title={`Complete: ${completing?.title ?? ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {completing?.recurrenceRule &&
            completing.recurrenceRule !== "One Time"
              ? `This is recurring (${completing.recurrenceRule}) — it will roll forward to the next due date.`
              : "This will mark the reminder completed."}
          </p>
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
    </div>
  );
}
