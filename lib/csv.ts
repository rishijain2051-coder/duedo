// CSV writing, shared.
//
// Lifted out of lib/audit-rotate.ts when the spending export needed the same thing. Two
// implementations of "quote a CSV cell" is how one of them ends up subtly wrong on the
// day someone's category is called `Rent, flat 2 "B"`.

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
  return `"${text.replace(/"/g, '""')}"`;
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
