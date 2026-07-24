import type {
  Activity,
  AppNotification,
  Category,
  DashboardStats,
  Member,
  Reminder,
} from "@/types";

// Same-origin API (the backend lives in this app under /api). An explicit
// NEXT_PUBLIC_API_URL can still point at a different host if ever needed.
const PREFIX = "/api";
function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  return (configured || "") + PREFIX;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      ...options,
    });
  } catch {
    throw new Error("Cannot reach the server. Please try again.");
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
      }
    } catch {
      /* ignore non-JSON error bodies */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries as [string, string][]).toString();
};

export interface LoginMember {
  id: string;
  name: string;
  hasPin: boolean;
}

export const api = {
  auth: {
    members: () => request<LoginMember[]>("/auth/members"),
    login: (memberId: string, pin: string) =>
      request<Member>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ memberId, pin }),
      }),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    me: () => request<Member>("/auth/me"),
  },
  members: {
    list: () => request<Member[]>("/users"),
    create: (data: Partial<Member> & { pin?: string }) =>
      request<Member>("/users", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Member> & { pin?: string }) =>
      request<Member>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) =>
      request<{ deleted: boolean }>(`/users/${id}`, { method: "DELETE" }),
  },
  categories: {
    list: () => request<Category[]>("/categories"),
    create: (data: Partial<Category>) =>
      request<Category>("/categories", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Category>) =>
      request<Category>(`/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) =>
      request<{ deleted: boolean; message?: string }>(`/categories/${id}`, {
        method: "DELETE",
      }),
  },
  reminders: {
    list: (assignedToId?: string) =>
      request<Reminder[]>(`/reminders${qs({ assignedToId })}`),
    get: (id: string) => request<Reminder>(`/reminders/${id}`),
    create: (data: Partial<Reminder>) =>
      request<Reminder>("/reminders", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Reminder>) =>
      request<Reminder>(`/reminders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<Reminder>(`/reminders/${id}`, { method: "DELETE" }),
    complete: (id: string, data: { amount?: number; remarks?: string }) =>
      request<Reminder>(`/reminders/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    notifyFamily: (id: string) =>
      request<{ emailed: number; notified: number; title: string }>(
        `/reminders/${id}/notify-family`,
        { method: "POST" },
      ),
  },
  reports: {
    dashboard: (assignedToId?: string) =>
      request<DashboardStats>(`/reports/dashboard${qs({ assignedToId })}`),
    recentActivity: (assignedToId?: string) =>
      request<Activity[]>(`/reports/recent-activity${qs({ assignedToId })}`),
  },
  notifications: {
    list: (userId?: string) => request<AppNotification[]>(`/notifications${qs({ userId })}`),
    markRead: (id: string) =>
      request<{ updated: number }>(`/notifications/${id}/read`, { method: "PATCH" }),
    markAllRead: (userId?: string) =>
      request<{ updated: number }>(`/notifications/read-all${qs({ userId })}`, {
        method: "PATCH",
      }),
    testEmail: (to?: string) =>
      request<{ sent: boolean; to?: string; message: string }>("/notifications/test-email", {
        method: "POST",
        body: JSON.stringify({ to }),
      }),
  },
};
