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
import { DomUtil, TileLayer, type Map as LeafletMap } from 'leaflet';
import {
  STORAGE_KEY,
  CORRUPT_BACKUP_PREFIX,
  IMPORT_BACKUP_PREFIX,
  serializePins,
} from './storage/pinStore';
import * as fileHandleRegistry from './storage/fileHandleRegistry';
import { VIEW_STORAGE_KEY } from './storage/viewStore';
import { MAP_VIEWPORT, setMapViewport, resetMapViewport } from './test/setup';
import { fakeFileHandle, type FakeFileHandle } from './test/fakeFileHandle';
import type { Pin } from './domain/pin';

// Unit 6's own fileHandleRegistry.test.ts covers the real IndexedDB
// round-trip (against a structurally-cloneable stand-in — see that file for
// why a real FileSystemFileHandle-shaped fake, which has function
// properties, can't survive fake-indexeddb's clone). App doesn't care how
// recallFileHandle got its answer, only how it reacts to one, so mocking the
// module boundary here is the right layer for these tests, not a
// workaround.
vi.mock('./storage/fileHandleRegistry', () => ({
  recallFileHandle: vi.fn().mockResolvedValue(null),
  rememberFileHandle: vi.fn().mockResolvedValue(undefined),
  forgetFileHandle: vi.fn().mockResolvedValue(undefined),
}));

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

/**
 * Captures the live Leaflet map instance during `render(<App />)`, by
 * intercepting the one TileLayer every render creates and forwarding to its
 * real `onAdd` so tiles still mount exactly as they would otherwise. Lets a
 * test pan/zoom the actual map — not just read marker positions off it — to
 * prove a LATER action doesn't move it, which markerPositions() alone cannot:
 * that proves "is this pin on screen", not "did the map move".
 */
function captureLeafletMap(renderApp: () => void): LeafletMap {
  let captured: LeafletMap | undefined;
  const originalOnAdd = TileLayer.prototype.onAdd;
  const spy = vi
    .spyOn(TileLayer.prototype, 'onAdd')
    .mockImplementation(function (this: TileLayer, map: LeafletMap) {
      captured = map;
      originalOnAdd.call(this, map);
      return this;
    });
  renderApp();
  spy.mockRestore();
  if (!captured) throw new Error('TileLayer.onAdd was never called — is the map mounted?');
  return captured;
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

describe('App — deleting a pin', () => {
  function deleteFirstMarker() {
    fireEvent.click(markers()[0]);
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
  }

  // The unit's headline flow: delete requires its own confirmation (a single
  // click must not be enough), and once confirmed removes the pin from both
  // the map and localStorage, closing the now-pointless editor.
  it('removes the pin from the map and the store, and closes the editor', () => {
    seed([alpha, beta]);
    render(<App />);
    expect(markers()).toHaveLength(2);

    fireEvent.click(markers()[0]);
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    // Arming alone must not delete anything yet.
    expect(stored()).toHaveLength(2);
    expect(markers()).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));

    expect(markers()).toHaveLength(1);
    expect(stored().map((p) => p.id)).not.toContain('a');
    expect(stored()).toHaveLength(1);
    // Nothing left to edit: the sidebar falls back to the add-pin form.
    expect(screen.getByRole('button', { name: /place on map/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/what happened on the visit/i)).toBeNull();
  });

  it('does not delete when the confirmation is cancelled', () => {
    seed([alpha, beta]);
    render(<App />);

    fireEvent.click(markers()[0]);
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(stored()).toHaveLength(2);
    expect(markers()).toHaveLength(2);
    // The editor is still open on the pin that almost got deleted.
    expect(notesBox().value).toBe(alpha.notes);
  });

  // "Wants its own confirm/undo story" (docs/roadmap.md) — the other half of
  // that: a confirmed delete is recoverable in-session via Undo, restoring
  // the exact pin (id, position, strength, notes) rather than a new one.
  it('offers an Undo that restores the exact pin, byte-for-byte', () => {
    seed([alpha, beta]);
    render(<App />);

    deleteFirstMarker();
    expect(stored()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));

    expect(markers()).toHaveLength(2);
    expect(stored()).toEqual(expect.arrayContaining([alpha, beta]));
    expect(stored()).toHaveLength(2);
  });

  // F1: `pinToDelete` used to come from `pins` (React state, captured at load
  // or last save) instead of the same fresh re-read the write uses — so Undo
  // could restore an older copy of the deleted pin's notes than the one
  // actually just removed from storage. Reproduces the reviewer's probe: a
  // concurrent edit to the pin being deleted, then Undo, then assert the
  // restored notes are the NEWER text, not this tab's stale pre-edit copy.
  it('undoes onto the record actually in storage at delete time, not a stale copy', () => {
    seed([alpha, beta]);
    render(<App />);
    fireEvent.click(markers()[0]); // opens Alpha, capturing it into `pins` state

    // ...meanwhile, in another tab, someone writes notes on Alpha:
    const editedElsewhere: Pin = {
      ...alpha,
      notes: 'THREE PARAGRAPHS WRITTEN IN ANOTHER TAB.',
    };
    seed([editedElsewhere, beta]);

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    expect(stored()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));

    // Undo must restore what was actually just deleted from storage — the
    // other tab's edited version — not this tab's stale pre-edit copy.
    expect(stored().find((p) => p.id === 'a')?.notes).toBe(
      'THREE PARAGRAPHS WRITTEN IN ANOTHER TAB.',
    );
  });

  // Same multi-tab discipline as the existing add/edit guards (see "a stale
  // tab cannot delete pins" above): a delete must act on what's really in
  // storage right now, not this tab's possibly-stale `pins` state, so a
  // concurrent write from another tab survives it.
  it('does not clobber a pin another tab added since this one loaded', () => {
    seed([alpha]);
    render(<App />);
    fireEvent.click(markers()[0]);

    // ...meanwhile, in another tab:
    const fromOtherTab: Pin = { ...beta, id: 'c', name: 'Added in tab A' };
    seed([alpha, fromOtherTab]);

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));

    const after = stored();
    expect(after.map((p) => p.name)).toEqual(['Added in tab A']);
    expect(after).toHaveLength(1);
  });

  // The duplicate-id hazard: loadPins treats a store with two pins sharing an
  // id as corrupt (pinStore.ts), so undo must refuse to write one rather than
  // resurrect a deleted record on top of an id that's since reappeared —
  // e.g. another tab importing a backup taken before this delete.
  it('declines to undo if another pin has since reused the deleted id', () => {
    seed([alpha, beta]);
    render(<App />);

    deleteFirstMarker();
    expect(stored()).toHaveLength(1);

    const revived: Pin = { ...alpha, name: 'Revived Alpha' };
    seed([...stored(), revived]);

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t undo/i);
    // The other tab's record must not be clobbered by the stale undo data.
    expect(stored().find((p) => p.id === 'a')).toEqual(revived);
    expect(screen.queryByRole('button', { name: /^undo$/i })).toBeNull();
  });

  // F2: deleteInfo used to be cleared by handleSelectPin, handleMapClick and
  // handleSaveEdits, wiping the only undo for a destructive action on the
  // very next click — including a purely read-only one like "did I delete
  // the right lead?". None of those three actions can make the held pin
  // stale or collide with it, so Undo must survive all of them.
  it('keeps the Undo banner through selecting, adding, and editing other pins', () => {
    seed([alpha, beta]);
    render(<App />);

    deleteFirstMarker(); // deletes Alpha
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeTruthy();

    // Selecting the surviving pin is a read.
    fireEvent.click(markers()[0]); // the only marker left: Beta
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeTruthy();

    // Editing it doesn't touch Alpha's id.
    fireEvent.change(notesBox(), { target: { value: 'Edited after the delete.' } });
    save();
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeTruthy();

    // Nor does adding a fresh pin — it gets its own new random id.
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Gamma Diner' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(stored()).toHaveLength(3); // Beta (edited) + Gamma + restored Alpha
    expect(stored().map((p) => p.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  // A stale Undo must still not survive something that actually invalidates
  // it: a second delete replaces the pending record with the newer one — only
  // the single most recent delete can be undone, never a stack of them.
  it('replaces the pending Undo when a second pin is deleted', () => {
    seed([alpha, beta]);
    render(<App />);

    deleteFirstMarker(); // deletes Alpha
    deleteFirstMarker(); // deletes Beta, now the only remaining marker

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));

    // Beta comes back; Alpha does not — only the most recent delete undoes.
    expect(stored().map((p) => p.id)).toEqual(['b']);
  });

  // Import is a real invalidation, unlike select/add/edit above: the
  // pre-import store — and any pin it held, including one just deleted — is
  // gone, so an undo against it would be meaningless at best.
  it('clears the Undo banner when an import replaces the store', async () => {
    seed([alpha, beta]);
    render(<App />);

    deleteFirstMarker();
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeTruthy();

    selectFile(serializePins([beta]));
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(screen.queryByRole('button', { name: /^undo$/i })).toBeNull();
  });

  // F4: handleUndoDelete used to call storedPinsForWrite() outside its own
  // try, so a failed rescue (an unreadable store whose own corrupt-snapshot
  // also fails) threw uncaught instead of surfacing a banner — the Undo
  // button stayed on screen doing nothing, forever, with no explanation.
  it('surfaces a named error instead of throwing when Undo cannot read the store', () => {
    seed([alpha, beta]);
    render(<App />);
    deleteFirstMarker();
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeTruthy();

    // The store becomes unreadable before Undo is clicked...
    window.localStorage.setItem(STORAGE_KEY, 'not valid json');
    // ...and the rescue snapshot that would normally save it aside also fails.
    const realSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((k, v) => {
      if (k.startsWith(CORRUPT_BACKUP_PREFIX)) throw new Error('QuotaExceededError');
      realSetItem(k, v);
    });

    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t restore/i);
  });

  // F6: a delete attempted on a pin another tab already removed used to
  // report "it was not removed" — false, since the pin really is gone from
  // storage — and left a ghost marker on screen that every further delete
  // attempt on it would just repeat forever.
  it('fails loud and resyncs when the pin was already deleted elsewhere', () => {
    seed([alpha, beta]);
    render(<App />);
    fireEvent.click(markers()[0]); // opens Alpha

    // ...meanwhile, in another tab, Alpha is deleted:
    seed([beta]);

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/already deleted elsewhere/i);
    // The ghost marker is gone: this tab's view now matches storage.
    expect(markers()).toHaveLength(1);
    expect(stored()).toEqual([beta]);
    // Nothing left to show for a pin that no longer exists anywhere.
    expect(screen.getByRole('button', { name: /place on map/i })).toBeTruthy();
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

describe('App — persists the map view across reloads', () => {
  // The roadmap item this unit closes: a returning user wants the
  // neighbourhood they were just looking at, not to be zoomed back out to
  // every lead they've ever saved. Pan the REAL Leaflet map (not just change
  // React state) — the same technique the filter suite uses to prove the
  // opposite guarantee (never moved) — so this proves the actual view got
  // remembered, not merely that a prop was passed somewhere.
  it('opens on the last pan/zoom instead of re-fitting the pins', () => {
    seed([alpha, beta]); // near NYC — nowhere near where we're about to pan
    const map = captureLeafletMap(() => render(<App />));

    act(() => {
      map.setView([48.8566, 2.3522], 9); // Paris
    });

    cleanup(); // <- the page reload
    const reopened = captureLeafletMap(() => render(<App />));

    expect(reopened.getCenter().lat).toBeCloseTo(48.8566, 2);
    expect(reopened.getCenter().lng).toBeCloseTo(2.3522, 2);
    expect(reopened.getZoom()).toBe(9);
    // Panning is a view preference under its own key — the pins themselves,
    // in their own key, are untouched by it.
    expect(stored()).toEqual([alpha, beta]);
  });

  // Independent of pin count: the saved view answers "where was I looking",
  // not "what is there" — deleting every pin shouldn't discard an otherwise
  // good position, and there being nothing to fit is exactly when honoring it
  // matters most.
  it('honors the saved view even with zero pins', () => {
    seed([]);
    const map = captureLeafletMap(() => render(<App />));
    act(() => {
      map.setView([35.6762, 139.6503], 11); // Tokyo
    });

    cleanup();
    const reopened = captureLeafletMap(() => render(<App />));
    expect(reopened.getCenter().lat).toBeCloseTo(35.6762, 2);
    expect(reopened.getCenter().lng).toBeCloseTo(139.6503, 2);
    expect(reopened.getZoom()).toBe(11);
  });

  // Independent of pin-store health: a corrupt pins key blocks reading pins,
  // not the separate, unrelated view key — the two stores must not couple.
  it('honors the saved view even when the pin store itself is corrupt', () => {
    seed([alpha]);
    const map = captureLeafletMap(() => render(<App />));
    act(() => {
      map.setView([35.6762, 139.6503], 8); // Tokyo
    });

    cleanup();
    window.localStorage.setItem(STORAGE_KEY, '{not valid json');
    const reopened = captureLeafletMap(() => render(<App />));
    expect(reopened.getCenter().lat).toBeCloseTo(35.6762, 2);
    expect(reopened.getZoom()).toBe(8);
  });

  // A stray/corrupt view record must not crash the app — the same fail-soft
  // bar loadView's own unit tests hold it to (viewStore.test.ts), exercised
  // here through the real mount path instead of the pure function directly.
  it('falls back to fitting the pins when the saved view is corrupt', () => {
    seed([alpha]);
    window.localStorage.setItem(VIEW_STORAGE_KEY, '{not valid json');

    render(<App />);
    expect(markers()).toHaveLength(1);
    expect(renderedZoom()).toBe(15); // the single-pin fit, unaffected
  });

  // The defect this design exists to prevent: importing a wholly different
  // set of leads must not leave the NEXT reload honoring the pre-import
  // position over the newly-restored pins — the same failure shape as
  // docs/reviews/Unit 3 Section B - export-import JSON.md F1 ("a confirmed
  // import never moved the map"), recurring here for the reload right after.
  it('clears the saved view on import, so the next reload fits the NEW pins, not the old position', async () => {
    const lisbon: Pin = {
      id: 'l',
      name: 'Cervejaria Ramiro',
      lat: 38.7223,
      lng: -9.1393,
      strength: 'strong',
      notes: '',
    };
    seed([alpha, beta]); // NYC-area
    const map = captureLeafletMap(() => render(<App />));
    act(() => {
      map.setView([48.8566, 2.3522], 9); // Paris — nowhere near NYC or Lisbon
    });

    selectFile(serializePins([lisbon]), 'backup.json');
    await waitFor(() =>
      expect(screen.getByText(/replace 2 saved leads with the 1 lead/i)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    cleanup();
    const reopened = captureLeafletMap(() => render(<App />));
    // Fit to the single imported pin — centred on it at street level, NOT
    // still parked over Paris.
    expect(reopened.getCenter().lat).toBeCloseTo(38.7223, 2);
    expect(reopened.getCenter().lng).toBeCloseTo(-9.1393, 2);
    expect(reopened.getZoom()).toBe(15);
  });

  function allOnScreen(at: { x: number; y: number }[]): boolean {
    return at.every(
      ({ x, y }) => x >= 0 && x <= MAP_VIEWPORT.width && y >= 0 && y <= MAP_VIEWPORT.height,
    );
  }

  // F1 (docs/reviews/persist map view across reloads.md): a saved view always
  // wins over fitting the pins, by design — but before this fix, there was no
  // way back once that left every lead off screen. This reproduces the exact
  // trap (pan to the mid-Pacific, reload, get stranded) and then proves the
  // "Show all leads" escape hatch recovers from it, and that the recovery
  // itself survives a further reload — otherwise the stranded position would
  // simply come back the moment the page refreshes again.
  it('recovers from a stranded view via "Show all leads", and the recovery survives a reload', () => {
    seed([alpha, beta]); // NYC-area
    const map = captureLeafletMap(() => render(<App />));

    act(() => {
      map.setView([0, -150], 5); // mid-Pacific — nowhere near the seeded leads
      map.fire('dragend');
      map.fire('zoomend');
    });

    cleanup();
    render(<App />); // the reload that would otherwise strand the user here forever
    // Confirms the setup really does reproduce the trap before claiming to
    // have recovered from it.
    expect(allOnScreen(markerPositions())).toBe(false);
    expect(stored()).toEqual([alpha, beta]); // the leads themselves are untouched, just off screen

    fireEvent.click(screen.getByRole('button', { name: /show all leads/i }));
    expect(allOnScreen(markerPositions())).toBe(true);

    cleanup();
    render(<App />);
    expect(allOnScreen(markerPositions())).toBe(true);
  });

  // F2: Leaflet's map centre is NOT wrapped into [-180, 180] the way a click
  // is (ClickCapture above) — pan past the antimeridian and it keeps
  // accumulating past ±180, which loadView (rightly) rejects as out of
  // range. Before the fix this silently discarded the save: the stored
  // record failed validation and the next reload quietly fell back to
  // fitting the pins instead, with no error anywhere.
  it('wraps the centre before persisting, so a pan past the antimeridian survives a reload', () => {
    seed([alpha, beta]);
    const map = captureLeafletMap(() => render(<App />));

    act(() => {
      map.setView([40.71, -197.05], 3); // west of the antimeridian, unwrapped
      map.fire('dragend');
    });

    const view = JSON.parse(window.localStorage.getItem(VIEW_STORAGE_KEY) as string);
    expect(view.center[1]).toBeGreaterThanOrEqual(-180);
    expect(view.center[1]).toBeLessThanOrEqual(180);
    expect(view.center[1]).toBeCloseTo(162.95, 1); // -197.05 wrapped

    cleanup();
    const reopened = captureLeafletMap(() => render(<App />));
    expect(reopened.getCenter().lat).toBeCloseTo(40.71, 1);
    expect(reopened.getCenter().lng).toBeCloseTo(162.95, 1);
    expect(reopened.getZoom()).toBe(3);
  });

  // F3: `moveend` is not a proxy for user intent — Leaflet fires it for a
  // window resize too (trackResize -> invalidateSize), with no drag and no
  // zoom change. Before the fix, ViewPersister listened to moveend alone, so
  // an incidental resize (or an opened devtools pane) would silently freeze
  // the "no saved view yet, fit the pins" fallback on its very first trigger.
  // This reproduces that exact shape — a centre change with no zoom change
  // and no drag/zoom gesture — and confirms it is now ignored.
  it('does not persist a view from a bare view change with no drag or zoom gesture', () => {
    seed([alpha, beta]);
    const map = captureLeafletMap(() => render(<App />));
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull();

    act(() => {
      // Same shape a window resize produces: the view moves (moveend fires)
      // but nothing dragged and the zoom is unchanged.
      map.setView([10, 10], map.getZoom());
    });

    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull();
  });

  // F4: the reviewer's mutation (moveend -> zoomend) killed 0 of the unit's
  // own tests, because every one of them changed the zoom alongside the
  // centre. This isolates a PURE pan — centre changes, zoom does not — ended
  // by the real terminal event a mouse/touch drag fires (dragend), so a
  // regression that drops pan persistence (e.g. reverting to zoomend-only,
  // or back to unguarded moveend) fails this test specifically.
  it('persists a pure pan — centre changes, zoom does not — once the drag settles', () => {
    seed([alpha, beta]);
    const map = captureLeafletMap(() => render(<App />));
    const zoom = map.getZoom();

    act(() => {
      map.setView([10, 20], zoom); // centre only
      map.fire('dragend'); // the terminal event a real drag fires
    });

    cleanup();
    const reopened = captureLeafletMap(() => render(<App />));
    expect(reopened.getCenter().lat).toBeCloseTo(10, 2);
    expect(reopened.getCenter().lng).toBeCloseTo(20, 2);
    expect(reopened.getZoom()).toBe(zoom);
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

    // Unit 6: export re-reads the active backend rather than serializing
    // React state synchronously (F3), so the download now lands one tick
    // after the click.
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe(serializePins(stored()));
    createObjectURL.mockRestore();
  });
});

describe('App — filter/search narrows the map', () => {
  const gamma: Pin = {
    id: 'g',
    name: 'Gamma Tavern',
    lat: 40.73,
    lng: -74.03,
    strength: 'failed',
    notes: 'Great wine list, shame it closed.',
  };

  function strengthCheckbox(label: 'Strong' | 'Weak' | 'Failed') {
    return screen.getByRole('checkbox', { name: label });
  }
  function searchBox() {
    return screen.getByRole('searchbox', { name: /search leads/i });
  }

  // The core bar: unchecking a strength hides exactly those markers, and
  // leaves the stored pins and their count completely untouched — a filter
  // is a view, not a mutation.
  it('hides pins whose strength is deselected, without touching storage', () => {
    seed([alpha, beta, gamma]); // strong, weak, failed
    render(<App />);
    expect(markers()).toHaveLength(3);

    fireEvent.click(strengthCheckbox('Weak'));

    expect(markers()).toHaveLength(2);
    // Content, not just length: a mutation that silently narrowed the WRITE
    // (not just the render) to the visible subset would still pass a length
    // check here (docs/reviews/filter-search-leads.md F3).
    expect(stored()).toEqual([alpha, beta, gamma]);
    expect(screen.getByText(/showing 2 of 3 leads/i)).toBeTruthy();
  });

  // The reason search exists at all: finding a lead by what's written about
  // it, not only by its name.
  it('matches search text against notes as well as the name', () => {
    seed([alpha, beta, gamma]);
    render(<App />);

    fireEvent.change(searchBox(), { target: { value: 'wine' } });

    expect(markers()).toHaveLength(1); // only gamma mentions wine
    expect(stored()).toEqual([alpha, beta, gamma]); // content, not just length (F3)
  });

  // Strength and text must combine (AND), not each independently widen the
  // result — otherwise deselecting "failed" while searching "wine" would
  // still surface the failed-only match.
  it('combines the strength and text filters as AND', () => {
    seed([alpha, beta, gamma]); // gamma (failed) is the only "wine" match
    render(<App />);

    fireEvent.click(strengthCheckbox('Failed'));
    fireEvent.change(searchBox(), { target: { value: 'wine' } });

    expect(markers()).toHaveLength(0);
    expect(screen.getByText(/no leads match your filters/i)).toBeTruthy();
  });

  // Export is read-only over the filter too: a backup must be every saved
  // lead, not whatever happens to be on screen. Correct today, but was
  // unguarded — mutating the ImportExport `pins` prop to the filtered subset
  // passed the whole suite untouched (docs/reviews/filter-search-leads.md F4).
  it('exports every saved lead, not just the ones the current filter shows', async () => {
    seed([alpha, beta, gamma]);
    render(<App />);

    fireEvent.click(strengthCheckbox('Weak')); // narrows to 2 of 3 visible
    expect(markers()).toHaveLength(2);

    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    fireEvent.click(screen.getByRole('button', { name: /export as json/i }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe(serializePins([alpha, beta, gamma]));
    createObjectURL.mockRestore();
  });

  it('Clear filters restores every pin and the control disappears', () => {
    seed([alpha, beta, gamma]);
    render(<App />);

    fireEvent.click(strengthCheckbox('Weak'));
    fireEvent.change(searchBox(), { target: { value: 'zzz-no-match' } });
    expect(markers()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

    expect(markers()).toHaveLength(3);
    expect((searchBox() as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
    // Clear is a view reset, not a write: reproduces the reviewer's M12
    // mutation (savePins(storage, visiblePins) in handleClearFilter, which
    // would overwrite the store with an empty array while narrowed to zero
    // matches) — content equality catches it, toHaveLength(0) would not
    // (docs/reviews/filter-search-leads.md F3).
    expect(stored()).toEqual([alpha, beta, gamma]);
    // The unfiltered wording branch, otherwise untested (F5): a regression
    // that always renders the filtered copy would leave this reading "No
    // leads match your filters." even with every pin back on screen.
    expect(screen.getByText(/3 leads on the map/i)).toBeTruthy();
  });

  // Filtering hides a marker, but the pin is still the one open in the
  // editor — it must not be force-closed just because its own marker
  // disappeared, the same "read actions don't clobber other state" rule
  // Undo relies on (docs/reviews/Delete a pin.md F2).
  // The unit's headline safety claim — filtering never re-fits or moves the
  // map — had zero tests guarding it: a mutation that force-remounted the
  // map on every filter change passed the whole suite untouched. Pan+zoom
  // the REAL map first, so this proves the filter doesn't reset the view,
  // not merely that it happens to coincide with the mount-time fit
  // (docs/reviews/filter-search-leads.md F2).
  it('never moves or re-fits the map when a filter changes', () => {
    seed([alpha, beta, gamma]);
    const map = captureLeafletMap(() => render(<App />));

    act(() => {
      map.setView([48.8566, 2.3522], 9); // Paris — nowhere near the seeded pins
    });
    const center = map.getCenter();
    const zoom = map.getZoom();

    function expectUnmoved() {
      expect(map.getCenter().lat).toBeCloseTo(center.lat);
      expect(map.getCenter().lng).toBeCloseTo(center.lng);
      expect(map.getZoom()).toBe(zoom);
    }

    fireEvent.click(strengthCheckbox('Weak'));
    expectUnmoved();

    fireEvent.change(searchBox(), { target: { value: 'wine' } });
    expectUnmoved();

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expectUnmoved();
  });

  // F1: a pin placed while a filter is active used to save correctly but
  // render nothing — the store went 3→4, the sidebar said "4 leads", and no
  // marker existed for the just-placed lead. Reproduces the reviewer's probe:
  // filter to "not the strength you're about to place", place a lead, and
  // confirm it's actually visible rather than silently hidden by a filter
  // still in effect (docs/reviews/filter-search-leads.md F1).
  it('resets the filter rather than hide a lead just placed', () => {
    seed([alpha, beta, gamma]); // strong, weak, failed
    render(<App />);

    fireEvent.click(strengthCheckbox('Strong')); // hides alpha; 2 of 3 visible
    expect(markers()).toHaveLength(2);

    // The add form's strength defaults to 'strong' — exactly what's hidden.
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'New Strong Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);

    expect(stored()).toHaveLength(4);
    expect(markers()).toHaveLength(4); // the new lead is actually on screen
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
  });

  // Same hole, the edit path: saving a strength change into a bucket the
  // active filter has deselected used to leave the marker gone while the
  // editor stayed open on it, with nothing explaining why.
  it('resets the filter rather than hide the pin just edited into a deselected strength', () => {
    seed([alpha]); // strong
    render(<App />);
    fireEvent.click(markers()[0]);

    fireEvent.click(strengthCheckbox('Failed')); // alpha (strong) still visible
    expect(markers()).toHaveLength(1);

    fireEvent.change(
      screen
        .getByDisplayValue('Alpha Cafe')
        .parentElement!.parentElement!.querySelector('select')!,
      { target: { value: 'failed' } },
    );
    save();

    expect(stored()[0].strength).toBe('failed');
    expect(markers()).toHaveLength(1); // still visible, not hidden by "Failed" being off
    expect(screen.queryByRole('button', { name: /clear filters/i })).toBeNull();
  });

  it('does not close the open editor when a filter hides its own marker', () => {
    seed([alpha, beta]); // alpha = strong
    render(<App />);
    fireEvent.click(markers()[0]); // open alpha's editor
    expect(notesBox()).toBeTruthy();

    fireEvent.click(strengthCheckbox('Strong')); // hides alpha's marker

    expect(markers()).toHaveLength(1); // only beta left on the map
    expect(notesBox()).toBeTruthy(); // alpha's editor is still open
  });
});

describe('App — Unit 6: sync via a linked data file', () => {
  // `showOpenFilePicker`/`showSaveFilePicker` don't exist in jsdom by
  // default — every other test in this file runs with them absent, which is
  // exactly the "unsupported browser" case, already exercised end-to-end by
  // every one of the 40+ tests above passing untouched. These tests define
  // them explicitly to exercise the supported path.
  beforeEach(() => {
    window.showOpenFilePicker = vi.fn();
    window.showSaveFilePicker = vi.fn();
    // The outer afterEach's vi.restoreAllMocks() clears any mockResolvedValue
    // set on these between tests (there's no "original" implementation for a
    // vi.mock-factory function to restore to), so both are re-established
    // here rather than only where each test first needs a non-default answer.
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(null);
    vi.mocked(fileHandleRegistry.rememberFileHandle).mockResolvedValue(undefined);
    vi.mocked(fileHandleRegistry.forgetFileHandle).mockResolvedValue(undefined);
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  function mockOpenPicker(handle: FakeFileHandle) {
    window.showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
  }
  function mockSavePicker(handle: FakeFileHandle) {
    window.showSaveFilePicker = vi.fn().mockResolvedValue(handle);
  }

  const gamma: Pin = {
    id: 'g',
    name: 'Gamma Bistro',
    lat: 41.1456,
    lng: -8.6108,
    strength: 'weak',
    notes: 'From the linked file.',
  };

  it('shows an honest fallback and keeps working on localStorage when the API is unsupported', () => {
    Reflect.deleteProperty(window, 'showOpenFilePicker');
    Reflect.deleteProperty(window, 'showSaveFilePicker');
    seed([alpha]);
    render(<App />);

    expect(screen.getByText(/needs chrome or edge/i)).toBeTruthy();
    expect(markers()).toHaveLength(1); // the app still works, just on localStorage
  });

  // "If the chosen file is empty/new, seed it from whatever is currently in
  // localStorage" — nothing to validate or confirm, so no confirmation step.
  it('links a brand-new empty file by seeding it with the pins currently shown', async () => {
    seed([alpha, beta]);
    render(<App />);
    const handle = fakeFileHandle('');
    mockSavePicker(handle);

    fireEvent.click(screen.getByRole('button', { name: /create new file/i }));

    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    expect(JSON.parse(handle.committed)).toEqual([alpha, beta]);
    expect(screen.getByRole('status').textContent).toMatch(/seeded with your 2 existing leads/i);
    expect(stored()).toEqual([alpha, beta]); // the seed write never touches localStorage
  });

  // The other branch: an existing file's content is an import-replace of a
  // different medium, reusing parseImportPayload and the same confirm-first
  // shape Unit 3B's JSON import uses — never a silent replace.
  it('links an existing file behind a confirmation naming both counts, then routes every write to it', async () => {
    seed([alpha, beta]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]), { name: 'data/pins.json' });
    mockOpenPicker(handle);

    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/replacing 2 currently shown leads with the 1 lead/i),
      ).toBeTruthy(),
    );
    // Nothing committed yet — seeing the confirmation must not touch anything.
    expect(markers()).toHaveLength(2);
    expect(handle.committed).toBe(serializePins([gamma]));

    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));

    await waitFor(() => expect(markers()).toHaveLength(1));
    expect(screen.getByText(/linked to “data\/pins\.json”/i)).toBeTruthy();

    // The pre-link localStorage data was snapshotted, not silently discarded.
    const backupKeys = storageKeys().filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX));
    expect(backupKeys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(backupKeys[0]) as string)).toEqual([
      alpha,
      beta,
    ]);
    expect(stored()).toEqual([alpha, beta]); // localStorage's own key is untouched by the link

    // Now prove writes really go to the file: add a pin and check it lands
    // in the fake file's committed bytes, not localStorage.
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'New Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);

    await waitFor(() => expect(markers()).toHaveLength(2));
    const fileContent = JSON.parse(handle.committed) as Pin[];
    expect(fileContent.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Gamma Bistro', 'New Lead']),
    );
    expect(stored()).toEqual([alpha, beta]); // still untouched post-link
  });

  it('does not link when the pending confirmation is cancelled', async () => {
    seed([alpha, beta]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);

    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(markers()).toHaveLength(2);
    expect(screen.queryByText(/linked to/i)).toBeNull();
    expect(handle.committed).toBe(serializePins([gamma])); // never written to
  });

  it('does nothing and shows no error when the file picker is cancelled', async () => {
    seed([alpha]);
    render(<App />);
    window.showOpenFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));

    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));

    await waitFor(() => expect(window.showOpenFilePicker).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(markers()).toHaveLength(1);
  });

  // "An unreadable linked file — including one left mid-git-conflict — is
  // treated exactly like a corrupt localStorage read is today: backed up
  // aside, a named error banner, no data loss, no crash." Exercised via
  // reconnect (permission already granted from a past session), which is
  // where an already-adopted file's content genuinely needs this recovery —
  // see the decision log for why a corrupt file offered at FIRST link
  // instead just rejects the link attempt outright, leaving localStorage
  // untouched, rather than "backing up" a file that was never adopted.
  it('backs up an unreadable linked file the same way a corrupt localStorage read is handled', async () => {
    seed([alpha]);
    const conflicted =
      '<<<<<<< HEAD\n[]\n=======\n[{"id":"1","name":"x"}]\n>>>>>>> branch';
    const handle = fakeFileHandle(conflicted, { permission: 'granted' });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t read saved pins/i),
    );
    expect(markers()).toHaveLength(0); // the linked file (empty/unreadable), not localStorage's alpha
    const backupKeys = storageKeys().filter((k) => k.startsWith(CORRUPT_BACKUP_PREFIX));
    expect(backupKeys).toHaveLength(1);
    expect(window.localStorage.getItem(backupKeys[0])).toBe(conflicted);
  });

  // "The link persists across reloads... reconnecting needs at most one
  // permission-confirmation click per session."
  it('shows a Reconnect control for a remembered handle needing permission, and adopts it on click', async () => {
    seed([alpha]);
    const fromFile: Pin = {
      id: 'f',
      name: 'From File',
      lat: 10,
      lng: 10,
      strength: 'strong',
      notes: '',
    };
    const handle = fakeFileHandle(serializePins([fromFile]), {
      permission: 'prompt',
      requestResult: 'granted',
    });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/this browser was linked to “pins\.json”/i)).toBeTruthy(),
    );
    // Still showing localStorage's pin until an explicit reconnect click —
    // permission is never auto-requested without a user gesture.
    fireEvent.click(markers()[0]);
    expect(screen.getByDisplayValue('Alpha Cafe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^reconnect$/i }));

    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    fireEvent.click(markers()[0]);
    expect(screen.getByDisplayValue('From File')).toBeTruthy();
  });

  it('surfaces a named error and keeps the Reconnect control when permission is refused', async () => {
    seed([alpha]);
    const handle = fakeFileHandle('[]', { permission: 'prompt', requestResult: 'denied' });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^reconnect$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/not granted/i),
    );
    expect(markers()).toHaveLength(1); // still on localStorage
    expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeTruthy(); // can retry
  });

  // A remembered handle hides the choose/create controls until it
  // reconnects, so a file that was renamed, deleted, or is simply the wrong
  // one now strands the user on a button that can only fail — with no in-app
  // way to link a different file. Confirmed by hand in Chrome on 2026-08-10:
  // clearing site data in DevTools was the only escape (see
  // docs/progress_log.md for exactly what that session did and didn't
  // establish).
  it('lets a stale remembered handle be forgotten, restoring the choose/create controls', async () => {
    seed([alpha]);
    const handle = fakeFileHandle('[]', { permission: 'prompt', requestResult: 'denied' });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /forget this file/i })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /forget this file/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose existing file/i })).toBeTruthy(),
    );
    expect(fileHandleRegistry.forgetFileHandle).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^reconnect$/i })).toBeNull();
    expect(markers()).toHaveLength(1); // localStorage's pin, still readable
  });

  // Review F4: in the reconnect state nothing was ever adopted — the app is
  // already on localStorage, already showing its pins — so forgetting is
  // bookkeeping, not a store replace. Running the linked-state ceremony here
  // remounts the map (yanking the view away with no data reason) and closes
  // the editor, discarding an unsaved notes draft, for a button labelled
  // "Forget this *file*". The open editor is the assertion with teeth: it
  // survives only if the ceremony is skipped.
  it('forgetting a never-adopted handle leaves the map and an open editor alone', async () => {
    seed([alpha]);
    const handle = fakeFileHandle('[]', { permission: 'prompt', requestResult: 'denied' });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /forget this file/i })).toBeTruthy(),
    );
    // Open the editor and type a note the user has NOT saved yet.
    fireEvent.click(markers()[0]);
    const notes = screen.getByPlaceholderText(/what happened on the visit/i);
    fireEvent.change(notes, { target: { value: 'half-typed thought' } });

    fireEvent.click(screen.getByRole('button', { name: /forget this file/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose existing file/i })).toBeTruthy(),
    );
    expect(screen.getByDisplayValue('half-typed thought')).toBeTruthy();
  });

  // Review F2: the UI switches to choose/create whether or not the delete
  // succeeded, so a swallowed rejection makes the app *assert* the handle is
  // forgotten while the next reload strands the user on Reconnect again —
  // the exact state they used DevTools to escape — with nothing said.
  it('reports a failed forget instead of claiming the handle was forgotten', async () => {
    seed([alpha]);
    const handle = fakeFileHandle('[]', { permission: 'prompt', requestResult: 'denied' });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);
    vi.mocked(fileHandleRegistry.forgetFileHandle).mockRejectedValue(
      new Error('IndexedDB unavailable'),
    );

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /forget this file/i })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /forget this file/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn’t forget it/i);
    expect(alert.textContent).toMatch(/may reappear/i);
    expect(alert.textContent).toMatch(/IndexedDB unavailable/);
  });

  // Review F1: the permission prompt is browser chrome and the page stays
  // interactive underneath it, so Forget is clickable while it's open. If the
  // grant then lands, an unguarded handleReconnect adopts the handle the user
  // just abandoned — whose IndexedDB record is already deleted — so every pin
  // written afterwards goes to a file the next reload will not reopen.
  it('a permission grant landing after Forget does not re-link the abandoned file', async () => {
    seed([alpha]);
    const fromFile: Pin = {
      id: 'f',
      name: 'From File',
      lat: 10,
      lng: 10,
      strength: 'strong',
      notes: '',
    };
    const handle = fakeFileHandle(serializePins([fromFile]), { permission: 'prompt' });
    // Hand-controlled prompt: resolves only when the test says so, modelling
    // a bubble the user leaves open while clicking elsewhere on the page.
    let grantPrompt!: () => void;
    handle.requestPermission = () =>
      new Promise<PermissionState>((resolve) => {
        grantPrompt = () => resolve('granted');
      });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^reconnect$/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /waiting for permission/i })).toBeTruthy(),
    );
    // The escape hatch stays clickable while the prompt is open — deliberately
    // not disabled alongside Reconnect, or abandoning a stuck prompt would be
    // impossible for as long as it hangs.
    fireEvent.click(screen.getByRole('button', { name: /forget this file/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose existing file/i })).toBeTruthy(),
    );

    grantPrompt();
    await waitFor(() => expect(fileHandleRegistry.forgetFileHandle).toHaveBeenCalled());

    // Still unlinked, still on localStorage — the late grant changed nothing.
    expect(screen.getByRole('button', { name: /choose existing file/i })).toBeTruthy();
    expect(screen.queryByText(/linked to “pins\.json”/i)).toBeNull();
    expect(markers()).toHaveLength(1);
    fireEvent.click(markers()[0]);
    expect(screen.getByDisplayValue('Alpha Cafe')).toBeTruthy();
  });

  // Review F3: `file-unreadable`'s banner ends "use Reconnect below to try
  // the file again" — a control Forget removes. Left standing it reports an
  // active linked-file problem on an app that is now correctly running on
  // browser storage, pointing at a button that no longer exists.
  it('clears a file-origin error banner when the file is forgotten', async () => {
    seed([alpha]);
    const handle = fakeFileHandle('[]', { permission: 'granted' });
    handle.getFile = () => Promise.reject(new Error('NotFoundError'));
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/use reconnect below/i),
    );

    fireEvent.click(screen.getByRole('button', { name: /forget this file/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose existing file/i })).toBeTruthy(),
    );
    expect(screen.queryByText(/use reconnect below/i)).toBeNull();
    expect(markers()).toHaveLength(1); // localStorage, still active and readable
  });

  // The link works for this session either way, so this is a warning rather
  // than an abort — but it must not be the silent `.catch(() => {})` it was:
  // the sidebar otherwise promises "every read and write goes through this
  // file" while the link is one reload from evaporating with no explanation.
  it('warns, rather than silently swallowing, when the handle cannot be remembered for next session', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle('');
    mockSavePicker(handle);
    vi.mocked(fileHandleRegistry.rememberFileHandle).mockRejectedValue(
      new Error('IndexedDB unavailable'),
    );

    fireEvent.click(screen.getByRole('button', { name: /create new file/i }));

    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn’t remember it for next time/i);
    expect(alert.textContent).toMatch(/IndexedDB unavailable/);
    // The link itself still took effect — the warning is not a rollback.
    expect(JSON.parse(handle.committed)).toEqual([alpha]);
  });

  // Review F6: the warning above covers only the create-new/empty-file
  // branch. Linking an existing file goes through handleConfirmFileLink,
  // which has its own rememberLink call site and its own ordering — an
  // untested second path where the same silence could return.
  it('warns about an unrememberable handle on the existing-file link path too', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);
    vi.mocked(fileHandleRegistry.rememberFileHandle).mockRejectedValue(
      new Error('IndexedDB unavailable'),
    );

    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /link file/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /link file/i }));

    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn’t remember it for next time/i);
    expect(alert.textContent).toMatch(/IndexedDB unavailable/);
  });

  // A hard read failure on an ALREADY-linked file (permission revoked, the
  // file moved or was deleted mid-session) is deliberately NOT the same as a
  // denied reconnect at startup: there's no safe automatic fallback to
  // localStorage here, because the user believes writes are going to the
  // file, and silently rerouting one write to a different backend than the
  // one they think is active would be a worse surprise than a refused write.
  // The write must be refused with a named error and must not silently
  // succeed against a treated-as-empty file, which would look like data loss.
  it('refuses a write and names the failure, rather than silently switching backends, when the linked file becomes unreadable mid-session', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());

    // Simulate permission being revoked (or the file being moved/deleted)
    // between linking and the next write.
    handle.getFile = () => Promise.reject(new Error('NotAllowedError'));

    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Should Not Save' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/could not read the linked file/i),
    );
    expect(markers()).toHaveLength(1); // the new pin was not added
    expect(stored()).toEqual([alpha]); // and localStorage was never silently used instead
  });

  // F7 (docs/reviews/Unit 6 - git syncable storage.md): only "add" had
  // coverage against a linked file before this — edit, delete, and undo were
  // exercised only against localStorage.
  it('routes edit, delete, and undo through the linked file too, never touching localStorage', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    expect(markers()).toHaveLength(1);

    // Edit.
    fireEvent.click(markers()[0]);
    fireEvent.change(notesBox(), { target: { value: 'Edited via the linked file.' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect((JSON.parse(handle.committed) as Pin[])[0].notes).toBe(
        'Edited via the linked file.',
      ),
    );
    expect(stored()).toEqual([alpha]); // localStorage untouched throughout

    // Delete (two clicks: arm, then confirm).
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    await waitFor(() => expect(markers()).toHaveLength(0));
    expect(JSON.parse(handle.committed)).toEqual([]);
    expect(stored()).toEqual([alpha]);

    // Undo.
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    await waitFor(() => expect(markers()).toHaveLength(1));
    const restored = JSON.parse(handle.committed) as Pin[];
    expect(restored[0].notes).toBe('Edited via the linked file.');
    expect(stored()).toEqual([alpha]);
  });

  // F1: a hard read failure on the linked file during an import-replace must
  // hard-abort — no write, no false "nothing was saved before this import"
  // claim — the same way a failed backupBeforeImport aborts the localStorage
  // path. Before the fix this destroyed the file's contents with no
  // snapshot while telling the user nothing was lost.
  it('refuses to import over a linked file it cannot read, rather than destroying it with no backup', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([beta]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    const linkedRaw = handle.committed;
    // Linking itself already snapshotted the pre-link localStorage content —
    // capture that count so the assertion below is about whether the FAILED
    // import added a NEW backup, not about there being zero total.
    const backupKeysBeforeImport = storageKeys().filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX));

    handle.getFile = () => Promise.reject(new Error('NotReadableError'));

    selectFile(serializePins([gamma]), 'incoming.json');
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/could not read the linked file/i),
    );
    expect(handle.committed).toBe(linkedRaw); // the file was NOT overwritten
    expect(screen.queryByText(/nothing was saved before this import/i)).toBeNull();
    const backupKeysAfterImport = storageKeys().filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX));
    expect(backupKeysAfterImport).toEqual(backupKeysBeforeImport); // no new snapshot from a failed read
  });

  // F1's positive twin: a successful import-replace against a linked file
  // DOES snapshot the file's previous content before overwriting it.
  it('backs up the linked file’s previous content before a confirmed import replaces it', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([beta]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    // Linking itself already snapshotted localStorage's pre-link content
    // under this same prefix — isolate the NEW key the import adds.
    const backupKeysBeforeImport = storageKeys().filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX));

    selectFile(serializePins([gamma]), 'incoming.json');
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    await waitFor(() => expect(JSON.parse(handle.committed)).toEqual([gamma]));
    const newBackupKeys = storageKeys()
      .filter((k) => k.startsWith(IMPORT_BACKUP_PREFIX))
      .filter((k) => !backupKeysBeforeImport.includes(k));
    expect(newBackupKeys).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(newBackupKeys[0]) as string)).toEqual([beta]);
    expect(stored()).toEqual([alpha]); // localStorage's own key, untouched by the linked import
  });

  // F2: a remembered handle whose permission is still granted but whose file
  // can no longer be read (moved, deleted, a repo re-cloned elsewhere) must
  // NOT be adopted — adopting it used to hide every localStorage pin behind
  // an empty, unusable, un-escapable "linked" state.
  it('does not adopt a remembered file it cannot read at startup, and keeps localStorage active', async () => {
    seed([alpha]);
    const handle = fakeFileHandle(serializePins([gamma]), { permission: 'granted' });
    handle.getFile = () => Promise.reject(new Error('NotFoundError'));
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t read the linked file/i),
    );
    expect(markers()).toHaveLength(1); // localStorage's alpha, not hidden
    // Not adopted as the active backend — "This browser WAS linked to..."
    // (the Reconnect prompt) is expected and asserted below; the distinct
    // "Linked to X. Every read and write goes through this file" status line
    // must NOT be showing, since nothing was actually adopted.
    expect(screen.queryByText(/every read and write goes through this file/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^reconnect$/i })).toBeTruthy(); // escapable

    // And localStorage is genuinely still the active backend, not a refused one.
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Still Works' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);
    expect(markers()).toHaveLength(2);
    expect(stored().map((p) => p.name)).toContain('Still Works');
  });

  // F3: export must read the linked file fresh, not serialize stale React
  // state — a linked file expects an external writer (`git pull`), so
  // exporting `pins` could silently omit everything pulled since the tab
  // opened.
  it('exports the linked file’s current content, including a change made outside the app', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());

    // Simulate an external `git pull` changing the file after the tab opened
    // — React state (`pins`) still only knows about gamma.
    const pulled = serializePins([gamma, { ...beta, id: 'pulled' }]);
    handle.getFile = async () => new File([pulled], 'pins.json', { type: 'application/json' });

    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    fireEvent.click(screen.getByRole('button', { name: /export as json/i }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toBe(pulled);
    createObjectURL.mockRestore();
  });

  it('shows a named error and downloads nothing when the linked file can’t be read at export time', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());

    handle.getFile = () => Promise.reject(new Error('NotReadableError'));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');

    fireEvent.click(screen.getByRole('button', { name: /export as json/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t export/i),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    createObjectURL.mockRestore();
  });

  // F9: with BOTH localStorage and the linked file corrupt in the same
  // session, the banner must name the key that actually matches its own
  // message — not whichever ref happened to be set first.
  it('pairs the load-error banner with the backup key for whichever backend actually failed', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');
    const conflicted = '<<<<<<< HEAD\n[]\n=======\n[{"id":"1"}]\n>>>>>>> branch';
    const handle = fakeFileHandle(conflicted, { permission: 'granted' });
    vi.mocked(fileHandleRegistry.recallFileHandle).mockResolvedValue(handle);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());

    // Both backends really did back their own corrupt bytes up in this
    // session — both under the same CORRUPT_BACKUP_PREFIX (they're
    // distinguished only by timestamp, not by which backend they came from).
    const corruptKeys = storageKeys().filter((k) => k.startsWith(CORRUPT_BACKUP_PREFIX));
    expect(corruptKeys).toHaveLength(2);
    const fileBackupKey = corruptKeys.find(
      (k) => window.localStorage.getItem(k) === conflicted,
    );
    expect(fileBackupKey).toBeDefined();

    // The file is what actually ended up live (it was adopted last, and its
    // content is what the current banner message is about) — the banner
    // must name ITS key, not localStorage's earlier one.
    const banner = screen.getByRole('alert').textContent ?? '';
    expect(banner).toContain(fileBackupKey as string);
  });

  // F8: once linked, Unlink is the only in-app way back to localStorage.
  it('forgets the link on Unlink and falls back to localStorage’s own content', async () => {
    seed([alpha]);
    render(<App />);
    const handle = fakeFileHandle(serializePins([gamma]));
    mockOpenPicker(handle);
    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    await waitFor(() => screen.getByRole('button', { name: /^link file$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^link file$/i }));
    await waitFor(() => expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy());
    expect(markers()).toHaveLength(1); // gamma, from the file

    fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }));

    await waitFor(() => expect(markers()).toHaveLength(1));
    expect(screen.queryByText(/linked to/i)).toBeNull();
    expect(screen.getByRole('button', { name: /choose existing file/i })).toBeTruthy();
    fireEvent.click(markers()[0]);
    expect(screen.getByDisplayValue('Alpha Cafe')).toBeTruthy(); // back to localStorage's alpha

    // And a subsequent write goes to localStorage again, not the (now
    // forgotten) file.
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Post-Unlink' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);
    expect(stored().map((p) => p.name)).toContain('Post-Unlink');
    expect(JSON.parse(handle.committed).map((p: Pin) => p.name)).not.toContain('Post-Unlink');
  });
});

// F13 (docs/reviews/Unit 6 - git syncable storage.md): every write handler
// is declared `async` so it can also serve a linked file, on the bet that
// the localStorage (`else`) branch never contains an executed `await` — see
// the decision log's Assumption 1. Dozens of tests above incidentally depend
// on that (a synchronous `expect(stored())` right after `fireEvent.click`,
// no `await`/`waitFor`), but the invariant itself had no explicit, named
// guard — only a comment (`.claude/rules/00-process.md`: "prose is not
// mechanism"). This test exists so a future `await` accidentally added to
// that branch fails loudly and specifically, not just as noise somewhere in
// the suite.
describe('App — the localStorage write path stays synchronous (Unit 6 Assumption 1)', () => {
  it('commits an add to localStorage before the click handler yields, with no await/waitFor', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Sync Check' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    clickMapAt(30, 40);

    // No await/waitFor above this line: if a future edit adds an executed
    // `await` to handleMapClick's localStorage branch, the write would not
    // have landed yet here and this assertion would fail.
    expect(stored().map((p) => p.name)).toEqual(['Sync Check']);
    expect(markers()).toHaveLength(1);
  });
});

describe('App — multi-view navigation (List view)', () => {
  const gamma: Pin = {
    id: 'g',
    name: 'Gamma Tavern',
    lat: 40.73,
    lng: -74.03,
    strength: 'failed',
    notes: 'Great wine list, shame it closed.',
  };

  function switchTo(view: 'Map' | 'List') {
    fireEvent.click(screen.getByRole('button', { name: view }));
  }
  function listRows(): HTMLElement[] {
    return Array.from(document.querySelectorAll('.pin-list__row'));
  }

  // The headline safety claim: List is layered on top of the map, not
  // swapped in for it, so a mid-session pan survives a round trip through
  // List and back — the same DOM node proves MapView itself never unmounted
  // (a remount would create a brand new Leaflet container and re-fit/re-open
  // on the persisted view, silently discarding wherever the user had panned
  // to). Same `captureLeafletMap` + real `setView` technique the filter
  // suite's "never moves or re-fits the map" test uses.
  it('layers List over the map without ever unmounting it, so a pan survives the round trip', () => {
    seed([alpha, beta]);
    const map = captureLeafletMap(() => render(<App />));
    expect(markers()).toHaveLength(2);
    expect(document.querySelector('.pin-list')).toBeNull();
    const mapNode = document.querySelector('.leaflet-container');

    act(() => {
      map.setView([48.8566, 2.3522], 9); // Paris — nowhere near the seeded pins
    });
    const center = map.getCenter();
    const zoom = map.getZoom();

    switchTo('List');
    expect(listRows()).toHaveLength(2);
    // The map's wrapper is still in the DOM (never unmounted) but out of the
    // accessibility tree while covered.
    expect(document.querySelector('.map-pane__map')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(document.querySelector('.leaflet-container')).toBe(mapNode);

    switchTo('Map');
    expect(document.querySelector('.pin-list')).toBeNull();
    expect(document.querySelector('.map-pane__map')?.getAttribute('aria-hidden')).toBe(
      'false',
    );
    // Same node — not a fresh MapContainer — and the pan is exactly as left.
    expect(document.querySelector('.leaflet-container')).toBe(mapNode);
    expect(map.getCenter().lat).toBeCloseTo(center.lat);
    expect(map.getCenter().lng).toBeCloseTo(center.lng);
    expect(map.getZoom()).toBe(zoom);
  });

  // Same AND semantics, same "Showing N of M" wording as the map (Unit 7's
  // "Done when"): List is read over the same `visiblePins` MapView gets, not
  // a second, independently-filtered copy of the pins.
  it('respects the active filter/search exactly as the map does', () => {
    seed([alpha, beta, gamma]); // strong, weak, failed
    render(<App />);
    switchTo('List');
    expect(listRows()).toHaveLength(3);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Weak' }));
    expect(listRows()).toHaveLength(2);
    expect(screen.getByText(/showing 2 of 3 leads/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Weak' })); // back to all 3
    fireEvent.change(screen.getByRole('searchbox', { name: /search leads/i }), {
      target: { value: 'wine' },
    });
    expect(listRows()).toHaveLength(1); // only gamma mentions wine
    expect(listRows()[0].textContent).toContain('Gamma Tavern');
  });

  // Nothing pin-specific is duplicated for the list: clicking a row routes
  // through the exact same handleSelectPin the map's markers use, opening
  // the exact same PinEditor.
  it('clicking a row opens the same PinEditor the map uses, seeded from the clicked pin', () => {
    seed([alpha, beta]);
    render(<App />);
    switchTo('List');

    fireEvent.click(screen.getByText('Beta Grill'));

    expect(screen.getByDisplayValue('Beta Grill')).toBeTruthy();
    expect(notesBox().value).toBe(beta.notes);
  });

  it('keeps the selected pin’s editor open across a view switch either way', () => {
    seed([alpha, beta]);
    render(<App />);
    fireEvent.click(markers()[0]); // select alpha via the map
    expect(screen.getByDisplayValue('Alpha Cafe')).toBeTruthy();

    switchTo('List');
    expect(screen.getByDisplayValue('Alpha Cafe')).toBeTruthy(); // same pin, still open

    switchTo('Map');
    expect(screen.getByDisplayValue('Alpha Cafe')).toBeTruthy();
  });

  // Pure UI/read state, per Unit 7's "Done when": switching views must not
  // write to storage or disturb a placement the user is mid-way through
  // arming.
  it('switching views touches neither storage nor an in-progress add-pin draft', () => {
    seed([alpha, beta]);
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Third Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    expect(screen.getByText(/click the map to place/i)).toBeTruthy();
    const before = stored();

    switchTo('List');
    switchTo('Map');

    expect(screen.getByText(/click the map to place “third lead”/i)).toBeTruthy();
    expect(stored()).toEqual(before);
  });

  // Regression (docs/reviews/unit 7.md F1): "Show all leads" re-fits and
  // force-remounts the map, but that entire effect used to be invisible from
  // List, where nothing on screen changes — a filtered-list user could
  // silently discard a saved pan with the button they'd click expecting
  // "clear the filter". It must switch to Map so its effect is observable.
  it('"Show all leads" switches to Map view, so its effect is actually visible from List', () => {
    seed([alpha, beta]);
    window.localStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({ center: [0, -150], zoom: 5 }), // mid-Pacific, nowhere near the seeded leads
    );
    render(<App />);
    switchTo('List');
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: /show all leads/i }));

    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(document.querySelector('.pin-list')).toBeNull();
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull(); // the stranded view really was cleared
  });

  // Regression (docs/reviews/unit 7.md F2): "placement is Map-only" was
  // enforced only by the opaque `.list-pane` covering the map — true in a
  // real browser, invisible to jsdom (which does no layout/paint), so this
  // test could never fail if that CSS ever regressed. `handleMapClick` now
  // checks `activeView` itself, so this is a real guard, not just a
  // stylesheet.
  it('does not place a pin when the covered map is clicked while List is showing', () => {
    seed([]);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText(/joe's diner/i), {
      target: { value: 'Ghost Lead' },
    });
    fireEvent.click(screen.getByRole('button', { name: /place on map/i }));
    switchTo('List');

    clickMapAt(400, 300); // dispatched straight at .leaflet-container, bypassing the CSS cover

    expect(stored()).toEqual([]);
    expect(listRows()).toHaveLength(0);
  });

  // Regression (docs/reviews/unit 7.md F4): aria-hidden alone still left the
  // covered map's Leaflet controls/markers tabbable — a keyboard user could
  // reach and activate them invisibly, including a zoom button that silently
  // rewrites the persisted map view. `inert` (toggled via a ref effect, since
  // React 18 has no inert JSX prop) blocks that.
  it('makes the covered map inert while List is showing, and interactive again back on Map', () => {
    seed([alpha, beta]);
    render(<App />);
    const wrapper = () => document.querySelector('.map-pane__map') as HTMLElement;
    expect(wrapper().hasAttribute('inert')).toBe(false);

    switchTo('List');
    expect(wrapper().hasAttribute('inert')).toBe(true);

    switchTo('Map');
    expect(wrapper().hasAttribute('inert')).toBe(false);
  });
});
