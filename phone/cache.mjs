// A versioned, single-record cache. It is intentionally a projection cache, not
// a browser-side copy of Assistant's durable data model.
export const PHONE_CACHE_SCHEMA = 1;
const DATABASE = "assistant-ai-phone";
const STORE = "projections";
const KEY = "current";

function validDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }

export function validPhoneProjection(value) {
  return Boolean(value && value.schema === PHONE_CACHE_SCHEMA && value.timezone === "Australia/Darwin" &&
    typeof value.cachedAt === "string" && value.today && Array.isArray(value.openTasks) &&
    Array.isArray(value.events) && Array.isArray(value.categories) && Array.isArray(value.tags) &&
    Array.isArray(value.today.days) && validDate(value.windowStart) && validDate(value.windowEnd));
}

export function createPhoneProjectionStore({ indexedDB = globalThis.indexedDB } = {}) {
  let database;
  async function open() {
    if (!indexedDB) throw new Error("IndexedDB is unavailable");
    if (database) return database;
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, PHONE_CACHE_SCHEMA);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }
  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    async read() {
      try {
        const value = await transaction("readonly", store => store.get(KEY));
        if (!validPhoneProjection(value)) {
          if (value !== undefined) await transaction("readwrite", store => store.delete(KEY));
          return null;
        }
        return value;
      } catch { return null; }
    },
    async write(projection) {
      if (!validPhoneProjection(projection)) throw new Error("Invalid phone projection");
      try { await transaction("readwrite", store => store.put(projection, KEY)); }
      catch { /* A private-browsing/storage failure must not break the phone UI. */ }
      return projection;
    },
    async clear() {
      try { await transaction("readwrite", store => store.delete(KEY)); }
      catch { /* best effort */ }
    },
  };
}
