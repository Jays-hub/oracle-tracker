/**
 * Tests for the view the map opens at. Pure — no DOM, no Leaflet: this is the
 * arithmetic that decides whether a lead is on screen at all, and it is worth
 * being able to check it against hand-computed numbers.
 */
import { describe, it, expect } from 'vitest';
// The stylesheet as text, via Vite's `?raw` — the assertions below are about
// what index.css actually says, so they have to read the file, not a copy.
import css from '../index.css?raw';
import {
  CLOSE_UP_ZOOM,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FIT_PADDING_PX,
  MARKER_SIZE_PX,
  initialViewForPins,
} from './mapFit';
import type { Pin } from './pin';

function pin(lat: number, lng: number, id = `${lat}:${lng}`): Pin {
  return { id, name: `Lead ${id}`, lat, lng, strength: 'strong', notes: '' };
}

describe('initialViewForPins', () => {
  // Nothing to fit: the box of an empty set is undefined, and inventing one
  // (the whole world, [0,0]) would open the app on the middle of the Atlantic.
  it('keeps the default view when there are no pins', () => {
    expect(initialViewForPins([])).toEqual({
      kind: 'center',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
  });

  // A box around one point has no extent; fitting it zooms as far in as the
  // tiles go, which shows a roof. Answer with the point and a readable zoom.
  it('centres on the only pin at a readable zoom', () => {
    expect(initialViewForPins([pin(38.7223, -9.1393)])).toEqual({
      kind: 'center',
      center: [38.7223, -9.1393],
      zoom: CLOSE_UP_ZOOM,
    });
  });

  // The core: the box has to be the extremes of the whole list, and every pin
  // has to be inside it — that containment IS "see them all at a glance".
  it('fits a box that contains every pin', () => {
    const pins = [
      pin(41.1456, -8.6108), // Porto
      pin(38.7223, -9.1393), // Lisbon
      pin(37.0194, -7.9304), // Faro
      pin(40.2033, -8.4103), // Coimbra
    ];

    const view = initialViewForPins(pins);

    // Hand-computed: min lat Faro / min lng Lisbon, max lat Porto / max lng Faro.
    expect(view).toEqual({
      kind: 'bounds',
      bounds: [
        [37.0194, -9.1393],
        [41.1456, -7.9304],
      ],
    });

    if (view.kind !== 'bounds') throw new Error('expected a bounds view');
    const [[south, west], [north, east]] = view.bounds;
    for (const p of pins) {
      expect(p.lat).toBeGreaterThanOrEqual(south);
      expect(p.lat).toBeLessThanOrEqual(north);
      expect(p.lng).toBeGreaterThanOrEqual(west);
      expect(p.lng).toBeLessThanOrEqual(east);
    }
  });

  // Guards the classic version of this bug: corners taken from pins[0] and the
  // last pin. Insertion order says nothing about position, so the pins that
  // define the box are deliberately in the middle of the list here.
  it('takes the corners from the extremes, not the ends of the list', () => {
    const view = initialViewForPins([
      pin(10, 10),
      pin(-20, -30), // south-west corner
      pin(40, 50), // north-east corner
      pin(11, 11),
    ]);

    expect(view).toEqual({
      kind: 'bounds',
      bounds: [
        [-20, -30],
        [40, 50],
      ],
    });
  });

  // Same pins in any order must give the same view — a map that opened
  // somewhere else depending on the order pins were added would be a bug you
  // could only see by reloading twice. Also: it must not reorder the caller's
  // list, which is React state.
  it('is order-independent and leaves the caller’s list alone', () => {
    const pins = [pin(10, 10), pin(-20, -30), pin(40, 50), pin(11, 11)];
    const snapshot = structuredClone(pins);

    const first = initialViewForPins(pins);
    const shuffled = initialViewForPins([pins[2], pins[0], pins[3], pins[1]]);

    expect(shuffled).toEqual(first);
    expect(initialViewForPins(pins)).toEqual(first); // same input twice
    expect(pins).toEqual(snapshot);
  });

  // Two restaurants in the same building, or the same lead pinned twice: the
  // box is degenerate exactly as in the one-pin case.
  it('answers with a point when every pin sits at the same coordinate', () => {
    const view = initialViewForPins([
      pin(51.5074, -0.1278, 'a'),
      pin(51.5074, -0.1278, 'b'),
      pin(51.5074, -0.1278, 'c'),
    ]);

    expect(view).toEqual({
      kind: 'center',
      center: [51.5074, -0.1278],
      zoom: CLOSE_UP_ZOOM,
    });
  });

  // ...but only when the coordinates are *equal*. Two pins a few metres apart
  // still get a box; the zoom cap in MapView is what keeps that readable.
  it('still fits a box for pins that are close but not identical', () => {
    const view = initialViewForPins([pin(51.5074, -0.1278), pin(51.50745, -0.1278)]);

    expect(view.kind).toBe('bounds');
  });

  // The extremes parsePin admits. Nothing here may clamp, wrap or reorder them.
  it('handles the coordinate extremes the pin boundary allows', () => {
    expect(initialViewForPins([pin(-90, -180), pin(90, 180)])).toEqual({
      kind: 'bounds',
      bounds: [
        [-90, -180],
        [90, 180],
      ],
    });
  });
});

/**
 * The constants are part of the spec, not implementation detail: "keep today's
 * default view" IS zoom 12 over lower Manhattan, and "a readable zoom" IS 15.
 * Asserting them against the symbols the code returns would let any of them be
 * changed to any other number with a green suite, so these are literals.
 */
describe('the view constants', () => {
  it('opens an empty map exactly where unit 1 did', () => {
    expect(DEFAULT_CENTER).toEqual([40.7128, -74.006]);
    expect(DEFAULT_ZOOM).toBe(12);
  });

  it('uses street level for a single pin', () => {
    // 15 is close enough to read which block a restaurant is on. Lower opens on
    // a district, higher on a roof.
    expect(CLOSE_UP_ZOOM).toBe(15);
  });

  it('pads a fit by more than a marker radius', () => {
    // The dot is centred on its coordinate, so anything under half its size
    // clips the dot itself; the rest is room for the popup to open.
    expect(FIT_PADDING_PX).toBe(56);
    expect(FIT_PADDING_PX).toBeGreaterThan(MARKER_SIZE_PX / 2);
  });
});

/**
 * The one place a stylesheet is load-bearing for the fit.
 *
 * Leaflet fits a box into the container MINUS the padding on both sides. Once
 * the map pane is narrower (or shorter) than `2 x FIT_PADDING_PX` that figure
 * is negative: the zoom comes out `Infinity`, `maxZoom` clamps it to street
 * level, and the map opens on the centre of the bounding box with no pin on
 * screen — no throw, no warning. The CSS floor is what makes that unreachable,
 * so it has to be checked against the padding rather than trusted; raising
 * FIT_PADDING_PX past what the floor affords must turn this red.
 */
describe('the map pane is always big enough for its own fit padding', () => {
  function floor(selector: string, property: string): number {
    const rule = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1];
    if (rule === undefined) throw new Error(`no ${selector} rule in index.css`);
    const value = rule.match(new RegExp(`${property}:\\s*(\\d+)px`))?.[1];
    if (value === undefined) throw new Error(`no ${property} on ${selector}`);
    return Number(value);
  }

  // A pin needs the padding on BOTH sides plus somewhere to actually be.
  const needed = 2 * FIT_PADDING_PX + MARKER_SIZE_PX;

  it('floors the pane width above twice the fit padding', () => {
    expect(floor('.map-pane', 'min-width')).toBeGreaterThanOrEqual(needed);
  });

  it('floors the app height above twice the fit padding', () => {
    // `.app` is `height: 100vh` and the pane is stretched to it, so the
    // vertical floor belongs on the flex container.
    expect(floor('.app', 'min-height')).toBeGreaterThanOrEqual(needed);
  });
});
