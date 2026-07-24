// Pure helpers shared by the reminder API routes.

export function sanitizeReminderInput(data: Record<string, unknown>, isCreate: boolean) {
  const out: Record<string, unknown> = {};
  if (data.title !== undefined) out.title = String(data.title);
  if (data.description !== undefined)
    out.description = data.description ? String(data.description) : null;
  if (data.categoryId !== undefined) out.categoryId = data.categoryId;
  if (data.assignedToId !== undefined) out.assignedToId = data.assignedToId;
  if (data.priority !== undefined) out.priority = data.priority;
  if (data.status !== undefined) out.status = data.status;
  if (data.dueDate !== undefined) out.dueDate = new Date(data.dueDate as string);
  if (data.recurrenceRule !== undefined) out.recurrenceRule = data.recurrenceRule;
  if (data.amount !== undefined)
    out.amount =
      data.amount === "" || data.amount == null ? 0 : Number(data.amount);

  if (isCreate) {
    if (out.priority === undefined) out.priority = "normal";
    if (out.status === undefined) out.status = "active";
    if (out.recurrenceRule === undefined) out.recurrenceRule = "One Time";
    if (out.amount === undefined) out.amount = 0;
  }
  return out;
}

export function computeNextDueDate(from: Date, rule: string | null): Date | null {
  if (!rule || rule === "One Time") return null;
  const d = new Date(from);
  switch (rule) {
    case "Daily":
      d.setDate(d.getDate() + 1);
      return d;
    case "Weekly":
      d.setDate(d.getDate() + 7);
      return d;
    case "Monthly":
      d.setMonth(d.getMonth() + 1);
      return d;
    case "Quarterly":
      d.setMonth(d.getMonth() + 3);
      return d;
    case "Half-Yearly":
      d.setMonth(d.getMonth() + 6);
      return d;
    case "Yearly":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    default:
      return null;
  }
}

export const assignedToSelect = { id: true, name: true, email: true };
