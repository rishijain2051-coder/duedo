"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  LogOut,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useApp } from "@/components/app-context";
import { FamilyActivity } from "@/components/family-activity";
import { FamilyPreferences } from "@/components/family-preferences";
import { api } from "@/services/api";
import { useCached } from "@/lib/cache";
import { formatDateTime } from "@/lib/format";
import type { FamilySummary } from "@/types";

/**
 * Family management, for family accounts.
 *
 * Split out of the Settings page because it is the one card whose contents depend
 * on a role — a head sees the join code and the member controls, a plain member
 * sees neither — and interleaving that with the rest of Settings made both harder
 * to read.
 */
export function FamilySettings({
  onNotice,
  onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { families, refreshFamilies, refreshSettings, timeZone, settings } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      onNotice(await fn());
      await refreshFamilies();
      await refreshSettings();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onError("Could not copy — select the code and copy it by hand.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Families
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Each family has a shared list every member can see. Your personal reminders
          are never part of it.
        </p>

        {families.map((family) => (
          <FamilyBlock
            key={family.id}
            family={family}
            busy={busy}
            copied={copied}
            timeZone={timeZone}
            onCopy={copyCode}
            onRun={run}
            onNotice={onNotice}
            onError={onError}
          />
        ))}

        {/* Create / join */}
        <div className="space-y-4 border-t border-border pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Field label="Start a new family">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Jain household"
                />
              </Field>
              <Button
                disabled={busy !== null || newName.trim().length < 2}
                onClick={() =>
                  run("create", async () => {
                    const f = await api.families.create(newName.trim());
                    setNewName("");
                    return `${f.name} created. Share the code ${f.joinCode} to invite people.`;
                  })
                }
              >
                {busy === "create" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Users className="mr-2 h-4 w-4" />
                )}
                Create family
              </Button>
            </div>

            <div className="space-y-2">
              <Field label="Join with a code">
                <Input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABCD2345"
                  className="tracking-widest"
                />
              </Field>
              <Button
                variant="outline"
                disabled={busy !== null || joinCode.trim().length < 4}
                onClick={() =>
                  run("join", async () => {
                    const res = await api.families.join(joinCode.trim());
                    setJoinCode("");
                    return res.message;
                  })
                }
              >
                {busy === "join" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="mr-2 h-4 w-4" />
                )}
                Join
              </Button>
            </div>
          </div>
          {/* Kept: the code *is* the permission, and nothing else on screen says so.
              Someone who assumes the head approves joins will treat it casually. */}
          <p className="text-xs text-muted-foreground">
            A valid code puts you straight in, so anyone holding it can join. Share it
            directly, and press <strong>New code</strong> if it gets passed around.
          </p>
        </div>

        {/* Back to solo */}
        {families.length === 0 && settings?.accountType === "family" && (
          <div className="border-t border-border pt-4">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run("solo", async () => {
                  await api.settings.update({ accountType: "solo" });
                  return "Switched back to a single-person account.";
                })
              }
            >
              Switch back to just me
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Your reminders are untouched.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FamilyBlock({
  family,
  busy,
  copied,
  timeZone,
  onCopy,
  onRun,
  onNotice,
  onError,
}: {
  family: FamilySummary;
  busy: string | null;
  copied: string | null;
  timeZone: string | undefined;
  onCopy: (code: string) => void;
  onRun: (key: string, fn: () => Promise<string>) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const isHead = family.role === "head";
  const [rename, setRename] = useState("");

  // The flags come back with the scoreboard rather than on FamilySummary, so the head's
  // switches read them from there — one fewer field on a payload every page loads, for
  // something only a head ever sees.
  const board = useCached(`family-scoreboard-${family.id}`, () =>
    api.family.scoreboard(family.id),
  );
  const flags = {
    showRanking: board.data?.ranked ?? false,
    showStreaks: board.data?.streaks ?? false,
    allowNudges: board.data?.nudges ?? false,
    // Not in the scoreboard payload — it is about mail, not display — so it shows as on,
    // matching the column default, until the head changes it.
    monthlyReportToHead: true,
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {/* Same reason as the member rows below: a chip inline in a `truncate`
              paragraph inherits white-space:nowrap, so a long family name pushed the
              role badge into the clipped overflow. Sibling that wraps instead. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 max-w-full truncate font-medium">{family.name}</p>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {family.role}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {family.members.length} member{family.members.length === 1 ? "" : "s"} ·
            since {formatDateTime(family.createdAt, false, timeZone)}
          </p>
        </div>

        {/* A member can leave; a head must hand over first if anyone else is left. */}
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => {
            if (!confirm(`Leave ${family.name}? You'll lose sight of its shared list.`))
              return;
            void onRun(`leave-${family.id}`, async () => {
              await api.families.leave(family.id);
              return `You've left ${family.name}.`;
            });
          }}
        >
          <LogOut className="mr-1 h-3.5 w-3.5" /> Leave
        </Button>
      </div>

      {/* Head-only: the join code */}
      {isHead && family.joinCode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2">
          <span className="font-mono text-lg tracking-widest">{family.joinCode}</span>
          <Button variant="ghost" size="sm" onClick={() => onCopy(family.joinCode!)}>
            {copied === family.joinCode ? (
              <Check className="mr-1 h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            {copied === family.joinCode ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              if (!confirm("Replace the join code? The old one stops working."))
                return;
              void onRun(`rotate-${family.id}`, async () => {
                const f = await api.families.rotateCode(family.id);
                return `New code: ${f.joinCode}`;
              });
            }}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> New code
          </Button>
        </div>
      )}


      {/* Members */}
      <ul className="divide-y divide-border rounded-md border">
        {family.members.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              {/* The badges are siblings of the name, not inline inside it. Inside a
                  `truncate` paragraph they inherit white-space:nowrap and share one
                  unbreakable line, so on a 320px screen the HEAD chip was simply
                  clipped away by the overflow rather than moving. Now the name
                  truncates on its own and the chips wrap. */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <p className="min-w-0 max-w-full truncate font-medium">{m.name}</p>
                {m.self && <span className="text-xs text-primary">you</span>}
                {m.role === "head" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    head
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>

            {isHead && !m.self && (
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    if (
                      !confirm(
                        `Make ${m.name} the head of ${family.name}? You become a normal member.`,
                      )
                    )
                      return;
                    void onRun(`head-${m.id}`, async () => {
                      await api.families.transferHead(family.id, m.id);
                      return `${m.name} is now the head.`;
                    });
                  }}
                >
                  Make head
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove from family"
                  className="text-destructive hover:bg-destructive/10"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!confirm(`Remove ${m.name} from ${family.name}?`)) return;
                    void onRun(`remove-${m.id}`, async () => {
                      const res = await api.families.removeMember(family.id, m.id);
                      return `${res.name} was removed.`;
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Head-only: rename and dissolve */}
      {isHead && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label="Rename">
              <Input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                placeholder={family.name}
              />
            </Field>
          </div>
          <Button
            variant="outline"
            disabled={busy !== null || rename.trim().length < 2}
            onClick={() =>
              onRun(`rename-${family.id}`, async () => {
                await api.families.rename(family.id, rename.trim());
                setRename("");
                return "Family renamed.";
              })
            }
          >
            Save
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={busy !== null}
            onClick={() => {
              if (
                !confirm(
                  `Dissolve ${family.name}? Every member loses the shared list. ` +
                    `This is refused if any reminders are still on it.`,
                )
              )
                return;
              void onRun(`dissolve-${family.id}`, async () => {
                await api.families.dissolve(family.id);
                return `${family.name} dissolved.`;
              });
            }}
          >
            Dissolve
          </Button>
        </div>
      )}

      {/* Who is keeping up, and what has happened. Always visible to members; the
          switches that decide how much of it is a competition are head-only. */}
      <FamilyActivity familyId={family.id} />
      {isHead && (
        <FamilyPreferences
          familyId={family.id}
          initial={flags}
          onNotice={onNotice}
          onError={onError}
        />
      )}
    </div>
  );
}
