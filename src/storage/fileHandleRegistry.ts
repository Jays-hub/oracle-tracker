/**
 * Remembers the one linked `FileSystemFileHandle` across reloads, via
 * IndexedDB — still entirely local, not a new external dependency. A handle
 * itself (not a path string) is what's stored: paths aren't portable across
 * platforms and don't carry permission state, whereas a structured-cloned
 * handle is exactly what `queryPermission`/`requestPermission` need on the
 * next load to ask for at most one reconnect click (Unit 6's Done-when).
 *
 * `indexedDB` is feature-detected via `typeof`, not assumed present: jsdom
 * (this project's test environment) doesn't implement it at all, so every
 * function here degrades to a safe no-op rather than throwing when it's
 * missing. Real browsers old enough to lack File System Access still
 * virtually all have IndexedDB, so this isn't trading one gap for another.
 */

const DB_NAME = 'restaurant-map.file-handle';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const HANDLE_KEY = 'linked-file';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function resolveFactory(factory?: IDBFactory): IDBFactory | null {
  if (factory) return factory;
  return typeof indexedDB !== 'undefined' ? indexedDB : null;
}

/** Persist `handle` as the one remembered linked file, replacing any prior one. */
export async function rememberFileHandle(
  handle: FileSystemFileHandle,
  factory?: IDBFactory,
): Promise<void> {
  const idb = resolveFactory(factory);
  if (!idb) return;
  const db = await openDb(idb);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The remembered linked file's handle, or null if none was ever linked. */
export async function recallFileHandle(
  factory?: IDBFactory,
): Promise<FileSystemFileHandle | null> {
  const idb = resolveFactory(factory);
  if (!idb) return null;
  const db = await openDb(idb);
  try {
    return await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Forget the remembered linked file, if any. */
export async function forgetFileHandle(factory?: IDBFactory): Promise<void> {
  const idb = resolveFactory(factory);
  if (!idb) return;
  const db = await openDb(idb);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
