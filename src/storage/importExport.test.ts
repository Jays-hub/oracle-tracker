import { describe, it, expect } from 'vitest';
import { parseImportPayload, exportFilename, importPins, ImportError } from './importExport';
import {
  loadPins,
  savePins,
  serializePins,
  STORAGE_KEY,
  IMPORT_BACKUP_PREFIX,
  type StorageLike,
} from './pinStore';
import type { Pin } from '../domain/pin';

function fakeStorage(
  initial?: string,
): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
    get length() {
      return data.size;
    },
    key: (i) => Array.from(data.keys())[i] ?? null,
  };
}

const alpha: Pin = {
  id: 'a',
  name: 'Alpha Cafe',
  lat: 40.7,
  lng: -74,
  strength: 'strong',
  notes: 'Owner: Ana “Anita”.\n\n- great espresso\n- revisit 2026-09-01 🍜',
};
const beta: Pin = {
  id: 'b',
  name: 'Beta Grill',
  lat: 0,
  lng: 0,
  strength: 'failed',
  notes: '',
};

describe('parseImportPayload', () => {
  // Core correctness: a well-formed file becomes exactly the pins it holds,
  // notes and all — same boundary parsePin gives loadPins.
  it('parses a well-formed JSON array into equal pins', () => {
    const raw = serializePins([alpha, beta]);
    expect(parseImportPayload(raw)).toEqual([alpha, beta]);
  });

  // Legacy files: unit-1 records with no notes key must import, same terms
  // as loadPins.
  it('imports a legacy (pre-notes) record with notes ""', () => {
    const legacy = JSON.stringify([
      { id: '1', name: 'A', lat: 10.5, lng: -20.25, strength: 'strong' },
    ]);
    const imported = parseImportPayload(legacy);
    expect(imported).toEqual([
      { id: '1', name: 'A', lat: 10.5, lng: -20.25, strength: 'strong', notes: '' },
    ]);
  });

  it('rejects text that is not valid JSON', () => {
    expect(() => parseImportPayload('{not json')).toThrow(ImportError);
  });

  it('rejects a payload that is not a JSON array', () => {
    expect(() => parseImportPayload(JSON.stringify({ id: 'a' }))).toThrow(ImportError);
  });

  // No partial import: one bad record among otherwise-good ones rejects the
  // WHOLE file, not just the offending record.
  it('rejects the whole file when any one record is invalid', () => {
    const raw = JSON.stringify([alpha, { ...beta, strength: 'lukewarm' }]);
    expect(() => parseImportPayload(raw)).toThrow(ImportError);
  });

  it('rejects a file with duplicate pin ids', () => {
    const raw = JSON.stringify([alpha, { ...beta, id: alpha.id }]);
    expect(() => parseImportPayload(raw)).toThrow(ImportError);
    expect(() => parseImportPayload(raw)).toThrow(/duplicate/i);
  });
});

describe('exportFilename', () => {
  // Reproducibility: the same instant always names the same file.
  it('is deterministic for a given instant', () => {
    const now = () => Date.parse('2026-08-04T15:30:00Z');
    expect(exportFilename(now)).toBe(exportFilename(now));
  });

  it('carries the export date in the filename', () => {
    const now = () => Date.parse('2026-08-04T15:30:00Z');
    expect(exportFilename(now)).toBe('restaurant-map-2026-08-04.json');
  });

  // Edge case: a date near UTC midnight must use the UTC day, not shift with
  // the machine's local timezone.
  it('uses the UTC date', () => {
    const now = () => Date.parse('2026-01-01T00:05:00Z');
    expect(exportFilename(now)).toBe('restaurant-map-2026-01-01.json');
  });
});

describe('importPins', () => {
  it('replaces the store and reports the pre-import snapshot key', () => {
    const s = fakeStorage(serializePins([alpha]));
    const { backupKey } = importPins(s, [beta], () => 0);

    expect(loadPins(s)).toEqual([beta]);
    expect(backupKey).toBe(`${IMPORT_BACKUP_PREFIX}1970-01-01T00:00:00.000Z`);
    expect(s.data.get(backupKey as string)).toBe(serializePins([alpha])); // recoverable
  });

  it('returns a null backup key when there was nothing stored before', () => {
    const s = fakeStorage();
    const { backupKey } = importPins(s, [alpha]);
    expect(backupKey).toBeNull();
    expect(loadPins(s)).toEqual([alpha]);
  });

  // Hard-abort: if the pre-import snapshot itself cannot be written, the
  // import must not proceed — the old data would otherwise be destroyed with
  // no copy anywhere.
  it('hard-aborts and leaves the store untouched when the snapshot fails', () => {
    const original = serializePins([alpha]);
    const s = fakeStorage(original);
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => importPins(s, [beta])).toThrow();
    expect(s.data.get(STORAGE_KEY)).toBe(original); // never overwritten
  });

  // The unit's headline bar, exactly as specced: export, wipe, import the
  // same file, and the store comes back byte-identical.
  it('round-trips losslessly: export, wipe, import the same file, byte-identical store', () => {
    const s = fakeStorage();
    const original: Pin[] = [alpha, beta];
    savePins(s, original);

    const exportedFile = serializePins(loadPins(s)); // what the download would contain
    s.data.delete(STORAGE_KEY); // wipe the store (a fresh browser)

    const parsed = parseImportPayload(exportedFile);
    const { backupKey } = importPins(s, parsed);

    expect(backupKey).toBeNull(); // nothing was there after the wipe
    expect(loadPins(s)).toEqual(original);
    expect(s.data.get(STORAGE_KEY)).toBe(serializePins(original)); // byte-identical
  });
});
