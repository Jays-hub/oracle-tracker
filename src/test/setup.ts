/**
 * Test setup. Loaded for every suite; only does anything under jsdom.
 *
 * jsdom has no layout engine, so every element reports a `clientWidth` and
 * `clientHeight` of 0. Leaflet divides by the map container's size when it
 * fits a bounding box: at 0x0 the scale goes negative, the zoom comes out NaN,
 * and the map throws `Invalid LatLng object: (NaN, NaN)` while mounting. So a
 * fixed size here is not decoration — without it the component tests cannot
 * mount an app that has more than one pin.
 *
 * It is also what makes a viewport assertion mean anything: "is this pin on
 * screen?" has no answer on a 0x0 screen. Tests import MAP_VIEWPORT and check
 * marker positions against it.
 *
 * The size is settable because the fit's correctness is a FUNCTION of it: the
 * padding is subtracted from the container, so a pane that is small relative to
 * the padding fits differently from a comfortable one. A suite that only ever
 * saw 800x600 could not see that. `setMapViewport` lets a test run the real fit
 * at the smallest pane the CSS permits; `resetMapViewport` puts it back.
 *
 * Scoped to Leaflet's own container class so nothing else in the DOM starts
 * claiming a size it doesn't have.
 */
export const DEFAULT_MAP_VIEWPORT = { width: 800, height: 600 } as const;

/** Live: read at assert time, so it follows `setMapViewport`. */
export const MAP_VIEWPORT: { width: number; height: number } = {
  ...DEFAULT_MAP_VIEWPORT,
};

export function setMapViewport(width: number, height: number): void {
  MAP_VIEWPORT.width = width;
  MAP_VIEWPORT.height = height;
}

export function resetMapViewport(): void {
  setMapViewport(DEFAULT_MAP_VIEWPORT.width, DEFAULT_MAP_VIEWPORT.height);
}

if (typeof HTMLElement !== 'undefined') {
  const sizes = [
    ['clientWidth', 'width'],
    ['clientHeight', 'height'],
  ] as const;

  for (const [prop, axis] of sizes) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('leaflet-container') ? MAP_VIEWPORT[axis] : 0;
      },
    });
  }
}

/**
 * jsdom does not implement `URL.createObjectURL` / `revokeObjectURL` (the
 * Export-as-JSON download depends on them) even though it does implement
 * Blob — so without this, every component test that renders the sidebar
 * would throw the moment Export was clicked, regardless of whether the
 * export logic itself is correct. The placeholder URL is never dereferenced
 * by jsdom (there is no navigation), so an opaque string is enough; tests
 * that need the actual content spy on `createObjectURL` to capture the Blob.
 */
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  let counter = 0;
  URL.createObjectURL = () => `blob:mock-${++counter}`;
  URL.revokeObjectURL = () => {};
}
