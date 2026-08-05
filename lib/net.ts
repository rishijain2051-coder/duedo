"use client";

import { useSyncExternalStore } from "react";

// Whether the app can currently reach its own server.
//
// `navigator.onLine` on its own is not that. It reports true on a hotel captive
// portal, on a wifi network whose router has no route out, and on a phone holding a
// single bar of a cell it can't actually use — which is precisely the situation this
// exists for. The browser says "connected" and every request still fails.
//
// So the signal here is driven by *observed* request outcomes: services/api.ts marks
// it after every call, and a response of any kind — even a 500 — counts as reachable,
// because the server clearly answered. The browser's own events are used only as a
// hint that something changed and it's worth trying again.

let offline = false;
let sinceMs: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function isOffline(): boolean {
  return offline;
}

/** When the connection was first observed to be gone. Null while reachable. */
export function offlineSince(): number | null {
  return sinceMs;
}

/** Called by services/api.ts when a fetch never reached the server at all. */
export function markOffline(): void {
  if (offline) return;
  offline = true;
  sinceMs = Date.now();
  emit();
}

/** Called on any response. A 401 or a 500 still proves the server was reached. */
export function markOnline(): void {
  if (!offline) return;
  offline = false;
  sinceMs = null;
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  // Losing the interface is conclusive — there is nothing to reach. Regaining it is
  // not, so "online" only clears the flag optimistically: the next request that fails
  // sets it straight back, and clearing it is what lets the app try at all.
  window.addEventListener("offline", markOffline);
  window.addEventListener("online", markOnline);
}

/**
 * Re-renders on every change of reachability.
 *
 * The server snapshot is always false: a server render has no network state, and
 * claiming "offline" during hydration would flash the banner on every cold load.
 */
export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => offline,
    () => false,
  );
}

/** An error thrown because the request never left the device. */
export interface OfflineError extends Error {
  offline: true;
}

export function isOfflineError(e: unknown): boolean {
  return Boolean(e) && (e as { offline?: boolean }).offline === true;
}
