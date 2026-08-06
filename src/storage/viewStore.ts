import type { LatLngTuple } from '../domain/mapFit';
import type { StorageLike } from './pinStore';

export const VIEW_STORAGE_KEY = 'restaurant-map.view.v1';

/** Where the map was last left: a specific pan/zoom, not a fit instruction. */
export interface PersistedView {
  center: LatLngTuple;
  zoom: number;
}

/**
 * `center`'s longitude is assumed already wrapped into [-180, 180] — the same
 * boundary `loadView` enforces below. `saveView` does not wrap it: Leaflet's
 * own `getCenter()` is NOT wrapped (pan past the antimeridian and it keeps
 * accumulating), so the caller — `MapView`'s `ViewPersister` — wraps it via
 * `.wrap()` before it ever reaches here. An unwrapped value written by
 * `saveView` would simply be rejected by `loadView` on the next load, no
 * error, and used to fail exactly that way before the wrap was added (see
 * docs/reviews/persist map view across reloads.md F2).
 */

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The last pan/zoom the user left the map at, or `null` when there is none —
 * absent, unreadable, or invalid.
 *
 * Unlike `loadPins`, a bad record here is NOT an error: this is a view
 * preference, not data. Notes cannot be reconstructed if lost; a pan position
 * can always be recovered by fitting to the pins again, which is itself a
 * perfectly good view. So this fails soft — `null`, not a thrown error — and
 * the caller falls back to `initialViewForPins`. No banner, no snapshot, no
 * corrupt-store ceremony: that machinery exists to protect prose that cannot
 * be recreated, and would be drift for a value this disposable.
 */
export function loadView(storage: StorageLike): PersistedView | null {
  const raw = storage.getItem(VIEW_STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Record<string, unknown>;
  const center = r.center;

  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !isFiniteNumber(center[0]) ||
    !isFiniteNumber(center[1]) ||
    center[0] < -90 ||
    center[0] > 90 ||
    center[1] < -180 ||
    center[1] > 180 ||
    !isFiniteNumber(r.zoom) ||
    r.zoom < 0
  ) {
    return null;
  }

  return { center: [center[0], center[1]], zoom: r.zoom };
}

/**
 * Persist the current pan/zoom. Best-effort: a failed write (quota exceeded,
 * storage disabled) only means the next reload falls back to fitting the
 * pins again — never worth an error banner for a value this disposable, and
 * this fires on every pan/zoom, so surfacing failures here would spam one for
 * every gesture the moment storage is full.
 */
export function saveView(storage: StorageLike, view: PersistedView): void {
  try {
    storage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // best-effort — see doc comment above
  }
}

/**
 * Forget the last pan/zoom. Used only when it is about to become actively
 * wrong, not merely stale — a confirmed import replaces the pins with a
 * different set that the old position may say nothing about (imagine leads
 * in a different city entirely). Without this, reloading right after an
 * import would honor the pre-import position over the freshly-fit view the
 * import just showed, potentially landing on an empty patch of map with none
 * of the restored pins visible — the same failure shape Section B's review
 * caught for the import itself (docs/reviews/Unit 3 Section B - export-import
 * JSON.md F1), recurring here for the reload right after.
 */
export function clearView(storage: StorageLike): void {
  try {
    storage.removeItem(VIEW_STORAGE_KEY);
  } catch {
    // best-effort — see saveView
  }
}
