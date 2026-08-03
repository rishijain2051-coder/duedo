/** The signed-in account, as returned by /api/auth/me. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  status: UserStatus;
}

export type UserStatus = 'pending' | 'active' | 'rejected';

/** An account as an admin sees it on the Users list. */
export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  status: UserStatus;
  approvedAt?: string | null;
  createdAt: string;
  /** True for the admin viewing the list — the UI stops them locking themselves out. */
  self?: boolean;
}

/**
 * Per-account preferences plus the read-only facts the Settings page needs to
 * describe delivery. Everything here belongs to the signed-in user alone.
 */
export interface Settings {
  name: string;
  email: string;
  role: 'admin' | 'member';
  timezone: string;
  defaultTime: string; // "HH:mm"
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
  /** Only set for admins: how many accounts are waiting for approval. */
  pendingApprovals?: number;
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
}

export interface Reminder {
  id: string;
  title: string;
  description?: string | null;
  categoryId: string;
  category?: Category;
  priority: 'low' | 'normal' | 'high';
  status: 'draft' | 'active' | 'completed' | 'archived';
  /** ISO instant. Always concrete — the user's default time is applied server-side. */
  dueAt: string;
  /** False when no time was chosen and the default was filled in. */
  hasTime: boolean;
  /** Minutes before dueAt to send an advance alert. */
  leadOffsets: number[];
  recurrenceRule?: string | null;
  amount?: number | null;
  snoozedUntil?: string | null;
  completedAt?: string | null;
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

export const RECURRENCE_OPTIONS = [
  'One Time',
  'Daily',
  'Weekly',
  'Monthly',
  'Quarterly',
  'Half-Yearly',
  'Yearly',
] as const;

export const PRIORITY_OPTIONS = ['low', 'normal', 'high'] as const;

/** Snooze choices offered on the notification and in the reminder list. */
export const SNOOZE_OPTIONS = [
  { minutes: 10, label: '10 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 60 * 4, label: '4 hours' },
  { minutes: 60 * 24, label: 'Tomorrow' },
] as const;
