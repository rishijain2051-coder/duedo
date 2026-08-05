"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";
import { clearCache, readCache, setCacheOwner, writeCache } from "@/lib/cache";
import { isOfflineError } from "@/lib/net";
import {
  adoptOutbox,
  flush as flushOutbox,
  forgetOutbox,
  pending as pendingWrites,
  useOutboxFlush,
} from "@/lib/offline";
import {
  ensurePushSubscribed,
  registerServiceWorker,
  setBadge,
} from "@/lib/push-client";
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

type BootstrapPayload = Awaited<ReturnType<typeof api.bootstrap>>;

const BOOT_CACHE_KEY = "bootstrap";
/** Goes through lib/cache so it is wiped on account switch and on sign-out. */
const SCOPE_CACHE_KEY = "scope";
/**
 * How stale a cached shell may be before it is ignored rather than painted.
 *
 * A day is generous on purpose: the point is that the chrome and the user's own
 * settings appear instantly, and the fresh payload lands moments later regardless.
 * Anything older than this is more likely to be a browser someone left alone for a
 * week, where showing week-old counts would be worse than a brief spinner.
 */
const BOOT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  /**
   * Which list the user is looking at: `"mine"` or a family id.
   *
   * Shared rather than per-page. It started as a useState on the reminders page, which
   * meant picking a family and then opening the dashboard silently put you back on your
   * personal list — the app appeared to forget, and two pages disagreed about what you
   * were looking at. Persisted under the cache-owner key, so it clears with everything
   * else when a different account signs in.
   */
  scope: string;
  setScope: (scope: string) => void;
  /**
   * Unread notifications, from the same bootstrap payload the shell already fetched.
   * The header renders one digit from it and used to fetch up to 100 rows to do so.
   */
  unreadNotifications: number;
  /** The deployed build, so the update banner needn't fetch /api/version on load. */
  deployedBuildId: string | null;
  loading: boolean;
  refreshSettings: () => Promise<void>;
  refreshFamilies: () => Promise<void>;
  /** Re-reads the due/overdue count and repaints the Home Screen icon badge. */
  syncBadge: () => Promise<void>;
  /** `silent` is the idle auto-lock: no prompt, and unsent writes are kept. */
  logout: (opts?: { silent?: boolean }) => Promise<void>;

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
  const [unreadNotifications, setUnread] = useState(0);
  const [deployedBuildId, setDeployedBuildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);
  const [scope, setScopeState] = useState<string>("mine");

  const setScope = useCallback((next: string) => {
    setScopeState(next);
    writeCache(SCOPE_CACHE_KEY, next);
  }, []);

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

  const lastBadgeSync = useRef(0);
  const syncBadge = useCallback(async () => {
    // Throttled, because the trigger is "app came to the foreground" and that fires
    // on every glance at the phone. The numbers change at most once a minute — when
    // the dispatcher runs — so anything more often is a request that cannot tell you
    // something new.
    if (Date.now() - lastBadgeSync.current < 30_000) return;
    lastBadgeSync.current = Date.now();
    try {
      // /badge, not /reports/dashboard: the badge needs one number and the dashboard
      // computes six aggregates to produce it.
      const { outstanding, unreadNotifications: unread } = await api.badge();
      setUnread(unread);
      await setBadge(outstanding);
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

  /**
   * Paint from the last known bootstrap before the network is even asked.
   *
   * Without this the whole app sits behind one request: the shell renders a spinner,
   * waits for /api/bootstrap, and only then can any page start its own fetch. Reading
   * the cache synchronously in a layout effect — not during render, which would
   * mismatch hydration — means a repeat visit and a cold PWA launch show the real
   * chrome immediately, with the fresh payload swapping in behind it.
   *
   * `loading` is only cleared here when there *is* a cached payload, so a first-ever
   * visit still waits rather than flashing an empty app.
   */
  useLayoutEffect(() => {
    const cached = readCache<BootstrapPayload>(BOOT_CACHE_KEY, BOOT_CACHE_MAX_AGE_MS);

    // Read before paint too, so the list you were last looking at is the list that
    // appears — restoring it a frame later would show your personal reminders and then
    // replace them, which reads as a glitch.
    //
    // Checked against the cached membership first. A saved scope can name a family
    // somebody has since left, and the effect below only corrects that once
    // /api/bootstrap answers — which is a whole round trip during which every scoped
    // page is asking about a family the API refuses. Reminders answer that with an
    // empty list, but Categories and Spending answer 404, so the pages painted a red
    // error and then quietly fixed themselves. With no cached payload there is nothing
    // to check against, and nothing is rendered until bootstrap lands anyway.
    const savedScope = readCache<string>(SCOPE_CACHE_KEY);
    if (
      savedScope &&
      (savedScope === "mine" ||
        !cached ||
        cached.families.some((f) => f.id === savedScope))
    ) {
      setScopeState(savedScope);
    }

    if (!cached) return;
    // Adopted from the cached identity as well as the fresh one, because offline is
    // exactly when the queue matters and the fresh payload may never arrive.
    void adoptOutbox(cached.user.id);
    setUser(cached.user);
    setSettings(cached.settings);
    setFamilies(cached.families);
    setUnread(cached.badge.unreadNotifications);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // One request for the whole shell. This was /auth/me, then /settings, then
        // /families — three serial round trips, each its own serverless function
        // re-resolving the session, with nothing on screen until the last returned.
        const boot = await api.bootstrap();
        // Bound to the account, so a cached shell can never paint for the next person
        // on a shared browser.
        setCacheOwner(boot.user.id);
        // Same rule as the cache, and it matters more here: a queued write replayed
        // under somebody else's session would put one person's completion on another
        // person's list.
        void adoptOutbox(boot.user.id);
        writeCache(BOOT_CACHE_KEY, boot);
        setUser(boot.user);
        setSettings(boot.settings);
        setFamilies(boot.families);
        setUnread(boot.badge.unreadNotifications);
        setDeployedBuildId(boot.buildId);
        // A saved scope can outlive the membership it names — someone was removed from
        // a family, or left it. Left alone, every scoped page would ask about a family
        // the API now 404s, so the whole app would look broken until the user thought
        // to press "Mine".
        setScopeState((current) =>
          current !== "mine" && !boot.families.some((f) => f.id === current)
            ? "mine"
            : current,
        );
        void setBadge(boot.badge.outstanding);
        // The worker serves the app offline as well as receiving pushes, so it has to
        // be registered for everyone. ensurePushSubscribed() below registers it too,
        // but only after finding permission already granted — which left every person
        // who declined notifications, or never answered, with no offline app at all.
        void registerServiceWorker();
        // Registers the worker AND re-hands this device's subscription to the
        // server on every authenticated load, so a pruned or rotated
        // subscription heals itself instead of failing silently — and a device
        // someone else was signed in on is re-pointed at this account. No-ops
        // unless permission is already granted, so it never prompts.
        void ensurePushSubscribed();
        // No syncBadge() here: the payload above already carried both counts, and
        // calling it would spend a second request re-reading what was just set.
        // Returning to the app is what makes them stale, and that path still syncs.
        lastBadgeSync.current = Date.now();
      } catch (e) {
        // A dropped connection is not a lapsed session. Left alone, opening the
        // installed app with no signal sent you to the lock screen — which cannot be
        // passed offline either, so the app became unusable at exactly the moment the
        // cached copy was most wanted. The session cookie is still there; the shell
        // that just painted from cache is still correct; so stay put and let the
        // pages show what they have.
        if (isOfflineError(e) && readCache<BootstrapPayload>(BOOT_CACHE_KEY)) return;
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshSettings, refreshFamilies, syncBadge, router]);

  // Sends anything queued while offline, on reconnect and on foreground.
  useOutboxFlush();

  // Coming back to the app is the moment the badge is most likely to be stale.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [syncBadge]);

  /**
   * `silent` is the idle auto-lock rather than someone pressing Logout.
   *
   * The two differ in what happens to unsent writes. Pressing Logout is a handover:
   * the queue is cleared like the cache, and the user is warned first if anything
   * would be lost. An idle lock is the same person coming back in a minute, and there
   * is nobody there to warn — so the queue is left alone and replays when they sign
   * back in. adoptOutbox() drops it if a *different* account signs in instead.
   */
  const logout = useCallback(
    async ({ silent = false } = {}) => {
      // One last attempt while there is still a session, so a change made moments ago
      // isn't thrown away for the sake of tidiness.
      try {
        await flushOutbox();
      } catch {
        /* nothing queued, or still no connection */
      }

      if (!silent) {
        const stranded = pendingWrites().length;
        if (
          stranded > 0 &&
          !confirm(
            `${stranded} ${stranded === 1 ? "change hasn't" : "changes haven't"} been sent yet, and signing out discards ${stranded === 1 ? "it" : "them"}. Sign out anyway?`,
          )
        ) {
          return;
        }
      }

      try {
        await api.auth.logout();
      } catch {
        /* ignore */
      }
      // Reminders are private, so cached copies must not outlive the session for
      // whoever sits down at this browser next.
      clearCache();
      if (!silent) await forgetOutbox();
      router.replace("/login");
      router.refresh();
    },
    [router],
  );

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
      if (Date.now() - lastActivity.current > idleMins * 60_000) {
        void logout({ silent: true });
      } else bump();
    };
    document.addEventListener("visibilitychange", onVisible);

    const timer = setInterval(() => {
      // silent: nobody is at the screen to answer a prompt, and blocking the lock on
      // one would leave the app sitting open — which is the thing it exists to prevent.
      if (Date.now() - lastActivity.current > idleMins * 60_000) {
        void logout({ silent: true });
      }
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
        scope,
        setScope,
        unreadNotifications,
        deployedBuildId,
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
