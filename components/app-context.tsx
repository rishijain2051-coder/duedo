"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";
import { clearCache } from "@/lib/cache";
import { ensurePushSubscribed, setBadge } from "@/lib/push-client";
import {
  applyTheme,
  readAccent,
  readMode,
  saveAccent,
  saveMode,
  DEFAULT_ACCENT,
  DEFAULT_MODE,
} from "@/lib/theme";
import type {
  AccentId,
  CurrentUser,
  FamilySummary,
  Settings,
  ThemeMode,
} from "@/types";

interface AppContextValue {
  /** The signed-in account. Null until the first /auth/me resolves. */
  user: CurrentUser | null;
  isAdmin: boolean;
  settings: Settings | null;
  /** Families the user belongs to. Always empty for a solo account. */
  families: FamilySummary[];
  /** True once they've declared themselves a family account. */
  isFamilyAccount: boolean;
  /** The user's own zone, used for every date the UI renders. */
  timeZone: string | undefined;
  loading: boolean;
  refreshSettings: () => Promise<void>;
  refreshFamilies: () => Promise<void>;
  /** Re-reads the due/overdue count and repaints the Home Screen icon badge. */
  syncBadge: () => Promise<void>;
  logout: () => Promise<void>;

  themeMode: ThemeMode;
  accent: AccentId;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentId) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api.settings.get());
    } catch {
      /* surfaced by the pages that need it */
    }
  }, []);

  const refreshFamilies = useCallback(async () => {
    try {
      setFamilies(await api.families.list());
    } catch {
      /* solo accounts simply have none */
    }
  }, []);

  const syncBadge = useCallback(async () => {
    try {
      const stats = await api.reports.dashboard();
      await setBadge(stats.outstanding);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    // The inline script in layout.tsx already painted the theme; mirror it into
    // React state so the Settings controls start on the right values.
    setThemeModeState(readMode());
    setAccentState(readAccent());
  }, []);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      saveMode(mode);
      applyTheme(mode, accent);
    },
    [accent],
  );

  const setAccent = useCallback(
    (next: AccentId) => {
      setAccentState(next);
      saveAccent(next);
      applyTheme(themeMode, next);
    },
    [themeMode],
  );

  // Follow the OS while the mode is "system".
  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system", accent);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode, accent]);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.auth.me();
        setUser(me);
        await refreshSettings();
        if (me.accountType === "family") await refreshFamilies();
        // Registers the worker AND re-hands this device's subscription to the
        // server on every authenticated load, so a pruned or rotated
        // subscription heals itself instead of failing silently — and a device
        // someone else was signed in on is re-pointed at this account. No-ops
        // unless permission is already granted, so it never prompts.
        void ensurePushSubscribed();
        void syncBadge();
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshSettings, refreshFamilies, syncBadge, router]);

  // Coming back to the app is the moment the badge is most likely to be stale.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [syncBadge]);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* ignore */
    }
    // Reminders are private, so cached copies must not outlive the session for
    // whoever sits down at this browser next.
    clearCache();
    router.replace("/login");
    router.refresh();
  }, [router]);

  // ------------------------------------------------------------ idle auto-lock
  // The server is the real enforcement point (it drops the session), but waiting
  // for the next request would leave the app sitting open looking signed in. This
  // locks the screen at roughly the same moment.
  const lastActivity = useRef(Date.now());
  const idleMins = settings?.idleTimeoutMins ?? 0;

  useEffect(() => {
    if (idleMins <= 0) return;

    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Returning to a tab that sat in the background past the limit should lock
      // immediately rather than wait out another poll.
      if (Date.now() - lastActivity.current > idleMins * 60_000) void logout();
      else bump();
    };
    document.addEventListener("visibilitychange", onVisible);

    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > idleMins * 60_000) void logout();
    }, 15_000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [idleMins, logout]);

  return (
    <AppContext.Provider
      value={{
        user,
        isAdmin: user?.role === "admin",
        settings,
        families,
        // Settings is the fresher source: creating a family flips accountType
        // server-side, and this avoids waiting for a reload to see the change.
        isFamilyAccount:
          (settings?.accountType ?? user?.accountType) === "family",
        timeZone: settings?.timezone,
        loading,
        refreshSettings,
        refreshFamilies,
        syncBadge,
        logout,
        themeMode,
        accent,
        setThemeMode,
        setAccent,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
