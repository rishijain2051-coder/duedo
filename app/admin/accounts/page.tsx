"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, KeyRound, Loader2, Trash2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useApp } from "@/components/app-context";
import { api } from "@/services/api";
import { formatDateTime } from "@/lib/format";
import { PIN_LENGTH, type ManagedUser, type Reminder } from "@/types";

const STATUSES = ["", "pending", "active", "rejected"];

export default function AdminAccountsPage() {
  const { timeZone, refreshSettings } = useApp();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pinFor, setPinFor] = useState<ManagedUser | null>(null);
  const [newPin, setNewPin] = useState("");
  const [viewing, setViewing] = useState<ManagedUser | null>(null);
  const [viewed, setViewed] = useState<Reminder[] | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (status) qs.set("status", status);
      // The typed client covers the common case; the filters are a thin extra.
      const res = await fetch(`/api/users?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json())?.message ?? "Failed");
      setUsers(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(u: ManagedUser, action: "approve" | "reject" | "remove") {
    if (action === "remove") {
      if (
        !confirm(
          `Delete ${u.name} (${u.email})?\n\n` +
            `Everything they own goes with it — reminders, categories, history and ` +
            `devices. Rejecting is the reversible option; this is not.`,
        )
      )
        return;
    }
    if (action === "reject" && !confirm(`Reject ${u.name}? They can't sign in.`)) return;

    setBusy(u.id);
    setError(null);
    setNotice(null);
    try {
      if (action === "approve") await api.users.approve(u.id);
      else if (action === "reject") await api.users.reject(u.id);
      else await api.users.remove(u.id);
      await load();
      await refreshSettings();
      setNotice(
        action === "approve"
          ? `${u.name} can now sign in.`
          : action === "reject"
            ? `${u.name} has been rejected.`
            : `${u.name} has been deleted.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function openReminders(u: ManagedUser) {
    setViewing(u);
    setViewed(null);
    try {
      setViewed(await api.admin.userReminders(u.id));
    } catch (e) {
      setError((e as Error).message);
      setViewing(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-400">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
          className="max-w-64"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="max-w-40"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "" ? "All statuses" : s}
            </option>
          ))}
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        You can&apos;t change your own row — that&apos;s what stops the last admin
        locking everyone out.
      </p>

      {loading ? (
        <div className="flex items-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No accounts match.
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {users.map((u) => (
            <li key={u.id} className="px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  {/* Badges as siblings, not inline in a `truncate` paragraph: there
                      they inherited white-space:nowrap, so a long name pushed the
                      ADMIN and SOLO chips into the clipped overflow and they
                      vanished instead of wrapping. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 max-w-full truncate font-medium">{u.name}</p>
                    {u.self && <span className="text-xs text-primary">you</span>}
                    {u.role === "admin" && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        admin
                      </span>
                    )}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {u.accountType}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email} · joined {formatDateTime(u.createdAt, false, timeZone)}
                  </p>
                  <p className="text-xs">
                    <span
                      className={
                        u.status === "active"
                          ? "text-green-600 dark:text-green-400"
                          : u.status === "pending"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400"
                      }
                    >
                      {u.status}
                    </span>
                    {/* Whether the address was actually proved. A pending account
                        that has verified is waiting on nothing — mail was probably
                        broken — whereas one that hasn't just needs to click a link,
                        and only the first is worth an admin's attention. */}
                    {u.status === "pending" && (
                      <span
                        className={
                          u.emailVerifiedAt
                            ? "text-green-600 dark:text-green-400"
                            : "text-muted-foreground"
                        }
                      >
                        {u.emailVerifiedAt
                          ? " · email confirmed"
                          : " · email not confirmed yet"}
                      </span>
                    )}
                    {u.counts && (
                      <span className="text-muted-foreground">
                        {" · "}
                        {u.counts.reminders} reminders · {u.counts.families} families ·{" "}
                        {u.counts.devices} devices
                      </span>
                    )}
                  </p>
                </div>

                {/* No shrink-0 on the action group below. It and flex-wrap cancel
                    each other out: the group keeps its max-content width, so it
                    never gets narrow enough for its own wrapping to trigger, and on
                    a phone the row of six buttons ran ~130px past the screen edge —
                    clipped by the shell's overflow and unreachable. Allowed to
                    shrink, the group drops onto its own line and wraps there. */}
                {!u.self && (
                  <div className="flex flex-wrap items-center gap-1">
                    {u.status !== "active" && (
                      <Button
                        size="sm"
                        onClick={() => act(u, "approve")}
                        disabled={busy !== null}
                      >
                        {busy === u.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1 h-3.5 w-3.5" />
                        )}
                        Approve
                      </Button>
                    )}
                    {u.status !== "rejected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act(u, "reject")}
                        disabled={busy !== null}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        api.users
                          .setRole(u.id, u.role === "admin" ? "member" : "admin")
                          .then(load)
                          .then(() => setNotice(`${u.name}'s role updated.`))
                          .catch((e) => setError((e as Error).message))
                      }
                    >
                      {u.role === "admin" ? "Make member" : "Make admin"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Set a new PIN for someone locked out"
                      disabled={busy !== null}
                      onClick={() => {
                        setPinFor(u);
                        setNewPin("");
                      }}
                    >
                      <KeyRound className="mr-1 h-3.5 w-3.5" /> PIN
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="View their reminders (recorded in the audit log)"
                      disabled={busy !== null}
                      onClick={() => openReminders(u)}
                    >
                      <Eye className="mr-1 h-3.5 w-3.5" /> Reminders
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete account"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => act(u, "remove")}
                      disabled={busy !== null}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Reset PIN */}
      <Modal
        open={!!pinFor}
        onClose={() => setPinFor(null)}
        title={`Set a new PIN for ${pinFor?.name ?? ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            For someone locked out. Their current PIN isn&apos;t needed, so this is
            recorded in the audit log and all their devices are signed out.
          </p>
          <Input
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            placeholder={`${PIN_LENGTH} digits`}
            className="text-center tracking-[0.5em]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPinFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={newPin.length !== PIN_LENGTH}
              onClick={async () => {
                if (!pinFor) return;
                try {
                  await api.users.resetPin(pinFor.id, newPin);
                  setNotice(`${pinFor.name}'s PIN was reset. Tell them the new one.`);
                  setPinFor(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Set PIN
            </Button>
          </div>
        </div>
      </Modal>

      {/* Read their reminders */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={`${viewing?.name ?? ""}'s reminders`}
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This view is recorded in the audit log.
          </p>
          {viewed === null ? (
            <div className="flex items-center py-6 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : viewed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              They have no reminders.
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border">
              {viewed.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm">
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.category?.name} · {formatDateTime(r.dueAt, r.hasTime, timeZone)}
                    {r.family ? ` · ${r.family.name}` : " · personal"} · {r.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
