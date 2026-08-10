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
