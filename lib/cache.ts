"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

const PREFIX = "prosys:cache:";
/** Which account the cached data belongs to. See setCacheOwner. */
const OWNER_KEY = "prosys:cache-owner";

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
  /** True while revalidating in the background over cached data. */
  validating: boolean;
  refresh: () => Promise<void>;
  /** Replaces the value locally and in the cache, for optimistic updates. */
  set: (value: T) => void;
}

/**
 * Fetches `key` through `fetcher`, seeding from localStorage first.
 *
 * `fetcher` is held in a ref, so an inline arrow function doesn't cause a refetch
 * loop; only `key` controls re-running.
 */
export function useCached<T>(key: string, fetcher: () => Promise<T>): Cached<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [primed, setPrimed] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useBeforePaint(() => {
    const cached = readCache<T>(key);
    if (cached !== null) setData(cached);
    setPrimed(true);
  }, [key]);

  const revalidate = useCallback(async () => {
    setValidating(true);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      writeCache(key, fresh);
      setError(null);
    } catch (e) {
      // Deliberately keeps whatever is on screen: stale content beats an empty
      // page when a request fails.
      setError((e as Error).message);
    } finally {
      setValidating(false);
    }
  }, [key]);

  useEffect(() => {
    if (!primed) return; // wait until the cache has been consulted
    void revalidate();
  }, [primed, revalidate]);

  const set = useCallback(
    (value: T) => {
      setData(value);
      writeCache(key, value);
    },
    [key],
  );

  return { data, loading: data === null, error, validating, refresh: revalidate, set };
}
