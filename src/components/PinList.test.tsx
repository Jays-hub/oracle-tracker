/**
 * Component-level tests for the List view's rendering: order, notes preview
 * truncation, the selected-row indicator, the empty state, and that clicking
 * a row calls back with exactly that pin's id — the same wiring the map's
 * markers already use, per Unit 7's "nothing pin-specific is duplicated".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PinList, previewNotes, NOTES_PREVIEW_LENGTH } from './PinList';
import { colorForStrength } from '../domain/leadStrength';
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
  name: 'Beta Grill',
  lat: 40.71,
  lng: -74.01,
  strength: 'weak',
  notes: 'Met the owner, follow up in a month.',
};
const gamma: Pin = {
  id: 'g',
  name: 'gamma tavern',
  lat: 40.72,
  lng: -74.02,
  strength: 'failed',
  notes: '',
};

describe('previewNotes', () => {
  it('returns short notes unchanged', () => {
    expect(previewNotes('Short note.')).toBe('Short note.');
  });

  it('collapses internal newlines and runs of whitespace to a single space', () => {
    expect(previewNotes('Line one.\n\n  Line two.\t Line three.')).toBe(
      'Line one. Line two. Line three.',
    );
  });

  it('truncates past NOTES_PREVIEW_LENGTH characters with an ellipsis', () => {
    const long = 'x'.repeat(NOTES_PREVIEW_LENGTH + 20);
    const preview = previewNotes(long);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBe(NOTES_PREVIEW_LENGTH + 1); // + the ellipsis char
  });

  it('does not truncate a note exactly at the limit', () => {
    const exact = 'x'.repeat(NOTES_PREVIEW_LENGTH);
    expect(previewNotes(exact)).toBe(exact);
  });

  // Edge case: whitespace-only notes (possible via imported/legacy data —
  // parsePin doesn't trim notes) collapse to '', same as genuinely empty.
  it('collapses whitespace-only notes to the empty string', () => {
    expect(previewNotes('   \n\t  ')).toBe('');
  });

  // Regression (docs/reviews/unit 7.md F5): a surrogate-pair character (most
  // emoji) sitting exactly on the truncation boundary used to be sliced by
  // UTF-16 code unit, splitting it into a lone high surrogate that renders as
  // a replacement-character glyph. The fix slices by code point instead, so
  // the character is either kept whole or dropped whole, never split.
  it('does not split a surrogate pair when truncating past the limit', () => {
    const withEmoji = 'x'.repeat(79) + '😀' + 'y'.repeat(10);
    expect(previewNotes(withEmoji)).toBe(`${'x'.repeat(79)}😀…`);
  });
});

describe('PinList', () => {
  it('shows an empty-state message instead of an empty list', () => {
    render(<PinList pins={[]} selectedPinId={null} onSelectPin={() => {}} />);
    expect(screen.getByText(/no leads to show/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // Order: alphabetical by name, case-insensitive — independent of input order.
  it('renders rows alphabetically by name regardless of input order', () => {
    render(<PinList pins={[beta, gamma, alpha]} selectedPinId={null} onSelectPin={() => {}} />);
    const names = screen.getAllByRole('button').map((row) => row.textContent);
    expect(names[0]).toContain('Alpha Cafe');
    expect(names[1]).toContain('Beta Grill');
    expect(names[2]).toContain('gamma tavern');
  });

  it('shows the strength label and a notes preview, or a placeholder when there are none', () => {
    render(<PinList pins={[alpha, beta]} selectedPinId={null} onSelectPin={() => {}} />);
    expect(screen.getByText('Strong')).toBeTruthy();
    expect(screen.getByText('Weak')).toBeTruthy();
    expect(screen.getByText(/met the owner/i)).toBeTruthy();
    expect(screen.getByText(/no notes yet/i)).toBeTruthy();
  });

  it('marks exactly the selected pin’s row', () => {
    render(<PinList pins={[alpha, beta]} selectedPinId={beta.id} onSelectPin={() => {}} />);
    const rows = screen.getAllByRole('button');
    const selected = rows.filter((r) => r.className.includes('pin-list__row--selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Beta Grill');
  });

  // The whole point of the row being a button rather than static text: it
  // opens the same PinEditor the map's markers do, via the same callback.
  it('calls onSelectPin with exactly the clicked pin’s id', () => {
    const onSelectPin = vi.fn();
    render(<PinList pins={[alpha, beta]} selectedPinId={null} onSelectPin={onSelectPin} />);

    fireEvent.click(screen.getByText('Beta Grill'));

    expect(onSelectPin).toHaveBeenCalledTimes(1);
    expect(onSelectPin).toHaveBeenCalledWith('b');
  });

  // Regression (docs/reviews/unit 7.md F6): CLAUDE.md #3 makes strength→color
  // a total, fixed mapping that must hold everywhere a pin renders — this was
  // correct but unguarded on the List surface, so a future hardcode/transpose
  // of the list palette would have passed every existing test.
  it('colors each row’s swatch by its own strength, matching the map’s palette', () => {
    render(<PinList pins={[alpha, beta, gamma]} selectedPinId={null} onSelectPin={() => {}} />);
    function swatchFor(name: string): HTMLElement {
      return screen.getByText(name).closest('button')!.querySelector(
        '.pin-list__swatch',
      ) as HTMLElement;
    }
    // React sets `style={{background: ...}}` via the CSSOM, which jsdom (like
    // real browsers) normalizes a hex value to rgb() on readback — so the hex
    // straight out of `colorForStrength` has to go through the same
    // normalization before comparing, rather than being matched as a raw
    // substring of the attribute.
    function asCssColor(hex: string): string {
      const probe = document.createElement('span');
      probe.style.background = hex;
      return probe.style.background;
    }
    expect(swatchFor('Alpha Cafe').style.background).toBe(asCssColor(colorForStrength('strong')));
    expect(swatchFor('Beta Grill').style.background).toBe(asCssColor(colorForStrength('weak')));
    expect(swatchFor('gamma tavern').style.background).toBe(
      asCssColor(colorForStrength('failed')),
    );
  });

  // Regression (docs/reviews/unit 7.md NIT): the row's visible content is
  // adjacent <span>s with no whitespace between them, which screen readers
  // announce as one run-together token ("Alpha CafeStrongno notes yet").
  // aria-label gives it an explicit, readable name instead.
  it('gives each row a readable accessible name, not run-together text', () => {
    render(<PinList pins={[alpha, beta]} selectedPinId={null} onSelectPin={() => {}} />);
    expect(screen.getByRole('button', { name: 'Alpha Cafe, Strong, no notes yet' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Beta Grill, Weak, Met the owner/ }),
    ).toBeTruthy();
  });
});
