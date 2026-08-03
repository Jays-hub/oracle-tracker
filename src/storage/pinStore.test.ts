import { describe, it, expect } from 'vitest';
import {
  loadPins,
  savePins,
  serializePins,
  STORAGE_KEY,
  PinStoreError,
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
  };
}

const pins: Pin[] = [
  { id: '1', name: 'A', lat: 10.5, lng: -20.25, strength: 'strong' },
  { id: '2', name: 'B', lat: 0, lng: 0, strength: 'failed' },
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

describe('multi-pin accumulation through the store (simulates the add flow)', () => {
  // Defends the unit's core promise — a second pin must not wipe the first.
  // Mirrors exactly what App.handleMapClick does: load current, append, save.
  it('accumulates pins added one at a time and round-trips them all', () => {
    const s = fakeStorage();
    const p1: Pin = { id: '1', name: 'First', lat: 1, lng: 2, strength: 'strong' };
    const p2: Pin = { id: '2', name: 'Second', lat: 3, lng: 4, strength: 'weak' };
    const p3: Pin = { id: '3', name: 'Third', lat: 5, lng: 6, strength: 'failed' };

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
});
