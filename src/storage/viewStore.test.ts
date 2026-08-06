import { describe, it, expect } from 'vitest';
import { loadView, saveView, clearView, VIEW_STORAGE_KEY, type PersistedView } from './viewStore';
import type { StorageLike } from './pinStore';

function fakeStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(VIEW_STORAGE_KEY, initial);
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

describe('viewStore round-trip', () => {
  // Lossless: what goes in comes back out, exactly.
  it('save then load returns an equal view', () => {
    const s = fakeStorage();
    const view: PersistedView = { center: [38.7223, -9.1393], zoom: 14 };
    saveView(s, view);
    expect(loadView(s)).toEqual(view);
  });

  it('returns null when nothing has ever been saved', () => {
    expect(loadView(fakeStorage())).toBeNull();
  });

  it('a later save overwrites the earlier one, not merges with it', () => {
    const s = fakeStorage();
    saveView(s, { center: [10, 10], zoom: 5 });
    saveView(s, { center: [20, 20], zoom: 9 });
    expect(loadView(s)).toEqual({ center: [20, 20], zoom: 9 });
  });

  it('clearView removes a saved view', () => {
    const s = fakeStorage();
    saveView(s, { center: [10, 10], zoom: 5 });
    clearView(s);
    expect(loadView(s)).toBeNull();
  });

  it('clearView on an already-empty store is a harmless no-op', () => {
    const s = fakeStorage();
    expect(() => clearView(s)).not.toThrow();
    expect(loadView(s)).toBeNull();
  });
});

/**
 * A bad record here must fall back to `null`, not throw — the boundary this
 * unit deliberately does NOT share with `parsePin`/`loadPins`. A thrown error
 * would surface as a banner over a value nobody can act on (there is nothing
 * to "recover" a pan position from — refitting to the pins is already the
 * correct fallback), so every one of these has to resolve to a quiet null.
 */
describe('loadView fails soft on bad data', () => {
  it('rejects data that is not valid JSON', () => {
    expect(loadView(fakeStorage('{not json'))).toBeNull();
  });

  it('rejects a JSON value that is not an object', () => {
    expect(loadView(fakeStorage('"nope"'))).toBeNull();
    expect(loadView(fakeStorage('42'))).toBeNull();
    expect(loadView(fakeStorage('null'))).toBeNull();
  });

  it('rejects a missing or malformed center', () => {
    expect(loadView(fakeStorage(JSON.stringify({ zoom: 10 })))).toBeNull();
    expect(loadView(fakeStorage(JSON.stringify({ center: [1], zoom: 10 })))).toBeNull();
    expect(loadView(fakeStorage(JSON.stringify({ center: [1, 2, 3], zoom: 10 })))).toBeNull();
    expect(
      loadView(fakeStorage(JSON.stringify({ center: ['a', 'b'], zoom: 10 }))),
    ).toBeNull();
  });

  it('rejects a center outside the coordinate range parsePin would also reject', () => {
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [91, 0], zoom: 10 }))),
    ).toBeNull();
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [0, 181], zoom: 10 }))),
    ).toBeNull();
  });

  it('rejects a missing, non-finite, or negative zoom', () => {
    expect(loadView(fakeStorage(JSON.stringify({ center: [0, 0] })))).toBeNull();
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [0, 0], zoom: 'far' }))),
    ).toBeNull();
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [0, 0], zoom: NaN }))),
    ).toBeNull();
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [0, 0], zoom: -1 }))),
    ).toBeNull();
  });

  // The coordinate extremes are valid, same as parsePin's boundary.
  it('accepts the coordinate extremes and zoom 0', () => {
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [-90, -180], zoom: 0 }))),
    ).toEqual({ center: [-90, -180], zoom: 0 });
    expect(
      loadView(fakeStorage(JSON.stringify({ center: [90, 180], zoom: 19 }))),
    ).toEqual({ center: [90, 180], zoom: 19 });
  });
});
