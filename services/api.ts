import type {
  Activity,
  AppNotification,
  Category,
  CurrentUser,
  DashboardStats,
  ManagedUser,
  Reminder,
  Settings,
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

    // A 401 mid-session means the server dropped it — usually the inactivity
    // timeout, or the login was revoked from another device. Go to the lock
    // screen instead of letting every page render its own auth error.
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login" &&
      !path.startsWith("/auth/")
    ) {
      window.location.replace("/login");
    }

    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AuthStatus {
  /** True on a fresh install: the first account to register becomes the admin. */
  setupNeeded: boolean;
}

export interface RegisterResult {
  status: "pending" | "active";
  message: string;
}

export interface PasskeySummary {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  pruned: number;
  subscriptions: number;
}

export interface PushDevice {
  id: string;
  label: string | null;
  service: string;
  fingerprint: string;
  failures: number;
  lastOkAt: string | null;
  createdAt: string;
  blocked: boolean;
}

export interface ActiveLogin {
  id: string;
  label: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface VersionInfo {
  buildId: string;
}

export const api = {
  auth: {
    status: () => request<AuthStatus>("/auth/status"),
    register: (data: { name: string; email: string; pin: string }) =>
      request<RegisterResult>("/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    login: (email: string, pin: string) =>
      request<CurrentUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, pin }),
      }),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
    me: () => request<CurrentUser>("/auth/me"),
  },
  /** Admin-only account management. */
  users: {
    list: () => request<ManagedUser[]>("/users"),
    approve: (id: string) =>
      request<ManagedUser>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      }),
    reject: (id: string) =>
      request<ManagedUser>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "rejected" }),
      }),
    setRole: (id: string, role: "admin" | "member") =>
      request<ManagedUser>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    remove: (id: string) =>
      request<{ deleted: boolean }>(`/users/${id}`, { method: "DELETE" }),
  },
  settings: {
    get: () => request<Settings>("/settings"),
    update: (
      data: Partial<
        Pick<
          Settings,
          | "name"
          | "timezone"
          | "defaultTime"
          | "overdueRepeatMins"
          | "idleTimeoutMins"
          | "emailOptIn"
          | "pushOptIn"
        >
      > & { currentPin?: string; newPin?: string },
    ) => request<Settings>("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    testEmail: () =>
      request<{ sent: boolean; to: string; message: string }>(
        "/settings/test-email",
        { method: "POST" },
      ),
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
    list: () => request<Reminder[]>("/reminders"),
    get: (id: string) => request<Reminder>(`/reminders/${id}`),
    create: (data: Record<string, unknown>) =>
      request<Reminder>("/reminders", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<Reminder>(`/reminders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) => request<Reminder>(`/reminders/${id}`, { method: "DELETE" }),
    complete: (id: string, data: { amount?: number; remarks?: string }) =>
      request<Reminder>(`/reminders/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    snooze: (id: string, minutes: number) =>
      request<Reminder>(`/reminders/${id}/snooze`, {
        method: "POST",
        body: JSON.stringify({ minutes }),
      }),
  },
  reports: {
    /** Stats + upcoming + recent activity in one request, for the dashboard. */
    overview: () =>
      request<{
        stats: DashboardStats;
        upcoming: Reminder[];
        activity: Activity[];
      }>("/reports/overview"),
    /** Just the counters — used by the badge sync, which needs nothing else. */
    dashboard: () => request<DashboardStats>("/reports/dashboard"),
    recentActivity: () => request<Activity[]>("/reports/recent-activity"),
  },
  notifications: {
    list: () => request<AppNotification[]>("/notifications"),
    markRead: (id: string) =>
      request<{ updated: number }>(`/notifications/${id}/read`, { method: "PATCH" }),
    markAllRead: () =>
      request<{ updated: number }>("/notifications/read-all", { method: "PATCH" }),
  },
  push: {
    subscribe: (sub: PushSubscriptionJSON, label?: string, silent = false) =>
      request<{ id?: string; subscribed: boolean; blocked: boolean }>(
        "/push/subscribe",
        { method: "POST", body: JSON.stringify({ ...sub, label, silent }) },
      ),
    unsubscribe: (endpoint: string) =>
      request<{ removed: number }>("/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint }),
      }),
    test: () => request<PushSendResult>("/push/test", { method: "POST" }),
    devices: () => request<PushDevice[]>("/push/devices"),
    revokeDevice: (id: string) =>
      request<{ blocked: number; purged: number }>(
        `/push/devices?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    forgetDevice: (id: string) =>
      request<{ blocked: number; purged: number }>(
        `/push/devices?id=${encodeURIComponent(id)}&purge=1`,
        { method: "DELETE" },
      ),
    revokeAllDevices: () =>
      request<{ blocked: number; purged: number }>("/push/devices?all=1", {
        method: "DELETE",
      }),
  },
  sessions: {
    list: () => request<ActiveLogin[]>("/sessions"),
    revoke: (id: string) =>
      request<{ revoked: number; selfRevoked: boolean }>(
        `/sessions?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    revokeOthers: () =>
      request<{ revoked: number; selfRevoked: boolean }>("/sessions?others=1", {
        method: "DELETE",
      }),
  },
  version: () => request<VersionInfo>("/version"),
  passkeys: {
    list: () => request<PasskeySummary[]>("/webauthn/passkeys"),
    remove: (id: string) =>
      request<{ removed: number }>(`/webauthn/passkeys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    registerOptions: () =>
      request<Record<string, unknown>>("/webauthn/register-options", { method: "POST" }),
    registerVerify: (body: Record<string, unknown>) =>
      request<{ verified: boolean }>("/webauthn/register-verify", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    authOptions: () =>
      request<Record<string, unknown>>("/webauthn/auth-options", { method: "POST" }),
    authVerify: (body: Record<string, unknown>) =>
      request<CurrentUser>("/webauthn/auth-verify", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
};
