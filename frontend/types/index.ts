export interface Member {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  emailOptIn: boolean;
  notifyDaysBefore: number;
  createdAt: string;
}

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
  assignedToId: string;
  assignedTo?: Pick<Member, 'id' | 'name' | 'email'>;
  priority: 'low' | 'normal' | 'high';
  status: 'draft' | 'active' | 'completed' | 'archived';
  dueDate: string;
  nextDueDate?: string | null;
  recurrenceRule?: string | null;
  amount?: number | null;
}

export interface DashboardStats {
  totalActive: number;
  dueToday: number;
  overdue: number;
  completedThisMonth: number;
  monthlySpend: number;
}

export interface Activity {
  id: string;
  title: string;
  member?: string | null;
  amount: number;
  status: string;
  completedOn: string;
  remarks?: string | null;
}

export interface AppNotification {
  id: string;
  userId: string;
  reminderId?: string | null;
  channel: string;
  message: string;
  read: boolean;
  createdAt: string;
  user?: { name: string };
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
