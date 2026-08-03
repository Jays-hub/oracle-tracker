import { describe, it, expect } from 'vitest';
import { parsePin, createPin, InvalidPinError } from './pin';

const valid = {
  id: 'a1',
  name: "Joe's Diner",
  lat: 40.7,
  lng: -74.0,
  strength: 'strong' as const,
};

describe('parsePin', () => {
  it('accepts a well-formed pin and preserves every field', () => {
    expect(parsePin(valid)).toEqual(valid);
  });

  it('rejects invalid shapes with a named error', () => {
    const bad: unknown[] = [
      null,
      'nope',
      { ...valid, id: '' }, // empty id
      { ...valid, name: 42 }, // non-string name
      { ...valid, lat: 'x' }, // non-numeric lat
      { ...valid, lat: 91 }, // lat out of range
      { ...valid, lng: 200 }, // lng out of range
      { ...valid, lat: Number.NaN }, // NaN
      { ...valid, lat: Infinity }, // non-finite
      { ...valid, strength: 'lukewarm' }, // unknown strength
      { id: 'a1', name: 'x', lat: 0, lng: 0 }, // missing strength
    ];
    for (const b of bad) {
      expect(() => parsePin(b)).toThrow(InvalidPinError);
    }
  });
});

describe('createPin', () => {
  it('trims the name and produces a valid, uniquely-identified pin', () => {
    const p = createPin({ name: '  Cafe  ', lat: 1, lng: 2, strength: 'weak' });
    expect(p.name).toBe('Cafe');
    expect(p.id.length).toBeGreaterThan(0);
    expect(p.strength).toBe('weak');

    const q = createPin({ name: 'Cafe', lat: 1, lng: 2, strength: 'weak' });
    expect(p.id).not.toBe(q.id); // ids are unique
  });

  it('rejects an empty / whitespace-only name', () => {
    expect(() =>
      createPin({ name: '   ', lat: 1, lng: 2, strength: 'strong' }),
    ).toThrow(InvalidPinError);
  });
});
