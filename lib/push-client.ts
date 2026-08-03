"use client";

import { api } from "@/services/api";

// Browser-side push enrolment. Everything here is best-effort and capability
// checked, because iOS only supports any of it in an installed PWA.

const SW_URL = "/sw.js";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "PRO-SYS";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac, but a touch-capable one.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/** True when running as an installed app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * On iOS, push is only available to a Home Screen install — in a Safari tab the
 * Notification API either is missing or permission requests silently fail.
 */
export function needsInstallFirst(): boolean {
  return isIos() && !isStandalone();
}

export function permission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch (e) {
    console.error("[push] service worker registration failed:", e);
    return null;
  }
}

function deviceLabel(): string {
  if (isIos()) return isStandalone() ? "iPhone (installed)" : "iPhone (Safari)";
  return navigator.platform || "This device";
}

export interface EnableResult {
  ok: boolean;
  reason?: string;
}

export async function enablePush(): Promise<EnableResult> {
  if (!isPushSupported()) {
    return { ok: false, reason: "This browser doesn't support push notifications." };
  }
  if (needsInstallFirst()) {
    return {
      ok: false,
      reason: `On iPhone, add ${APP_NAME} to your Home Screen first — Safari tabs can't receive push.`,
    };
  }

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) {
    return { ok: false, reason: "NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set." };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { ok: false, reason: "Could not register the service worker." };
  }
  // subscribe() throws if the worker isn't active yet.
  await navigator.serviceWorker.ready;

  const result = await Notification.requestPermission();
  if (result !== "granted") {
    return {
      ok: false,
      reason:
        result === "denied"
          ? `Notifications are blocked. Enable them for ${APP_NAME} in your device settings.`
          : "Notification permission was dismissed.",
    };
  }

  try {
    await syncSubscription(registration, vapid, false);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || "Subscription failed." };
  }
}

/**
 * Reuses this device's subscription (creating one if absent) and hands it to the
 * server. /api/push/subscribe upserts on endpoint, so calling this repeatedly is
 * cheap and — importantly — repairs a server row that has gone missing, and
 * re-points the device at whoever is signed in now.
 */
async function syncSubscription(
  registration: ServiceWorkerRegistration,
  vapid: string,
  silent: boolean,
): Promise<void> {
  const existing = await registration.pushManager.getSubscription();
  const sub =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
    }));
  // `silent` tells the server this is the automatic refresh, which must not undo
  // a device the same user revoked from Settings.
  await api.push.subscribe(sub.toJSON() as PushSubscriptionJSON, deviceLabel(), silent);
}

/**
 * Silent self-heal, safe to call on every load.
 *
 * Only acts when permission is ALREADY granted — no prompt, so no user gesture is
 * needed. This is what recovers the nasty failure mode where the browser still
 * holds a valid subscription but the server's row is gone (pruned after a failed
 * send, rotated by iOS, or deleted by hand): notifications look enabled on the
 * device while nothing can actually reach it.
 *
 * It is also what hands the device over when a different user signs in on it.
 *
 * Returns true when a subscription is registered with the server afterwards.
 */
export async function ensurePushSubscribed(): Promise<boolean> {
  if (!isPushSupported() || needsInstallFirst()) return false;
  if (Notification.permission !== "granted") return false;

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return false;

  try {
    const registration = await registerServiceWorker();
    if (!registration) return false;
    await navigator.serviceWorker.ready;
    await syncSubscription(registration, vapid, true);
    return true;
  } catch (e) {
    console.error("[push] could not re-register this device:", e);
    return false;
  }
}

export async function disablePush(): Promise<EnableResult> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager.getSubscription();
    if (sub) {
      await api.push.unsubscribe(sub.endpoint);
      await sub.unsubscribe();
    }
    await clearBadge();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message || "Could not unsubscribe." };
  }
}

export async function hasLocalSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager.getSubscription();
  return Boolean(sub);
}

/** What, if anything, is standing between this device and a lock-screen alert. */
export type PushBlocker =
  | "none" // notifications are live
  | "install" // iPhone, but running in a Safari tab
  | "permission" // supported, never granted — one tap away
  | "blocked" // explicitly denied; only the OS settings can undo it
  | "unsupported";

export async function pushBlocker(): Promise<PushBlocker> {
  if (!isPushSupported()) return isIos() && !isStandalone() ? "install" : "unsupported";
  if (needsInstallFirst()) return "install";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "default") return "permission";
  // Granted — but that alone doesn't mean the server can reach us.
  return (await ensurePushSubscribed()) ? "none" : "permission";
}

/**
 * Paints the count of due/overdue reminders onto the Home Screen icon. On iOS
 * this is the closest thing a web app gets to a widget.
 */
export async function setBadge(count: number): Promise<void> {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* best-effort */
  }
}

export async function clearBadge(): Promise<void> {
  await setBadge(0);
}
