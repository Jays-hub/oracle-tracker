import { describe, it, expect } from 'vitest';
import {
  allPinsFilter,
  filterPins,
  isFilterActive,
  matchesFilter,
  type PinFilter,
} from './pinFilter';
import type { Pin } from './pin';

function pin(overrides: Partial<Pin> = {}): Pin {
  return {
    id: 'a1',
    name: "Joe's Diner",
    lat: 40.7,
    lng: -74.0,
    strength: 'strong',
    notes: '',
    ...overrides,
  };
}

const strong = pin({ id: 's', name: 'Strong Steakhouse', strength: 'strong', notes: 'Great wine list.' });
const weak = pin({ id: 'w', name: 'Weak Tea House', strength: 'weak', notes: 'Owner was noncommittal.' });
const failed = pin({ id: 'f', name: 'Failed Bistro', strength: 'failed', notes: 'Closed down.' });
const all = [strong, weak, failed];

describe('allPinsFilter', () => {
  // The default must actually be a no-op filter, not just "looks empty" — every
  // other test below assumes matchesFilter(pin, allPinsFilter()) is always true.
  it('matches every pin regardless of strength or notes', () => {
    for (const p of all) {
      expect(matchesFilter(p, allPinsFilter())).toBe(true);
    }
    expect(isFilterActive(allPinsFilter())).toBe(false);
  });
});

describe('filterPins — strength', () => {
  it('keeps only pins whose strength is selected', () => {
    const filter: PinFilter = { strengths: new Set(['strong', 'failed']), query: '' };
    expect(filterPins(all, filter)).toEqual([strong, failed]);
  });

  // Edge case: nothing checked is a legitimate filter state ("show none of
  // these"), not an error — must not silently fall back to "show everything".
  it('matches nothing when every strength is deselected', () => {
    const filter: PinFilter = { strengths: new Set(), query: '' };
    expect(filterPins(all, filter)).toEqual([]);
    expect(isFilterActive(filter)).toBe(true);
  });
});

describe('filterPins — text search', () => {
  it('matches a substring in the name, case-insensitively', () => {
    const filter: PinFilter = { strengths: new Set(['strong', 'weak', 'failed']), query: 'STEAKHOUSE' };
    expect(filterPins(all, filter)).toEqual([strong]);
  });

  // The whole reason search exists: finding a lead by what happened there, not
  // only by what it's called.
  it('matches a substring in notes when the name does not match', () => {
    const filter: PinFilter = { strengths: new Set(['strong', 'weak', 'failed']), query: 'wine' };
    expect(filterPins(all, filter)).toEqual([strong]);
  });

  it('is whitespace-tolerant: a query of only spaces is the same as no query', () => {
    const filter: PinFilter = { strengths: new Set(['strong', 'weak', 'failed']), query: '   ' };
    expect(filterPins(all, filter)).toEqual(all);
    expect(isFilterActive(filter)).toBe(false);
  });

  it('does not throw on empty notes when searching', () => {
    const bare = pin({ id: 'bare', notes: '' });
    const filter: PinFilter = { strengths: new Set(['strong']), query: 'anything' };
    expect(filterPins([bare], filter)).toEqual([]);
  });
});

describe('filterPins — strength and text combine as AND', () => {
  it('excludes a text match whose strength is deselected', () => {
    // "wine" only appears on the strong pin; deselecting strong must hide it
    // even though the text would otherwise match.
    const filter: PinFilter = { strengths: new Set(['weak', 'failed']), query: 'wine' };
    expect(filterPins(all, filter)).toEqual([]);
  });
});

describe('isFilterActive', () => {
  it('is false only when every strength is selected and the query is blank', () => {
    expect(isFilterActive({ strengths: new Set(['strong', 'weak', 'failed']), query: '' })).toBe(false);
    expect(isFilterActive({ strengths: new Set(['strong', 'weak']), query: '' })).toBe(true);
    expect(isFilterActive({ strengths: new Set(['strong', 'weak', 'failed']), query: 'x' })).toBe(true);
  });
});
