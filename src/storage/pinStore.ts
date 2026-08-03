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

  try {
    return parsed.map(parsePin);
  } catch (cause) {
    throw new PinStoreError('stored data contains an invalid pin', { cause });
  }
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
    })),
  );
}
