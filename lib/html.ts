// HTML escaping, shared.
//
// Exists for the same reason lib/csv.ts does: there were four hand-rolled copies of
// "escape a value before it goes into markup" — in lib/reminder-email.ts,
// lib/family-report.ts and app/api/contacts/confirm/route.ts — plus one that was simply
// missing from the external-contact invitation in lib/external-contacts.ts. That last
// one is the whole argument. The invitation interpolates a reminder title and an account
// name into HTML and mails it to somebody outside the app, so the copy nobody wrote was
// the copy pointed at a stranger's inbox. Two of the four also escaped only four
// characters, leaving `'` alone.

/**
 * Escapes the five characters that matter in element text and in a double-quoted
 * attribute value.
 *
 * Not a sanitiser: it makes a value inert as *text*, which is all any caller here
 * wants. Nothing in this app takes markup from a user and tries to keep part of it.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
