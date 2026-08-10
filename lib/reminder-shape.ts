/**
 * What a reminder carries when a route returns one.
 *
 * Three routes hand-rolled this — the list, the single-reminder route, and the voice
 * ingest — and the third had already drifted: it omitted `assignedTo`, so the same
 * reminder came back with an assignee through the form and without one through Siri.
 * Nothing failed, which is how it survived. Same reason lib/settings-shape.ts and
 * lib/family-shape.ts exist.
 */
export const REMINDER_INCLUDE = {
  category: true,
  family: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, name: true } },
} as const;
