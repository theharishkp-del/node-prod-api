'use strict';

/**
 * @file Minimal in-memory TTL cache (per process). Entries expire `ttlMs` after being set;
 * expired entries are dropped lazily on read and when the size cap is reached.
 */

/**
 * Create a TTL cache.
 * @param {object} options
 * @param {number} options.ttlMs Time to live in ms; 0 disables caching (get always misses).
 * @param {number} [options.maxEntries=10000] Oldest entries are evicted beyond this size.
 * @param {() => number} [options.now=Date.now] Clock (injectable for tests).
 * @returns {{get: (key: string) => *, set: (key: string, value: *) => void,
 *   delete: (key: string) => boolean, deleteWhere: (fn: (value: *, key: string) => boolean) => number,
 *   clear: () => void, size: () => number}}
 */
function createTtlCache({ ttlMs, maxEntries = 10000, now = Date.now }) {
  const store = new Map();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      if (ttlMs <= 0) return;
      store.delete(key); // re-insert so Map order stays oldest-first
      store.set(key, { value, expiresAt: now() + ttlMs });
      while (store.size > maxEntries) store.delete(store.keys().next().value);
    },
    delete(key) {
      return store.delete(key);
    },
    deleteWhere(fn) {
      let removed = 0;
      for (const [key, entry] of store) {
        if (fn(entry.value, key)) {
          store.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

module.exports = { createTtlCache };
