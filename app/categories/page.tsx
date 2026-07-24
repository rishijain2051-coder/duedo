"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderPlus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/form";
import { api } from "@/services/api";
import type { Category, Reminder } from "@/types";

const DEFAULT_COLOR = "#3b82f6";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, rem] = await Promise.all([
        api.categories.list(),
        api.reminders.list(),
      ]);
      setCategories(cats);
      setReminders(rem);
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

  const countFor = (id: string) =>
    reminders.filter((r) => r.categoryId === id && r.status === "active").length;

  function openCreate() {
    setEditingId(null);
    setName("");
    setColor(DEFAULT_COLOR);
    setOpen(true);
  }

  function openEdit(c: Category) {
    setEditingId(c.id);
    setName(c.name);
    setColor(c.color ?? DEFAULT_COLOR);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) await api.categories.update(editingId, { name, color });
      else await api.categories.create({ name, color });
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    try {
      const res = await api.categories.remove(c.id);
      if (!res.deleted) setError(res.message ?? "Could not delete category.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex-1 space-y-4 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Categories</h2>
        <Button onClick={openCreate}>
          <FolderPlus className="mr-2 h-4 w-4" /> Add Category
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((c) => (
            <Card key={c.id} className="group relative overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full w-1.5"
                style={{ backgroundColor: c.color ?? DEFAULT_COLOR }}
              />
              <CardHeader className="pb-2 pl-6">
                <CardTitle className="text-xl font-bold">{c.name}</CardTitle>
              </CardHeader>
              <CardContent className="pl-6">
                <p className="text-sm text-muted-foreground">
                  {countFor(c.id)} active reminder{countFor(c.id) === 1 ? "" : "s"}
                </p>
                <div className="mt-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-destructive hover:bg-destructive hover:text-white"
                    onClick={() => remove(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "Edit Category" : "New Category"}
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Insurance"
              autoFocus
            />
          </Field>
          <Field label="Color">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-md border border-border bg-transparent"
              />
              <span className="text-sm text-muted-foreground">{color}</span>
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
