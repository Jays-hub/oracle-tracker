import { useEffect, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { AddPinForm } from './components/AddPinForm';
import { PinEditor } from './components/PinEditor';
import { Legend } from './components/Legend';
import { createPin, replacePin, updatePin, type Pin } from './domain/pin';
import { type LeadStrength } from './domain/leadStrength';
import { initialViewForPins, type InitialView } from './domain/mapFit';
import { backupCorruptStore, loadPins, savePins } from './storage/pinStore';

const storage: Storage = window.localStorage;

export default function App() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Where the map opens. Written exactly once, by the mount effect below, from
  // the pins the app started with — never derived from `pins`, which changes on
  // every save. `null` means "the store hasn't been read yet", and the map is
  // not mounted until it has, so Leaflet is created already knowing what it has
  // to show. See MapView for why that makes the fit a one-time event.
  const [initialView, setInitialView] = useState<InitialView | null>(null);

  // Draft state for the add-a-pin flow.
  const [name, setName] = useState('');
  const [strength, setStrength] = useState<LeadStrength>('strong');
  const [armed, setArmed] = useState(false);

  // Which pin the editor is open on. Selection is derived by id, never by
  // holding a copy of the pin: after a save the editor always reads the pin
  // that is actually in state (and therefore in storage), never a stale one.
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null;

  // Set once we've snapshotted an unreadable store, so we snapshot it once per
  // session instead of on every write attempt.
  const corruptBackupRef = useRef<string | null>(null);

  // Load once on mount. On a corrupt store we surface the error and start with
  // an empty in-memory list, but we DON'T save over the stored bytes — the raw
  // data stays intact for recovery, so a bad read can never silently drop pins.
  useEffect(() => {
    let loaded: Pin[] = [];
    try {
      loaded = loadPins(storage);
      setPins(loaded);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      // Snapshot the unreadable bytes NOW, while they still exist. Without
      // this, the map is empty, the only available action is "add a pin", and
      // that single click would overwrite every unrecoverable note in the store.
      try {
        corruptBackupRef.current = backupCorruptStore(storage);
      } catch (backupError) {
        setSaveError(
          `Couldn’t back up the unreadable saved data: ${
            backupError instanceof Error ? backupError.message : String(backupError)
          }. Adding or editing pins is blocked until that succeeds, so the raw data can’t be overwritten.`,
        );
      }
    }
    // Both paths, once: an unreadable store shows no pins, and the default view
    // is exactly right for that. Set last so the map mounts knowing the pins.
    setInitialView(initialViewForPins(loaded));
  }, []);

  /**
   * The stored list, re-read immediately before every write.
   *
   * Writing `[...pins]` from React state would rewrite the whole key from a
   * list captured at load time — a second tab (or any long-lived stale state)
   * would then delete every pin added since, while the UI reported "Saved.".
   * Re-reading here makes each write a read-modify-write on the real store.
   *
   * If the store is unreadable we can only proceed once its bytes are safely
   * snapshotted; that snapshot is taken here (or on mount) and this throws if
   * it can't be, so recovery never runs over the top of unbacked-up data.
   */
  function storedPinsForWrite(): Pin[] {
    try {
      return loadPins(storage);
    } catch (loadFailure) {
      if (corruptBackupRef.current === null) {
        corruptBackupRef.current = backupCorruptStore(storage); // throws if it fails
      }
      setLoadError(
        loadFailure instanceof Error ? loadFailure.message : String(loadFailure),
      );
      return [];
    }
  }

  function handleMapClick(lat: number, lng: number) {
    if (!armed) return;

    // Build the pin, then persist it, and only commit to UI state if the save
    // succeeds — so a failed write can never leave a pin on the map that would
    // silently vanish on reload. Both steps can throw a named error
    // (InvalidPinError, PinStoreError, or a raw storage QuotaExceededError);
    // surface it instead of crashing the map.
    let created: Pin;
    let next: Pin[];
    try {
      // createPin re-validates and throws on an empty name; the form guards
      // against arming without one, so that branch is defense in depth.
      created = createPin({ name, lat, lng, strength });
      next = [...storedPinsForWrite(), created];
      savePins(storage, next); // persist explicitly, never via a mount effect
    } catch (e) {
      setSaveError(
        `Couldn’t save that pin: ${e instanceof Error ? e.message : String(e)}. It was not added.`,
      );
      return;
    }

    setPins(next);
    setSaveError(null);
    setLoadError(null); // the store now holds valid data
    setArmed(false);
    setName('');
    // Open the new pin in the editor: you place a lead right after visiting it,
    // so notes are the very next thing you want to write.
    setSelectedPinId(created.id);
  }

  function handleSelectPin(id: string) {
    // Selecting and placing are mutually exclusive: the editor replaces the add
    // form in the sidebar, so an armed placement can't be pending underneath it.
    setArmed(false);
    setSaveError(null);
    setSelectedPinId(id);
  }

  function handleSaveEdits(edits: {
    name: string;
    strength: LeadStrength;
    notes: string;
  }) {
    if (selectedPin === null) return;

    // Same order as the add path: build and persist first, commit to UI state
    // only once the write succeeded, so the editor can never show "Saved" for
    // an edit that isn't in localStorage. updatePin re-validates and replacePin
    // throws rather than silently dropping the edit on an unknown id — including
    // when the re-read store no longer contains the pin being edited.
    let next: Pin[];
    try {
      next = replacePin(storedPinsForWrite(), updatePin(selectedPin, edits));
      savePins(storage, next);
    } catch (e) {
      setSaveError(
        `Couldn’t save those changes: ${e instanceof Error ? e.message : String(e)}. The pin is unchanged.`,
      );
      return;
    }

    setPins(next);
    setSaveError(null);
    setLoadError(null); // the store now holds valid data
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="sidebar__brand">restaurant-map</h1>
        <p className="sidebar__tagline">Your restaurant leads, by strength.</p>

        {loadError && (
          <div className="banner banner--error" role="alert">
            Couldn’t read saved pins: {loadError}.{' '}
            {corruptBackupRef.current === null
              ? 'Your saved data is untouched; new pins you add will overwrite it.'
              : `The unreadable data was copied to “${corruptBackupRef.current}” before anything else is saved, so nothing is lost — recover it from there.`}
          </div>
        )}

        {saveError && (
          <div className="banner banner--error" role="alert">
            {saveError}
          </div>
        )}

        {selectedPin ? (
          // key={id}: switching pins remounts the editor so its draft is
          // re-seeded from the newly selected pin instead of carrying over.
          <PinEditor
            key={selectedPin.id}
            pin={selectedPin}
            onSave={handleSaveEdits}
            onClose={() => setSelectedPinId(null)}
          />
        ) : (
          <AddPinForm
            name={name}
            strength={strength}
            armed={armed}
            onNameChange={setName}
            onStrengthChange={setStrength}
            onArm={() => setArmed(true)}
            onCancel={() => setArmed(false)}
          />
        )}

        <Legend />

        <p className="sidebar__count">
          {pins.length} {pins.length === 1 ? 'lead' : 'leads'} on the map
          {pins.length > 0 && !selectedPin && (
            <> · click a pin to read or edit its notes</>
          )}
        </p>
      </aside>

      {/* The armed cursor is set here rather than on MapContainer, which
          freezes its className at construction and would never show it. */}
      <main className={`map-pane${armed ? ' map-pane--armed' : ''}`}>
        {/* Held back for the one render it takes to read the store: a map
            created before the pins are known could only fit itself to them
            afterwards, which is the re-fit this unit exists to avoid. */}
        {initialView && (
          <MapView
            initialView={initialView}
            pins={pins}
            selectedPinId={selectedPinId}
            onMapClick={handleMapClick}
            onSelectPin={handleSelectPin}
          />
        )}
      </main>
    </div>
  );
}
