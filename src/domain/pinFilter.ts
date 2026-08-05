import { LEAD_STRENGTHS, type LeadStrength } from './leadStrength';
import type { Pin } from './pin';

/**
 * What's currently shown on the map: which strengths are visible, and an
 * optional substring that must appear in a pin's name or notes. The two
 * narrow the same result (AND, not OR) — unchecking "weak" while searching
 * "wine" means strong-or-failed leads mentioning wine, not everything weak
 * plus everything mentioning wine.
 */
export interface PinFilter {
  strengths: ReadonlySet<LeadStrength>;
  query: string;
}

/** The default filter: every strength shown, no text narrowing — i.e. every pin. */
export function allPinsFilter(): PinFilter {
  return { strengths: new Set(LEAD_STRENGTHS), query: '' };
}

/**
 * True once the filter would actually hide something. Drives whether the
 * "Clear filters" control and the "Showing N of M" wording appear — an
 * all-strengths, empty-query filter is functionally identical to no filter
 * at all, and should read that way rather than as "Showing 4 of 4 leads".
 */
// Trimmed deliberately, so a query of only spaces reads as "no query" — a
// whitespace-only search box is functionally identical to an empty one, and
// treating it as active would show "Showing N of N" and a Clear control for
// a filter that narrows nothing. The one cosmetic cost: the box can hold
// visible characters while every other affordance says nothing is filtered.
// Trimming ON CHANGE to avoid that would strip a trailing space the instant
// it's typed, silently merging the next word into the current one — worse
// than the cosmetic mismatch it would fix. Left as-is; see
// docs/reviews/filter-search-leads.md F9.
export function isFilterActive(filter: PinFilter): boolean {
  return filter.strengths.size < LEAD_STRENGTHS.length || filter.query.trim() !== '';
}

function matchesQuery(pin: Pin, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return pin.name.toLowerCase().includes(q) || pin.notes.toLowerCase().includes(q);
}

/** Whether `pin` should be visible under `filter`. */
export function matchesFilter(pin: Pin, filter: PinFilter): boolean {
  return filter.strengths.has(pin.strength) && matchesQuery(pin, filter.query);
}

/** `pins` narrowed to the ones `filter` allows, order preserved. */
export function filterPins(pins: Pin[], filter: PinFilter): Pin[] {
  return pins.filter((pin) => matchesFilter(pin, filter));
}
