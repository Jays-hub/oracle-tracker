import { describe, it, expect } from 'vitest';
import {
  loadPins,
  parsePinsPayload,
  savePins,
  serializePins,
  serializePinsForFile,
  backupCorruptStore,
  backupBeforeImport,
  backupRawAsCorrupt,
  backupRawBeforeReplace,
  STORAGE_KEY,
  CORRUPT_BACKUP_PREFIX,
  IMPORT_BACKUP_PREFIX,
  MAX_IMPORT_BACKUPS,
  PinStoreError,
  type StorageLike,
} from './pinStore';
import { replacePin, updatePin, type Pin } from '../domain/pin';

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

const pins: Pin[] = [
  {
    id: '1',
    name: 'A',
    lat: 10.5,
    lng: -20.25,
    strength: 'strong',
    notes: 'Talked to the chef.\nCome back in June.',
  },
  { id: '2', name: 'B', lat: 0, lng: 0, strength: 'failed', notes: '' },
];

describe('pinStore round-trip', () => {
  // Lossless: what goes in comes back out, exactly.
  it('save then load returns an equal list', () => {
    const s = fakeStorage();
    savePins(s, pins);
    expect(loadPins(s)).toEqual(pins);
  });

  // Reproducibility: serialization is deterministic and key-order independent.
  it('serialization is deterministic regardless of key order', () => {
    expect(serializePins(pins)).toBe(serializePins(pins));
    const reordered: Pin[] = pins.map(
      (p) =>
        ({
          notes: p.notes,
          strength: p.strength,
          lng: p.lng,
          lat: p.lat,
          name: p.name,
          id: p.id,
        }) as Pin,
    );
    expect(serializePins(reordered)).toBe(serializePins(pins));
  });
});

describe('serializePinsForFile (Unit 6)', () => {
  // F4 (docs/reviews/Unit 6 - git syncable storage.md): the linked file must
  // NOT be one minified line — git merges line-by-line, so a single-line
  // file guarantees a conflict on any two concurrent edits.
  it('pretty-prints with one lead spanning multiple lines, unlike serializePins', () => {
    const pretty = serializePinsForFile(pins);
    expect(pretty).not.toBe(serializePins(pins));
    expect(pretty.split('\n').length).toBeGreaterThan(pins.length);
    expect(pretty.endsWith('\n')).toBe(true);
  });

  it('round-trips losslessly through parsePinsPayload, same as serializePins', () => {
    expect(parsePinsPayload(serializePinsForFile(pins))).toEqual(pins);
  });

  it('is deterministic and key-order independent, same as serializePins', () => {
    expect(serializePinsForFile(pins)).toBe(serializePinsForFile(pins));
  });
});

describe('notes persistence (unit 2)', () => {
  // The unit's acceptance bar, at the storage layer: notes written on a pin
  // come back byte-identical after a reload, formatting and all.
  it('round-trips multi-line, unicode and quote-bearing notes exactly', () => {
    const notes = 'Owner: Ana “Anita”.\n\n- great espresso\n- revisit 2026-09-01 🍜';
    const withNotes: Pin[] = [{ ...pins[0], notes }];
    const s = fakeStorage();
    savePins(s, withNotes);
    expect(loadPins(s)[0].notes).toBe(notes);
  });

  // Migration: a store written by unit 1 (no notes key) must keep loading, and
  // re-saving it must upgrade the record rather than strand the old pins.
  it('loads pre-notes records as "" and re-saves them with a notes field', () => {
    const legacy = JSON.stringify([
      { id: '1', name: 'A', lat: 10.5, lng: -20.25, strength: 'strong' },
      { id: '2', name: 'B', lat: 0, lng: 0, strength: 'weak' },
    ]);
    const s = fakeStorage(legacy);

    const loaded = loadPins(s);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((p) => p.notes)).toEqual(['', '']);
    expect(loaded[0].name).toBe('A'); // nothing else drifted in the migration

    savePins(s, loaded);
    expect(JSON.parse(s.data.get(STORAGE_KEY) as string)[0]).toHaveProperty(
      'notes',
      '',
    );
    expect(loadPins(s)).toEqual(loaded);
  });

  it('throws PinStoreError when a stored notes field is not a string', () => {
    const s = fakeStorage(JSON.stringify([{ ...pins[0], notes: 42 }]));
    expect(() => loadPins(s)).toThrow(PinStoreError);
  });
});

describe('edit flow through the store (simulates App.handleSaveEdits)', () => {
  // End-to-end for this unit: add three pins, edit the middle one's notes and
  // strength, reload. The edit survives and the neighbours are untouched —
  // this is the "attach notes, reload, they're still there" bar.
  it('persists an edit to one pin and leaves the others unchanged', () => {
    const s = fakeStorage();
    const a: Pin = { id: 'a', name: 'A', lat: 1, lng: 1, strength: 'strong', notes: 'a' };
    const b: Pin = { id: 'b', name: 'B', lat: 2, lng: 2, strength: 'weak', notes: '' };
    const c: Pin = { id: 'c', name: 'C', lat: 3, lng: 3, strength: 'failed', notes: 'c' };
    savePins(s, [a, b, c]);

    // What the editor does: read current state, apply the edit, persist.
    const current = loadPins(s);
    const target = current.find((p) => p.id === 'b') as Pin;
    savePins(
      s,
      replacePin(
        current,
        updatePin(target, { notes: 'Met the owner.\nRevisit.', strength: 'strong' }),
      ),
    );

    const reloaded = loadPins(s); // <- the page reload
    expect(reloaded).toHaveLength(3);
    expect(reloaded[1]).toEqual({
      ...b,
      strength: 'strong',
      notes: 'Met the owner.\nRevisit.',
    });
    expect(reloaded[0]).toEqual(a);
    expect(reloaded[2]).toEqual(c);
  });

  it('survives repeated edits to the same pin, keeping only the latest', () => {
    const s = fakeStorage();
    const a: Pin = { id: 'a', name: 'A', lat: 1, lng: 1, strength: 'weak', notes: '' };
    savePins(s, [a]);

    for (const notes of ['first', 'second', 'third and final']) {
      const current = loadPins(s);
      savePins(s, replacePin(current, updatePin(current[0], { notes })));
    }

    expect(loadPins(s)).toEqual([{ ...a, notes: 'third and final' }]);
  });
});

describe('multi-pin accumulation through the store (simulates the add flow)', () => {
  // Defends the unit's core promise — a second pin must not wipe the first.
  // Mirrors exactly what App.handleMapClick does: load current, append, save.
  it('accumulates pins added one at a time and round-trips them all', () => {
    const s = fakeStorage();
    const p1: Pin = { id: '1', name: 'First', lat: 1, lng: 2, strength: 'strong', notes: '' };
    const p2: Pin = { id: '2', name: 'Second', lat: 3, lng: 4, strength: 'weak', notes: '' };
    const p3: Pin = { id: '3', name: 'Third', lat: 5, lng: 6, strength: 'failed', notes: '' };

    savePins(s, [...loadPins(s), p1]);
    savePins(s, [...loadPins(s), p2]);
    savePins(s, [...loadPins(s), p3]);

    const loaded = loadPins(s);
    expect(loaded).toEqual([p1, p2, p3]);
    expect(loaded).toHaveLength(3);
  });
});

describe('pinStore load edge cases', () => {
  it('returns [] when nothing is stored (first run)', () => {
    expect(loadPins(fakeStorage())).toEqual([]);
  });

  it('throws PinStoreError on non-JSON and leaves the bytes untouched', () => {
    const s = fakeStorage('{not json');
    expect(() => loadPins(s)).toThrow(PinStoreError);
    expect(s.data.get(STORAGE_KEY)).toBe('{not json'); // never silently dropped
  });

  it('throws PinStoreError on valid JSON with an invalid pin (no partial list)', () => {
    const s = fakeStorage(
      JSON.stringify([
        pins[0],
        { id: 'x', name: 'y', lat: 1, lng: 2, strength: 'lukewarm' },
      ]),
    );
    expect(() => loadPins(s)).toThrow(PinStoreError);
  });

  it('throws PinStoreError when stored data is not an array', () => {
    expect(() => loadPins(fakeStorage(JSON.stringify({})))).toThrow(
      PinStoreError,
    );
  });

  // Duplicate ids would route an edit onto the wrong lead: selection and
  // replacePin both resolve by id and take the first match, so clicking the
  // second marker would silently rewrite the first record's notes.
  it('throws PinStoreError on duplicate pin ids', () => {
    const s = fakeStorage(
      JSON.stringify([pins[0], { ...pins[1], id: pins[0].id }]),
    );
    expect(() => loadPins(s)).toThrow(PinStoreError);
    expect(() => loadPins(s)).toThrow(/duplicate/i);
  });
});

describe('backupCorruptStore', () => {
  const raw = '[{"id":"1","name":"A"'; // truncated: unreadable

  // Copying the bytes aside is what makes recovery-by-overwriting survivable.
  it('copies the raw bytes to a timestamped key and returns that key', () => {
    const s = fakeStorage(raw);
    const key = backupCorruptStore(s, () => 0);
    expect(key).toBe(`${CORRUPT_BACKUP_PREFIX}1970-01-01T00:00:00.000Z`);
    expect(s.data.get(key as string)).toBe(raw);
    expect(s.data.get(STORAGE_KEY)).toBe(raw); // original left in place
  });

  it('returns null when there is nothing stored to back up', () => {
    expect(backupCorruptStore(fakeStorage(), () => 0)).toBeNull();
  });

  // If the rescue itself fails, it must fail LOUD: the caller aborts the write
  // rather than overwriting data that was never copied anywhere.
  it('throws PinStoreError when the copy cannot be written', () => {
    const s = fakeStorage(raw);
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => backupCorruptStore(s, () => 0)).toThrow(PinStoreError);
  });

  // F3: the copy-failure message used to say "unreadable saved data" even
  // when the data being copied (an import's pre-replace snapshot) was fine —
  // the only thing that failed was the copy. The message must name neither
  // caller, since it's shown to the user verbatim by both.
  it('describes a failed copy without claiming the source data is unreadable', () => {
    const s = fakeStorage(raw);
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    let message = '';
    try {
      backupCorruptStore(s, () => 0);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('could not copy the saved data aside');
    expect(message).not.toMatch(/unreadable/);
  });
});

describe('backupBeforeImport', () => {
  const raw = serializePins(pins);

  // Same shape as backupCorruptStore, but under its own prefix — these bytes
  // are ordinarily perfectly good, so they must never be filed under a key
  // that says "corrupt" (F5).
  it('copies the raw bytes to a timestamped IMPORT_BACKUP_PREFIX key', () => {
    const s = fakeStorage(raw);
    const key = backupBeforeImport(s, () => 0);
    expect(key).toBe(`${IMPORT_BACKUP_PREFIX}1970-01-01T00:00:00.000Z`);
    expect(s.data.get(key as string)).toBe(raw);
    expect(key).not.toMatch(CORRUPT_BACKUP_PREFIX);
  });

  it('returns null when there is nothing stored to back up', () => {
    expect(backupBeforeImport(fakeStorage(), () => 0)).toBeNull();
  });

  it('throws PinStoreError when the copy cannot be written', () => {
    const s = fakeStorage(raw);
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => backupBeforeImport(s, () => 0)).toThrow(PinStoreError);
  });

  // F4: without a cap, a user who restores backups regularly walks the store
  // toward its quota one full copy at a time, with no way in the app to
  // remove one. Six imports must leave at most MAX_IMPORT_BACKUPS snapshots,
  // and it must be the OLDEST ones that get pruned, not an arbitrary set.
  it('prunes to the most recent MAX_IMPORT_BACKUPS snapshots, oldest first', () => {
    const s = fakeStorage(raw);
    const timestamps = Array.from({ length: MAX_IMPORT_BACKUPS + 1 }, (_, i) => i * 1000);
    for (const t of timestamps) {
      backupBeforeImport(s, () => t);
    }

    const importKeys = Array.from(s.data.keys())
      .filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX))
      .sort();
    expect(importKeys).toHaveLength(MAX_IMPORT_BACKUPS);
    // The very first snapshot (t=0) is the one that should have been pruned.
    expect(importKeys[0]).not.toContain('1970-01-01T00:00:00.000Z');
    expect(s.data.get(STORAGE_KEY)).toBe(raw); // the live store is never touched by pruning
  });

  it('does not prune backupCorruptStore snapshots', () => {
    const s = fakeStorage(raw);
    backupCorruptStore(s, () => 0);
    for (let t = 1; t <= MAX_IMPORT_BACKUPS + 1; t++) {
      backupBeforeImport(s, () => t);
    }
    const corruptKeys = Array.from(s.data.keys()).filter((k) =>
      k.startsWith(CORRUPT_BACKUP_PREFIX),
    );
    expect(corruptKeys).toHaveLength(1);
  });
});

describe('parsePinsPayload (Unit 6: the boundary a linked file goes through too)', () => {
  // loadPins is now a thin wrapper: parsePinsPayload(storage.getItem(...)).
  // These pin the boundary itself so a file-sourced caller can rely on it.
  it('mirrors loadPins exactly when fed the same raw bytes', () => {
    const raw = serializePins(pins);
    expect(parsePinsPayload(raw)).toEqual(loadPins(fakeStorage(raw)));
  });

  it('null reads as [] (localStorage’s absent-key case)', () => {
    expect(parsePinsPayload(null)).toEqual([]);
  });

  // A git-conflict-mangled file is exactly this case: `<<<<<<< HEAD` etc. is
  // not valid JSON, so it fails the same way any other corrupt bytes do —
  // no special-casing needed for Unit 6's "mid-git-conflict" scenario.
  it('rejects git-conflict-marker bytes as invalid JSON, same as any other corruption', () => {
    const conflicted = '<<<<<<< HEAD\n[]\n=======\n[{"id":"1"}]\n>>>>>>> branch';
    expect(() => parsePinsPayload(conflicted)).toThrow(PinStoreError);
  });

  it('rejects an empty string rather than silently treating it as no pins', () => {
    // Only `null` (localStorage's absent key) is "nothing stored yet". An
    // empty string is anomalous — a truncated or wiped file, say — and
    // should surface as corrupt like any other unparseable content, not
    // silently read as an empty store.
    expect(() => parsePinsPayload('')).toThrow(PinStoreError);
  });
});

describe('backupRawAsCorrupt / backupRawBeforeReplace (Unit 6: file-sourced bytes)', () => {
  const raw = serializePins(pins);

  it('backupRawAsCorrupt writes the given bytes under CORRUPT_BACKUP_PREFIX, unlike backupCorruptStore it does not read storage itself', () => {
    const s = fakeStorage(); // nothing in the main key at all
    const key = backupRawAsCorrupt(s, raw, () => 0);
    expect(key).toBe(`${CORRUPT_BACKUP_PREFIX}1970-01-01T00:00:00.000Z`);
    expect(s.data.get(key)).toBe(raw);
  });

  it('backupRawAsCorrupt throws PinStoreError when the copy cannot be written', () => {
    const s = fakeStorage();
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => backupRawAsCorrupt(s, raw, () => 0)).toThrow(PinStoreError);
  });

  it('backupRawBeforeReplace writes under IMPORT_BACKUP_PREFIX and prunes like backupBeforeImport', () => {
    const s = fakeStorage();
    const timestamps = Array.from({ length: MAX_IMPORT_BACKUPS + 1 }, (_, i) => i * 1000);
    for (const t of timestamps) {
      backupRawBeforeReplace(s, raw, () => t);
    }
    const keys = Array.from(s.data.keys()).filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX));
    expect(keys).toHaveLength(MAX_IMPORT_BACKUPS);
    expect(keys.sort()[0]).not.toContain('1970-01-01T00:00:00.000Z'); // oldest pruned
  });
});
