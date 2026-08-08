// CSV writing, shared.
//
// Lifted out of lib/audit-rotate.ts when the spending export needed the same thing. Two
// implementations of "quote a CSV cell" is how one of them ends up subtly wrong on the
// day someone's category is called `Rent, flat 2 "B"`.

/** Leading characters Excel, Sheets and LibreOffice read as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** A plain number, which must stay a number — see deFang. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Stops a spreadsheet treating a value as a formula.
 *
 * RFC 4180 quoting does nothing about this: Excel evaluates `"=1+1"` on open regardless
 * of the quotes, so a cell beginning `=`, `+`, `-`, `@`, tab or carriage return is
 * executable content in the reader rather than data. That matters here because both CSVs
 * this app produces carry text somebody else typed — the audit dump mails every
 * account's name, address and detail to the install's owner, and the family spending
 * export carries another member's reminder titles and remarks. A leading apostrophe is
 * the conventional answer: spreadsheets drop it and show the text as written.
 *
 * Plain numbers are exempt, so a negative amount stays a number the reader can total
 * rather than becoming text that silently won't add up.
 */
function deFang(text: string): string {
  return FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/**
 * RFC 4180: quote everything, double any embedded quote.
 *
 * Quoting unconditionally rather than only when needed — a comma, quote or newline in a
 * value is exactly the case a conditional gets wrong, and the file is a few bytes larger
 * for the certainty.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${deFang(text).replace(/"/g, '""')}"`;
}

/**
 * A complete CSV document.
 *
 * CRLF line endings, because that is what RFC 4180 says and what Excel expects; a
 * bare-LF file opens as one long row in some versions of it.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join(
    "\r\n",
  );
}
