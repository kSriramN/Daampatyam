import { supabase } from "./supabaseClient.js";

/* ---------------------------------------------------------------
   Two storage backends behind one interface:
   - "local"   -> IndexedDB, used for Guest Mode (on this device only)
   - "account" -> Supabase kv_store table, used once logged in
   Every value that passes through here is already an encrypted blob
   (see crypto helpers in App.jsx) except for a couple of non-sensitive
   flags (device id, feedback). Switching modes never re-encrypts
   anything — the same ciphertext just moves to a different table.
----------------------------------------------------------------*/

let backendMode = "local"; // "local" | "account"
export function setBackendMode(mode) { backendMode = mode === "account" ? "account" : "local"; }
export function getBackendMode() { return backendMode; }

const DB_NAME = "daampatyam-db";
const STORE_NAME = "kv";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function localGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ? JSON.parse(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}
async function localSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(JSON.stringify(value), key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function supaGet(key) {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("user_id", session.user.id)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return JSON.parse(data.value);
}
async function supaSet(key, value) {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { error } = await supabase
    .from("kv_store")
    .upsert({ user_id: session.user.id, key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
  return error ? null : true;
}

export async function storageGet(key) {
  try {
    return backendMode === "account" ? await supaGet(key) : await localGet(key);
  } catch (e) {
    console.error("storage get failed", key, e);
    return null;
  }
}
export async function storageSet(key, value) {
  try {
    return backendMode === "account" ? await supaSet(key, value) : await localSet(key, value);
  } catch (e) {
    console.error("storage set failed", key, e);
    return null;
  }
}

// Copies every listed key's current value from local (Guest Mode) storage
// into the logged-in account's Supabase rows. Used when a guest creates
// an account and chooses to bring their data with them.
export async function migrateLocalToAccount(keys) {
  for (const key of keys) {
    const value = await localGet(key);
    if (value !== null && value !== undefined) {
      await supaSet(key, value);
    }
  }
}
