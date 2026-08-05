"use client";

import { useMemo, useState } from "react";
import { FolderPlus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/form";
import { useApp } from "@/components/app-context";
import { useCached } from "@/lib/cache";
import { api } from "@/services/api";
import type { Category, Reminder } from "@/types";

const DEFAULT_COLOR = "#3b82f6";

/** Stable identities, so an empty result doesn't invalidate the memo every render. */
const NO_CATEGORIES: Category[] = [];
const NO_REMINDERS: Reminder[] = [];

export default function CategoriesPage() {
  const { families, scope } = useApp();

  // Cached like every other page, so this one also paints instantly and still shows
  // something with no connection. It was the last page doing a bare fetch, which
  // offline meant an error and an empty grid where the rest of the app carried on.
  const {
    data,
    loading,
    error: loadError,
    refresh: load,
  } = useCached("categories-page", async () => {
    const [cats, rem] = await Promise.all([
      api.categories.list(),
      api.reminders.list(),
    ]);
    return { cats, rem };
  });
  const categories = data?.cats ?? NO_CATEGORIES;
  const reminders = data?.rem ?? NO_REMINDERS;
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  /** Which list a new category belongs to: "" for personal, or a family id. */
  const [owner, setOwner] = useState("");
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reminders) {
      if (r.status !== "active") continue;
      map.set(r.categoryId, (map.get(r.categoryId) ?? 0) + 1);
    }
    return map;
  }, [reminders]);
  const countFor = (id: string) => counts.get(id) ?? 0;

  function openCreate() {
    setEditingId(null);
    setName("");
    setColor(DEFAULT_COLOR);
    // Defaults to whichever list you are looking at elsewhere in the app, so the
    // shared Mine/family switcher decides this too rather than it being a fresh
    // question every time.
    setOwner(scope === "mine" ? "" : scope);
    setOpen(true);
  }

  function openEdit(c: Category) {
    setEditingId(c.id);
    setName(c.name);
    setColor(c.color ?? DEFAULT_COLOR);
    setOwner(c.familyId ?? "");
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
      // familyId is what was missing: this page lists personal *and* family
      // categories, so without it every category created here was silently personal
      // and a family could never gain a new one — only ever the eight it was seeded
      // with. A family reminder can only be filed under its own family's categories,
      // so that was a dead end with no error to explain it.
      else await api.categories.create({ name, color, familyId: owner || null });
      setOpen(false);
      setError(null);
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
    <div className="flex-1 space-y-4 p-4 md:p-8">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Categories</h2>
        <Button onClick={openCreate}>
          <FolderPlus className="mr-2 h-4 w-4" /> Add Category
        </Button>
      </div>

      {(error ?? loadError) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error ?? loadError}
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
                {/* Which list this belongs to.
                    A family starts with the same default categories as a person, so
                    "Utility Bills" appears twice the moment you join one — identical
                    cards, different lists, and no way to tell which you were editing or
                    which the reminder count belonged to. */}
                <p className="text-xs text-muted-foreground">
                  {c.family ? c.family.name : "Personal"}
                </p>
              </CardHeader>
              <CardContent className="pl-6">
                <p className="text-sm text-muted-foreground">
                  {countFor(c.id)} active reminder{countFor(c.id) === 1 ? "" : "s"}
                </p>
                <div className="mt-4 flex gap-2 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
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
                    aria-label={`Delete ${c.name}`}
                    title={`Delete ${c.name}`}
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
          {/* Only on create. Moving a category between lists would leave its reminders
              filed under something their own list can't see, so the field is shown as
              a fact when editing rather than offered as a choice. */}
          {editingId ? (
            families.length > 0 && (
              <p className="text-xs text-muted-foreground">
                On{" "}
                <span className="font-medium">
                  {owner
                    ? (families.find((f) => f.id === owner)?.name ?? "a family list")
                    : "your personal list"}
                </span>
                . Which list a category belongs to can&apos;t be changed.
              </p>
            )
          ) : families.length > 0 ? (
            <Field label="Which list">
              <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Personal — only you</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} — everyone in it
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
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
