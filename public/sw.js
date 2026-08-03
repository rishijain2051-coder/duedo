/* PRO-SYS service worker — push delivery only.
 *
 * Deliberately does NOT precache the app shell. Next.js ships hashed assets and a
 * stale cached HTML document is a much worse bug than a slightly slower cold load,
 * so this worker exists purely to receive pushes and act on notification taps.
 *
 * Note that it holds no notion of *who* is signed in. Every fetch below goes out
 * with the session cookie, so an action always applies to whoever is logged in on
 * this device — which is also why the server scopes each of those endpoints by the
 * session rather than trusting an id from here.
 */

const APP_ICON = "/icons/icon-192.png";
const BADGE_ICON = "/icons/badge-96.png";

self.addEventListener("install", () => {
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Lets "Reload" in the app promote a waiting worker instead of leaving the old
// one in control across the refresh.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/**
 * iOS is unforgiving here: if a push arrives and the worker does not call
 * showNotification(), Safari may revoke the subscription. So every branch shows
 * something, even when the payload is unreadable.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "PRO-SYS", body: event.data ? event.data.text() : "Reminder" };
  }

  const title = data.title || "PRO-SYS";
  const hasReminder = Boolean(data.reminderId);

  const options = {
    body: data.body || "",
    icon: APP_ICON,
    badge: BADGE_ICON,
    // Collapses repeat nags for the same reminder into one notification.
    tag: data.tag || "prosys",
    renotify: true,
    requireInteraction: false,
    data: {
      reminderId: data.reminderId || null,
      kind: data.kind || "due",
      url: data.url || "/reminders",
    },
    actions: hasReminder
      ? [
          { action: "complete", title: "Complete" },
          { action: "snooze", title: "Snooze 1h" },
        ]
      : [],
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      if (typeof data.badge === "number" && self.navigator.setAppBadge) {
        try {
          if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
          else await self.navigator.clearAppBadge();
        } catch {
          /* badge is best-effort */
        }
      }
    })(),
  );
});

async function post(path) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The session cookie is httpOnly; without this the call lands as a 401.
    credentials: "include",
    body: JSON.stringify({}),
  });
}

async function openApp(url) {
  const all = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of all) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client && url) {
        try {
          await client.navigate(url);
        } catch {
          /* navigation is best-effort */
        }
      }
      return;
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(url || "/");
}

async function refreshBadge() {
  try {
    const res = await fetch("/api/reports/dashboard", { credentials: "include" });
    if (!res.ok) return;
    const stats = await res.json();
    if (!self.navigator.setAppBadge) return;
    if (stats.outstanding > 0) await self.navigator.setAppBadge(stats.outstanding);
    else await self.navigator.clearAppBadge();
  } catch {
    /* best-effort */
  }
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const action = event.action;
  event.notification.close();

  if (data.reminderId && (action === "complete" || action === "snooze")) {
    const path =
      action === "complete"
        ? `/api/reminders/${data.reminderId}/complete`
        : `/api/reminders/${data.reminderId}/snooze`;

    event.waitUntil(
      (async () => {
        const res =
          action === "snooze"
            ? await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ minutes: 60 }),
              })
            : await post(path);

        // A 401 means the session lapsed — open the app so it can be signed into
        // again instead of silently dropping the action. A 404 means the reminder
        // belongs to a different account than the one signed in here, which the
        // server is right to refuse.
        if (res && (res.status === 401 || res.status === 404)) {
          await openApp(res.status === 401 ? "/login" : "/reminders");
          return;
        }
        await refreshBadge();
      })(),
    );
    return;
  }

  event.waitUntil(openApp(data.url || "/reminders"));
});

/**
 * Push services rotate subscriptions. When that happens the old endpoint stops
 * working, so re-subscribe with the same key and hand the new one to the server.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        const applicationServerKey =
          event.newSubscription?.options?.applicationServerKey ||
          old?.options?.applicationServerKey;
        if (!applicationServerKey) return;

        const fresh =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }));

        if (old?.endpoint) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ endpoint: old.endpoint }),
          });
        }
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(fresh.toJSON()),
        });
      } catch {
        /* nothing useful to do here; the Settings page can re-subscribe manually */
      }
    })(),
  );
});
