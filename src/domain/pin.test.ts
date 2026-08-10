import { describe, it, expect } from 'vitest';
import {
  parsePin,
  createPin,
  updatePin,
  replacePin,
  removePin,
  sortPinsByName,
  InvalidPinError,
  PinNotFoundError,
  type Pin,
} from './pin';

const valid = {
  id: 'a1',
  name: "Joe's Diner",
  lat: 40.7,
  lng: -74.0,
  strength: 'strong' as const,
  notes: 'Spoke to the owner.',
};

describe('parsePin', () => {
  it('accepts a well-formed pin and preserves every field', () => {
    expect(parsePin(valid)).toEqual(valid);
  });

  // Backward compatibility: pins saved by unit 1 have no notes key at all.
  // They must still load (as "no notes"), not read as a corrupt store.
  it('reads a pre-notes record as notes: ""', () => {
    const legacy: Record<string, unknown> = { ...valid };
    delete legacy.notes;
    expect(parsePin(legacy)).toEqual({ ...legacy, notes: '' });
    expect('notes' in legacy).toBe(false); // the input really had no notes key
  });

  // Losslessness: notes are free-form prose, so whitespace and line breaks the
  // user wrote must survive the round trip through validation untouched.
  it('preserves notes exactly, including line breaks and unicode', () => {
    const notes = 'Line one\n\n  indented two\tтест — “quoted” 🍜';
    expect(parsePin({ ...valid, notes }).notes).toBe(notes);
  });

  it('rejects invalid shapes with a named error', () => {
    const bad: unknown[] = [
      null,
      'nope',
      { ...valid, id: '' }, // empty id
      { ...valid, name: 42 }, // non-string name
      { ...valid, name: '' }, // empty name
      { ...valid, name: '   ' }, // whitespace-only name
      { ...valid, lat: 'x' }, // non-numeric lat
      { ...valid, lat: 91 }, // lat out of range
      { ...valid, lng: 200 }, // lng out of range
      { ...valid, lat: Number.NaN }, // NaN
      { ...valid, lat: Infinity }, // non-finite
      { ...valid, strength: 'lukewarm' }, // unknown strength
      { id: 'a1', name: 'x', lat: 0, lng: 0 }, // missing strength
      { ...valid, notes: 42 }, // notes present but not a string
      { ...valid, notes: null }, // null is corruption, not "absent"
      { ...valid, notes: ['a'] }, // notes present but not a string
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

  it('defaults notes to "" when none are given', () => {
    expect(createPin({ name: 'Cafe', lat: 1, lng: 2, strength: 'weak' }).notes).toBe(
      '',
    );
  });

  it('rejects an empty / whitespace-only name', () => {
    expect(() =>
      createPin({ name: '   ', lat: 1, lng: 2, strength: 'strong' }),
    ).toThrow(InvalidPinError);
  });
});

describe('updatePin', () => {
  const pin: Pin = {
    id: 'p1',
    name: 'Cafe',
    lat: 10.5,
    lng: -20.25,
    strength: 'weak',
    notes: 'First visit: manager was out.',
  };

  // Core correctness of this unit: an edit changes what was edited and nothing
  // else — checked field by field against hand-written expected values.
  it('applies each edit and carries identity + position over untouched', () => {
    const edited = updatePin(pin, {
      name: 'Cafe Rio',
      strength: 'strong',
      notes: 'Second visit: signed a trial.',
    });
    expect(edited).toEqual({
      id: 'p1',
      name: 'Cafe Rio',
      lat: 10.5,
      lng: -20.25,
      strength: 'strong',
      notes: 'Second visit: signed a trial.',
    });
    expect(pin.notes).toBe('First visit: manager was out.'); // original not mutated
  });

  it('leaves omitted fields at their current values', () => {
    expect(updatePin(pin, { notes: 'Just the notes.' })).toEqual({
      ...pin,
      notes: 'Just the notes.',
    });
    expect(updatePin(pin, { strength: 'failed' })).toEqual({
      ...pin,
      strength: 'failed',
    });
    expect(updatePin(pin, {})).toEqual(pin);
  });

  // Reproducibility: the same edit applied twice yields identical pins.
  it('is deterministic — the same edit twice gives an identical result', () => {
    const edits = { name: ' Cafe Rio ', strength: 'failed' as const, notes: ' x ' };
    expect(updatePin(pin, edits)).toEqual(updatePin(pin, edits));
  });

  it('trims the name and the notes but keeps notes formatting inside', () => {
    const edited = updatePin(pin, {
      name: '  Cafe Rio  ',
      notes: '\n  Visited twice.\n\n  Owner: Ana.  \n',
    });
    expect(edited.name).toBe('Cafe Rio');
    expect(edited.notes).toBe('Visited twice.\n\n  Owner: Ana.');
  });

  // Edge case: clearing notes is a real edit, not "leave them alone".
  it('clears notes when given an empty (or whitespace-only) string', () => {
    expect(updatePin(pin, { notes: '' }).notes).toBe('');
    expect(updatePin(pin, { notes: '   \n ' }).notes).toBe('');
  });

  it('rejects an empty name and a strength that bypassed the type system', () => {
    expect(() => updatePin(pin, { name: '   ' })).toThrow(InvalidPinError);
    expect(() =>
      // @ts-expect-error deliberately invalid input to exercise the runtime guard
      updatePin(pin, { strength: 'lukewarm' }),
    ).toThrow(InvalidPinError);
  });
});

describe('replacePin', () => {
  const a: Pin = { id: 'a', name: 'A', lat: 1, lng: 1, strength: 'strong', notes: '' };
  const b: Pin = { id: 'b', name: 'B', lat: 2, lng: 2, strength: 'weak', notes: 'b' };
  const c: Pin = { id: 'c', name: 'C', lat: 3, lng: 3, strength: 'failed', notes: '' };

  it('replaces exactly the matching pin, in place, leaving the rest alone', () => {
    const edited = updatePin(b, { notes: 'edited' });
    const next = replacePin([a, b, c], edited);
    expect(next).toEqual([a, edited, c]);
    expect(next[1].notes).toBe('edited');
  });

  it('does not mutate the input list', () => {
    const pins = [a, b, c];
    replacePin(pins, updatePin(b, { notes: 'edited' }));
    expect(pins).toEqual([a, b, c]);
  });

  // The silent-no-op guard: an unknown id must fail loud, because the caller
  // saves the returned list and would otherwise report a phantom save.
  it('throws PinNotFoundError when no pin has that id', () => {
    const orphan: Pin = { ...b, id: 'gone' };
    expect(() => replacePin([a, c], orphan)).toThrow(PinNotFoundError);
    expect(() => replacePin([], a)).toThrow(PinNotFoundError);
  });
});

describe('removePin', () => {
  const a: Pin = { id: 'a', name: 'A', lat: 1, lng: 1, strength: 'strong', notes: '' };
  const b: Pin = { id: 'b', name: 'B', lat: 2, lng: 2, strength: 'weak', notes: 'b' };
  const c: Pin = { id: 'c', name: 'C', lat: 3, lng: 3, strength: 'failed', notes: '' };

  // Core correctness: removes exactly the matching pin, leaves the others (and
  // their order) untouched — hand-checked against the expected list.
  it('removes exactly the matching pin, leaving the rest in order', () => {
    expect(removePin([a, b, c], 'b')).toEqual([a, c]);
  });

  it('does not mutate the input list', () => {
    const pins = [a, b, c];
    removePin(pins, 'b');
    expect(pins).toEqual([a, b, c]);
  });

  // Reproducibility: removing the same id from the same list twice (as two
  // independent calls) gives an identical result both times.
  it('is deterministic', () => {
    expect(removePin([a, b, c], 'b')).toEqual(removePin([a, b, c], 'b'));
  });

  // Edge case: removing the only pin leaves an empty list, not undefined/null.
  it('leaves an empty list when the only pin is removed', () => {
    expect(removePin([a], 'a')).toEqual([]);
  });

  // The silent-no-op guard: an unknown id must fail loud, same reasoning as
  // replacePin — the caller persists the returned list and would otherwise
  // report a deletion that never happened.
  it('throws PinNotFoundError when no pin has that id', () => {
    expect(() => removePin([a, c], 'gone')).toThrow(PinNotFoundError);
    expect(() => removePin([], 'a')).toThrow(PinNotFoundError);
  });
});

describe('sortPinsByName', () => {
  const zebra: Pin = { id: 'z', name: 'Zebra Diner', lat: 1, lng: 1, strength: 'strong', notes: '' };
  const apple: Pin = { id: 'a', name: 'apple bistro', lat: 2, lng: 2, strength: 'weak', notes: '' };
  const mango: Pin = { id: 'm', name: 'Mango Grill', lat: 3, lng: 3, strength: 'failed', notes: '' };

  // Core correctness, hand-checked: alphabetical, and case must not change
  // the order ('apple bistro' sorts before 'Mango Grill' despite the lowercase a).
  it('sorts alphabetically by name, case-insensitively', () => {
    expect(sortPinsByName([zebra, apple, mango])).toEqual([apple, mango, zebra]);
  });

  it('does not mutate the input list', () => {
    const pins = [zebra, apple, mango];
    sortPinsByName(pins);
    expect(pins).toEqual([zebra, apple, mango]);
  });

  // Reproducibility: sorting the same list twice gives an identical result.
  it('is deterministic', () => {
    const pins = [zebra, apple, mango];
    expect(sortPinsByName(pins)).toEqual(sortPinsByName(pins));
  });

  // Edge case: names equal except for case keep their relative input order
  // (a stable sort), rather than reordering nondeterministically on ties.
  it('keeps the input order for names that are equal case-insensitively', () => {
    const first: Pin = { id: '1', name: 'Cafe', lat: 0, lng: 0, strength: 'strong', notes: '' };
    const second: Pin = { id: '2', name: 'CAFE', lat: 0, lng: 0, strength: 'weak', notes: '' };
    expect(sortPinsByName([first, second])).toEqual([first, second]);
    expect(sortPinsByName([second, first])).toEqual([second, first]);
  });

  it('returns an empty list for an empty input', () => {
    expect(sortPinsByName([])).toEqual([]);
  });

  // Regression (docs/reviews/unit 7.md NIT): parsePin deliberately preserves
  // leading/trailing whitespace on imported/legacy names for losslessness, so
  // un-trimmed padding must not become a sort key — a padded name should sort
  // where its real, visible letters put it, not before every other letter.
  it('ignores leading/trailing whitespace when ordering (padding is not a sort key)', () => {
    const padded: Pin = { id: 'p', name: '  Zulu Diner', lat: 0, lng: 0, strength: 'strong', notes: '' };
    const cafe: Pin = { id: 'c', name: 'Cafe', lat: 0, lng: 0, strength: 'weak', notes: '' };
    expect(sortPinsByName([padded, cafe])).toEqual([cafe, padded]);
  });

  // Regression (docs/reviews/unit 7.md NIT): plain lexicographic order would
  // put "10 Downing" before "2 Fish Grill" (comparing the characters '1' and
  // '2'), which reads as broken to a user scanning a numbered street.
  it('orders numerically within names, not lexicographically ("2" before "10")', () => {
    const ten: Pin = { id: 't', name: '10 Downing Bistro', lat: 0, lng: 0, strength: 'strong', notes: '' };
    const two: Pin = { id: 'w', name: '2 Fish Grill', lat: 0, lng: 0, strength: 'weak', notes: '' };
    expect(sortPinsByName([ten, two])).toEqual([two, ten]);
  });
});
