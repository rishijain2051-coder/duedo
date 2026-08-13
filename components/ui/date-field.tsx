"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/form";
// Pure, and in lib/ so a smoke suite can run the real parser — see lib/date-text.ts.
import { editDate, isoToText, textToIso } from "@/lib/date-text";

/**
 * A date field that is always dd/mm/yyyy, whatever the browser thinks.
 *
 * `<input type="date">` renders in the *browser's* locale and there is no attribute,
 * CSS or option that changes it. On a machine set to en-US it shows 08/10/2026 while
 * every other date in this app reads 10/08/2026 — and in a reminders app that is not
 * merely untidy: 08/10 is a real date under both readings, two months apart, with
 * nothing on screen to say which one was meant.
 *
 * So the visible control is a text input this file formats, and the native picker sits
 * transparently over the calendar button beside it. Keeping the native one matters —
 * on a phone the wheel picker is the fast way to enter a date, and hand-rolling a
 * calendar to replace it would be a worse control than the one the OS already ships.
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

  /**
   * Applies one edit and puts the caret back where the typist expects it.
   *
   * The DOM is written directly before `setText`, rather than waiting for the render
   * to land. A controlled input re-rendering with a new value drops the caret at the
   * end, and setting it afterwards from an effect means one painted frame with the
   * caret in the wrong place — visible as a jump on every keystroke. Writing both
   * together, then telling React the same string, leaves nothing for it to correct.
   */
  function edit(el: HTMLInputElement) {
    const { text: next, caret } = editDate(text, el.value, el.selectionStart ?? el.value.length);
    el.value = next;
    el.setSelectionRange(caret, caret);
    setText(next);
    // "" while incomplete, so a half-typed date can never be submitted as a whole one.
    onChange(textToIso(next));
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
        onChange={(e) => edit(e.currentTarget)}
        // Paste arrives as one event and lands in onChange already; this only stops
        // the browser's own autofill offering a differently-formatted date.
        autoComplete="off"
      />
      {/*
        The native date input, laid transparently over a drawn button rather than
        hidden beside one.

        It used to be `sr-only` with a real <button> calling showPicker(). That button
        did nothing at all on Firefox and on Safari before 16.4, because neither has
        showPicker — and `showPicker?.()` on a missing method returns undefined rather
        than throwing, so the catch that was meant to rescue it never ran. A control
        that silently does nothing is worse than no control.

        Putting the input itself under the pointer removes the dependency entirely:
        a tap opens the OS picker because that is what tapping a date input does.
        showPicker() is still called on top, because desktop Chrome and Edge open the
        calendar from that and not from a click — and there it is a genuine user
        gesture, which is the one condition it actually needs.
      */}
      <div className="relative h-11 w-11 shrink-0 sm:h-10 sm:w-10">
        <span
          aria-hidden="true"
          className="pointer-events-none flex h-full w-full items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm"
        >
          <CalendarDays className="h-4 w-4" />
        </span>
        <input
          type="date"
          aria-label="Pick a date"
          // Not in the tab order: the text field beside it is the control a keyboard
          // reaches, and it accepts the same date typed out.
          tabIndex={-1}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value}
          onClick={(e) => {
            try {
              (
                e.currentTarget as HTMLInputElement & { showPicker?: () => void }
              ).showPicker?.();
            } catch {
              // Already focused by the click that got us here, which is what opens
              // the picker on a phone.
            }
          }}
          onChange={(e) => {
            setText(isoToText(e.target.value));
            onChange(e.target.value);
          }}
        />
      </div>
    </div>
  );
}
