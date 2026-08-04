import { parsePin, type Pin } from '../domain/pin';

export const STORAGE_KEY = 'restaurant-map.pins.v1';

/**
 * The slice of the Storage API we use — injectable so it can be faked in
 * tests. `removeItem`/`length`/`key` exist so a snapshot prefix can be
 * enumerated and pruned (see `pruneSnapshots`); `window.localStorage` already
 * satisfies all five as the real `Storage` type.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export class PinStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Pin store: ${message}`, options);
    this.name = 'PinStoreError';
  }
}

/**
 * Load pins from storage.
 * - Absent key   -> [] (first run; empty-but-usable).
 * - Present data -> fully validated. ANY corruption throws PinStoreError and
 *   leaves the stored bytes untouched. We never return a partial/filtered list,
 *   so a bad store can neither crash silently nor drop pins on the floor.
 *
 * The key stays at `.v1` even though unit 2 added `notes`: the change is
 * backward-compatible (a record with no notes loads with notes ''), so bumping
 * the key would strand pins the user already saved instead of migrating them.
 */
export function loadPins(storage: StorageLike): Pin[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new PinStoreError('stored data is not valid JSON', { cause });
  }

  if (!Array.isArray(parsed)) {
    throw new PinStoreError('stored data is not an array of pins');
  }

  let pins: Pin[];
  try {
    pins = parsed.map(parsePin);
  } catch (cause) {
    throw new PinStoreError('stored data contains an invalid pin', { cause });
  }

  // Ids must be unique: everything downstream (selection, replacePin) resolves a
  // pin by id and takes the FIRST match, so duplicates would silently route an
  // edit onto a different lead than the one clicked. Fail loud like the rest of
  // this boundary rather than editing the wrong restaurant's notes.
  if (new Set(pins.map((p) => p.id)).size !== pins.length) {
    throw new PinStoreError('stored data contains duplicate pin ids');
  }

  return pins;
}

/** Key prefix for snapshots of unreadable data. */
export const CORRUPT_BACKUP_PREFIX = `${STORAGE_KEY}.corrupt-`;

/**
 * Key prefix for the pre-replace snapshot `importPins` takes. A separate
 * prefix from `CORRUPT_BACKUP_PREFIX` on purpose: the bytes this copies are
 * ordinarily perfectly good — the only thing about to happen to them is a
 * user-confirmed replace — so filing them under a key that says "corrupt"
 * would tell a user tidying up localStorage that their only undo is garbage.
 */
export const IMPORT_BACKUP_PREFIX = `${STORAGE_KEY}.backup-`;

/** How many pre-import snapshots `importPins` keeps before pruning the oldest. */
export const MAX_IMPORT_BACKUPS = 5;

/**
 * Copy whatever is currently stored aside under `${prefix}<ISO timestamp>`.
 * Shared by `backupCorruptStore` and `backupBeforeImport` — both just need
 * "whatever is there right now, copied somewhere safe before I write over
 * it," and differ only in which prefix names the result and why. Returns the
 * new key, or null when there was nothing stored to copy.
 *
 * Throws PinStoreError if the copy itself fails — the caller must then refuse
 * to overwrite. Losing notes because the *rescue* quietly failed would be
 * worse than whatever it is rescuing from. The message names no caller: it is
 * shown verbatim to the user by both a corrupt-read recovery (where the data
 * really is unreadable) and an import (where it usually isn't) — see
 * `docs/reviews/Unit 3 Section B - export-import JSON.md` F3.
 */
function writeSnapshot(
  storage: StorageLike,
  prefix: string,
  now: () => number,
): string | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  const key = `${prefix}${new Date(now()).toISOString()}`;
  try {
    storage.setItem(key, raw);
  } catch (cause) {
    throw new PinStoreError('could not copy the saved data aside', { cause });
  }
  return key;
}

/** Every key under `prefix`, oldest first (ISO timestamps sort lexically). */
function snapshotKeys(storage: StorageLike, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys.sort();
}

/** Delete the oldest keys under `prefix` past the most recent `keep`. */
function pruneSnapshots(storage: StorageLike, prefix: string, keep: number): void {
  const keys = snapshotKeys(storage, prefix);
  for (const key of keys.slice(0, Math.max(0, keys.length - keep))) {
    storage.removeItem(key);
  }
}

/**
 * Copy whatever is currently stored aside before a corrupt-read recovery
 * overwrites it. The bytes are unreadable (that's why this is running), so
 * this is the only copy of them that will ever exist — not pruned, since a
 * corrupt read is rare enough that it doesn't accumulate the way routine
 * imports do.
 */
export function backupCorruptStore(
  storage: StorageLike,
  now: () => number = Date.now,
): string | null {
  return writeSnapshot(storage, CORRUPT_BACKUP_PREFIX, now);
}

/**
 * Copy whatever is currently stored aside before `importPins` replaces it,
 * then prune to the `MAX_IMPORT_BACKUPS` most recent such snapshots. Unlike a
 * corrupt-read backup, importing a file is an ordinary, repeatable action —
 * without a cap, a user who restores backups regularly walks the store
 * toward its quota one full copy at a time, with no way in the app to remove
 * one (`docs/reviews/Unit 3 Section B - export-import JSON.md` F4).
 */
export function backupBeforeImport(
  storage: StorageLike,
  now: () => number = Date.now,
): string | null {
  const key = writeSnapshot(storage, IMPORT_BACKUP_PREFIX, now);
  pruneSnapshots(storage, IMPORT_BACKUP_PREFIX, MAX_IMPORT_BACKUPS);
  return key;
}

/** Persist pins. Deterministic: equal inputs produce byte-identical output. */
export function savePins(storage: StorageLike, pins: Pin[]): void {
  storage.setItem(STORAGE_KEY, serializePins(pins));
}

/** Serialize with a fixed field order so output is independent of key order. */
export function serializePins(pins: Pin[]): string {
  return JSON.stringify(
    pins.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      strength: p.strength,
      notes: p.notes,
    })),
  );
}
