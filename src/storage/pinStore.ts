import { parsePin, type Pin } from '../domain/pin';

export const STORAGE_KEY = 'restaurant-map.pins.v1';

/** The slice of the Storage API we use — injectable so it can be faked in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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
 * Copy unreadable bytes aside under a timestamped key, so the next successful
 * save cannot destroy them. Returns the backup key, or null when there was
 * nothing stored to back up.
 *
 * Throws PinStoreError if the copy itself fails — the caller must then refuse
 * to overwrite. Losing notes because the *rescue* quietly failed would be worse
 * than the corruption it is rescuing from.
 */
export function backupCorruptStore(
  storage: StorageLike,
  now: () => number = Date.now,
): string | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  const key = `${CORRUPT_BACKUP_PREFIX}${new Date(now()).toISOString()}`;
  try {
    storage.setItem(key, raw);
  } catch (cause) {
    throw new PinStoreError('could not back up the unreadable saved data', {
      cause,
    });
  }
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
