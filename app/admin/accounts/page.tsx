"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeIndianRupee,
  Check,
  Crown,
  Eye,
  KeyRound,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useApp } from "@/components/app-context";
import { api } from "@/services/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { CURRENCY, PLANS, PLAN_ORDER, planSpec } from "@/lib/plan";
import { PIN_LENGTH, type ManagedUser, type PlanId, type Reminder } from "@/types";

/** What the owner actually types. A year is the sold unit; the rest are for fixing things. */
const GRANT_PRESETS = [
  { days: 365, label: "1 year" },
  { days: 30, label: "1 month" },
  { days: 7, label: "7 days" },
];

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

  const [planFor, setPlanFor] = useState<ManagedUser | null>(null);
  const [grantPlanId, setGrantPlanId] = useState<PlanId>("individual");
  const [grantDays, setGrantDays] = useState(365);
  const [grantNote, setGrantNote] = useState("");

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

  /**
   * One-way as far as this admin is concerned: the flag moves off their row, so the
   * button they just pressed is the last owner action they can take. Worth a
   * confirmation that says so rather than a generic "are you sure".
   */
  async function makeOwner(u: ManagedUser) {
    if (
      !confirm(
        `Hand this install over to ${u.name}?\n\n` +
          `They become the account nobody else can demote, reject or delete — and ` +
          `you lose that protection. Only they can hand it back.`,
      )
    )
      return;
    setBusy(u.id);
    setError(null);
    setNotice(null);
    try {
      await api.users.makeOwner(u.id);
      await load();
      setNotice(`${u.name} is now the owner of this install.`);
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
                    {u.isRoot ? (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        owner
                      </span>
                    ) : (
                      u.role === "admin" && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          admin
                        </span>
                      )
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
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
                        {u.emailVerifiedAt ? " · confirmed" : " · not confirmed"}
                      </span>
                    )}
                    {u.accountType === "family" && (
                      <span className="text-muted-foreground"> · family</span>
                    )}
                  </p>
                  {/* Plan, and when it runs out. The date is the point — a boolean
                      "premium yes/no" would leave nothing to read here, and knowing
                      who lapses this week is the only way a manual renewal gets
                      chased before it stops working. */}
                  <p className="text-xs text-muted-foreground">
                    {u.effectivePlan && u.effectivePlan !== "free" ? (
                      <span className="text-primary">
                        {planSpec(u.effectivePlan).name}
                        {u.premiumUntil &&
                          ` · until ${formatDate(u.premiumUntil, timeZone)}`}
                      </span>
                    ) : u.premiumUntil ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        lapsed {formatDate(u.premiumUntil, timeZone)}
                      </span>
                    ) : (
                      "Free"
                    )}
                    {u.planNote && ` · ${u.planNote}`}
                  </p>
                </div>

                {/* No shrink-0 on the action group below. It and flex-wrap cancel
                    each other out: the group keeps its max-content width, so it
                    never gets narrow enough for its own wrapping to trigger, and on
                    a phone the row of six buttons ran ~130px past the screen edge —
                    clipped by the shell's overflow and unreachable. Allowed to
                    shrink, the group drops onto its own line and wraps there.

                    Nothing is offered on the owner's row: the API refuses every one
                    of these against it, so showing buttons would only promise an
                    action that comes back as a 403.

                    Plan is the exception, and it is offered on every row including
                    the viewer's own. Extending access cannot strand the install the
                    way demoting or rejecting can, and the owner is the one account
                    certain to need a plan — they are the one with the family. */}
                {(u.canGrantPlan || (!u.self && !u.isRoot)) && (
                  <div className="flex flex-wrap items-center gap-1">
                    {u.canGrantPlan && (
                      <Button
                        size="sm"
                        variant="outline"
                        title="Grant or extend paid access"
                        disabled={busy !== null}
                        onClick={() => {
                          setPlanFor(u);
                          setGrantPlanId(u.plan && u.plan !== "free" ? u.plan : "individual");
                          setGrantDays(365);
                          setGrantNote(u.planNote ?? "");
                        }}
                      >
                        <BadgeIndianRupee className="mr-1 h-3.5 w-3.5" /> Plan
                      </Button>
                    )}
                    {!u.self && !u.isRoot && u.status !== "active" && (
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
                        Activate
                      </Button>
                    )}
                    {!u.self && !u.isRoot && u.status !== "rejected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act(u, "reject")}
                        disabled={busy !== null}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                    )}
                    {/* Only on an account that can actually sign in. Offered on a
                        rejected or unconfirmed one it did nothing visible — the role
                        cannot be used until the account is active — and left a trap:
                        whoever activated them later would be handing out admin without
                        knowing it had been granted. */}
                    {!u.self && !u.isRoot && u.status === "active" && (
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
                    )}
                    {!u.self && !u.isRoot && (
                      <>
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
                      </>
                    )}
                    {u.canTransferRoot && (
                      <Button
                        size="sm"
                        variant="outline"
                        title="Hand this install over to them"
                        disabled={busy !== null}
                        onClick={() => makeOwner(u)}
                      >
                        <Crown className="mr-1 h-3.5 w-3.5" /> Make owner
                      </Button>
                    )}
                    {!u.self && !u.isRoot && (
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
                    )}
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
            Recorded in the audit log, and signs out all their devices.
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

      {/* Grant, extend or withdraw paid access */}
      <Modal
        open={!!planFor}
        onClose={() => setPlanFor(null)}
        title={`Plan for ${planFor?.name ?? ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {planFor?.premiumUntil
              ? `Currently ${planSpec(planFor.effectivePlan).name}, ${
                  planFor.effectivePlan === "free" ? "lapsed" : "until"
                } ${formatDate(planFor.premiumUntil, timeZone)}.`
              : "No paid access yet."}
          </p>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Plan</p>
            <div className="flex flex-wrap gap-1.5">
              {PLAN_ORDER.filter((p) => p !== "free").map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={grantPlanId === p ? "default" : "outline"}
                  onClick={() => setGrantPlanId(p)}
                >
                  {PLANS[p].name} · {CURRENCY}
                  {PLANS[p].price}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Add time
              {/* Stacking is the whole reason this says "add" rather than "set".
                  Renewing three days early keeps the three days. */}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {GRANT_PRESETS.map((g) => (
                <Button
                  key={g.days}
                  size="sm"
                  variant={grantDays === g.days ? "default" : "outline"}
                  onClick={() => setGrantDays(g.days)}
                >
                  {g.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              What was paid — only you ever see this
            </p>
            <Input
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
              placeholder={`UPI ref, ${CURRENCY}${PLANS[grantPlanId].price}, 1 year`}
              maxLength={200}
            />
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            {planFor?.premiumUntil && (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10"
                onClick={async () => {
                  if (!planFor) return;
                  if (
                    !confirm(
                      `Withdraw paid access from ${planFor.name}?\n\n` +
                        `They keep every reminder they have and it keeps firing. ` +
                        `They just drop to the free caps and lose email, spending and voice.`,
                    )
                  )
                    return;
                  try {
                    await api.users.clearPlan(planFor.id);
                    await load();
                    setNotice(`${planFor.name} is back on Free.`);
                    setPlanFor(null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Withdraw
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setPlanFor(null)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!planFor) return;
                  try {
                    const updated = await api.users.grantPlan(planFor.id, {
                      plan: grantPlanId,
                      addDays: grantDays,
                      planNote: grantNote,
                    });
                    await load();
                    setNotice(
                      `${planFor.name} is on ${PLANS[grantPlanId].name} until ` +
                        `${formatDate(updated.premiumUntil!, timeZone)}.`,
                    );
                    setPlanFor(null);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Grant
              </Button>
            </div>
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
