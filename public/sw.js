/* PRO-SYS service worker — push delivery, and enough caching to open offline.
 *
 * Note that it holds no notion of *who* is signed in. Every fetch below goes out
 * with the session cookie, so an action always applies to whoever is logged in on
 * this device — which is also why the server scopes each of those endpoints by the
 * session rather than trusting an id from here.
 *
 * On caching, the rules below are narrow on purpose:
 *
 *   * A page document is fetched from the **network first**, always, and only falls
 *     back to a stored copy when the network fails. This worker used to precache
 *     nothing at all, on the grounds that a stale HTML document is a worse bug than a
 *     slow cold load — which is true of cache-first, and is why that isn't what this
 *     does. Network-first cannot serve stale content while there is a connection.
 *   * Only assets the server marks `immutable` are served cache-first. Under
 *     /_next/static a production build hashes the filename, so the URL changes
 *     whenever the bytes do; the header is what proves that rather than assumed.
 *   * Anything under /api is never cached, in either direction. Those are per-account
 *     and the leak risk on a shared device is real; the app keeps its own snapshot
 *     under a key bound to the signed-in account instead. See lib/cache.ts.
 *
 * Storing page documents is only acceptable because every page in this app is a
 * client component that fetches after hydration: the HTML is chrome, and carries no
 * reminder, name or figure belonging to anyone. If a page is ever server-rendered
 * with account data in it, it must be excluded here.
 */

const APP_ICON = "/icons/icon-192.png";
const BADGE_ICON = "/icons/badge-96.png";

/** Content-hashed assets. Immutable by construction, so cache-first is safe. */
const STATIC_CACHE = "prosys-static-v1";
/** Page documents, kept only as a fallback for when the network is gone. */
const SHELL_CACHE = "prosys-shell-v1";
// Precached at install, so editing that file alone is not enough to ship the change —
// SHELL_CACHE has to be renamed too, or installed devices keep serving the old copy.
const OFFLINE_URL = "/offline.html";
/** Every cache this version of the worker knows about; the rest are deleted. */
const KEEP = [STATIC_CACHE, SHELL_CACHE];

// Caps, because a hashed URL is a new entry on every deploy and nothing else would
// ever evict the old ones. Cache.keys() is in insertion order, so the oldest go first.
const MAX_STATIC = 150;
const MAX_SHELL = 20;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(OFFLINE_URL);
      } catch {
        // The one thing precached here. If it fails the worker still installs —
        // losing the fallback page is not worth losing push delivery over.
      }
    })(),
  );
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // A rename of either cache above is how a bad stored copy gets abandoned, so
      // the sweep has to actually happen rather than being left for the browser.
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("prosys-") && !KEEP.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trim(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  } catch {
    /* eviction is housekeeping, never worth failing a response over */
  }
}

/** True for URLs whose contents can never change without the URL changing too. */
function isImmutable(pathname) {
  return pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/");
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Stored only when the server itself says the bytes behind this URL can never
  // change. The path is not enough: `next dev` serves these same /_next/static paths
  // unhashed and no-store, so trusting the prefix alone would pin the first chunk
  // ever fetched and break every subsequent edit — offline support that silently
  // stops the app updating is not a trade worth making.
  const immutable = (res.headers.get("Cache-Control") || "").includes("immutable");
  if (res && res.ok && immutable) {
    cache.put(request, res.clone());
    void trim(STATIC_CACHE, MAX_STATIC);
  }
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    // `redirected` excludes the case that matters: an expired session answers a
    // request for /reminders with the login page. Storing that under the /reminders
    // key would serve the lock screen offline to someone who is signed in.
    if (res && res.ok && !res.redirected) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, res.clone());
      void trim(SHELL_CACHE, MAX_SHELL);
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    // ignoreSearch, so /reminders?new=1 is answered by the copy of /reminders.
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    // Deliberately NOT "serve any cached page as a shell". That was the first version
    // of this and it is wrong: an App Router document carries the render of its own
    // route, so answering /insights with the stored /reminders document hydrates the
    // reminders page under the /insights URL — the wrong screen, silently, with no
    // clue anything went astray. A page never opened on this device has nothing
    // truthful to show, so it says exactly that.
    const offline = await cache.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only GET, and only our own origin. A queued write is replayed by the app from
  // IndexedDB when the connection returns — retrying one from here would replay it
  // without the conflict rules that decide whether it should still land.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Never cached, and deliberately not even wrapped: letting the request go through
  // untouched means an /api failure reaches the app as the same error it always was.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isImmutable(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else — favicon, manifest, the odd svg — is left to the HTTP cache.
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
      family: Boolean(data.family),
      url: data.url || "/reminders",
    },
    // Two actions, because iOS shows at most two and a third would simply not appear.
    //
    // There is deliberately no "assign to <person>" here: action buttons are fixed when
    // the notification is *sent*, so a member picker cannot live inside one on any
    // platform. A family reminder therefore trades Snooze for Assign, which deep-links
    // straight into the app with the picker already open — one tap to the picker rather
    // than one tap to assign, which is the closest thing that actually exists.
    actions: !hasReminder
      ? []
      : data.family
        ? [
            { action: "complete", title: "Complete" },
            { action: "assign", title: "Assign" },
          ]
        : [
            { action: "complete", title: "Complete" },
            { action: "snooze", title: "Snooze 1h" },
          ],
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

  // Nothing is assigned from here — see the note on `actions` above. The app is opened
  // at the reminder with `?assign=<id>`, which is what makes the picker appear.
  if (data.reminderId && action === "assign") {
    event.waitUntil(openApp(`/reminders?assign=${encodeURIComponent(data.reminderId)}`));
    return;
  }

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
