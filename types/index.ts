/** The signed-in account, as returned by /api/auth/me. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  status: UserStatus;
  /** solo hides every family surface in the UI; family unlocks it. */
  accountType: AccountType;
}

export type UserStatus = 'pending' | 'active' | 'rejected';
export type AccountType = 'solo' | 'family';

/**
 * PINs are exactly this many digits.
 *
 * Fixed rather than a range because the login form submits itself the moment the
 * last digit lands — with a variable length there is no "last digit" to detect,
 * and the form would either fire early or need a button after all. Declared here
 * so the client and lib/pin.ts can't disagree.
 */
export const PIN_LENGTH = 4;

/** An account as an admin sees it on the Users list. */
export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  status: UserStatus;
  accountType: AccountType;
  /**
   * When the address was proved by following the link. Null on an account an admin
   * activated by hand — worth distinguishing, since only one of the two is evidence
   * that somebody can actually read the address.
   */
  emailVerifiedAt?: string | null;
  createdAt: string;
  /** True for the admin viewing the list — the UI stops them locking themselves out. */
  self?: boolean;
  /** The install's owner. No admin action is offered on this row. */
  isRoot?: boolean;
  /** Whether the viewer may hand ownership to this account. */
  canTransferRoot?: boolean;
  reminders?: number;
}

/**
 * Per-account preferences plus the read-only facts the Settings page needs to
 * describe delivery. Everything here belongs to the signed-in user alone.
 */
export interface Settings {
  name: string;
  email: string;
  role: 'admin' | 'member';
  accountType: AccountType;
  timezone: string;
  /** "HH:mm". No longer used for reminders — see UNTIMED_LEAD_MINUTES in lib/time.ts. */
  defaultTime: string;
  overdueRepeatMins: number;
  /** Sign out after this many minutes idle. 0 = never. */
  idleTimeoutMins: number;
  /** Delivery channels, chosen per account. */
  emailOptIn: boolean;
  pushOptIn: boolean;
  pinSet: boolean;
  passkeyCount: number;
  /** Server-side facts, not preferences. */
  pushConfigured: boolean;
  mailConfigured: boolean;
  pushSubscriptions: number;
}

// ------------------------------------------------------------------ families

export interface FamilyMemberSummary {
  id: string;
  name: string;
  email: string;
  role: 'head' | 'member';
  joinedAt: string;
  self: boolean;
}

export interface FamilySummary {
  id: string;
  name: string;
  role: 'head' | 'member';
  createdAt: string;
  /** Only sent to the head — a member has no business handing the code out. */
  joinCode: string | null;
  /**
   * What this family has opted into. Head-controlled; every member sees the values,
   * because the UI has to know which actions to offer before offering them.
   */
  flags: {
    showRanking: boolean;
    showStreaks: boolean;
    allowNudges: boolean;
    monthlyReportToHead: boolean;
  };
  members: FamilyMemberSummary[];
}

/** Who hears about a reminder when it fires. */
export type Audience = 'owner' | 'assignee' | 'family';

export const AUDIENCE_OPTIONS = [
  { id: 'owner', label: 'Only me', hint: 'Nobody else is notified.' },
  {
    id: 'assignee',
    label: 'The assigned member',
    hint: 'Falls back to you if nobody is assigned.',
  },
  { id: 'family', label: 'Everyone in the family', hint: 'All members get it.' },
] as const;

export function isAudience(value: unknown): value is Audience {
  return value === 'owner' || value === 'assignee' || value === 'family';
}

/** Inactivity choices offered in Settings. */
export const IDLE_TIMEOUT_OPTIONS = [
  { minutes: 0, label: 'Never' },
  { minutes: 5, label: 'After 5 minutes' },
  { minutes: 10, label: 'After 10 minutes' },
  { minutes: 15, label: 'After 15 minutes' },
  { minutes: 30, label: 'After 30 minutes' },
  { minutes: 60, label: 'After 1 hour' },
] as const;

export type ThemeMode = 'light' | 'dark' | 'system';

/** Accent presets. `soft` is the lighter end of the wordmark gradient. */
export const ACCENTS = [
  { id: 'blue', label: 'Blue', primary: '#3b82f6', soft: '#60a5fa' },
  { id: 'violet', label: 'Violet', primary: '#8b5cf6', soft: '#a78bfa' },
  { id: 'emerald', label: 'Emerald', primary: '#10b981', soft: '#34d399' },
  { id: 'rose', label: 'Rose', primary: '#f43f5e', soft: '#fb7185' },
  { id: 'amber', label: 'Amber', primary: '#f59e0b', soft: '#fbbf24' },
  { id: 'cyan', label: 'Cyan', primary: '#06b6d4', soft: '#22d3ee' },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];

export interface Category {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  /** Null for a personal category; set for one belonging to a family. */
  familyId?: string | null;
  family?: { id: string; name: string } | null;
}

export interface Reminder {
  id: string;
  /** The creator. Needed on the client to work out who an alert is actually addressed to. */
  userId: string;
  title: string;
  description?: string | null;
  categoryId: string;
  category?: Category;
  priority: 'low' | 'normal' | 'high';
  status: 'draft' | 'active' | 'completed' | 'archived';
  /** ISO instant. Always concrete — an omitted time becomes ten minutes from saving. */
  dueAt: string;
  /** False when no time was chosen and the default was filled in. */
  hasTime: boolean;
  /** Minutes before dueAt to send an advance alert. */
  leadOffsets: number[];
  recurrenceRule?: string | null;
  amount?: number | null;
  snoozedUntil?: string | null;
  completedAt?: string | null;
  /** Null = personal and private. Set = on that family's shared list. */
  familyId?: string | null;
  family?: { id: string; name: string } | null;
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string } | null;
  audience: Audience;
  /** Set once somebody has said they'll handle this cycle. Cleared on completion. */
  acknowledgedAt?: string | null;
  acknowledgedById?: string | null;
  /** Who to tell if it stays undone. Null on almost every reminder. */
  escalation?: EscalationStep[] | null;
  /** Bumped on every write; the offline sync uses it as the version token. */
  updatedAt?: string;
}

export interface DashboardStats {
  totalActive: number;
  dueToday: number;
  overdue: number;
  completedThisMonth: number;
  monthlySpend: number;
  outstanding: number;
}

export interface Activity {
  id: string;
  title: string;
  /** Who completed it — only set for family reminders. */
  by?: string | null;
  amount: number;
  status: string;
  completedOn: string;
  remarks?: string | null;
}

export interface AppNotification {
  id: string;
  reminderId?: string | null;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  createdAt: string;
}

/** Escalation, as the reminder form stores and sends it. See lib/escalation.ts. */
export interface EscalationStep {
  afterMins: number;
  notify: "assignee" | "head" | "admins" | "external";
  contactId?: string;
}

export const RECURRENCE_OPTIONS = [
  'One Time',
  'Daily',
  'Weekly',
  'Monthly',
  'Quarterly',
  'Half-Yearly',
  'Yearly',
  // Anchored to the month rather than to the day you happened to pick. 'Monthly' on
  // the 31st keeps landing near the 31st; these two always land on the 1st and on the
  // last day, whatever length the month is. Rent and salary-day bills want the latter.
  'Beginning of the month',
  'End of the month',
] as const;

export const PRIORITY_OPTIONS = ['low', 'normal', 'high'] as const;

/**
 * The states a reminder can be in.
 *
 * Listed here so the API can discard anything else. Without a whitelist a client
 * typo lands in the database and the reminder disappears from every list that
 * filters on a known status — visible nowhere, deletable nowhere.
 */
export const REMINDER_STATUSES = ['draft', 'active', 'completed', 'archived'] as const;

/** Snooze choices offered on the notification and in the reminder list. */
export const SNOOZE_OPTIONS = [
  { minutes: 10, label: '10 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 4, label: '4 hours' },
  { minutes: 60 * 24, label: 'Tomorrow' },
] as const;
