import { useCallback, useEffect, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { AddPinForm } from './components/AddPinForm';
import { PinEditor } from './components/PinEditor';
import { Legend } from './components/Legend';
import { ImportExport } from './components/ImportExport';
import { PinFilterBar } from './components/PinFilterBar';
import { DataFileLink } from './components/DataFileLink';
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
import {
  backupCorruptStore,
  backupBeforeImport,
  backupRawAsCorrupt,
  backupRawBeforeReplace,
  loadPins,
  parsePinsPayload,
  savePins,
  serializePinsForFile,
  PinStoreError,
} from './storage/pinStore';
import { importPins, parseImportPayload } from './storage/importExport';
import {
  createNewFile,
  isFileSystemAccessSupported,
  pickExistingFile,
  queryReadWritePermission,
  readFile,
  requestReadWritePermission,
  writeFile,
} from './storage/fileStorage';
import {
  forgetFileHandle,
  recallFileHandle,
  rememberFileHandle,
} from './storage/fileHandleRegistry';
import { describeError } from './errors';
import { clearView, loadView, saveView, type PersistedView } from './storage/viewStore';

const storage: Storage = window.localStorage;

export default function App() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which backend produced the current loadError, so the banner below can
  // pair the right rescue-backup key with the right message instead of
  // guessing from ref presence (see docs/reviews/Unit 6 - git syncable
  // storage.md F9 — the old `corruptBackupRef.current ?? fileCorruptBackupRef
  // .current` fallback could show the wrong key when both had failed in the
  // same session). 'file-unreadable' is Unit 6's hard-read-failure case
  // (F2): nothing is corrupt, there's just nothing to back up from — see
  // adoptLinkedFile.
  const [loadErrorBackend, setLoadErrorBackend] = useState<
    'localStorage' | 'file-corrupt' | 'file-unreadable' | null
  >(null);
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

  // Bumped only by a confirmed import (or, Unit 6, linking/reconnecting a
  // file — both replace the whole visible set the same way an import does),
  // never by the mount effect or an ordinary save. `MapView` is keyed by
  // this: changing it forces React to unmount and remount MapView, which is
  // what makes react-leaflet construct a brand-new map from the freshly
  // recomputed `initialView` below — the fit is still a mount-time-only event
  // (Section A's rule), it's just that a whole-store replace is deliberately
  // treated as a new mount, not a save. Without this, a confirmed import
  // leaves the map parked on the pre-import view with every restored pin off
  // screen until the next reload (see
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

  // Unit 6: once set, every read/write goes through this file instead of
  // localStorage. Null (the default, and the only mode before this unit)
  // means "use localStorage", exactly as every earlier unit's tests assume.
  const [linkedHandle, setLinkedHandle] = useState<FileSystemFileHandle | null>(null);
  // A handle recalled from a past session (IndexedDB) whose permission needs
  // one fresh user-gesture click to confirm — browsers don't promise
  // permission survives a reload, so this is never auto-requested.
  const [reconnectHandle, setReconnectHandle] = useState<FileSystemFileHandle | null>(null);
  // Bumped whenever the user abandons a link (Unlink / Forget this file).
  // Async link work captures it before its first await and re-reads it after,
  // which is the only way to notice a decision made *during* an await: a
  // handler's closure can't see it, and the permission prompt is browser
  // chrome that leaves the page clickable underneath (review F1). A ref, not
  // state, precisely because it must be readable at resolve time rather than
  // at the render that captured it.
  const linkGeneration = useRef(0);
  // True while a permission request is open. Disables Reconnect only —
  // NOT "Forget this file", deliberately, though the review suggested both:
  // an escape hatch that goes dead while a prompt is open re-creates, for the
  // length of that prompt, exactly the dead end this control exists to
  // remove. The generation check above is what makes the race safe; this
  // just stops a second prompt stacking on the first.
  const [reconnectPending, setReconnectPending] = useState(false);
  // Set while linking to a file that already has content: mirrors Unit 3B's
  // import-confirmation shape exactly, since adopting an existing file's
  // content is an import-replace of a different medium, not a new mechanism.
  const [pendingFileLink, setPendingFileLink] = useState<{
    handle: FileSystemFileHandle;
    pins: Pin[];
    /** The file's raw bytes as read at pick time — kept so a confirmed link
     * can skip rewriting a file whose content is already in canonical form
     * (see handleConfirmFileLink, F10). */
    raw: string;
    fileName: string;
    savedCount: number | null;
  } | null>(null);
  const [fileLinkError, setFileLinkError] = useState<string | null>(null);
  // Dedup, same idea as corruptBackupRef below: back up an unreadable linked
  // file's bytes once per session, not on every write attempt against it.
  const fileCorruptBackupRef = useRef<string | null>(null);

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
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadErrorBackend('localStorage');
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
   * Read a linked file, parse it, and adopt it as the active backend —
   * replacing whatever's currently shown, the same way a confirmed import
   * does. Used for both silent reconnect (permission already granted, either
   * at mount or after a Reconnect click) — never for the first-time link
   * flow, which has its own seed-vs-confirm branching (`linkFile` below).
   *
   * `useCallback([])`: every dependency here (setters, the ref, module-level
   * imports) is referentially stable, so an empty array is accurate, not a
   * lie — it's what lets the mount effect below list this function as a
   * dependency without an infinite-effect risk or a disabled lint rule.
   */
  const adoptLinkedFile = useCallback(async (handle: FileSystemFileHandle) => {
    // Two failure modes that look similar but get deliberately different
    // treatment (decision log Assumption 4). A HARD read failure (the file
    // was moved/deleted, permission was silently revoked) means there is
    // nothing safe to adopt: adopting anyway would hide every localStorage
    // pin behind an empty "linked" file with every write refused and no
    // escape (see docs/reviews/Unit 6 - git syncable storage.md F2). Stay on
    // whatever's currently shown and surface Reconnect again so the user can
    // retry with a user gesture.
    let raw: string;
    try {
      raw = await readFile(handle);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadErrorBackend('file-unreadable');
      setReconnectHandle(handle);
      return;
    }

    // Readable bytes that fail validation (corrupt JSON, a git-conflict-
    // mangled file) — unlike a hard read failure, this content genuinely IS
    // the file, so it's adopted (empty) exactly like a corrupt localStorage
    // read: backed up aside, named error, no data loss, no crash.
    let loaded: Pin[] = [];
    try {
      loaded = parsePinsPayload(raw);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoadErrorBackend('file-corrupt');
      if (fileCorruptBackupRef.current === null) {
        try {
          fileCorruptBackupRef.current = backupRawAsCorrupt(storage, raw);
        } catch (backupError) {
          setSaveError(
            `Couldn’t back up the unreadable linked file: ${
              backupError instanceof Error ? backupError.message : String(backupError)
            }.`,
          );
        }
      }
    }
    setLinkedHandle(handle);
    setReconnectHandle(null);
    setPins(loaded);
    setInitialView(initialViewForPins(loaded));
    setMapEpoch((epoch) => epoch + 1);
  }, []);

  // Unit 6: on mount, check whether this browser remembers a linked file
  // from a past session. Permission is not guaranteed to survive a reload,
  // so this only auto-adopts when it's still granted; otherwise it surfaces
  // a Reconnect control (a user gesture — required to request permission —
  // rather than silently staying on localStorage forever with no way back.
  // No-ops entirely (leaving `pins` exactly as the load effect above set
  // them) when the API isn't supported or nothing was ever linked, which is
  // every existing test's environment.
  useEffect(() => {
    if (!isFileSystemAccessSupported()) return;
    let cancelled = false;
    const generation = linkGeneration.current;

    (async () => {
      const handle = await recallFileHandle().catch(() => null);
      if (!handle || cancelled) return;

      const permission = await queryReadWritePermission(handle).catch(() => 'denied' as const);
      if (cancelled || generation !== linkGeneration.current) return;

      if (permission === 'granted') {
        await adoptLinkedFile(handle);
      } else {
        setReconnectHandle(handle);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adoptLinkedFile]);

  async function handleReconnect() {
    if (!reconnectHandle) return;
    const handle = reconnectHandle;
    // Captured BEFORE the await, compared after: the permission prompt is
    // browser chrome and the page stays interactive underneath it, so the
    // user can click "Forget this file" while it's open. Without this the
    // resolved promise would adopt a handle the app has already forgotten —
    // re-linking the abandoned file, with its IndexedDB record already
    // deleted, so every pin written afterwards lands in a file the next
    // reload won't reopen (review F1).
    const generation = linkGeneration.current;
    setFileLinkError(null);
    setReconnectPending(true);
    let permission: PermissionState;
    try {
      permission = await requestReadWritePermission(handle).catch(() => 'denied' as const);
    } finally {
      setReconnectPending(false);
    }
    if (generation !== linkGeneration.current) return;
    if (permission !== 'granted') {
      // `requestPermission` resolves 'denied' both when the prompt is refused
      // and when it's dismissed — clicking back into the page is enough to
      // dismiss it — and the prompt itself renders in browser chrome, outside
      // the page, so a user who never noticed it reads this as "the button did
      // nothing". Name where the prompt is and that retrying is safe, rather
      // than reporting a refusal the user may not know they made. The "where"
      // lives in DataFileLink's paragraph, which is on screen alongside this —
      // saying it twice is what review F9 caught.
      setFileLinkError(
        'Access to that file was not granted — choose “Allow” in the browser’s prompt, or ' +
          'forget the file to link a different one.',
      );
      return;
    }
    await adoptLinkedFile(handle);
  }

  /**
   * Forget the linked file and fall back to localStorage — the escape hatch
   * a broken link otherwise has none of (see
   * docs/reviews/Unit 6 - git syncable storage.md F2/F8: a linked file that
   * can't be read used to dead-end the app with no in-app way back). The
   * file on disk is left exactly as it was; only the in-app link and the
   * remembered IndexedDB handle are forgotten. localStorage was never
   * written to while a file was linked (Assumption 3), so re-reading it here
   * surfaces whatever was there before the link, same discipline every other
   * read here uses.
   */
  async function handleUnlink() {
    // Invalidate any in-flight permission request before anything else, so a
    // prompt answered after this point can't re-adopt what we're forgetting.
    linkGeneration.current += 1;
    const forgottenName = linkedHandle?.name ?? reconnectHandle?.name ?? 'that file';
    // Was a file actually the active backend, or is this a reconnect-state
    // forget where nothing was ever adopted? The two need different amounts
    // of work, and doing the linked-state amount for the reconnect state is
    // what review F4 caught: the app is ALREADY on localStorage showing its
    // pins, so re-seeding, remounting the map and closing the editor are all
    // changes with no data change behind them.
    const wasLinked = linkedHandle !== null;

    // The one operation this control exists to perform. Reporting its failure
    // is not optional: the UI below switches to choose/create either way, so
    // a swallowed rejection makes the app *assert* the handle was forgotten
    // while the next reload strands the user on Reconnect again, with nothing
    // said (review F2 — the same silent catch this change de-silenced for
    // rememberFileHandle, left on the call that matters more).
    let forgetWarning: string | null = null;
    try {
      await forgetFileHandle();
    } catch (e) {
      forgetWarning =
        `Stopped using “${forgottenName}” here, but this browser couldn’t forget it ` +
        `(${describeError(e)}). It may reappear as a reconnect prompt after a reload.`;
    }

    setLinkedHandle(null);
    setReconnectHandle(null);
    setFileLinkError(null);
    // A banner about the file we just stopped using is stale the moment it's
    // forgotten — and `file-unreadable`'s copy ends "use Reconnect below to
    // try the file again", pointing at a control this very action removes
    // (review F3). A localStorage-origin error is left alone: that one is
    // about the backend we're switching *to*, and is still true.
    if (loadErrorBackend === 'file-unreadable' || loadErrorBackend === 'file-corrupt') {
      setLoadError(null);
      setLoadErrorBackend(null);
    }
    // Cleared before the re-seed below, not after, so a fresh failure from
    // that read still surfaces.
    setSaveError(null);

    if (wasLinked) {
      let seed: Pin[];
      try {
        seed = storedPinsForWrite();
      } catch (e) {
        setSaveError(`Couldn’t switch back to browser storage: ${describeError(e)}.`);
        seed = [];
      }
      setPins(seed);
      setInitialView(initialViewForPins(seed));
      setMapEpoch((epoch) => epoch + 1);
      setSelectedPinId(null);
      setArmed(false);
      setImportInfo(null);
    }

    if (forgetWarning !== null) setFileLinkError(forgetWarning);
  }

  /**
   * Remember the handle for the next session, reporting a failure instead of
   * swallowing it. Deliberately a warning, not an abort: a link whose handle
   * can't be stored still works for this session, so refusing the link would
   * cost the user something real. But it must not be silent — a sidebar that
   * says "every read and write goes through this file" while the link is
   * quietly one reload from evaporating is the kind of failure a user can
   * only experience as data mysteriously reverting.
   */
  async function rememberLink(handle: FileSystemFileHandle): Promise<string | null> {
    try {
      await rememberFileHandle(handle);
      return null;
    } catch (e) {
      return (
        `Linked “${handle.name}”, but this browser couldn’t remember it for next time ` +
        `(${describeError(e)}). You’ll need to link the file again after a reload.`
      );
    }
  }

  /**
   * Link storage to a file for the first time — reachable only while nothing
   * is linked yet (the sidebar offers no relink/switch control once linked;
   * see the decision log for why that's out of scope for this unit).
   *
   * Reuses Unit 3B's import machinery rather than inventing a new one: an
   * existing file's content goes through the exact same `parseImportPayload`
   * boundary and confirm-before-replace step a JSON import does. An empty
   * file is the one case that ISN'T an import — there's nothing to validate
   * or confirm, so it's seeded from what's currently shown instead.
   */
  async function linkFile(pick: () => Promise<FileSystemFileHandle>) {
    setFileLinkError(null);
    let handle: FileSystemFileHandle;
    try {
      handle = await pick();
    } catch (e) {
      // Cancelling the native picker rejects with AbortError — not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setFileLinkError(
        `Couldn’t open the file picker: ${e instanceof Error ? e.message : String(e)}.`,
      );
      return;
    }

    const permission = await requestReadWritePermission(handle).catch(() => 'denied' as const);
    if (permission !== 'granted') {
      setFileLinkError('Permission to read and write that file was not granted.');
      return;
    }

    let raw: string;
    try {
      raw = await readFile(handle);
    } catch (e) {
      setFileLinkError(`Couldn’t read that file: ${e instanceof Error ? e.message : String(e)}.`);
      return;
    }

    if (raw === '') {
      // New/empty file: nothing to validate or confirm — seed it from the
      // freshest read of what's currently backing the app (storedPinsForWrite
      // re-reads localStorage and handles a corrupt local store the same way
      // every other write here does, rather than seeding from possibly-stale
      // `pins` state). storedPinsForWrite can itself throw (a corrupt local
      // store whose rescue backup also failed) — that used to escape this
      // async function uncaught, leaving the link silently doing nothing with
      // an orphaned empty file left on disk (see
      // docs/reviews/Unit 6 - git syncable storage.md F6).
      let seed: Pin[];
      try {
        seed = storedPinsForWrite();
      } catch (e) {
        setFileLinkError(
          `Couldn’t seed that file: ${e instanceof Error ? e.message : String(e)}.`,
        );
        return;
      }
      try {
        await writeFile(handle, serializePinsForFile(seed));
      } catch (e) {
        setFileLinkError(
          `Couldn’t write the starting data to that file: ${
            e instanceof Error ? e.message : String(e)
          }.`,
        );
        return;
      }
      const rememberWarning = await rememberLink(handle);
      setLinkedHandle(handle);
      setReconnectHandle(null);
      setPins(seed);
      setImportInfo(
        `Linked “${handle.name}”, seeded with your ${seed.length} existing ${leadNoun(seed.length)}.`,
      );
      if (rememberWarning !== null) setFileLinkError(rememberWarning);
      return;
    }

    // Existing content: validate through the same boundary a JSON import
    // uses, then hold it for an explicit confirmation naming both counts —
    // never a silent replace of what's currently shown.
    let imported: Pin[];
    try {
      imported = parseImportPayload(raw);
    } catch (e) {
      const cause = e instanceof Error ? e.cause : undefined;
      const detail = cause instanceof Error ? `: ${cause.message}` : '';
      setFileLinkError(
        `That file isn’t a valid backup: ${e instanceof Error ? e.message : String(e)}${detail}.`,
      );
      return;
    }

    setPendingFileLink({
      handle,
      pins: imported,
      raw,
      fileName: handle.name,
      savedCount: countStoredPinsSync(),
    });
  }

  function handleChooseExisting() {
    void linkFile(pickExistingFile);
  }

  function handleCreateNew() {
    void linkFile(createNewFile);
  }

  async function handleConfirmFileLink() {
    if (!pendingFileLink) return;
    const { handle, pins: imported, raw } = pendingFileLink;
    // Recomputed fresh here rather than reusing pendingFileLink.savedCount
    // (captured back when the file was picked): a pin added between the
    // picker resolving and this confirm click would otherwise make the
    // post-link banner name a stale count for what was actually just
    // replaced (see docs/reviews/Unit 6 - git syncable storage.md F12,
    // mirroring how handleImportReplace's localStorage branch already
    // re-reads fresh rather than trusting ImportExport's own pending count).
    const previousCount = countStoredPinsSync();

    let backupKey: string | null;
    try {
      // Snapshots whatever's currently in localStorage (the pre-link store —
      // linking is only reachable before anything's linked) before the new
      // file becomes the backend, exactly as a confirmed JSON import does.
      backupKey = backupBeforeImport(storage);
      // Skip the write entirely when the file already holds exactly this
      // content in canonical form — otherwise linking an already-clean file
      // (e.g. re-linking after Unlink) dirties the git working tree with a
      // pure reformat and no actual data change (F10).
      const canonical = serializePinsForFile(imported);
      if (raw !== canonical) {
        await writeFile(handle, canonical);
      }
    } catch (e) {
      setFileLinkError(`Couldn’t link that file: ${e instanceof Error ? e.message : String(e)}.`);
      setPendingFileLink(null);
      return;
    }
    const rememberWarning = await rememberLink(handle);

    setLinkedHandle(handle);
    setReconnectHandle(null);
    setPins(imported);
    setInitialView(initialViewForPins(imported));
    setMapEpoch((epoch) => epoch + 1);
    setSelectedPinId(null);
    setArmed(false);
    setName('');
    setSaveError(null);
    setLoadError(null);
    setDeleteInfo(null);
    setPendingFileLink(null);
    setImportInfo(
      `Linked “${handle.name}”, replacing ${
        previousCount === null
          ? 'the previously shown data (which was unreadable)'
          : `${previousCount} previously shown`
      } with the ${imported.length} ${leadNoun(imported.length)} in that file. ${
        backupKey
          ? `Your previous data was backed up to “${backupKey}”.`
          : 'There was nothing shown before this link.'
      }`,
    );
    // Kept last by preference, not necessity: nothing between the
    // rememberLink call and here touches fileLinkError today (review F8
    // caught the older comment claiming this ordering was load-bearing).
    // The link succeeded; if it won't survive a reload, say so now.
    if (rememberWarning !== null) setFileLinkError(rememberWarning);
  }

  function handleCancelFileLink() {
    setPendingFileLink(null);
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
      setLoadError(
        loadFailure instanceof Error ? loadFailure.message : String(loadFailure),
      );
      setLoadErrorBackend('localStorage');
      setLoadError(describeError(loadFailure));
      return [];
    }
  }

  /**
   * The linked file's current pins, re-read immediately before every write —
   * the file-backed equivalent of `storedPinsForWrite`, same read-modify-
   * write discipline, same "return [] and let the write become the recovery"
   * contract on corrupt content. A read failure that isn't corrupt content
   * (permission revoked mid-session, the file moved or was deleted) has
   * nothing to snapshot and no safe automatic fallback, so it throws instead
   * — the caller's existing try/catch turns that into a named saveError, the
   * write is refused, and nothing is lost (see the decision log for why this
   * doesn't auto-fall-back to localStorage the way startup reconnect does).
   */
  async function readLinkedPinsForWrite(handle: FileSystemFileHandle): Promise<Pin[]> {
    let raw: string;
    try {
      raw = await readFile(handle);
    } catch (cause) {
      throw new PinStoreError('could not read the linked file', { cause });
    }
    try {
      return parsePinsPayload(raw);
    } catch (parseFailure) {
      if (fileCorruptBackupRef.current === null) {
        fileCorruptBackupRef.current = backupRawAsCorrupt(storage, raw);
      }
      setLoadError(
        parseFailure instanceof Error ? parseFailure.message : String(parseFailure),
      );
      setLoadErrorBackend('file-corrupt');
      return [];
    }
  }

  /** Synchronous localStorage count — the piece `countStoredPins` below
   * shares with `linkFile`'s pending-link confirmation, which needs a plain
   * number (not a Promise) since it's read before anything is linked. */
  function countStoredPinsSync(): number | null {
    try {
      return loadPins(storage).length;
    } catch {
      return null;
    }
  }

  /**
   * How many pins are actually in the active backend right now, or null if
   * it's unreadable. Used only to word an import/link confirmation or banner
   * honestly — `pins.length` (React state) is what was last loaded or saved,
   * not necessarily what's about to be destroyed by a replace (see
   * docs/reviews/Unit 3 Section B - export-import JSON.md F2).
   *
   * Returns a plain value for localStorage (synchronous) or a Promise for a
   * linked file (reading it is inherently async) — `ImportExport`'s
   * `getSavedCount` prop accepts either, and `await`ing either works.
   */
  function countStoredPins(): number | null | Promise<number | null> {
    if (linkedHandle) {
      return readFile(linkedHandle)
        .then((raw) => parsePinsPayload(raw).length)
        .catch(() => null);
    }
    return countStoredPinsSync();
  }

  /**
   * The pins to export, read fresh from the active backend rather than
   * `pins` (React state) — the file-linked equivalent of `storedPinsForWrite`
   * /`readLinkedPinsForWrite`, but for a read-only export rather than a
   * write. Before Unit 6, exporting React state was fine because App was the
   * only writer of localStorage; a linked file expects an external writer
   * (`git pull`), so exporting stale state could silently produce a
   * "backup" that omits pins pulled since the tab opened (see
   * docs/reviews/Unit 6 - git syncable storage.md F3). Rejects (rather than
   * falling back to something partial) if the linked file can't be read, so
   * `ImportExport` can show a named error instead of downloading a lossy
   * file.
   */
  function pinsForExport(): Pin[] | Promise<Pin[]> {
    if (linkedHandle) {
      return readFile(linkedHandle).then(parsePinsPayload);
    }
    return storedPinsForWrite();
  }

  async function handleMapClick(lat: number, lng: number) {
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
      if (linkedHandle) {
        next = [...(await readLinkedPinsForWrite(linkedHandle)), created];
        await writeFile(linkedHandle, serializePinsForFile(next));
      } else {
        next = [...storedPinsForWrite(), created];
        savePins(storage, next); // persist explicitly, never via a mount effect
      }
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

  async function handleSaveEdits(edits: {
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
      if (linkedHandle) {
        next = replacePin(await readLinkedPinsForWrite(linkedHandle), updated);
        await writeFile(linkedHandle, serializePinsForFile(next));
      } else {
        next = replacePin(storedPinsForWrite(), updated);
        savePins(storage, next);
      }
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
  async function handleDeletePin(id: string) {
    let current: Pin[];
    try {
      current = linkedHandle ? await readLinkedPinsForWrite(linkedHandle) : storedPinsForWrite();
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
      if (linkedHandle) {
        await writeFile(linkedHandle, serializePinsForFile(next));
      } else {
        savePins(storage, next);
      }
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
  async function handleUndoDelete() {
    if (!deleteInfo) return;
    const { pin } = deleteInfo;

    let current: Pin[];
    try {
      current = linkedHandle ? await readLinkedPinsForWrite(linkedHandle) : storedPinsForWrite();
    } catch (e) {
      // storedPinsForWrite()/readLinkedPinsForWrite() can throw (an unreadable
      // store whose corrupt snapshot also failed) — that used to escape this
      // handler uncaught, leaving the Undo button on screen doing nothing
      // forever with no banner telling the user why (see
      // docs/reviews/Delete a pin.md F4).
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
      if (linkedHandle) {
        await writeFile(linkedHandle, serializePinsForFile(next));
      } else {
        savePins(storage, next);
      }
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
   * actually commits it, so App stays the only thing that touches storage
   * (localStorage or, once linked, the file).
   *
   * Unlike the add/edit paths this does NOT read the current pins first: a
   * replace means replace, and re-merging in whatever another tab wrote
   * since would silently turn this from "replace" into "replace-most-of",
   * defeating the confirmation the user just saw the counts for.
   */
  async function handleImportReplace(imported: Pin[]) {
    let previousCount: number | null;
    let backupKey: string | null;
    try {
      if (linkedHandle) {
        // A failed read means there is nothing safe to snapshot — this must
        // hard-abort the replace exactly the way a failed backupBeforeImport
        // aborts the localStorage path below, rather than silently skipping
        // the snapshot and writing anyway while telling the user nothing was
        // there (see docs/reviews/Unit 6 - git syncable storage.md F1: this
        // used to destroy the file's contents with no backup and no undo).
        let raw: string;
        try {
          raw = await readFile(linkedHandle);
        } catch (cause) {
          throw new PinStoreError('could not read the linked file before replacing it', {
            cause,
          });
        }
        if (raw === '') {
          // Genuinely empty file, not a read failure — nothing to back up,
          // and 0 (not null/"unreadable") is the honest previous count.
          previousCount = 0;
          backupKey = null;
        } else {
          // Readable bytes — back them up regardless of whether they parse:
          // corrupt content discovered on an already-linked file is treated
          // the same as any other unreadable linked-file read (Assumption 5),
          // and here we HAVE the bytes to rescue.
          backupKey = backupRawBeforeReplace(storage, raw);
          try {
            previousCount = parsePinsPayload(raw).length;
          } catch {
            previousCount = null;
          }
        }
        await writeFile(linkedHandle, serializePinsForFile(imported));
      } else {
        // Read BEFORE importPins's own snapshot-then-write, and from storage,
        // not `pins`: the banner has to name what was actually just
        // destroyed, not what this tab's in-memory state happened to say a
        // moment ago.
        previousCount = countStoredPinsSync();
        ({ backupKey } = importPins(storage, imported));
      }
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

  /**
   * The load-error banner's copy, keyed off `loadErrorBackend` rather than
   * guessing from which of the two backup refs happens to be non-null.
   * Before this, `corruptBackupRef.current ?? fileCorruptBackupRef.current`
   * could name the WRONG rescue key when both localStorage and a linked file
   * had failed in the same session — the key shown came from whichever ref
   * was set first, but the message text described whichever error happened
   * MOST RECENTLY (see docs/reviews/Unit 6 - git syncable storage.md F9).
   * Also fixes F11: a hard, unrecoverable read failure on a linked file
   * (F2's `'file-unreadable'`) is not a corrupt-content case — nothing was
   * backed up, nothing needs to be, and localStorage (never touched while
   * linked) is still exactly what's shown and being written to, so the old
   * "new pins you add will overwrite it" copy was actively false there.
   */
  function describeLoadError(): string {
    if (loadErrorBackend === 'file-unreadable') {
      return `Couldn’t read the linked file: ${loadError}. Your browser-saved data is untouched and stays active — use Reconnect below to try the file again.`;
    }
    const backupKey =
      loadErrorBackend === 'file-corrupt' ? fileCorruptBackupRef.current : corruptBackupRef.current;
    return backupKey === null
      ? `Couldn’t read saved pins: ${loadError}. Your saved data is untouched; new pins you add will overwrite it.`
      : `Couldn’t read saved pins: ${loadError}. The unreadable data was copied to “${backupKey}” before anything else is saved, so nothing is lost — recover it from there.`;
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
            {describeLoadError()}
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

        <DataFileLink
          supported={isFileSystemAccessSupported()}
          linkedFileName={linkedHandle?.name ?? null}
          reconnectFileName={reconnectHandle?.name ?? null}
          pendingLink={
            pendingFileLink && {
              fileName: pendingFileLink.fileName,
              savedCount: pendingFileLink.savedCount,
              importCount: pendingFileLink.pins.length,
            }
          }
          error={fileLinkError}
          reconnectPending={reconnectPending}
          onChooseExisting={handleChooseExisting}
          onCreateNew={handleCreateNew}
          onReconnect={handleReconnect}
          onConfirmLink={handleConfirmFileLink}
          onCancelLink={handleCancelFileLink}
          onUnlink={handleUnlink}
        />

        <ImportExport
          getSavedCount={countStoredPins}
          getPinsForExport={pinsForExport}
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
              the same mount-time fit — it only advances on a confirmed import
              (or Unit 6 link/reconnect), which forces the remount that applies
              the recomputed view. */}
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
