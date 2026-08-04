import type { Pin } from './pin';

/** A `[lat, lng]` pair, in Leaflet's argument order. */
export type LatLngTuple = [number, number];

/**
 * Where the map opens: either a point at a fixed zoom, or a box to fit.
 *
 * Two shapes rather than one because Leaflet treats them differently — a box
 * picks its own zoom from the map's pixel size, a point cannot. Keeping them
 * distinct means the caller never has to invent a zoom for a box, or a box for
 * a point (a box around one point has no extent and would fit at max zoom).
 */
export type InitialView =
  | { kind: 'center'; center: LatLngTuple; zoom: number }
  | { kind: 'bounds'; bounds: [LatLngTuple, LatLngTuple] };

/** Where the map opens with nothing to show: lower Manhattan, as since unit 1. */
export const DEFAULT_CENTER: LatLngTuple = [40.7128, -74.006];
export const DEFAULT_ZOOM = 12;

/**
 * Zoom for a single point — street level: close enough to read which block a
 * restaurant is on, wide enough to place it in its neighbourhood. Doubles as
 * the cap when fitting a box, so two leads on the same street don't open at
 * maximum zoom staring at a roof.
 */
export const CLOSE_UP_ZOOM = 15;

/**
 * Pixels kept between the outermost pins and the edge of the map when fitting.
 *
 * A marker dot is 22px across and drawn centred on its coordinate, so anything
 * under ~11 clips the dot itself; the rest is so an edge pin reads as a pin
 * (and its popup has somewhere to open) instead of being pressed into the
 * frame. The sidebar needs no allowance here: it is a flex sibling of the map
 * pane, not an overlay, so it never covers the map.
 */
export const FIT_PADDING_PX = 56;

/**
 * Width and height of a marker dot, in pixels. Lives here rather than only in
 * `MapView` because it is what makes `FIT_PADDING_PX` a number and not a taste:
 * the dot is drawn centred on its coordinate, so a pin closer to the frame than
 * half of this is clipped by it.
 */
export const MARKER_SIZE_PX = 22;

/**
 * The view the map should open at for `pins`.
 *
 * Pure, order-independent and non-mutating: the answer is a bounding box over
 * the whole list, so shuffling the pins cannot change it.
 *
 * Total for validated pins, and deliberately does not re-validate: `parsePin`
 * is the boundary that range-checks coordinates, so the `Pin` type already
 * means "finite lat in [-90, 90], finite lng in [-180, 180]". A second,
 * silent filter here would only hide a broken boundary.
 */
export function initialViewForPins(pins: readonly Pin[]): InitialView {
  if (pins.length === 0) {
    return { kind: 'center', center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  }

  // Extremes over every pin — never the first and last of the list, which are
  // in insertion order and say nothing about position.
  let minLat = pins[0].lat;
  let maxLat = pins[0].lat;
  let minLng = pins[0].lng;
  let maxLng = pins[0].lng;
  for (const pin of pins) {
    minLat = Math.min(minLat, pin.lat);
    maxLat = Math.max(maxLat, pin.lat);
    minLng = Math.min(minLng, pin.lng);
    maxLng = Math.max(maxLng, pin.lng);
  }

  // One pin — or several at the same address — gives a box with no extent.
  // Leaflet fits that at maximum zoom (a roof), so answer with the point
  // itself. `CLOSE_UP_ZOOM` as a fit cap would produce the same view today,
  // but the one-pin case is every new user's first load: it shouldn't depend
  // on a Leaflet option staying set somewhere else.
  if (minLat === maxLat && minLng === maxLng) {
    return { kind: 'center', center: [minLat, minLng], zoom: CLOSE_UP_ZOOM };
  }

  // South-west corner first, north-east second — Leaflet's LatLngBounds order.
  //
  // Leads straddling the antimeridian (say +179 and -179) make a box the long
  // way round the globe. That still *contains* every pin, which is the bar
  // here; it just opens further out than it needs to. A wrap-aware fit is not
  // worth its complexity for a personal visiting tracker.
  return { kind: 'bounds', bounds: [[minLat, minLng], [maxLat, maxLng]] };
}
