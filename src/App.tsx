import { useEffect, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { AddPinForm } from './components/AddPinForm';
import { PinEditor } from './components/PinEditor';
import { Legend } from './components/Legend';
import { ImportExport } from './components/ImportExport';
import { PinFilterBar } from './components/PinFilterBar';
import { PinList } from './components/PinList';
import { ViewSwitcher, type MainView } from './components/ViewSwitcher';
import {
  createPin,
  leadNoun,
  removePin,
  replacePin,
  updatePin,
  type Pin,
} from './domain/pin';
import { type LeadStrength } from './domain/leadStrength';
import { initialViewForPins, type InitialView } from './domain/mapFit';
import {
  allPinsFilter,
  filterPins,
  isFilterActive,
  matchesFilter,
  type PinFilter,
} from './domain/pinFilter';
import { backupCorruptStore, loadPins, savePins } from './storage/pinStore';
import { importPins } from './storage/importExport';
import { describeError } from './errors';
import { clearView, loadView, saveView, type PersistedView } from './storage/viewStore';

const storage: Storage = window.localStorage;

export default function App() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set once an import has actually replaced the store, so the sidebar can
  // say where the pre-import snapshot went (the only undo for a replace).
  const [importInfo, setImportInfo] = useState<string | null>(null);

  // Set once a delete has actually removed a pin, holding the exact pin that
  // was removed so Undo can restore it byte-for-byte (id, position, strength,
  // notes) rather than reconstructing it. This is the ONLY undo mechanism for
  // a delete — in-memory, and good for exactly the most recent delete (no
  // multi-level history). Cleared only when it would actually become invalid
  // — a new delete (which replaces it with the newer one) or a whole-store
  // import replace — NOT by ordinary reads/writes like selecting, adding, or
  // editing a pin, none of which can make the held pin stale or its id
  // reappear. A whole-store snapshot like importPins takes would be the wrong
  // tool here: that exists to protect a destructive REPLACE of everything,
  // not a single pin, and duplicating it for one-pin deletes would be the
  // kind of ceremony CLAUDE.md's drift rule warns against for a single-user
  // local tool.
  const [deleteInfo, setDeleteInfo] = useState<{ pin: Pin } | null>(null);

  // Where the map opens. Written exactly once, by the mount effect below —
  // never derived from `pins`, which changes on every save. `null` means "the
  // store hasn't been read yet", and the map is not mounted until it has, so
  // Leaflet is created already knowing what it has to show. See MapView for
  // why that makes the fit a one-time event.
  //
  // Prefers wherever the map was last left (`loadView`) over fitting the
  // pins: a returning user wants the neighbourhood they were just looking at,
  // not to be zoomed back out to every lead they've ever saved. Fitting the
  // pins (`initialViewForPins`) is the fallback for when there's no last
  // position yet — first run, or right after an import (see
  // handleImportReplace, which clears it deliberately).
  const [initialView, setInitialView] = useState<InitialView | null>(null);

  // Bumped only by a confirmed import, never by the mount effect or an
  // ordinary save. `MapView` is keyed by this: changing it forces React to
  // unmount and remount MapView, which is what makes react-leaflet construct
  // a brand-new map from the freshly recomputed `initialView` below — the fit
  // is still a mount-time-only event (Section A's rule), it's just that a
  // whole-store replace is deliberately treated as a new mount, not a save.
  // Without this, a confirmed import leaves the map parked on the pre-import
  // view with every restored pin off screen until the next reload (see
  // docs/reviews/Unit 3 Section B - export-import JSON.md F1).
  const [mapEpoch, setMapEpoch] = useState(0);

  // Which surface the main pane shows: the map (default) or the list. Pure
  // UI/read state — switching never touches storage, the current selection,
  // or the add-pin flow (Unit 7's "Done when"). MapView itself is never
  // unmounted by this: it stays mounted and simply gets covered by the list
  // panel, so a pan/zoom mid-session survives a round trip through List and
  // back, and Leaflet's container never changes size (no resize/invalidation
  // dance needed). See `.list-pane` in index.css.
  const [activeView, setActiveView] = useState<MainView>('map');

  // React 18 has no `inert` JSX prop (that lands in React 19), so the
  // covered map's tabbability is toggled directly on the DOM node instead.
  // `toggleAttribute`, not the `.inert` IDL property: the property setter is
  // meant to reflect to the attribute, but doesn't in this project's jsdom
  // (verified directly — `el.inert = true` left `getAttribute('inert')`
  // `null`), so a test asserting the attribute would pass in every real
  // browser and silently no-op here. `toggleAttribute` sets the actual
  // attribute either way, which is what makes every descendant (Leaflet's
  // zoom buttons, markers, attribution links) untabbable and unclickable in
  // one step — `aria-hidden` alone does not (see the `activeView === 'list'`
  // JSX comment below).
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mapWrapperRef.current?.toggleAttribute('inert', activeView === 'list');
  }, [activeView]);

  // Draft state for the add-a-pin flow.
  const [name, setName] = useState('');
  const [strength, setStrength] = useState<LeadStrength>('strong');
  const [armed, setArmed] = useState(false);

  // Which pin the editor is open on. Selection is derived by id, never by
  // holding a copy of the pin: after a save the editor always reads the pin
  // that is actually in state (and therefore in storage), never a stale one.
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null;

  // Which pins are shown on the map. Read-only over `pins` — narrowing which
  // markers render is the only effect a filter has; it never touches storage,
  // the current selection, or the add-pin flow, and (unlike every other piece
  // of state above) it survives every write untouched: an add/edit/delete/
  // import never resets it, because it isn't pin data, just a view over it.
  const [filter, setFilter] = useState<PinFilter>(allPinsFilter);
  const visiblePins = filterPins(pins, filter);
  const filterActive = isFilterActive(filter);

  function handleToggleStrength(toggled: LeadStrength) {
    setFilter((f) => {
      const strengths = new Set(f.strengths);
      if (strengths.has(toggled)) {
        strengths.delete(toggled);
      } else {
        strengths.add(toggled);
      }
      return { ...f, strengths };
    });
  }

  function handleQueryChange(query: string) {
    setFilter((f) => ({ ...f, query }));
  }

  function handleClearFilter() {
    setFilter(allPinsFilter());
  }

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
      setLoadError(describeError(e));
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
    // A saved pan/zoom (loadView) wins over fitting the pins when present —
    // see the state comment above — and is independent of whether the pins
    // themselves loaded: it's a view preference, not pin data, so a corrupt
    // pin store is no reason to also discard a perfectly good last position.
    const persisted = loadView(storage);
    setInitialView(
      persisted
        ? { kind: 'center', center: persisted.center, zoom: persisted.zoom }
        : initialViewForPins(loaded),
    );
  }, []);

  // The map reports its own pan/zoom here whenever it settles (MapView's
  // ViewPersister). Fire-and-forget: this never touches React state or
  // triggers a re-render, so it cannot become a path that moves the map
  // itself — it only ever records where the map already is.
  function handleViewChange(view: PersistedView) {
    saveView(storage, view);
  }

  /**
   * The escape hatch a saved view otherwise has none of: without this, a pan
   * or zoom that leaves every lead off screen persists across every future
   * reload with nothing in the app able to undo it — the exact defect Unit 3
   * Section A shipped to fix, reintroduced permanently by this unit having
   * nowhere to send a stranded user back (see docs/reviews/persist map view
   * across reloads.md F1). Re-fits to every saved pin through the same
   * mapEpoch remount handleImportReplace already uses, and clears the saved
   * view so this fit — not the position that stranded the user — is what a
   * reload restores from here on, until the next real pan.
   *
   * Also switches to Map: this button is always visible (including from
   * List), but its entire effect — re-fitting and force-remounting the map —
   * is invisible from List, where it silently discards the saved view with
   * nothing on screen changing. Switching to Map makes the recovery it
   * performs actually observable (see docs/reviews/unit 7.md F1).
   */
  function handleShowAllLeads() {
    setActiveView('map');
    setInitialView(initialViewForPins(pins));
    setMapEpoch((epoch) => epoch + 1);
    clearView(storage);
  }

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
      setLoadError(describeError(loadFailure));
      return [];
    }
  }

  /**
   * How many pins are actually in storage right now, or null if it's
   * unreadable. Used only to word the import confirmation/banner honestly —
   * `pins.length` (React state) is what another tab wrote as of THIS tab's
   * last load or save, not what's about to be destroyed by a replace. See
   * docs/reviews/Unit 3 Section B - export-import JSON.md F2.
   */
  function countStoredPins(): number | null {
    try {
      return loadPins(storage).length;
    } catch {
      return null;
    }
  }

  function handleMapClick(lat: number, lng: number) {
    // Placement is Map-only (Unit 7's "Done when"): List's opaque overlay
    // stops a real click from ever reaching the map, but that's CSS, not a
    // guarantee — this check is the actual mechanism, so the invariant holds
    // even if the overlay is ever removed, resized, or z-index-regressed
    // (see docs/reviews/unit 7.md F2).
    if (activeView !== 'map') return;
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
    setImportInfo(null);
    // deleteInfo is NOT cleared here: adding a pin (a fresh random id) cannot
    // make the held Undo record stale or collide with it.
    setArmed(false);
    setName('');
    // A pin saved while a filter is active must still be visible — otherwise
    // it's on the map (in storage) but not ON the map (no marker), with
    // nothing telling the user why. Reset rather than leave it silently
    // hidden (see docs/reviews/filter-search-leads.md F1).
    if (!matchesFilter(created, filter)) {
      setFilter(allPinsFilter());
    }
    // Open the new pin in the editor: you place a lead right after visiting it,
    // so notes are the very next thing you want to write.
    setSelectedPinId(created.id);
  }

  function handleSelectPin(id: string) {
    // Selecting and placing are mutually exclusive: the editor replaces the add
    // form in the sidebar, so an armed placement can't be pending underneath it.
    setArmed(false);
    setSaveError(null);
    setImportInfo(null);
    // deleteInfo is NOT cleared here: selecting a pin is a read, and it was
    // wiping out the only undo for a destructive action on the very next
    // click a user makes after a delete (see docs/reviews/Delete a pin.md F2).
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
    let updated: Pin;
    try {
      updated = updatePin(selectedPin, edits);
      next = replacePin(storedPinsForWrite(), updated);
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
    setImportInfo(null);
    // deleteInfo is NOT cleared here: editing a different pin's fields cannot
    // make the held Undo record stale or collide with it.
    // An edit (e.g. moving a lead's strength into a hidden bucket) can hide
    // the very pin whose editor is open. Same reasoning as handleMapClick:
    // reset rather than leave it silently invisible (F1).
    if (!matchesFilter(updated, filter)) {
      setFilter(allPinsFilter());
    }
  }

  /**
   * Delete one pin. Same write discipline as add/edit: re-read the store
   * immediately before writing (so a stale tab can't clobber a concurrent
   * change) and only commit to UI state once the write actually succeeds.
   *
   * `pinToDelete` is read from that same fresh re-read, not from `pins`
   * (React state) — otherwise Undo would restore a copy of the pin captured
   * whenever this tab last loaded or saved, silently discarding notes another
   * tab wrote after that (see docs/reviews/Delete a pin.md F1).
   */
  function handleDeletePin(id: string) {
    let current: Pin[];
    try {
      current = storedPinsForWrite();
    } catch (e) {
      setSaveError(
        `Couldn’t delete that pin: ${e instanceof Error ? e.message : String(e)}. It was not removed.`,
      );
      return;
    }

    const pinToDelete = current.find((p) => p.id === id);
    if (!pinToDelete) {
      // Another tab already removed this pin since it was loaded here. The
      // pin can't be un-deleted from data that no longer exists, so resync
      // this tab's view instead of leaving a ghost marker that every further
      // delete attempt on it would just repeat (see F6).
      setPins(current);
      setSelectedPinId(null);
      setSaveError('Couldn’t delete that pin: it was already deleted elsewhere. Your view has been refreshed.');
      return;
    }

    let next: Pin[];
    try {
      next = removePin(current, id);
      savePins(storage, next);
    } catch (e) {
      setSaveError(
        `Couldn’t delete that pin: ${e instanceof Error ? e.message : String(e)}. It was not removed.`,
      );
      return;
    }

    setPins(next);
    setSaveError(null);
    setLoadError(null);
    setImportInfo(null);
    // Nothing left to show in the editor for a pin that no longer exists.
    setSelectedPinId(null);
    setDeleteInfo({ pin: pinToDelete });
  }

  /**
   * Undo the most recent delete by re-adding the exact pin that was removed.
   *
   * Guards against restoring onto an id that's since reappeared (e.g. another
   * tab imported a backup file that happens to contain this same pin, from
   * before it was deleted here): loadPins treats duplicate ids as a corrupt
   * store, so writing one is a real hazard, not a theoretical one. In that
   * case the safest thing is to decline the undo rather than poison the store
   * — there's nothing more recoverable to fall back to.
   */
  function handleUndoDelete() {
    if (!deleteInfo) return;
    const { pin } = deleteInfo;

    let current: Pin[];
    try {
      current = storedPinsForWrite();
    } catch (e) {
      // storedPinsForWrite() can throw (an unreadable store whose corrupt
      // snapshot also failed) — that used to escape this handler uncaught,
      // leaving the Undo button on screen doing nothing forever with no
      // banner telling the user why (see docs/reviews/Delete a pin.md F4).
      setSaveError(
        `Couldn’t restore “${pin.name}”: ${e instanceof Error ? e.message : String(e)}.`,
      );
      return;
    }

    if (current.some((p) => p.id === pin.id)) {
      setSaveError(
        `Couldn’t undo: another lead now uses the same id. “${pin.name}” was not restored.`,
      );
      setDeleteInfo(null);
      return;
    }

    const next = [...current, pin];
    try {
      savePins(storage, next);
    } catch (e) {
      setSaveError(
        `Couldn’t restore “${pin.name}”: ${e instanceof Error ? e.message : String(e)}.`,
      );
      return;
    }

    setPins(next);
    setSaveError(null);
    setLoadError(null);
    setDeleteInfo(null);
  }

  /**
   * Replace the whole store with an imported file's pins. `ImportExport` has
   * already validated the file (every record through parsePin) and gotten an
   * explicit confirmation naming both counts — this is the one function that
   * actually commits it, so App stays the only thing that touches `storage`.
   *
   * Unlike the add/edit paths this does NOT read `storedPinsForWrite()` first:
   * a replace means replace, and re-merging in whatever another tab wrote
   * since would silently turn this from "replace" into "replace-most-of",
   * defeating the confirmation the user just saw the counts for.
   */
  function handleImportReplace(imported: Pin[]) {
    // Read BEFORE importPins's own snapshot-then-write, and from storage, not
    // `pins`: the banner has to name what was actually just destroyed, not
    // what this tab's in-memory state happened to say a moment ago.
    const previousCount = countStoredPins();
    let backupKey: string | null;
    try {
      ({ backupKey } = importPins(storage, imported));
    } catch (e) {
      setSaveError(
        `Couldn’t import: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`,
      );
      setImportInfo(null); // don't leave an earlier success banner claiming otherwise
      setDeleteInfo(null); // a pre-import delete can't be undone against a replaced store
      return;
    }

    setPins(imported);
    // A confirmed import is a wholesale replace, not the incremental save
    // Section A's "fit on mount only" rule was written to protect — so the
    // view is recomputed for the new pins and MapView is force-remounted
    // (mapEpoch) to apply it, the same as a fresh mount would.
    setInitialView(initialViewForPins(imported));
    setMapEpoch((epoch) => epoch + 1);
    // The pre-import pan/zoom says nothing about where the NEW pins are —
    // possibly a different city entirely. Left in place, a reload right after
    // this import (before any further panning) would honor that stale
    // position over the fit we just computed above, landing on a patch of map
    // with none of the just-restored pins visible. Clearing it makes that
    // reload fall back to fitting the imported pins instead — correct by
    // construction, not by hoping the user pans first.
    clearView(storage);
    // The pin previously open in the editor may not exist in the replaced
    // set (or may exist under different data) — close it rather than editing
    // a lead that no longer matches what's on screen.
    setSelectedPinId(null);
    // A placement armed before the import must not survive it: the map is
    // about to show entirely different pins, and the next click landing on
    // them would silently add a pin the user never meant to place here.
    setArmed(false);
    setName('');
    setSaveError(null);
    setLoadError(null);
    setDeleteInfo(null); // the pre-import store (and any pin it held) is gone
    setImportInfo(
      `Imported ${imported.length} ${leadNoun(imported.length)}, replacing ${
        previousCount === null
          ? 'the previously saved data (which was unreadable)'
          : `${previousCount} previously saved`
      }. ${
        backupKey
          ? `Your previous data was backed up to “${backupKey}” before the replace.`
          : 'There was nothing saved before this import.'
      }`,
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="sidebar__brand">restaurant-map</h1>
        <p className="sidebar__tagline">Your restaurant leads, by strength.</p>

        <ViewSwitcher view={activeView} onChange={setActiveView} />

        {/* Always visible, not gated behind any other state: this is the only
            way back once a saved pan/zoom has left every lead off screen, so
            it can't be one click behind an editor, a filter, or a banner. */}
        <button type="button" className="sidebar__show-all" onClick={handleShowAllLeads}>
          Show all leads
        </button>

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

        {importInfo && (
          <div className="banner banner--info" role="status">
            {importInfo}
          </div>
        )}

        {deleteInfo && (
          <div className="banner banner--info" role="status">
            Deleted “{deleteInfo.pin.name}”.{' '}
            <button type="button" className="banner__undo" onClick={handleUndoDelete}>
              Undo
            </button>
          </div>
        )}

        <PinFilterBar
          filter={filter}
          isActive={filterActive}
          onToggleStrength={handleToggleStrength}
          onQueryChange={handleQueryChange}
          onClear={handleClearFilter}
        />

        {selectedPin ? (
          // key={id}: switching pins remounts the editor so its draft is
          // re-seeded from the newly selected pin instead of carrying over.
          <PinEditor
            key={selectedPin.id}
            pin={selectedPin}
            onSave={handleSaveEdits}
            onClose={() => setSelectedPinId(null)}
            onDelete={handleDeletePin}
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

        <ImportExport
          pins={pins}
          getSavedCount={countStoredPins}
          onImport={handleImportReplace}
        />

        {/* aria-live (not role="status"): the import/delete banners already
            claim the sole "status" role elsewhere in the sidebar, and
            getByRole('status') in tests expects exactly one match. A live
            region without that role still announces filter changes to
            screen-reader users (see docs/reviews/filter-search-leads.md F6)
            without colliding with those banner queries. */}
        <p className="sidebar__count" aria-live="polite">
          {filterActive ? (
            visiblePins.length === 0 ? (
              <>No leads match your filters.</>
            ) : (
              <>
                Showing {visiblePins.length} of {pins.length} {leadNoun(pins.length)}
                {!selectedPin && <> · click a pin to read or edit its notes</>}
              </>
            )
          ) : (
            <>
              {pins.length} {leadNoun(pins.length)} on the map
              {pins.length > 0 && !selectedPin && (
                <> · click a pin to read or edit its notes</>
              )}
            </>
          )}
        </p>
      </aside>

      {/* The armed cursor is set here rather than on MapContainer, which
          freezes its className at construction and would never show it. */}
      <main className={`map-pane${armed ? ' map-pane--armed' : ''}`}>
        {/* The map's own wrapper is always rendered, List view or not:
            MapView must never unmount on a view switch (see the `activeView`
            state comment above), so `aria-hidden` + `inert` (applied in the
            effect below, not conditional rendering) are what keep it out of
            the accessibility tree AND the tab order while List covers it —
            `aria-hidden` alone still left Leaflet's zoom buttons/markers/
            attribution links tabbable and clickable-by-keyboard while
            invisible, one of them able to silently rewrite the persisted map
            view (docs/reviews/unit 7.md F4). */}
        <div className="map-pane__map" aria-hidden={activeView === 'list'} ref={mapWrapperRef}>
          {/* Held back for the one render it takes to read the store: a map
              created before the pins are known could only fit itself to them
              afterwards, which is the re-fit this unit exists to avoid.
              key={mapEpoch}: unchanged on every ordinary render, so this stays
              the same mount-time fit — it only advances on a confirmed import,
              which forces the remount that applies the recomputed view. */}
          {initialView && (
            <MapView
              key={mapEpoch}
              initialView={initialView}
              pins={visiblePins}
              selectedPinId={selectedPinId}
              onMapClick={handleMapClick}
              onSelectPin={handleSelectPin}
              onViewChange={handleViewChange}
            />
          )}
        </div>

        {/* Layered on top of (not instead of) the map above, so switching
            back to Map never remounts it — see the `activeView` state
            comment. `.list-pane` is opaque and covers the pane exactly
            (`.map-pane` is position:relative for this), which also means a
            covered map can't take clicks meant for the list. */}
        {activeView === 'list' && (
          <div className="list-pane">
            <PinList
              pins={visiblePins}
              selectedPinId={selectedPinId}
              onSelectPin={handleSelectPin}
            />
          </div>
        )}
      </main>
    </div>
  );
}
