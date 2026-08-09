import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { HttpError } from "./http";

// Family membership helpers. Node-only (prisma) — route handlers only.
//
// Membership is many-to-many, so "my family" is a *set*. Every scope check in the
// app is `familyId IN (that set)`, never an equality, and `familyIdsFor` is the
// only sanctioned way to obtain it — a route that builds the set by hand is a
// route that will eventually forget a condition.

/** Every family the user belongs to. Empty for a solo account. */
export async function familyIdsFor(userId: string): Promise<string[]> {
  const rows = await prisma.familyMember.findMany({
    where: { userId },
    select: { familyId: true },
  });
  return rows.map((r) => r.familyId);
}

export interface Membership {
  familyId: string;
  role: string;
}

export async function membershipsFor(userId: string): Promise<Membership[]> {
  return prisma.familyMember.findMany({
    where: { userId },
    select: { familyId: true, role: true },
  });
}

/** The membership row, or null when the user isn't in that family. */
export function membershipIn(userId: string, familyId: string) {
  return prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId } },
    select: { id: true, role: true },
  });
}

/** 404s unless the user is a member. 404 not 403 — see lib/ownership.ts. */
export async function assertMember(userId: string, familyId: string) {
  const m = await membershipIn(userId, familyId);
  if (!m) throw new HttpError(404, "Family not found");
  return m;
}

/**
 * 404s a non-member, 403s a member who isn't the head.
 *
 * The split matters: a member legitimately knows the family exists, so hiding it
 * from them buys nothing, while telling a stranger it exists would.
 */
export async function assertHead(userId: string, familyId: string) {
  const m = await assertMember(userId, familyId);
  if (m.role !== "head") {
    throw new HttpError(403, "Only the family head can do that.");
  }
  return m;
}

/**
 * Human-shareable join code. Base32-ish alphabet with I/O/0/1 removed, because
 * these get read aloud and typed by hand — "PRO-1IO0" is unusable.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function code(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/**
 * A join code no family is using yet.
 *
 * Retries on collision rather than trusting 32^8: the unique index is the real
 * guarantee, and this just avoids surfacing a constraint error to the caller.
 */
export async function uniqueJoinCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = code();
    const clash = await prisma.family.findUnique({
      where: { joinCode: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  throw new HttpError(500, "Could not allocate a join code. Try again.");
}

/** Codes are compared case-insensitively and ignoring spaces/dashes. */
export function normalizeJoinCode(input: unknown): string {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** The eight defaults, seeded per user and again per family on creation. */
export const DEFAULT_CATEGORIES = [
  { name: "Insurance", icon: "ShieldCheck", color: "#3b82f6" },
  { name: "EMI / Loans", icon: "Landmark", color: "#8b5cf6" },
  { name: "Utility Bills", icon: "Zap", color: "#eab308" },
  { name: "Subscriptions", icon: "Repeat", color: "#ec4899" },
  { name: "Vehicle", icon: "Car", color: "#64748b" },
  { name: "Taxes", icon: "FileText", color: "#ef4444" },
  { name: "Health / Medicine", icon: "HeartPulse", color: "#10b981" },
  { name: "Birthdays", icon: "Cake", color: "#f97316" },
];

/** Where a reminder goes when nobody picked a category. */
export const OTHERS_CATEGORY = "Others";

/**
 * The scope's "Others" category, created the first time it is needed.
 *
 * Picking a category is no longer part of adding a reminder — most of them don't want
 * one, and making it required meant a second decision before the thing could be saved.
 * `Reminder.categoryId` is still a required column with a real relation, though, so
 * "no category" has to be a category. Making the column nullable instead would put an
 * `if` on every read that groups or totals by category, and Spending is built entirely
 * out of those.
 *
 * Not seeded with the eight defaults: a list that opens with an empty "Others" in it
 * invites people to file things there deliberately, which is not what it is for.
 */
export async function ensureOthersCategory(
  scope: { userId: string } | { familyId: string },
): Promise<string> {
  const existing = await prisma.category.findFirst({
    where: { ...scope, name: OTHERS_CATEGORY },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const made = await prisma.category.create({
      data: { ...scope, name: OTHERS_CATEGORY, icon: "Folder", color: "#94a3b8" },
      select: { id: true },
    });
    return made.id;
  } catch {
    // Two reminders saved at once both found nothing and both inserted; the unique
    // index on (scope, name) refused the second. The winner's row is the answer.
    const raced = await prisma.category.findFirst({
      where: { ...scope, name: OTHERS_CATEGORY },
      select: { id: true },
    });
    if (raced) return raced.id;
    throw new HttpError(500, "Could not file this under a category.");
  }
}
