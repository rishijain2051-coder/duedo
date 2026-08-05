"use client";

import type { Mutation } from "@/lib/sync";

// The outbox's storage. One IndexedDB store, four operations, no dependency.
//
// Not localStorage, which everything else in this app caches into: a queued write has
// to survive a browser restart *and* a full quota, and localStorage is one synchronous
// ~5MB budget already shared with the snapshot cache. Losing a snapshot to quota costs
// a spinner; losing a queued completion costs someone's record of paying a bill.
//
// Not a wrapper library either. `idb` is small and good, but this is open, put, getAll
// and delete — and a runtime dependency needs a reason that survives the bundle cost.

const DB_NAME = "prosys";
const DB_VERSION = 1;
const STORE = "outbox";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    // Fires when another tab holds an old version open. Nothing useful to do but
    // fail: the caller treats an unavailable outbox as "cannot queue".
    req.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
  // A failed open must not be remembered, or a transient failure disables the outbox
  // for the life of the page.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    open().then((db) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    }, reject);
  });
}

/** True when a queue can be kept at all. Private browsing sometimes says no. */
export async function outboxAvailable(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

export async function putMutation(m: Mutation): Promise<void> {
  await run("readwrite", (s) => s.put(m));
}

export async function allMutations(): Promise<Mutation[]> {
  const rows = await run<Mutation[]>("readonly", (s) => s.getAll() as IDBRequest<Mutation[]>);
  // Oldest first. Replay order is the order things were done in, which is the only
  // order that makes a create-then-complete pair work.
  return rows.sort((a, b) => a.at - b.at);
}

export async function removeMutation(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

/**
 * Empties the queue.
 *
 * Called on sign-out, for the same reason lib/cache.ts wipes localStorage there: a
 * shared browser must not hold one person's unsent writes for the next. Whoever is
 * signing out is told first if anything would be lost — see logout() in app-context.
 */
export async function clearOutbox(): Promise<void> {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {
    /* nothing queued, or no IndexedDB at all */
  }
}
