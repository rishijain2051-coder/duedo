"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { api, type ExternalContactRow } from "@/services/api";
import type { EscalationStep } from "@/types";

/**
 * "If this still isn't done, tell someone else."
 *
 * Kept to two steps and a fixed set of delays on purpose. The full version of this idea —
 * arbitrary chains, rotations, schedules — is PagerDuty, and a household does not need an
 * on-call rota. Two steps covers the case people actually have: remind the person again,
 * then tell someone who can do something about it.
 */
const DELAYS = [
  { mins: 60, label: "1 hour late" },
  { mins: 240, label: "4 hours late" },
  { mins: 720, label: "12 hours late" },
  { mins: 1440, label: "1 day late" },
  { mins: 4320, label: "3 days late" },
  { mins: 10080, label: "1 week late" },
];

const MAX_STEPS = 2;

export function EscalationEditor({
  isFamily,
  steps,
  onChange,
}: {
  isFamily: boolean;
  steps: EscalationStep[];
  onChange: (steps: EscalationStep[]) => void;
}) {
  const [contacts, setContacts] = useState<ExternalContactRow[]>([]);

  useEffect(() => {
    // Loaded regardless of whether a step needs one, because the target dropdown has to
    // know whether "someone outside the app" is even offerable.
    api.contacts
      .list()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);

  const usable = contacts.filter((c) => c.state !== "blocked");

  function set(i: number, patch: Partial<EscalationStep>) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">If it&apos;s still not done</p>

      {steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing extra happens — the usual overdue reminders carry on.
        </p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Select
                value={String(step.afterMins)}
                onChange={(e) => set(i, { afterMins: Number(e.target.value) })}
                className="max-w-40"
              >
                {DELAYS.map((d) => (
                  <option key={d.mins} value={d.mins}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">tell</span>
              <Select
                value={step.notify}
                onChange={(e) =>
                  set(i, {
                    notify: e.target.value as EscalationStep["notify"],
                    // Dropping the contact when leaving `external` keeps the payload
                    // honest; the server refuses an external step with no contact.
                    contactId:
                      e.target.value === "external" ? (usable[0]?.id ?? "") : undefined,
                  })
                }
                className="max-w-44"
              >
                {isFamily && <option value="assignee">the assignee again</option>}
                {isFamily && <option value="head">the family head</option>}
                <option value="admins">an admin</option>
                {usable.length > 0 && <option value="external">someone outside</option>}
              </Select>
              {step.notify === "external" && (
                <Select
                  value={step.contactId ?? ""}
                  onChange={(e) => set(i, { contactId: e.target.value })}
                  className="max-w-52"
                >
                  {usable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label ? `${c.label} · ${c.email}` : c.email}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove step"
                className="text-destructive"
                onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {steps.length < MAX_STEPS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...steps,
              {
                // Each new step is offered a later slot than the last, because two steps at
                // the same minute would collide on the dispatcher's dedupe key and the
                // second would silently never fire.
                afterMins:
                  DELAYS[Math.min(DELAYS.length - 1, steps.length === 0 ? 2 : 3)].mins,
                notify: isFamily ? "head" : "admins",
              },
            ])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add a step
        </Button>
      )}

      {steps.some((s) => s.notify === "external") && (
        <p className="text-xs text-muted-foreground">
          Someone outside the app is asked to confirm before anything reaches them, and
          escalation stops the moment somebody says they&apos;ll handle it.
        </p>
      )}
      {usable.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add an outside address in Settings to escalate beyond this app.
        </p>
      )}
    </div>
  );
}
