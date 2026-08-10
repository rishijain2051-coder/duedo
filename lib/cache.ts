"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { isOfflineError } from "@/lib/net";

// Stale-while-revalidate on top of localStorage.
//
// Every page here is a client component that fetches after hydration, so without
// a cache each visit is: HTML -> JS -> request -> content. On a phone talking to a
// serverless function that's a spinner every single time, even for data that
// hasn't changed.
//
// With a cache the last known value paints immediately and the network result
// swaps in behind it. Repeat navigations and a cold PWA launch feel instant, and
// the app still shows something useful with no connection at all.

const PREFIX = "duedo:cache:";
/** Which account the cached data belongs to. See setCacheOwner. */
const OWNER_KEY = "duedo:cache-owner";

interface Entry<T> {
  v: T;
  at: number;
}

export function readCache<T>(key: string, maxAgeMs = Infinity): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.at !== "number") return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry.v;
  } catch {
    return null; // private mode, quota, or corrupt entry
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, at: Date.now() }));
  } catch {
    // Quota exceeded or blocked — caching is an optimisation, never a requirement.
  }
}

/** Wipes cached data. Called on sign-out so nothing survives for the next person. */
export function clearCache(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
    localStorage.removeItem(OWNER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The address last signed in with on this device, so the login screen only asks for
 * the PIN.
 *
 * Kept outside PREFIX on purpose, which means clearCache() does *not* remove it. That
 * is the point: the convenience is worth nothing if pressing Logout — the ordinary way
 * to leave — also forgets it. It is the identifier the person types anyway, never a
 * credential, and the PIN it is paired with is not stored at all.
 *
 * The trade is visible: sign out on a shared browser and the next person sees which
 * address was last used here. Clearing site data removes it, as does signing in with
 * a different address, which overwrites it.
 */
const LAST_EMAIL_KEY = "duedo:last-email";

export function rememberEmail(email: string): void {
  try {
    const trimmed = email.trim();
    if (trimmed) localStorage.setItem(LAST_EMAIL_KEY, trimmed);
  } catch {
    /* private mode — the field simply starts empty */
  }
}

export function lastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Binds the cache to an account, wiping it when the account changes.
 *
 * This matters because reminders are private and the cache is per *browser*, not
 * per account: without it, signing in as somebody else on a shared laptop would
 * paint the previous person's reminders from localStorage for a moment before the
 * fetch replaced them.
 *
 * Called from the login page the instant an identity is known — the only ways to
 * obtain a session are the PIN form and passkey verification, and both call this
 * before navigating into the app. Sign-out clears the cache outright.
 */
export function setCacheOwner(userId: string): void {
  try {
    if (localStorage.getItem(OWNER_KEY) !== userId) {
      clearCache();
      localStorage.setItem(OWNER_KEY, userId);
    }
  } catch {
    /* private mode — nothing was cached anyway */
  }
}

// Reading the cache must happen before the browser paints, or the spinner
// flashes. It also must not happen during the server render, which would
// mismatch hydration — the server has no localStorage.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface Cached<T> {
  data: T | null;
  /** True only when there is nothing to show yet — a cache hit is never "loading". */
  loading: boolean;
  /** Set when the last fetch failed. Stale data may still be present alongside it. */
  error: string | null;
  /**
   * The HTTP status behind `error`, when there was one.
   *
   * Exists for 402: a paid feature is not a fault, and rendering it in the same red
   * "something went wrong" banner as a 500 tells people the app is broken when it is
   * working exactly as designed. Matching on the message text instead would tie the
   * page's layout to the wording of a sentence.
   */
  errorStatus: number | null;
  /** True while revalidating in the background over cached data. */
  validating: boolean;
  /**
   * True when the last attempt never reached the server. Cached data is usually still
   * on screen underneath, which is why this is separate from `error` rather than
   * folded into it — "no connection, this is what we had" is not a failure to report.
   */
  offline: boolean;
  refresh: () => Promise<void>;
  /** Replaces the value locally and in the cache, for optimistic updates. */
  set: (value: T) => void;
}

/**
 * Fired after the outbox drains, so every cached page re-reads rather than sitting on
 * the optimistic copy it painted while offline. See lib/offline.ts.
 */
export const SYNCED_EVENT = "duedo:synced";

/**
 * Fetches `key` through `fetcher`, seeding from localStorage first.
 *
 * `fetcher` is held in a ref, so an inline arrow function doesn't cause a refetch
 * loop; only `key` controls re-running.
 */
export function useCached<T>(key: string, fetcher: () => Promise<T>): Cached<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [offline, setOffline] = useState(false);
  const [primed, setPrimed] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Read inside revalidate's catch, where `data` from the closure would be the value
  // as of the render that created it rather than the one on screen now.
  const hasData = useRef(false);

  useBeforePaint(() => {
    const cached = readCache<T>(key);
    if (cached !== null) {
      setData(cached);
      hasData.current = true;
    }
    setPrimed(true);
  }, [key]);

  const revalidate = useCallback(async () => {
    setValidating(true);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      hasData.current = true;
      writeCache(key, fresh);
      setError(null);
      setErrorStatus(null);
      setOffline(false);
    } catch (e) {
      // Deliberately keeps whatever is on screen: stale content beats an empty
      // page when a request fails.
      const dropped = isOfflineError(e);
      setOffline(dropped);
      // A dropped connection over data we already have is not an error to report —
      // the chrome says "Offline" once for the whole app, and repeating it as a red
      // banner on every page reads as five separate faults. With nothing cached
      // there is nothing else to say, so it is surfaced.
      setError(dropped && hasData.current ? null : (e as Error).message);
      setErrorStatus((e as { status?: number }).status ?? null);
    } finally {
      setValidating(false);
    }
  }, [key]);

  useEffect(() => {
    if (!primed) return; // wait until the cache has been consulted
    void revalidate();
  }, [primed, revalidate]);

  // Two moments when what's on screen is known to be behind: the connection came
  // back, and the outbox finished replaying. Both mean this page's data was written
  // by somebody — possibly this device, minutes ago — and never re-read.
  useEffect(() => {
    const again = () => void revalidate();
    window.addEventListener("online", again);
    window.addEventListener(SYNCED_EVENT, again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener(SYNCED_EVENT, again);
    };
  }, [revalidate]);

  const set = useCallback(
    (value: T) => {
      setData(value);
      writeCache(key, value);
    },
    [key],
  );

  return {
    data,
    // Not merely "no data yet": a request that has already failed is finished, not
    // pending. Without the second clause a refusal the server answered instantly —
    // 402 on a paid surface, say — left a spinner turning under the message forever,
    // because nothing was ever going to arrive to clear it.
    loading: data === null && error === null,
    error,
    errorStatus,
    validating,
    offline,
    refresh: revalidate,
    set,
  };
}
