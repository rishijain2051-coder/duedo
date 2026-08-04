"use client";

import { useCallback, useEffect, useState } from "react";
import { AtSign, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { api, type ExternalContactRow } from "@/services/api";

/**
 * Addresses outside the app that escalation may reach.
 *
 * The states are the point of this card. Adding an address does nothing on its own — the
 * first time a reminder tries to escalate to them, they get one message asking whether
 * they want this at all, and nothing further until they answer. Showing that plainly is
 * what stops someone assuming the landlord is being told when they aren't.
 */
const STATE_TEXT: Record<ExternalContactRow["state"], string> = {
  new: "Will be asked to confirm the first time a reminder escalates to them.",
  invited: "Asked, waiting for an answer. Nothing is being sent yet.",
  confirmed: "Confirmed — escalations reach them.",
  blocked: "They declined. This address can never be contacted again.",
};

export function ExternalContactsCard({
  onNotice,
  onError,
}: {
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<ExternalContactRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.contacts.list());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy("add");
    try {
      await api.contacts.add(email.trim(), label.trim() || undefined);
      setEmail("");
      setLabel("");
      await load();
      onNotice("Added. They'll be asked before anything is sent.");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!rows) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AtSign className="h-5 w-5" /> Outside contacts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          People who aren&apos;t on this app — a landlord, an accountant — that a reminder
          can escalate to. Only you can use yours.
        </p>

        {rows.length > 0 && (
          <ul className="divide-y divide-border rounded-md border">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {c.label ? `${c.label} · ${c.email}` : c.email}
                  </p>
                  <p
                    className={`text-xs ${
                      c.state === "confirmed"
                        ? "text-green-600 dark:text-green-400"
                        : c.state === "blocked"
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {STATE_TEXT[c.state]}
                  </p>
                </div>
                {/* A blocked address keeps its row deliberately — deleting it would let the
                    same address be added again, asking somebody who already said no a
                    second time. The API refuses, so no button is offered. */}
                {c.state !== "blocked" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove"
                    className="shrink-0 text-destructive hover:bg-destructive/10"
                    disabled={busy !== null}
                    onClick={async () => {
                      if (!confirm(`Remove ${c.email}?`)) return;
                      setBusy(c.id);
                      try {
                        await api.contacts.remove(c.id);
                        await load();
                      } catch (e) {
                        onError((e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email address">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="landlord@example.com"
            />
          </Field>
          <Field label="Label (optional)">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Landlord"
            />
          </Field>
        </div>
        <Button
          variant="outline"
          disabled={busy !== null || !email.includes("@")}
          onClick={add}
        >
          {busy === "add" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add contact
        </Button>
      </CardContent>
    </Card>
  );
}
