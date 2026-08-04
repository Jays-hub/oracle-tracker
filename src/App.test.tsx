/**
 * Component-level tests over the real App, real Leaflet and the real
 * `localStorage` — the layer where this unit's guards live and where the
 * domain tests cannot reach. Each test states the loss it prevents.
 *
 * A note on the marker click: react-leaflet renders markers into Leaflet's own
 * DOM, so these drive the real `.pin-marker` element with a real click event.
 * That exercises Leaflet -> eventHandlers.click -> handleSelectPin, i.e. the
 * chain a user actually triggers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { DomUtil } from 'leaflet';
import {
  STORAGE_KEY,
  CORRUPT_BACKUP_PREFIX,
  IMPORT_BACKUP_PREFIX,
  serializePins,
} from './storage/pinStore';
import { MAP_VIEWPORT, setMapViewport, resetMapViewport } from './test/setup';
import type { Pin } from './domain/pin';

// jsdom does not give us a usable localStorage under this Node build, and App
// captures `window.localStorage` at module scope — so install a real,
// spec-shaped Storage on window BEFORE importing App. Same spirit as the
// injected StorageLike fake in pinStore.test.ts: the store under test is ours,
// so the test depends on the Storage contract rather than on jsdom's version.
const backing = new Map<string, string>();
const fakeStorage: Storage = {
  get length() {
    return backing.size;
  },
  clear: () => backing.clear(),
  getItem: (k) => (backing.has(k) ? (backing.get(k) as string) : null),
  key: (i) => Array.from(backing.keys())[i] ?? null,
  removeItem: (k) => {
    backing.delete(k);
  },
  setItem: (k, v) => {
    backing.set(k, String(v));
  },
};
Object.defineProperty(window, 'localStorage', {
  value: fakeStorage,
  configurable: true,
  writable: true,
});

const { default: App } = await import('./App');

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
  lat: 40.72,
  lng: -74.02,
  strength: 'weak',
  notes: 'Beta notes.',
};

function seed(pins: unknown) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}
function stored(): Pin[] {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) as string);
}
function storageKeys(): string[] {
  return Array.from({ length: window.localStorage.length }, (_, i) =>
    window.localStorage.key(i),
  ).filter((k): k is string => k !== null);
}
function markers(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.pin-marker'));
}

/**
 * Where each pin actually sits on screen, in container pixels.
 *
 * Leaflet records the position it gave every element in `_leaflet_pos`
 * (`DomUtil.getPosition`), which is the pin's coordinate projected into layer
 * space; adding the map pane's own offset turns that into a point in the
 * container. So a pin is on screen iff this lands inside MAP_VIEWPORT — which
 * is the acceptance bar for this unit, read straight off the rendered map
 * rather than off the props we passed it.
 */
function markerPositions(): { x: number; y: number }[] {
  const pane = document.querySelector('.leaflet-map-pane') as HTMLElement;
  const paneAt = DomUtil.getPosition(pane);
  return markers().map((el) => {
    const at = paneAt.add(DomUtil.getPosition(el));
    return { x: at.x, y: at.y };
  });
}

function clickMapAt(clientX: number, clientY: number) {
  act(() => {
    document
      .querySelector('.leaflet-container')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
  });
}
function notesBox() {
  return screen.getByPlaceholderText(/what happened on the visit/i) as HTMLTextAreaElement;
}
function save() {
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
}
function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}
function selectFile(contents: string, name = 'leads.json') {
  const file = new File([contents], name, { type: 'application/json' });
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

/**
 * The zoom the map actually opened at, read off the tiles Leaflet requested.
 * Tile URLs are `.../{z}/{x}/{y}.png`, so the z segment is the rendered zoom —
 * the map's own answer, not the prop we handed it.
 */
function renderedZoom(): number {
  const tile = document.querySelector('img.leaflet-tile') as HTMLImageElement | null;
  if (!tile) throw new Error('no tile rendered');
  const z = tile.src.match(/\/(\d+)\/\d+\/\d+\.png/)?.[1];
  if (z === undefined) throw new Error(`unrecognised tile url: ${tile.src}`);
  return Number(z);
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  resetMapViewport();
  // Belt-and-suspenders for the test that mocks `window.localStorage.setItem`
  // (F8's "clears a previous success banner" test): if that test ever fails
  // BEFORE reaching its own `vi.restoreAllMocks()`, the mock would otherwise
  // leak into every later test in this file, since `beforeEach` only clears
  // localStorage's contents, not mocks applied to its methods.
  vi.restoreAllMocks();
});

describe('App — notes survive a reload', () => {
  // The unit's acceptance bar, end to end through the real UI: write a note on
  // a pin, throw the app away, start it again from localStorage, read it back.
  it('writes notes on a clicked pin and restores them on a fresh mount', () => {
    seed([alpha]);
    render(<App />);

    fireEvent.click(markers()[0]);
    fireEvent.change(notesBox(), { target: { value: 'Met Ana.\nRevisit in June.' } });
    save();

    expect(stored()[0].notes).toBe('Met Ana.\nRevisit in June.');

    cleanup(); // <- the page reload
    render(<App />);
    fireEvent.click(markers()[0]);
    expect(notesBox().value).toBe('Met Ana.\nRevisit in June.');
  });

  // A strength edit must repaint the marker in the mapped color, since the
  // color is the only thing that communicates lead strength at a glance.
  it('recolors the marker when the strength is edited', () => {
    seed([alpha]);
    render(<App />);
    fireEvent.click(markers()[0]);
    expect(document.querySelector('.pin-marker__dot')?.getAttribute('style')).toContain(
      '#2e9e4f',
    );

    fireEvent.change(screen.getByDisplayValue('Alpha Cafe').parentElement!.parentElement!.querySelector('select')!, {
      target: { value: 'failed' },
    });
    save();

    expect(document.querySelector('.pin-marker__dot')?.getAttribute('style')).toContain(
      '#d64545',
    );
    expect(stored()[0].strength).toBe('failed');
  });
});

describe('App — an edit cannot land on the wrong lead', () => {
  // Regression guard for `key={selectedPin.id}` on PinEditor. With that key
  // removed, the draft typed on Alpha stays mounted under Beta and this save
  // writes Alpha's text onto Beta — notes silently attached to the wrong
  // restaurant, which no amount of reloading can undo.
  it('never saves a draft typed on one pin onto another', () => {
    seed([alpha, beta]);
    render(<App />);

    fireEvent.click(markers()[0]);
    fireEvent.change(notesBox(), { target: { value: 'UNSAVED TEXT TYPED ON ALPHA' } });

    fireEvent.click(markers()[1]);
    expect(notesBox().value).toBe('Beta notes.');

    fireEvent.change(notesBox(), { target: { value: 'Beta notes, edited.' } });
    save();

    const after = stored();
    expect(after.find((p) => p.id === 'b')?.notes).toBe('Beta notes, edited.');
    expect(after.find((p) => p.id === 'a')?.notes).toBe(''); // Alpha untouched
    expect(JSON.stringify(after)).not.toContain('UNSAVED TEXT TYPED ON ALPHA');
  });
});

describe('App — a stale tab cannot delete pins', () => {
  // Reproduces the reviewer's multi-tab loss: this app instance loaded when the
  // store held one pin; another tab then added a second. Saving a note here
  // must not rewrite the whole key from the stale in-memory list.
  it('preserves pins another tab added since this one loaded', () => {
    seed([alpha]);
    render(<App />);
    fireEvent.click(markers()[0]);

    // ...meanwhile, in another tab:
    const fromOtherTab: Pin = { ...beta, id: 'c', name: 'Added in tab A' };
    seed([alpha, fromOtherTab]);

    fireEvent.change(notesBox(), { target: { value: 'Note written in the stale tab.' } });
    save();

    const after = stored();
    expect(after).toHaveLength(2);
    expect(after.map((p) => p.name)).toContain('Added in tab A');
    expect(after.find((p) => p.id === 'a')?.notes).toBe('Note written in the stale tab.');
  });

  it('preserves them when adding a pin, too', () => {
    seed([alpha]);
    render(<App />);

    const fromOtherTab: Pin = { ...beta, id: 'c', name: 'Added in tab A' };
    seed([alpha, fromOtherTab]);

    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Third Place' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);

    const after = stored();
    expect(after.map((p) => p.name)).toContain('Added in tab A');
    expect(after.map((p) => p.name)).toContain('Third Place');
    expect(after).toHaveLength(3);
  });
});

describe('App — a corrupt store is never overwritten unbacked-up', () => {
  // The whole point of failing loud on a corrupt read is undone if the first
  // ordinary action destroys the bytes. Notes are prose: they cannot be
  // reconstructed, so the raw data has to be copied aside before any write.
  it('backs the unreadable bytes up before the next save can overwrite them', () => {
    const raw = JSON.stringify([alpha, { ...beta, strength: 'faled' }]);
    window.localStorage.setItem(STORAGE_KEY, raw);

    render(<App />);
    expect(screen.getByRole('alert').textContent).toMatch(/couldn’t read saved pins/i);
    expect(markers()).toHaveLength(0);

    const backupKeys = storageKeys().filter((k) => k.startsWith(CORRUPT_BACKUP_PREFIX));
    expect(backupKeys).toHaveLength(1);
    expect(window.localStorage.getItem(backupKeys[0])).toBe(raw);

    // The only action available with zero pins is adding one; it overwrites the
    // main key, and the backup is what makes that survivable.
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Fresh Start' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);

    expect(stored().map((p) => p.name)).toEqual(['Fresh Start']);
    expect(window.localStorage.getItem(backupKeys[0])).toBe(raw); // still recoverable
  });
});

describe('App — arming the map is visible on the map', () => {
  // "Place on map" changes what the next click does, so something has to say
  // so where the click will happen. The class used to live on MapContainer,
  // which freezes className in a useState initialiser at construction — the
  // same read-once behaviour the mount-time fit relies on — so it was
  // evaluated once with armed=false and the crosshair never appeared.
  it('marks the map pane armed so the cursor changes, and unmarks it on cancel', () => {
    seed([alpha]);
    render(<App />);
    const pane = document.querySelector('.map-pane') as HTMLElement;
    expect(pane.className).not.toContain('map-pane--armed');

    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Fourth Place' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    expect(pane.className).toContain('map-pane--armed');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(pane.className).not.toContain('map-pane--armed');
  });
});

describe('App — the map opens on the pins', () => {
  // Leads nowhere near the hardcoded default view. Before this unit these
  // rendered thousands of kilometres off screen: the pins existed, the map
  // opened over Manhattan, and nothing was visible until you found them by
  // panning — which is exactly what "see it all at a glance" rules out.
  const lisbon: Pin = {
    id: 'l',
    name: 'Cervejaria Ramiro',
    lat: 38.7223,
    lng: -9.1393,
    strength: 'strong',
    notes: 'Great sardines.',
  };
  const porto: Pin = {
    id: 'p',
    name: 'Cantina 32',
    lat: 41.1456,
    lng: -8.6108,
    strength: 'weak',
    notes: '',
  };

  /**
   * A literal, deliberately NOT `FIT_PADDING_PX`.
   *
   * Importing the constant that drives the fit and asserting the view against
   * it is circular: change the padding and the expectation moves with it, so
   * the assertion can never fail on the thing it exists to protect. This number
   * is the independent bar — the marker dot is 22px centred on its coordinate,
   * so 11 is where it starts being clipped, and the slack is so an edge pin
   * reads as a pin rather than something pressed into the frame.
   */
  const MIN_EDGE_MARGIN_PX = 24;

  function expectOnScreen(at: { x: number; y: number }[], margin = 0) {
    for (const { x, y } of at) {
      expect(x).toBeGreaterThanOrEqual(margin);
      expect(x).toBeLessThanOrEqual(MAP_VIEWPORT.width - margin);
      expect(y).toBeGreaterThanOrEqual(margin);
      expect(y).toBeLessThanOrEqual(MAP_VIEWPORT.height - margin);
    }
  }

  it('fits every pin into the viewport, padded away from the edges', () => {
    seed([lisbon, porto]);
    render(<App />);

    const at = markerPositions();
    expect(at).toHaveLength(2);
    // The padding is the difference between "technically on screen" and a pin
    // half-clipped by the frame with nowhere to open its popup.
    expectOnScreen(at, MIN_EDGE_MARGIN_PX);
    // ...and it really did fit the box rather than open at some default: two
    // cities 270km apart do not fit at street zoom.
    expect(renderedZoom()).toBeLessThan(15);
  });

  /**
   * The fit is a function of the container's pixel size — the padding is
   * subtracted from it — so a suite that only ever saw one comfortable viewport
   * could not see the boundary. Below `2 x FIT_PADDING_PX` Leaflet's fit goes
   * negative, the zoom comes out Infinity, maxZoom clamps it to street level,
   * and the map opens on the centre of the box with NO pin on screen, silently.
   * `.map-pane`'s min-width / `.app`'s min-height are what put that out of
   * reach (tied to the padding in mapFit.test.ts); this runs the real fit at
   * that floor and checks the pins survive it.
   */
  it('still fits the pins at the smallest pane the layout allows', () => {
    setMapViewport(240, 240);
    seed([lisbon, porto]);
    render(<App />);

    const at = markerPositions();
    expect(at).toHaveLength(2);
    expectOnScreen(at); // on screen at all is the bar at this size
  });

  it('centres on a single pin instead of fitting a box with no extent', () => {
    seed([lisbon]);
    render(<App />);

    const [at] = markerPositions();
    // A one-point fit would have zoomed to the tile maximum; a centre view puts
    // the pin in the middle of the viewport, which is hand-checkable.
    expect(at.x).toBeCloseTo(MAP_VIEWPORT.width / 2, 0);
    expect(at.y).toBeCloseTo(MAP_VIEWPORT.height / 2, 0);
    // Street level, read off the map: close enough to read the block.
    expect(renderedZoom()).toBe(15);
  });

  it('keeps the default view when there is nothing to fit', () => {
    seed([]);
    render(<App />);

    // With no pins there is nothing to read off the map, so ask it where a
    // click lands: still lower Manhattan, the view unit 1 shipped.
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'First Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(400, 300); // the centre of the viewport

    const [placed] = stored();
    expect(placed.lat).toBeCloseTo(40.7128, 1);
    expect(placed.lng).toBeCloseTo(-74.006, 1);
    expect(renderedZoom()).toBe(12); // ...at the zoom unit 1 shipped, too
  });

  // The other half of the bar: fit ON MOUNT ONLY. A map that re-fits whenever
  // the pins change would jump mid-edit, and placing a lead in another city
  // would rip the view away from the one you were writing notes on.
  it('never moves the map again once it has opened', () => {
    seed([lisbon, porto]);
    render(<App />);
    const before = markerPositions();
    expect(before).toHaveLength(2);

    // (1) Saving an edit must not move it.
    fireEvent.click(markers()[0]);
    fireEvent.change(notesBox(), { target: { value: 'Revisit in June.' } });
    save();
    expect(markerPositions()).toEqual(before);

    // (2) Nor may the map move when the pin list grows to somewhere far away:
    // another tab adds a lead in Reykjavík, the next save picks it up through
    // the read-modify-write, and a map that re-fits would leap 2,000km north
    // out of the notes being written. The new pin being off screen is correct
    // — it wasn't there when the view was chosen.
    seed([lisbon, porto, { ...porto, id: 'r', name: 'Reykjavík lead', lat: 64.1466, lng: -21.9426 }]);
    fireEvent.change(notesBox(), { target: { value: 'Revisit in June. Ask for Ana.' } });
    save();
    expect(markers()).toHaveLength(3);
    expect(markerPositions()).toEqual(expect.arrayContaining(before));

    // (3) Nor may placing a new lead re-fit the map to include it.
    // Exact name: Leaflet's own popup close button is "Close popup".
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Third Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(60, 80);

    expect(markers()).toHaveLength(4);
    // Order-independent: the two original pins are pixel-for-pixel where they
    // were, whatever order Leaflet keeps its markers in.
    expect(markerPositions()).toEqual(expect.arrayContaining(before));
  });
});

describe('App — export/import replaces the whole store', () => {
  const gamma: Pin = {
    id: 'g',
    name: 'Gamma Bistro',
    lat: 41.1456,
    lng: -8.6108,
    strength: 'weak',
    notes: 'From the imported file.',
  };
  const delta: Pin = {
    id: 'd',
    name: 'Delta Diner',
    lat: 38.7223,
    lng: -9.1393,
    strength: 'failed',
    notes: '',
  };

  // The unit's headline flow, end to end: pick a file, see the counts, confirm,
  // and the store — not just the screen — ends up holding exactly the file.
  it('replaces the store and the map with the confirmed import, and snapshots the old data', async () => {
    seed([alpha, beta]);
    render(<App />);
    expect(markers()).toHaveLength(2);

    selectFile(serializePins([gamma, delta]), 'backup.json');
    await waitFor(() =>
      expect(screen.getByText(/replace 2 saved leads with the 2 leads/i)).toBeTruthy(),
    );
    expect(screen.getByText(/backup\.json/)).toBeTruthy();

    // Nothing committed yet — picking and even seeing the confirmation must
    // not touch the store.
    expect(stored()).toEqual([alpha, beta]);

    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    // The store is what the file said, not a merge of old and new.
    expect(stored()).toEqual([gamma, delta]);
    expect(markers()).toHaveLength(2);

    // F1: the imported pins must be ON SCREEN without a reload — before the
    // fix, `initialView` stayed parked on the pre-import pins (alpha/beta,
    // ~NYC) and this import of Portuguese leads left every restored marker
    // thousands of pixels outside the viewport despite existing in the DOM.
    expect(
      markerPositions().every(
        ({ x, y }) => x >= 0 && x <= MAP_VIEWPORT.width && y >= 0 && y <= MAP_VIEWPORT.height,
      ),
    ).toBe(true);

    // The pre-import data must be recoverable, not merely gone — under its
    // own prefix, never CORRUPT_BACKUP_PREFIX: these bytes aren't corrupt.
    const backupKeys = storageKeys().filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX));
    expect(backupKeys).toHaveLength(1);
    expect(storageKeys().some((k) => k.startsWith(CORRUPT_BACKUP_PREFIX))).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(backupKeys[0]) as string)).toEqual([
      alpha,
      beta,
    ]);
    expect(screen.getByRole('status').textContent).toContain(backupKeys[0]);

    // The rendered markers really are the imported pins, not the pre-import
    // ones — click one and read its name back off the editor it opens.
    fireEvent.click(markers()[0]);
    const openedName = notesBox().closest('form')?.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    expect(['Gamma Bistro', 'Delta Diner']).toContain(openedName.value);
  });

  // F2: the confirmation and the post-import banner must name what's really
  // in storage, not this tab's `pins` state — reproduces the reviewer's
  // multi-tab probe: another tab wrote a third pin after this tab loaded.
  it('counts the confirmation and the banner from storage, not from this tab’s stale pins', async () => {
    seed([alpha]);
    render(<App />);

    // ...meanwhile, in another tab:
    seed([alpha, beta, { ...beta, id: 'c', name: 'Added elsewhere' }]);

    selectFile(serializePins([gamma]), 'backup.json');
    await waitFor(() =>
      expect(screen.getByText(/replace 3 saved leads with the 1 lead/i)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(stored()).toEqual([gamma]); // the write really did replace all 3, not 1
    expect(screen.getByRole('status').textContent).toMatch(/replacing 3 previously saved/i);
  });

  // F8: a success banner from an earlier import must not linger, contradicting
  // a later import that actually failed.
  it('clears a previous success banner when a later import fails', async () => {
    seed([alpha]);
    render(<App />);

    selectFile(serializePins([gamma]), 'ok.json');
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));
    expect(screen.getByRole('status').textContent).toMatch(/imported 1 lead/i);

    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((k, v) => {
      if (k === STORAGE_KEY) throw new Error('QuotaExceededError');
      realSetItem(k, v);
    });

    selectFile(serializePins([delta]), 'fails.json');
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t import/i);
  });

  // F9: an armed placement left over from before the import must not survive
  // it — otherwise the first click on the freshly restored map silently adds
  // a pin the user never meant to place there.
  it('disarms a pending placement on import, so the next click adds nothing', async () => {
    seed([alpha]);
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Half-typed lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    expect(document.querySelector('.map-pane')?.className).toContain('map-pane--armed');

    selectFile(serializePins([gamma]), 'backup.json');
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(document.querySelector('.map-pane')?.className).not.toContain('map-pane--armed');

    clickMapAt(30, 40);

    expect(stored()).toEqual([gamma]); // no phantom "Half-typed lead" pin
  });

  it('does not change the store when the pending import is cancelled', async () => {
    seed([alpha, beta]);
    render(<App />);

    selectFile(serializePins([gamma]));
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(stored()).toEqual([alpha, beta]);
    expect(markers()).toHaveLength(2);
    expect(storageKeys().some((k) => k.startsWith(CORRUPT_BACKUP_PREFIX))).toBe(false);
  });

  // A bad file must reject outright: no confirmation offered, store untouched.
  it('rejects an invalid file before any confirmation, leaving the store untouched', async () => {
    seed([alpha]);
    render(<App />);

    selectFile(JSON.stringify([{ id: 'x', name: 'y', lat: 0, lng: 0, strength: 'lukewarm' }]));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/invalid pin/i),
    );
    expect(screen.queryByRole('button', { name: /^replace$/i })).toBeNull();
    expect(stored()).toEqual([alpha]);
  });

  // An import can silently orphan whatever pin was open in the editor — the
  // replaced set may not contain it, or may contain a same-id record with
  // different data. The editor must not keep showing it as if nothing changed.
  it('closes an open editor on import, rather than editing a lead that may no longer match', async () => {
    seed([alpha, beta]);
    render(<App />);
    fireEvent.click(markers()[0]);
    expect(notesBox()).toBeTruthy();

    selectFile(serializePins([gamma, delta]));
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(screen.queryByPlaceholderText(/what happened on the visit/i)).toBeNull();
    expect(screen.getByRole('button', { name: /place on map/i })).toBeTruthy();
  });

  // The sharper version of the same guard: the imported file reuses the OPEN
  // pin's id but with different data (a plausible restore-from-backup shape).
  // PinEditor is keyed by `pin.id`, so on a same-id swap React would NOT
  // remount it if selection weren't explicitly cleared — the sidebar would
  // keep showing whatever the editor's own state already held, stale, while
  // the store underneath had moved on to different data under that id.
  it('closes the editor even when the imported file reuses the open pin’s id with different data', async () => {
    seed([alpha]);
    render(<App />);
    fireEvent.click(markers()[0]);
    expect(notesBox().value).toBe(alpha.notes);

    const restored: Pin = { ...alpha, name: 'Restored from backup', notes: 'From backup.' };
    selectFile(serializePins([restored]));
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(screen.queryByPlaceholderText(/what happened on the visit/i)).toBeNull();
    expect(screen.getByRole('button', { name: /place on map/i })).toBeTruthy();
  });

  // Export is read-only and must reflect what's actually in the store, not a
  // stale snapshot from first render — added here (rather than only at the
  // component level) because App is what supplies the `pins` prop.
  it('exports exactly the pins currently on the map', async () => {
    seed([alpha]);
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Fresh Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);
    expect(markers()).toHaveLength(2);

    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    fireEvent.click(screen.getByRole('button', { name: /export as json/i }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe(serializePins(stored()));
    createObjectURL.mockRestore();
  });
});
