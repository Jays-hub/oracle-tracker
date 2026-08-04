import { parsePin, type Pin } from '../domain/pin';
import { backupBeforeImport, savePins, type StorageLike } from './pinStore';

export class ImportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Import: ${message}`, options);
    this.name = 'ImportError';
  }
}

/**
 * Parse and validate an uploaded file's contents into pins.
 *
 * Every record goes through `parsePin` — the same boundary `loadPins` uses
 * for the store itself — so a file can never import a pin the store would
 * refuse to hold, and a legacy (pre-notes) record loads exactly as it would
 * from localStorage. Any invalid record, a duplicate id, or a payload that
 * isn't a JSON array throws before anything is returned: the whole file is
 * rejected, never a partial list, and — since nothing here touches storage —
 * the current store is left untouched by construction, not by care taken at
 * the call site.
 */
export function parseImportPayload(raw: string): Pin[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ImportError('the file is not valid JSON', { cause });
  }
  if (!Array.isArray(parsed)) {
    throw new ImportError('the file is not a JSON array of pins');
  }

  let pins: Pin[];
  try {
    pins = parsed.map(parsePin);
  } catch (cause) {
    throw new ImportError('the file contains an invalid pin', { cause });
  }

  // Same reasoning as loadPins: a duplicate id would route an edit onto
  // whichever record is found first, silently, after the import "succeeded".
  if (new Set(pins.map((p) => p.id)).size !== pins.length) {
    throw new ImportError('the file contains duplicate pin ids');
  }

  return pins;
}

/** `restaurant-map-YYYY-MM-DD.json` — carries the export date. */
export function exportFilename(now: () => number = Date.now): string {
  return `restaurant-map-${new Date(now()).toISOString().slice(0, 10)}.json`;
}

/**
 * Replace the whole store with `pins`.
 *
 * Import is a REPLACE, not a merge (see docs/roadmap.md "Unit 3 — Section
 * B"), so the pre-import data is only recoverable if it was copied aside
 * first. This snapshots whatever is currently stored (`backupBeforeImport`,
 * under its own `IMPORT_BACKUP_PREFIX` — not `backupCorruptStore`'s, since
 * these bytes are usually perfectly good, just about to be overwritten) and
 * only then writes the new pins. `backupBeforeImport` throws if the copy
 * itself fails, which propagates here and never reaches `savePins`: a failed
 * snapshot hard-aborts the import exactly as it hard-aborts corrupt-store
 * recovery, so nothing is ever overwritten without a safety copy existing
 * first.
 */
export function importPins(
  storage: StorageLike,
  pins: Pin[],
  now: () => number = Date.now,
): { backupKey: string | null } {
  const backupKey = backupBeforeImport(storage, now);
  savePins(storage, pins);
  return { backupKey };
}
