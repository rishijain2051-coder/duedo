"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/form";
// Pure, and in lib/ so a smoke suite can run the real parser — see lib/date-text.ts.
import { isoToText, maskDate, textToIso } from "@/lib/date-text";

/**
 * A date field that is always dd/mm/yyyy, whatever the browser thinks.
 *
 * `<input type="date">` renders in the *browser's* locale and there is no attribute,
 * CSS or option that changes it. On a machine set to en-US it shows 08/10/2026 while
 * every other date in this app reads 10/08/2026 — and in a reminders app that is not
 * merely untidy: 08/10 is a real date under both readings, two months apart, with
 * nothing on screen to say which one was meant.
 *
 * So the visible control is a text input this file formats, and the native picker is
 * kept behind a button. Keeping it matters — on a phone the wheel picker is the fast
 * way to enter a date, and hand-rolling a calendar to replace it would be a worse
 * control than the one the OS already ships.
 *
 * `value` and `onChange` speak yyyy-mm-dd throughout, so nothing outside this file
 * knows the display format changed.
 */

export function DateField({
  value,
  onChange,
  id,
}: {
  /** yyyy-mm-dd, or "" for empty. */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
}) {
  const [text, setText] = React.useState(() => isoToText(value));
  const picker = React.useRef<HTMLInputElement>(null);

  /**
   * Follows `value` when it is changed from outside — opening the form prefills
   * today, and editing an existing reminder loads its date.
   *
   * Guarded on the round trip rather than on the raw strings: while somebody is
   * halfway through typing, `value` is "" and rewriting `text` from it would erase
   * what they were typing on every keystroke.
   */
  React.useEffect(() => {
    setText((current) => (textToIso(current) === value ? current : isoToText(value)));
  }, [value]);

  function type(next: string) {
    const masked = maskDate(next);
    setText(masked);
    // "" while incomplete, so a half-typed date can never be submitted as a whole one.
    onChange(textToIso(masked));
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        // Not type="date" — that is the whole point. Numeric so a phone offers digits.
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        maxLength={10}
        value={text}
        onChange={(e) => type(e.target.value)}
        // Paste arrives as one event and lands in onChange already; this only stops
        // the browser's own autofill offering a differently-formatted date.
        autoComplete="off"
      />
      <button
        type="button"
        aria-label="Pick a date"
        onClick={() => {
          const el = picker.current;
          if (!el) return;
          // showPicker() is the only way to open the native calendar from a button.
          // Firefox has no such method, and Safari can throw if the call is not
          // treated as user-initiated — falling back to focus at least reaches the
          // control rather than doing nothing.
          try {
            (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            el.focus();
          }
        }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-background shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground sm:h-10 sm:w-10"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      {/* The OS picker, kept for its value on a phone and never shown. `sr-only` and
          not `hidden`: a display:none input cannot be given a picker to show. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        value={value}
        onChange={(e) => {
          setText(isoToText(e.target.value));
          onChange(e.target.value);
        }}
      />
    </div>
  );
}
