// dd/mm/yyyy text ↔ yyyy-mm-dd, for the date field.
//
// Its own file, importing nothing, so a smoke suite can run the real functions rather
// than a paraphrase — the same reason lib/dictation.ts is import-free. The interesting
// half here is what it *rejects*, and "does 31 February parse?" is not a question worth
// answering by typing into a form and looking.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const TEXT = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** yyyy-mm-dd to dd/mm/yyyy. "" for anything that isn't a complete ISO date. */
export function isoToText(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * dd/mm/yyyy back to yyyy-mm-dd, or "" if it names no real day.
 *
 * The round trip through Date is what rejects 31/02 and 31/04: the constructor rolls
 * those forward to 3 March and 1 May, so a day that doesn't survive the trip never
 * existed. Range checks alone accept both, and the reminder then silently lands on a
 * different date than the one that was typed — which is the whole failure this field
 * is meant to prevent.
 */
export function textToIso(text: string): string {
  const m = TEXT.exec(text);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return "";
  }
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Digits in, dd/mm/yyyy out, slashes appearing as they are typed.
 *
 * Everything that isn't a digit is dropped, so a pasted "3 April 2027" becomes "32027"
 * rather than something worse, and a pasted "03/04/2027" survives unchanged.
 */
export function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter((p) => p.length > 0)
    .join("/");
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Where the caret belongs after `n` digits of a formatted date.
 *
 * Steps over a slash rather than resting before it, so the next digit typed lands in
 * the next field instead of pushing against the separator.
 */
function caretAfterDigits(text: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i])) {
      seen++;
      if (seen === n) {
        return text[i + 1] === "/" ? i + 2 : i + 1;
      }
    }
  }
  return text.length;
}

/**
 * One edit of the date field: the new text, and where the caret should sit.
 *
 * A date has eight slots and always the same shape, so typing into the middle of one
 * means *replacing* a digit, not pushing the rest along. Insertion is what this used
 * to do, and it made the field unusable for the thing people most often want from it —
 * fixing a single wrong digit. With the caret after the "2" of 25/12/2026, typing 3
 * gave 23/51/2202: every later digit shifted right, the year lost its last figure, and
 * month 51 is not a month, so textToIso() returned "" and the reminder could no longer
 * be saved. Nothing on screen explained why.
 *
 * The caret came back too. A controlled input re-renders with a fresh value and the
 * browser drops the caret at the end, so every keystroke threw it back to the year —
 * which is why the corruption above could not simply be typed over.
 *
 * Overwrite applies only when a single digit lands on a slot that already had one.
 * Everything else — appending, deleting, pasting, selecting a range and replacing it —
 * takes the plain path, because those all mean what they say.
 */
export function editDate(
  prev: string,
  raw: string,
  caret: number,
): { text: string; caret: number } {
  const prevDigits = digitsOf(prev);
  const rawDigits = digitsOf(raw);
  // Digits at or before the caret: with a single insertion, the last of them is the
  // one just typed, so its index is the slot it landed in.
  const upToCaret = digitsOf(raw.slice(0, caret)).length;
  const slot = upToCaret - 1;

  const overwrote =
    rawDigits.length === prevDigits.length + 1 && slot >= 0 && slot < prevDigits.length;

  const digits = overwrote
    ? prevDigits.slice(0, slot) + rawDigits[slot] + prevDigits.slice(slot + 1)
    : rawDigits.slice(0, 8);

  const text = maskDate(digits);
  const at = overwrote ? slot + 1 : Math.min(upToCaret, digitsOf(text).length);
  return { text, caret: caretAfterDigits(text, at) };
}
