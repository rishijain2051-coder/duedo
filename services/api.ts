import type {
  AccountType,
  Activity,
  AppNotification,
  Category,
  CurrentUser,
  DashboardStats,
  FamilySummary,
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
    // Kept alongside the message: a few callers need to act on *why*, not just show
    // the text. The login screen offers a resend when a refused sign-in was only
    // blocked on an unconfirmed address.
    let needsVerification = false;
    try {
      const body = await res.json();
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
      }
      needsVerification = body?.needsVerification === true;
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

    const err = new Error(message) as Error & {
      status?: number;
      needsVerification?: boolean;
    };
    err.status = res.status;
    err.needsVerification = needsVerification;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AuthStatus {
  /** True while the install has no accounts, so the page offers signup, not sign-in. */
  setupNeeded: boolean;
}

export interface RegisterResult {
  status: "pending";
  message: string;
  /**
   * Whether the confirmation link actually went out. False means mail is unavailable
   * and the account needs an admin instead — a different instruction for the person
   * waiting.
   */
  verificationSent?: boolean;
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

export interface AdminOverview {
  users: { total: number; pending: number; active: number; rejected: number; admins: number };
  families: number;
  reminders: { total: number; active: number; overdue: number };
  devices: { total: number; blocked: number };
  health: AdminHealth;
}

export interface DispatchRunRow {
  id: string;
  ranAt: string;
  durationMs: number;
  considered: number;
  recipients: number;
  firedLead: number;
  firedDue: number;
  firedOverdue: number;
  pushesSent: number;
  pushesFailed: number;
  emailsSent: number;
  error: string | null;
}

export interface AdminHealth {
  mailConfigured: boolean;
  pushConfigured: boolean;
  cronSecretSet: boolean;
  /** Minutes since the dispatcher last ran. Null when it never has. */
  lastRunMinutesAgo: number | null;
  lastRunError: string | null;
  /** Runs that threw in the last 24h — non-zero means delivery is degraded. */
  failuresLast24h: number;
  /**
   * The scheduler as Postgres sees it, for the case where the dispatcher is never
   * reached at all and therefore records nothing of its own.
   */
  scheduler: {
    /** False when the cron catalogs couldn't be read — not a verdict either way. */
    readable: boolean;
    pgCronInstalled: boolean;
    pgNetInstalled: boolean;
    jobScheduled: boolean;
    jobActive: boolean;
    lastTickAt: string | null;
    lastTickStatus: string | null;
    lastTickError: string | null;
  };
  runs: DispatchRunRow[];
  /** Devices with consecutive send failures, worth chasing. */
  failingDevices: { id: string; label: string | null; user: string; failures: number }[];
}

export interface AdminFamily {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  reminderCount: number;
  members: { id: string; name: string; email: string; role: string }[];
}

export interface AuditEntry {
  id: string;
  actor: { id: string; name: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  timestamp: string;
}

export const api = {
  auth: {
    status: () => request<AuthStatus>("/auth/status"),
    register: (data: {
      name: string;
      email: string;
      pin: string;
      accountType: AccountType;
    }) =>
      request<RegisterResult>("/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    login: (email: string, pin: string) =>
      request<CurrentUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, pin }),
      }),
    /**
     * Asks for the confirmation link again. Always resolves — the endpoint answers
     * the same thing for every address so it can't be used to discover which ones
     * exist, so there is nothing here for the caller to branch on.
     */
    resendVerification: (email: string) =>
      request<{ message: string }>("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
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
    /** Hand the install over. Only the current owner may call it. */
    makeOwner: (id: string) =>
      request<ManagedUser>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ makeRoot: true }),
      }),
    resetPin: (id: string, pin: string) =>
      request<{ reset: boolean }>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ newPin: pin }),
      }),
  },
  /** The dedicated admin panel. Every route behind jsonAdmin. */
  admin: {
    overview: () => request<AdminOverview>("/admin/overview"),
    health: () => request<AdminHealth>("/admin/health"),
    families: () => request<AdminFamily[]>("/admin/families"),
    renameFamily: (id: string, name: string) =>
      request<AdminFamily>(`/admin/families/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    setFamilyHead: (id: string, userId: string) =>
      request<AdminFamily>(`/admin/families/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ headId: userId }),
      }),
    removeFamilyMember: (id: string, userId: string) =>
      request<AdminFamily>(`/admin/families/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ removeUserId: userId }),
      }),
    dissolveFamily: (id: string) =>
      request<{ deleted: boolean }>(`/admin/families/${id}`, { method: "DELETE" }),
    audit: (params?: { action?: string; actorId?: string; take?: number }) => {
      const q = new URLSearchParams();
      if (params?.action) q.set("action", params.action);
      if (params?.actorId) q.set("actorId", params.actorId);
      if (params?.take) q.set("take", String(params.take));
      const qs = q.toString();
      return request<AuditEntry[]>(`/admin/audit${qs ? `?${qs}` : ""}`);
    },
    /** Reminder content for one account. Audited every time. */
    userReminders: (id: string) =>
      request<Reminder[]>(`/admin/users/${id}/reminders`),
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
          | "accountType"
        >
      > & { currentPin?: string; newPin?: string },
    ) => request<Settings>("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    testEmail: () =>
      request<{ sent: boolean; to: string; message: string }>(
        "/settings/test-email",
        { method: "POST" },
      ),
  },
  /** Families the caller belongs to, plus join/administration actions. */
  families: {
    list: () => request<FamilySummary[]>("/families"),
    create: (name: string) =>
      request<{ id: string; name: string; joinCode: string; role: "head" }>(
        "/families",
        { method: "POST", body: JSON.stringify({ name }) },
      ),
    join: (joinCode: string) =>
      request<{ status: string; family: string; familyId: string; message: string }>(
        "/families/join",
        { method: "POST", body: JSON.stringify({ joinCode }) },
      ),
    rename: (id: string, name: string) =>
      request<FamilySummary>(`/families/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    rotateCode: (id: string) =>
      request<{ id: string; name: string; joinCode: string }>(`/families/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ rotateCode: true }),
      }),
    transferHead: (id: string, userId: string) =>
      request<{ role: string }>(`/families/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ transferHeadTo: userId }),
      }),
    dissolve: (id: string) =>
      request<{ deleted: boolean }>(`/families/${id}`, { method: "DELETE" }),
    removeMember: (id: string, userId: string) =>
      request<{ removed: boolean; name: string; self: boolean }>(
        `/families/${id}/members?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      ),
    leave: (id: string) =>
      request<{ removed: boolean; self: boolean }>(`/families/${id}/members`, {
        method: "DELETE",
      }),
  },
  categories: {
    /** `scope`: omit for everything, "mine" for personal, or a familyId. */
    list: (scope?: string) =>
      request<Category[]>(
        `/categories${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`,
      ),
    create: (data: Partial<Category> & { familyId?: string | null }) =>
      request<Category>("/categories", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Category>) =>
      request<Category>(`/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    remove: (id: string) =>
      request<{ deleted: boolean; message?: string }>(`/categories/${id}`, {
        method: "DELETE",
      }),
  },
  reminders: {
    /** `scope`: omit for everything visible, "mine" for personal, or a familyId. */
    list: (scope?: string) =>
      request<Reminder[]>(
        `/reminders${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`,
      ),
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
  /**
   * Everything the app shell needs, in one call. Replaces the serial
   * /auth/me -> /settings -> /families chain plus a dashboard query for the badge.
   */
  bootstrap: () =>
    request<{
      user: CurrentUser;
      settings: Settings;
      families: FamilySummary[];
      badge: { outstanding: number; unreadNotifications: number };
      buildId: string;
    }>("/bootstrap"),
  /** Just the two numbers the chrome shows. Two COUNTs. */
  badge: () =>
    request<{ outstanding: number; unreadNotifications: number }>("/badge"),
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
