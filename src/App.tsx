import { useEffect, useState } from 'react';
import { MapView } from './components/MapView';
import { AddPinForm } from './components/AddPinForm';
import { Legend } from './components/Legend';
import { createPin, type Pin } from './domain/pin';
import { type LeadStrength } from './domain/leadStrength';
import { loadPins, savePins } from './storage/pinStore';

const storage: Storage = window.localStorage;

export default function App() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Draft state for the add-a-pin flow.
  const [name, setName] = useState('');
  const [strength, setStrength] = useState<LeadStrength>('strong');
  const [armed, setArmed] = useState(false);

  // Load once on mount. On a corrupt store we surface the error and start with
  // an empty in-memory list, but we DON'T save over the stored bytes — the raw
  // data stays intact for recovery, so a bad read can never silently drop pins.
  useEffect(() => {
    try {
      setPins(loadPins(storage));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function handleMapClick(lat: number, lng: number) {
    if (!armed) return;

    // Build the pin, then persist it, and only commit to UI state if the save
    // succeeds — so a failed write can never leave a pin on the map that would
    // silently vanish on reload. Both steps can throw a named error
    // (InvalidPinError, PinStoreError, or a raw storage QuotaExceededError);
    // surface it instead of crashing the map.
    let next: Pin[];
    try {
      // createPin re-validates and throws on an empty name; the form guards
      // against arming without one, so that branch is defense in depth.
      const pin = createPin({ name, lat, lng, strength });
      next = [...pins, pin];
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
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="sidebar__brand">restaurant-map</h1>
        <p className="sidebar__tagline">Your restaurant leads, by strength.</p>

        {loadError && (
          <div className="banner banner--error" role="alert">
            Couldn’t read saved pins: {loadError}. Your saved data is untouched;
            new pins you add will overwrite it.
          </div>
        )}

        {saveError && (
          <div className="banner banner--error" role="alert">
            {saveError}
          </div>
        )}

        <AddPinForm
          name={name}
          strength={strength}
          armed={armed}
          onNameChange={setName}
          onStrengthChange={setStrength}
          onArm={() => setArmed(true)}
          onCancel={() => setArmed(false)}
        />

        <Legend />

        <p className="sidebar__count">
          {pins.length} {pins.length === 1 ? 'lead' : 'leads'} on the map
        </p>
      </aside>

      <main className="map-pane">
        <MapView pins={pins} armed={armed} onMapClick={handleMapClick} />
      </main>
    </div>
  );
}
