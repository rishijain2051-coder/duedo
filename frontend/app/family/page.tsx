"use client";

import { useState } from "react";
import { UserPlus, Pencil, Trash2, Loader2, Mail, MailX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/form";
import { useMembers } from "@/components/member-context";
import { api } from "@/services/api";
import type { Member } from "@/types";

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  emailOptIn: "true",
  pin: "",
};

export default function FamilyPage() {
  const { members, refresh, loading } = useMembers();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(m: Member) {
    setEditingId(m.id);
    setForm({
      name: m.name,
      email: m.email,
      phone: m.phone ?? "",
      emailOptIn: String(m.emailOptIn),
      pin: "",
    });
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        emailOptIn: form.emailOptIn === "true",
        pin: form.pin.trim() || undefined,
      };
      if (editingId) await api.members.update(editingId, payload);
      else await api.members.create(payload);
      setOpen(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name} from the family?`)) return;
    try {
      await api.members.remove(m.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex-1 space-y-4 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Family</h2>
          <p className="text-sm text-muted-foreground">
            Each member gets their own reminder emails. No passwords needed.
          </p>
        </div>
        <Button onClick={openCreate}>
          <UserPlus className="mr-2 h-4 w-4" /> Add Member
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : members.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No family members yet. Add one to start assigning reminders.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <Card key={m.id} className="group">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-lg font-bold text-primary">
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-semibold">{m.name}</h4>
                      <p className="text-sm text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => remove(m)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {m.emailOptIn ? (
                      <Mail className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <MailX className="h-3.5 w-3.5 text-red-500" />
                    )}
                    {m.emailOptIn ? "Emails on" : "Emails off"}
                  </span>
                  {m.phone && <span>{m.phone}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit Member" : "Add Family Member"}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name *">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Mom"
              autoFocus
            />
          </Field>
          <Field label="Email * (reminders are sent here)">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="name@example.com"
            />
          </Field>
          <Field label="Phone (optional)">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91…"
            />
          </Field>
          <Field label="Login PIN (optional — 4–6 digits)">
            <Input
              inputMode="numeric"
              maxLength={6}
              value={form.pin}
              onChange={(e) =>
                setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })
              }
              placeholder={
                editingId
                  ? "Leave blank to keep current PIN"
                  : "Or they set it themselves at first login"
              }
            />
          </Field>
          <Field label="Email reminders">
            <Select
              value={form.emailOptIn}
              onChange={(e) => setForm({ ...form, emailOptIn: e.target.value })}
            >
              <option value="true">On</option>
              <option value="false">Off</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save" : "Add member"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
