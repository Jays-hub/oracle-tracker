/**
 * Guards the `pinIcon` cache added to close the "memoize per (strength,
 * selected)" NIT (docs/reviews/Unit 2 - notes + editing per pin.md). The
 * cache key is the only thing standing between "correct icon" and "stale
 * icon shared across pins" now that icons are reused rather than rebuilt —
 * nothing else in the suite asserts the selection ring at all, so a key that
 * silently drops `selected` (or `strength`) would pass every other test.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MapView } from './MapView';
import type { Pin } from '../domain/pin';

afterEach(cleanup);

const alpha: Pin = {
  id: 'a',
  name: 'Alpha Cafe',
  lat: 40.7,
  lng: -74,
  strength: 'strong',
  notes: '',
};
const beta: Pin = {
  id: 'b',
  name: 'Beta Diner',
  lat: 40.71,
  lng: -74.01,
  strength: 'strong', // same strength as alpha — shares a cached icon
  notes: '',
};

function dots(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.pin-marker__dot'));
}

describe('MapView pin icons', () => {
  it('marks exactly the selected pin, even when it shares a cached icon with an unselected one', () => {
    render(
      <MapView
        initialView={{ kind: 'center', center: [40.7, -74], zoom: 12 }}
        pins={[alpha, beta]}
        selectedPinId={beta.id}
        onMapClick={() => {}}
        onSelectPin={() => {}}
        onViewChange={() => {}}
      />,
    );

    const selected = dots().filter((d) =>
      d.classList.contains('pin-marker__dot--selected'),
    );
    expect(selected).toHaveLength(1);

    // Both pins are 'strong' and must both render green, whether or not they
    // share the same cached DivIcon instance — selection must not leak color
    // and color must not leak selection.
    for (const dot of dots()) {
      expect(dot.getAttribute('style')).toContain('#2e9e4f');
    }
  });
});
