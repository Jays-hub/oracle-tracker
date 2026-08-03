import { describe, it, expect } from 'vitest';
import {
  loadPins,
  savePins,
  serializePins,
  backupCorruptStore,
  STORAGE_KEY,
  CORRUPT_BACKUP_PREFIX,
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
});
