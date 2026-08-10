# Unit 6 — Git-syncable storage

## Why this, why now

`docs/roadmap.md`'s Unit 6 was scoped and specced directly (2026-08-05, `[decided]` in the progress log) as
the first of three requested units, sequenced first because it's the riskiest, most foundational change —
everything Unit 7 (multi-view) and Unit 8 (visual redesign) build on top of whatever storage shape results
here. `localStorage` is one browser profile on one machine; Unit 3B's export/import gave a manual escape
hatch (download a file, upload it back) but that's a backup mechanism, not sync — using the tracker from a
second device meant remembering to export, moving the file yourself, and importing on the other end, every
time. The File System Access API lets the browser read/write a real file on disk with the user's
permission, so pointing it at a git-tracked file and letting the user's own `git push`/`pull` be the sync
mechanism adds zero network surface and no server — squarely inside `CLAUDE.md`'s "no backend, no
accounts" charter, which is why the Done-when's last bullet requires `CLAUDE.md` to say so explicitly
rather than read as if it forbids the very thing just built.

## Codebase impact

**New:**
- `src/types/file-system-access.d.ts` — ambient declaration merging for `showOpenFilePicker`/
  `showSaveFilePicker`/`queryPermission`/`requestPermission`, none of which are in this project's bundled
  TypeScript's `lib.dom.d.ts` yet (confirmed by grepping it before writing anything).
- `src/storage/fileStorage.ts` — thin async wrapper over the File System Access API: feature detection,
  the two pickers, read/write (write aborts rather than closes on a failed write, so a partial write can't
  land), and the two permission calls.
- `src/storage/fileHandleRegistry.ts` — remembers the one linked handle across reloads via IndexedDB,
  feature-detected and a safe no-op with no `indexedDB` available (which is exactly jsdom's situation, so
  every pre-existing test needed zero changes).
- `src/components/DataFileLink.tsx` (+ `.test.tsx`) — the sidebar control: unsupported-browser note,
  choose/create buttons, a pending-link confirm/cancel step, a reconnect prompt, a linked-file status line.
  Purely presentational; every File System Access call lives in `App`.
- `src/test/fakeFileHandle.ts` — a shared in-memory `FileSystemFileHandle` test double (writes land only
  on `close()`, `abort()` discards them, permission is independently queryable/requestable), used by
  `fileStorage.test.ts` and `App.test.tsx` so its behaviour is defined once.
- `src/storage/fileStorage.test.ts`, `src/storage/fileHandleRegistry.test.ts`, `src/components/
  DataFileLink.test.tsx` — new suites, 26 tests total.
- `package.json` — added `fake-indexeddb` as a devDependency so `fileHandleRegistry`'s real IndexedDB
  round-trip could be genuinely tested rather than left a blind spot (jsdom doesn't implement IndexedDB at
  all).

**Changed:**
- `src/storage/pinStore.ts` — `parsePinsPayload(raw: string | null)` extracted from `loadPins` (now a
  one-line wrapper around it) so a linked file's content goes through the *exact* same validation boundary
  localStorage's does — a git-conflict-mangled file fails as "not valid JSON," no special-casing needed.
  `writeSnapshot` now takes `raw` as a parameter instead of reading `storage.getItem(STORAGE_KEY)` itself;
  `backupCorruptStore`/`backupBeforeImport` read that themselves before calling it (unchanged external
  behaviour, confirmed by the full pre-existing 22-test suite passing untouched), and two new exports
  (`backupRawAsCorrupt`, `backupRawBeforeReplace`) let a linked file's bytes go through the identical
  backup/prune machinery.
- `src/components/ImportExport.tsx` — `getSavedCount`'s type widened to `() => number | null | Promise<number
  | null>` and `await`ed in `reader.onload` (already an async boundary), so App can back it with an async
  file read once linked, with zero changes needed to existing sync-returning test mocks (`await 2`
  resolves immediately).
- `src/App.tsx` — the bulk of the unit. New state (`linkedHandle`, `reconnectHandle`, `pendingFileLink`,
  `fileLinkError`, `fileCorruptBackupRef`), a `useCallback`'d `adoptLinkedFile`, a mount-time reconnect
  effect, the first-link flow (`linkFile`/`handleChooseExisting`/`handleCreateNew`/
  `handleConfirmFileLink`/`handleCancelFileLink`/`handleReconnect`), and every existing write handler
  (`handleMapClick`, `handleSaveEdits`, `handleDeletePin`, `handleUndoDelete`, `handleImportReplace`,
  `countStoredPins`) now branches on `linkedHandle`. See Assumption 1 below — this is the single most
  load-bearing design decision in the unit.
- `src/index.css` — `.data-file-link*` rules, mirroring `.import-export*`'s existing structure and the
  same class+element specificity fix Unit 3B's review caught (`docs/reviews/Unit 3 Section B -
  export-import JSON.md`) applied preemptively to `.data-file-link__cancel`.
- `CLAUDE.md` — Structure section and standing order #2, per the Done-when's last bullet (see below).

## Load-bearing assumptions

1. **Every write handler is declared `async function`, but the localStorage branch contains zero `await`
   expressions.** (Load-bearing — this is the bet the whole unit rests on.) An async function with no
   executed `await` on a given call runs synchronously to completion before returning a resolved promise
   to the caller — so when `linkedHandle` is `null` (every pre-existing test's world), calling e.g.
   `handleMapClick` executes the *entire* body synchronously, exactly matching pre-unit-6 behaviour. This
   is why all 143 pre-existing tests — many of which do `fireEvent.click(...)` immediately followed by a
   synchronous `expect(stored())` with no `await`/`waitFor` — needed **zero modifications** and still pass.
   Verified directly: ran the full suite after the App.tsx rewrite before touching a single existing test,
   all 177 passed on the first run. **This is also the sharpest future landmine**: any edit that adds an
   `await` to the `else` (localStorage) branch of any handler — even one that looks harmless, like
   `await Promise.resolve()`— will silently break every synchronous assertion in `App.test.tsx` that
   follows a `fireEvent.click` with no `await`. Flagging this explicitly for the reviewer and for future
   units.
2. **Backups (corrupt-content rescue, pre-replace snapshot) always land in `localStorage`, regardless of
   which backend is primary.** (Load-bearing.) The File System Access API gives no reliable way to get a
   *parent directory* handle from a file obtained via `showOpenFilePicker`/`showSaveFilePicker` — there's
   no `getParent()` on `FileSystemFileHandle` — so writing a sibling backup file next to a linked file
   isn't available without asking for separate directory access, which is a materially bigger permission
   ask than this unit's Done-when calls for. `localStorage` is the one medium always writable regardless
   of backend, so `backupRawAsCorrupt`/`backupRawBeforeReplace` always target it, reusing the *existing*
   `CORRUPT_BACKUP_PREFIX`/`IMPORT_BACKUP_PREFIX` keys and pruning rather than inventing file-specific
   ones.
3. **First link is reachable only while nothing is linked yet.** (Load-bearing — shapes several other
   decisions below.) `DataFileLink`'s `linked` branch renders a status line only, no Choose/Create
   buttons, so there is no in-app "switch to a different file" or "unlink" affordance. This sidesteps a
   real complexity a relink flow would add (is "currently shown" the old file's content or localStorage's?
   does relinking forget the old handle?) that the roadmap's Done-when never asks for — see "what I did
   NOT do" below.
4. **A hard read failure on an already-linked file throws and refuses the write; a denied/pending
   permission at startup instead surfaces a Reconnect control and continues on localStorage.** (Load-
   bearing — two failure modes that look similar but get deliberately different treatment.) At startup,
   nothing has been committed to the file yet, so falling back to localStorage is safe and is what lets
   the app start at all. Mid-session, after a write has already been attributed to "the linked file" in the
   user's mental model, silently rerouting a write to localStorage instead would be a worse surprise than
   a refused write with a named error — the user would believe their pin is synced when it isn't. Guarded
   by a dedicated App-level test (revoke `getFile()` after linking, attempt an add, assert a named alert
   and that localStorage was never silently used) and by planting the opposite behaviour (see Self-review).
5. **A corrupt file discovered at first-link time is rejected outright — nothing adopted, nothing backed
   up — while a corrupt file discovered on an already-linked file (via reconnect, or a write) IS backed up
   and proceeds with an empty set.** (Load-bearing, and the one place I'd most want the reviewer's second
   opinion — see Least confident spots.) At first-link time nothing has been adopted as "the store" yet, so
   there's nothing meaningful to back up; the honest response is a clean rejection leaving the pre-existing
   localStorage-backed state completely untouched. Once a file *is* the store, an unreadable read (a
   git-conflict-mangled pull, e.g.) gets the exact same "backed up aside, named error, no crash" treatment
   a corrupt `localStorage` read gets today. Both paths are tested (`App.test.tsx`: cancel-on-invalid at
   link time is covered indirectly by the "not a valid backup" `fileLinkError` path; the corrupt-on-adopt
   path has its own dedicated test with real `<<<<<<<` conflict markers).
6. **`useCallback(adoptLinkedFile, [])` is correct, not just convenient.** Every value the callback closes
   over — `useState` setters, a `useRef`, module-level imports — is referentially stable across renders, so
   an empty dependency array is accurate. This is what lets the mount-time reconnect effect list
   `adoptLinkedFile` as a dependency without either an infinite-effect risk or a disabled `react-hooks/
   exhaustive-deps` rule. Confirmed: `npm run lint` is 0 warnings, not just 0 errors.

## What I deliberately did NOT do

- **No "Unlink" or "switch to a different file" control.** Once linked, there is no in-app path back to
  localStorage-only or to a different file, short of clearing site data (which also forgets the IndexedDB
  handle). The roadmap's Done-when asks for first link + reconnect-after-reload, not ongoing file
  management, and building a relink flow now would have reopened exactly the "what does 'currently shown'
  mean" complexity Assumption 3 sidesteps. Real gap, deliberately left — flagging it rather than quietly
  shipping around it.
- **No directory-handle / sibling-file backups** (Assumption 2) — backups always go to `localStorage`.
- **No live file-watching or automatic re-read while the app is open** (explicitly excluded by the
  roadmap).
- **No merge/conflict-resolution UI.** A git-conflicted file is unreadable content like any other; it gets
  backed up and named-error'd, and the user resolves the conflict the same way they'd resolve one in any
  other tracked file — in their editor or git tool, outside the app.
- **No automated git operations** (explicitly excluded — commit/push/pull stay entirely manual).
- **In-browser verification was not performed this session.** Every prior unit's build note in this repo
  reports a Chrome walkthrough; this one doesn't, because the Claude-in-Chrome extension wasn't connected
  when I tried. I'm not fabricating one. What I have instead: 186 automated tests (50 in `App.test.tsx`
  alone, 8 of them new Unit-6 integration tests driving a real `FileSystemFileHandle`-shaped fake through
  the actual `App` component and its Leaflet map), a clean `tsc --noEmit`, a clean `eslint .` (zero
  warnings, not just zero errors), a clean production build, and four self-proving plant/revert cycles
  (below) that exercise the exact failure modes a human walkthrough would probe. But nobody has clicked
  the real native file picker in a real Chrome window against this code yet — flagging this as the honest
  state of verification, and recommending the reviewer (or the user) do a real-browser pass specifically
  for the two things a fake handle can't prove: that the real native picker dialogs actually appear and
  behave as expected, and that a real permission-prompt dialog on reconnect looks right.

## Self-review

Ran core-logic correctness, the acceptance bar (roadmap Unit 6's "Done when," bullet by bullet),
reproducibility, boundaries/types, and meaningful-tests against the finished code:

- **Core-logic correctness:** `pinStore.ts`'s refactor is behavior-preserving by construction
  (`parsePinsPayload` is the exact logic `loadPins` used to inline; `loadPins` itself is now a one-line
  wrapper) — confirmed by the pre-existing 22 tests passing unmodified, plus 7 new ones for the extracted/
  added exports. `fileStorage.ts`'s read/write/permission/abort-on-failure logic has 12 dedicated tests
  against the shared fake handle.
- **Acceptance bar:** every Done-when bullet has a corresponding test — link via choose/create (2 tests),
  empty-file seeds (1), existing-file confirms-and-replaces-and-routes-subsequent-writes (1 meaty test),
  cancel-the-confirmation (1), cancel-the-picker (1), persists across reload (mocked at the registry-module
  boundary in App tests since a function-bearing fake handle can't survive fake-indexeddb's structured
  clone — see `fileHandleRegistry.test.ts`'s own comment — but the *real* IndexedDB round-trip is verified
  there against a clonable stand-in, 6 tests), reconnect needs at most one click (2 tests: granted-after-
  request, denied-keeps-retry-available), unsupported-browser fallback (1), corrupt-linked-file handling
  (1), mid-session read failure refuses rather than silently reroutes (1, added after noticing the gap
  while drafting this note — see below), `CLAUDE.md` updated (Structure + standing order #2).
- **Reproducibility:** no new stochastic input; the new backup functions reuse the existing injectable
  `now: () => number` parameter pattern already established by `backupCorruptStore`/`backupBeforeImport`.
- **Boundaries/types:** `parsePinsPayload` is now the single shared validation boundary for both storage
  media — proven, not assumed, by a dedicated test feeding it real `<<<<<<<`/`=======`/`>>>>>>>` conflict
  markers and confirming it fails as plain invalid JSON, no special-casing anywhere in the codebase for
  that case.
- **Meaningful tests, not smoke tests:** see the four plant/revert cycles below — while drafting this
  self-review I realized I had *zero* coverage for Assumption 4's "mid-session read failure" claim (I'd
  written the design decision but not a test for it), added
  `'refuses a write and names the failure, rather than silently switching backends, when the linked file
  becomes unreadable mid-session'` to `App.test.tsx`, and only then wrote this note — the assumption is now
  actually guarded, not just asserted in prose.

**Self-proving — 4 regressions planted, run, restored, `git diff`/grep confirmed no leftover markers:**
1. Removed the empty-file seed branch in `linkFile` (forcing an empty file through `parseImportPayload`
   like any other content, which throws on empty-string-is-not-JSON) — failed exactly `'links a brand-new
   empty file by seeding it with the pins currently shown'`.
2. Skipped the pre-link `backupBeforeImport` snapshot in `handleConfirmFileLink` — failed exactly the
   backup-key assertions in `'links an existing file behind a confirmation naming both counts, then routes
   every write to it'`.
3. Made `readLinkedPinsForWrite` swallow a hard read failure and return `[]` instead of throwing (the
   opposite of Assumption 4) — failed exactly `'refuses a write... when the linked file becomes unreadable
   mid-session'` (the pin got silently added instead of the write being refused — precisely the failure
   mode that test exists to catch).
4. Swapped `backupRawAsCorrupt`'s prefix from `CORRUPT_BACKUP_PREFIX` to `IMPORT_BACKUP_PREFIX` (a
   plausible copy-paste mistake) — caught at **two** layers independently: the dedicated `pinStore.test.ts`
   unit test, and the App-level `'backs up an unreadable linked file...'` integration test (which looks for
   a `CORRUPT_BACKUP_PREFIX` key and finds none).

Re-ran the full gate after each revert; final state: `npm run typecheck` clean · `npm run lint` clean (0
warnings) · `npm test` **186 passed** (12 files; was 143) · `npm run build` succeeds.

## Least confident spots (reviewer: look here first)

1. **Assumption 5 — the first-link-vs-already-linked split on corrupt content is an interpretation call,
   not something the roadmap states explicitly.** The Done-when's literal text is "an unreadable linked
   file... is treated exactly like a corrupt localStorage read." I read "linked" as "already adopted," so a
   file that's corrupt *before* it's ever adopted (discovered during the first-link flow's `parseImportPayload`
   call) just gets a clean rejection with nothing backed up — reasoning that there's nothing to back up
   *from*, since we never made it the store. But a reviewer could reasonably read the bullet as covering the
   pick-a-bad-file-by-mistake case too, in which case I'd want the first-link rejection path to also snapshot
   the (never-adopted) file's bytes somewhere — which raises the question of *where*, since nothing was ever
   "the store" to back up *from* at that point. I'd rather have this checked than assume my reading is the
   only reasonable one.
2. **The two mount-time effects (localStorage load, and the Unit 6 reconnect check) run concurrently and
   independently, both with `[]` deps.** When a remembered handle's permission is already `'granted'` (the
   ordinary case within one browser session, not across a full restart), the reconnect effect's async chain
   (`recallFileHandle` → `queryReadWritePermission` → `readFile` → `adoptLinkedFile`'s `setPins`/
   `setInitialView`/`setMapEpoch`) resolves *after* the synchronous localStorage effect has already set
   `pins`/`initialView` from localStorage — so `MapView` mounts once against localStorage's pins, then
   immediately remounts (via the `mapEpoch` bump) against the file's, the same visible mechanism a confirmed
   import already uses. I reasoned this is an imperceptibly brief flash in practice (both are fast local I/O
   within the same task) and not worth a "hold the map back until both effects settle" mechanism, but I did
   not write a test that captures the *intermediate* render (only the eventual, settled DOM), and the
   `loadError` banner's `corruptBackupRef.current ?? fileCorruptBackupRef.current` merge (used to decide
   which of two possible backup keys to name) hasn't been exercised by a test where *both* refs are
   simultaneously non-null — only the file-only-corrupt case is tested. Worth the reviewer's own read of
   whether that race is actually as harmless as I judged it to be.
