import { isLeadStrength, type LeadStrength } from './leadStrength';

/** A restaurant lead placed on the map. */
export interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  strength: LeadStrength;
  /** Free-form visit notes. Always a string; `''` means "nothing written yet". */
  notes: string;
}

export class InvalidPinError extends Error {
  constructor(message: string) {
    super(`Invalid pin: ${message}`);
    this.name = 'InvalidPinError';
  }
}

export class PinNotFoundError extends Error {
  constructor(id: string) {
    super(`Pin not found: ${JSON.stringify(id)}`);
    this.name = 'PinNotFoundError';
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** "lead" or "leads" for `n` — shared so every count in the UI agrees. */
export function leadNoun(n: number): 'lead' | 'leads' {
  return n === 1 ? 'lead' : 'leads';
}

/**
 * `pins` sorted alphabetically by name, case-insensitive — the List view's
 * default order (`docs/roadmap.md` Unit 7: "a sensible default order" so
 * leads aren't presented in arbitrary/insertion order). Does not mutate its
 * input.
 *
 * Compares on `name.trim()`, not the raw name: `parsePin` deliberately keeps
 * leading/trailing whitespace on imported/legacy records for losslessness
 * (see `parsePin`'s own comment), and un-trimmed padding would otherwise sort
 * before every real letter — surprising, since it's invisible in the row.
 * `numeric: true` makes "2 Fish" sort before "10 Downing" rather than after
 * (plain lexicographic order would put "10" first) (docs/reviews/unit 7.md
 * NIT).
 *
 * `Array.prototype.sort` has been a stable sort since ES2019, so pins whose
 * trimmed names are equal under `sensitivity: 'base'` (same letters,
 * different case, or genuine duplicates) keep their relative order from
 * `pins` rather than shuffling on every call — the result is deterministic
 * for a given input.
 */
export function sortPinsByName(pins: Pin[]): Pin[] {
  return [...pins].sort((a, b) =>
    a.name
      .trim()
      .localeCompare(b.name.trim(), undefined, { sensitivity: 'base', numeric: true }),
  );
}

/**
 * Validate an untrusted value (e.g. a JSON-parsed record from storage) into a
 * Pin, or throw InvalidPinError. This is the boundary that keeps corrupt data
 * from ever becoming a live pin.
 */
export function parsePin(raw: unknown): Pin {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidPinError('not an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) {
    throw new InvalidPinError('id must be a non-empty string');
  }
  if (typeof r.name !== 'string') {
    throw new InvalidPinError('name must be a string');
  }
  // createPin/updatePin have always rejected an empty (or whitespace-only)
  // name; parsePin — the actual boundary untrusted data crosses — didn't,
  // so a hand-edited or legacy record with name: '' could load and then get
  // stuck: PinEditor disables Save until the name is non-empty, so nothing
  // about that pin (not even notes) could be edited until it was renamed.
  // Rejecting it here instead means it fails loud at the same boundary as
  // every other corrupt field, consistent with the invariant the write path
  // already enforces.
  //
  // KNOWN TRADE-OFF, chosen deliberately over coercing to a placeholder name:
  // parsePin is the single validation boundary for THREE callers — loadPins
  // (every page load), parseImportPayload (every Import), and Unit 6's
  // planned file-link — and all three reject their ENTIRE input on the first
  // bad record (see docs/roadmap.md's "never a partial import" rule). So one
  // blank-named record anywhere in a stored/imported collection now fails
  // the whole load or the whole import, not just that one pin. This can't
  // happen through the app's own writes (createPin/updatePin always require
  // a name); it requires the data to have been edited outside the app —
  // directly in localStorage via devtools, or by hand in Unit 6's
  // git-tracked file. See docs/reviews/uncommitted-2026-08-06-pinicon-parsepin.md
  // F1 for the full analysis and the rejected alternatives.
  if (r.name.trim().length === 0) {
    throw new InvalidPinError('name must not be empty');
  }
  if (!isFiniteNumber(r.lat) || r.lat < -90 || r.lat > 90) {
    throw new InvalidPinError('lat must be a finite number in [-90, 90]');
  }
  if (!isFiniteNumber(r.lng) || r.lng < -180 || r.lng > 180) {
    throw new InvalidPinError('lng must be a finite number in [-180, 180]');
  }
  if (!isLeadStrength(r.strength)) {
    throw new InvalidPinError(
      `strength must be one of strong|weak|failed, got ${JSON.stringify(r.strength)}`,
    );
  }
  // `notes` arrived with unit 2. Pins written before it have no notes key at
  // all, so an ABSENT notes field reads as '' — otherwise every pin the user
  // already saved would fail validation and the whole store would read as
  // corrupt. A notes field that is PRESENT but not a string is still a hard
  // error: that's real corruption, not an older record.
  if (r.notes !== undefined && typeof r.notes !== 'string') {
    throw new InvalidPinError(
      `notes must be a string when present, got ${JSON.stringify(r.notes)}`,
    );
  }
  // Deliberately NOT trimmed here — for `notes` below, and for `name` above
  // (only checked for non-empty-after-trim, returned as-is): parsing must be
  // lossless so that save -> load returns exactly what was stored.
  // Normalization happens on the way in (createPin / updatePin), not on the
  // way out. One consequence: a name that arrives with padding (e.g. from an
  // imported file) keeps that padding until the pin is next saved through the
  // editor, which trims it — the padding doesn't survive the first edit.
  const notes = r.notes === undefined ? '' : r.notes;

  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    strength: r.strength,
    notes,
  };
}

/** Create a new, validated pin from user input. Trims and requires a name. */
export function createPin(input: {
  name: string;
  lat: number;
  lng: number;
  strength: LeadStrength;
  notes?: string;
}): Pin {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InvalidPinError('name must not be empty');
  }
  return parsePin({
    id: newId(),
    name,
    lat: input.lat,
    lng: input.lng,
    strength: input.strength,
    notes: normalizeNotes(input.notes ?? ''),
  });
}

/**
 * Apply an edit to an existing pin, returning a new validated pin.
 *
 * Identity and position are carried over from the original and are NOT
 * editable through this path: an edit can never change a pin's id (which would
 * orphan it from its stored record) or silently move it on the map. Omitted
 * fields keep their current value; passing `''` for notes genuinely clears
 * them. The result goes back through `parsePin`, so an edit cannot produce a
 * pin that the store would later refuse to load.
 */
export function updatePin(
  pin: Pin,
  edits: { name?: string; strength?: LeadStrength; notes?: string },
): Pin {
  const name = (edits.name ?? pin.name).trim();
  if (name.length === 0) {
    throw new InvalidPinError('name must not be empty');
  }
  return parsePin({
    id: pin.id,
    name,
    lat: pin.lat,
    lng: pin.lng,
    strength: edits.strength ?? pin.strength,
    notes: normalizeNotes(edits.notes ?? pin.notes),
  });
}

/**
 * Return `pins` with the pin sharing `updated.id` replaced, order preserved.
 *
 * Throws when no pin matches. The tempting one-liner
 * (`pins.map(p => p.id === updated.id ? updated : p)`) silently no-ops on an
 * unknown id: the UI would report a saved edit while the store kept the old
 * text. Failing loud makes that class of lost edit impossible.
 */
export function replacePin(pins: Pin[], updated: Pin): Pin[] {
  const index = pins.findIndex((p) => p.id === updated.id);
  if (index === -1) {
    throw new PinNotFoundError(updated.id);
  }
  const next = [...pins];
  next[index] = updated;
  return next;
}

/**
 * Return `pins` with the pin matching `id` removed, order preserved for the
 * rest.
 *
 * Throws PinNotFoundError when no pin matches — the same fail-loud contract
 * as replacePin: the caller saves the returned list, so a silent no-op here
 * would report a deletion that never happened (e.g. a stale tab re-deleting
 * a pin another tab already removed).
 */
export function removePin(pins: Pin[], id: string): Pin[] {
  const index = pins.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new PinNotFoundError(id);
  }
  return [...pins.slice(0, index), ...pins.slice(index + 1)];
}

/**
 * Notes are free-form: internal blank lines and spacing are the user's and are
 * preserved. Only leading/trailing whitespace is stripped, so a textarea left
 * holding just newlines stores as "no notes" rather than as whitespace.
 */
function normalizeNotes(notes: string): string {
  return notes.trim();
}

let fallbackCounter = 0;
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `pin-${Date.now()}-${fallbackCounter}`;
}
