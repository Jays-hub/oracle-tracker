import { STRENGTH_LABELS, colorForStrength } from '../domain/leadStrength';
import { sortPinsByName, type Pin } from '../domain/pin';

/** How many code points of notes a row shows before truncating with an ellipsis. */
export const NOTES_PREVIEW_LENGTH = 80;

/**
 * A single-line summary of `notes` for a list row: internal newlines/runs of
 * whitespace collapse to one space (a multi-line note would otherwise blow up
 * a row's height), and anything past `NOTES_PREVIEW_LENGTH` is cut with "…".
 * `''` in means `''` out — the caller decides how to render "no notes".
 *
 * Sliced via `Array.from` (code points), not `.slice()` (UTF-16 code units):
 * a surrogate-pair character (e.g. most emoji) straddling the cut point would
 * otherwise split into a lone, unpaired surrogate and render as a replacement
 * glyph (see docs/reviews/unit 7.md F5) — plausible in free-form visit notes.
 */
export function previewNotes(notes: string): string {
  const collapsed = notes.replace(/\s+/g, ' ').trim();
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= NOTES_PREVIEW_LENGTH) return collapsed;
  return `${codePoints.slice(0, NOTES_PREVIEW_LENGTH).join('').trimEnd()}…`;
}

/**
 * The List view: every pin App hands it (already narrowed by the active
 * filter — see `visiblePins` in App.tsx) as a scannable row of name /
 * strength / notes preview, alphabetical by name. Clicking a row calls the
 * same `onSelectPin` the map's markers use, so it opens the same `PinEditor`
 * — nothing pin-specific is duplicated here.
 */
export function PinList({
  pins,
  selectedPinId,
  onSelectPin,
}: {
  pins: Pin[];
  selectedPinId: string | null;
  onSelectPin: (id: string) => void;
}) {
  if (pins.length === 0) {
    return <p className="pin-list__empty">No leads to show.</p>;
  }

  return (
    <ul className="pin-list">
      {sortPinsByName(pins).map((pin) => {
        const preview = previewNotes(pin.notes);
        return (
          <li key={pin.id}>
            <button
              type="button"
              className={`pin-list__row${
                pin.id === selectedPinId ? ' pin-list__row--selected' : ''
              }`}
              // The visual layout is adjacent <span>s with no whitespace
              // between them, which screen readers announce as one
              // run-together token (e.g. "Alpha CafeStronggood espresso…") —
              // aria-label gives the row an explicit, readable name instead
              // (docs/reviews/unit 7.md NIT).
              aria-label={`${pin.name}, ${STRENGTH_LABELS[pin.strength]}, ${
                preview === '' ? 'no notes yet' : preview
              }`}
              onClick={() => onSelectPin(pin.id)}
            >
              <span
                className="pin-list__swatch"
                style={{ background: colorForStrength(pin.strength) }}
                aria-hidden="true"
              />
              <span className="pin-list__name">{pin.name}</span>
              <span className="pin-list__strength">{STRENGTH_LABELS[pin.strength]}</span>
              <span className="pin-list__notes">
                {preview === '' ? (
                  <span className="pin-list__notes--empty">No notes yet</span>
                ) : (
                  preview
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
