"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOutbox } from "@/lib/offline";
import { useOffline } from "@/lib/net";

/**
 * The queue of writes made offline, and what happened to them.
 *
 * Shown rather than hidden, because a queue nobody can see is worse than no queue at
 * all: somebody marks a bill paid, the write never lands, and the app spends a week
 * looking like it simply forgot. Anything the server refused sits here with the reason
 * and a way to throw it away — the user can then redo it, which is the only thing that
 * actually resolves a refusal.
 */
export function OutboxBar() {
  const { items, waiting, blocked, syncing, flush, discard } = useOutbox();
  const offline = useOffline();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const tone = blocked > 0 ? "destructive" : "primary";

  return (
    <div
      className={`mx-4 mt-3 rounded-lg border p-3 md:mx-8 md:mt-4 ${
        tone === "destructive"
          ? "border-destructive/40 bg-destructive/10"
          : "border-primary/40 bg-primary/10"
      }`}
    >
      <div className="flex items-center gap-3">
        {blocked > 0 ? (
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        ) : syncing ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
        ) : (
          <UploadCloud className="h-5 w-5 shrink-0 text-primary" />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {blocked > 0
              ? `${blocked} ${blocked === 1 ? "change wasn't" : "changes weren't"} accepted`
              : syncing
                ? "Sending your changes…"
                : `${waiting} ${waiting === 1 ? "change waiting" : "changes waiting"} to sync`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {blocked > 0
              ? "Open the list to see why, then discard and redo them."
              : offline
                ? "They'll go out on their own once you're back online."
                : "Sending now."}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* No point offering a retry with no connection — it would fail on the spot
              and read as the app being broken rather than the network being absent. */}
          {!offline && waiting > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={syncing}
              onClick={() => void flush()}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      {open && (
        <ul className="mt-3 space-y-2 border-t pt-3">
          {items.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.label}</p>
                {m.error && (
                  <p
                    className={
                      m.blocked ? "mt-0.5 text-destructive" : "mt-0.5 text-muted-foreground"
                    }
                  >
                    {m.error}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Discard this change"
                className="text-destructive"
                onClick={() => void discard(m.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
