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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { STORAGE_KEY, CORRUPT_BACKUP_PREFIX } from './storage/pinStore';
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
function notesBox() {
  return screen.getByPlaceholderText(/what happened on the visit/i) as HTMLTextAreaElement;
}
function save() {
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

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
    act(() => {
      document
        .querySelector('.leaflet-container')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 40 }));
    });

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
    act(() => {
      document
        .querySelector('.leaflet-container')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 40 }));
    });

    expect(stored().map((p) => p.name)).toEqual(['Fresh Start']);
    expect(window.localStorage.getItem(backupKeys[0])).toBe(raw); // still recoverable
  });
});
