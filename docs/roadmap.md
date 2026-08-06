# Roadmap — planned units

Where a unit's acceptance criteria live *before* it is built. `/build <unit>` reads its section here as
the spec; `/review <unit>` judges against it. Decision logs (written after) go in `docs/build_notes/`,
the running record of what happened in `docs/progress_log.md`.

Units 1–2 are done; see the progress log.

---

## Unit 3 — "See it all, and keep it"

Two sections. Both close gaps that unit 2's review or use exposed, and neither adds a backend, an
account, or a network call — the store is still `localStorage`, the app is still standalone.

### Section A — Fit the map to the pins

**Problem.** `MapView` hardcodes `center={[40.7128, -74.006]} zoom={12}` (NYC) and never fits to the
data. For leads anywhere else, every load opens on an empty patch of Manhattan and the pins exist but
are invisible until you pan to them. `CLAUDE.md`'s "Winning" sentence is *at a glance I can see where my
strong, weak, and failed leads sit* — today that only holds if your leads happen to be in New York.
Flagged as a MINOR in `docs/reviews/Unit 2 - notes + editing per pin.md`.

**Done when.** From a clean checkout with pins saved outside NYC, loading the app shows **every** pin in
the viewport without panning or zooming:
- On mount with ≥ 2 pins: fit the view to their bounding box, with enough padding that edge pins aren't
  under the sidebar or clipped at the edges.
- With exactly 1 pin: center on it at a readable zoom (a bounding box of one point has no extent).
- With 0 pins: keep today's default view — there is nothing to fit.
- **Fit on mount only.** It must not re-fit on every save, or adding a pin would yank the map out from
  under you mid-edit. Panning and zooming after load stick until the next reload.

**Not in this section.** Persisting the map view across reloads (deferred since unit 1 — decide it
separately; it partly conflicts with fit-on-mount and needs its own answer about which wins).

### Section B — Export / import JSON

**Problem.** `localStorage` is one browser profile on one machine, with no way to get the data out. A
new laptop, a different browser, or "clear browsing data" loses every visit note, and notes are prose
that cannot be reconstructed. The corrupt-store backup added in unit 2 protects against bad *data*; it
does nothing about any of this. This is the section that makes the tracker safe to actually rely on.

**Done when.** From a clean checkout:
- **Export:** one control in the sidebar downloads every pin as a JSON file — position, name, strength
  and notes, byte-for-byte what round-trips back in. Filename carries the date
  (e.g. `restaurant-map-2026-08-03.json`). Purely local: `Blob` + `URL.createObjectURL`, no upload.
- **Import:** pick a file (`<input type="file">` + `FileReader`), and the pins in it become the pins on
  the map and in `localStorage`.
- **Round-trip is lossless and verified by test:** export → wipe the store → import the same file →
  the store is byte-identical to before, notes and line breaks intact.
- **Import validates at the boundary like everything else.** Every record goes through `parsePin`; any
  invalid record, a duplicate id, or a non-array payload rejects the **whole file** with a named error
  and leaves the current store untouched. Never a partial import — half your leads is worse than a
  clear failure.
- **Import cannot destroy data silently.** Before replacing the store, snapshot the current one aside
  (same mechanism as `backupCorruptStore`) and tell the user where it went. Since import is a *replace*
  (see below), this snapshot is the only undo — treat a failed snapshot as a hard abort, exactly as the
  corrupt-store backup does.
- Legacy files load: a JSON array of unit-1 records with no `notes` key imports with empty notes, on the
  same terms as `loadPins`.

**Settled 2026-08-04: import REPLACES the whole store.** Not merge-by-id, not additive. One import
control, behind an explicit confirmation naming the counts ("replace 12 saved leads with the 9 in this
file?"), with the pre-import snapshot as the undo.

Why replace, given the code as it stands:
1. **`Pin` has no timestamp.** With no `updatedAt`, "newest wins" — the only conflict rule a user would
   find intuitive — is not implementable. What remains is "file wins" or "store wins", which is replace
   applied one pin at a time, and it's the *worse* version: on a conflicting pin one side's notes vanish
   **inside** a lead you have no reason to open. Replace loses data visibly and predictably; per-pin
   merge loses prose invisibly. The payload here is free-form prose — a wrong strength shows up as a
   wrong color, but three paragraphs silently reverting to an older draft does not.
2. **Ids are `crypto.randomUUID`.** A matching id therefore means genuinely the same pin, so merge-by-id
   is at least coherent — but the same physical restaurant pinned on two machines gets two *different*
   ids, so merge unions them into overlapping duplicate pins. Merge doesn't deliver what people want
   from sync; it delivers duplicates.
3. **There was no delete yet.** Those duplicates would have been permanent until a later unit shipped
   one. *(Now does: Unit 4, below — this was true when the decision above was made, not any more.)*

Rejected alternative — **additive-only** ("import ids not already present, never touch existing"): needs
no conflict rule and is ~5 lines more than replace, but it is wrong for the case that motivates this
section. Restoring a backup into a non-empty store would silently ignore the file's version of every pin
you already have — precisely the notes you were trying to recover.

**If two-machine use turns out to be real, that's a sync unit, not a section of this one**, and its
honest prerequisite is `updatedAt` on `Pin` (making "newest wins" implementable) — delete now exists
(Unit 4, below), so duplicates from a merge would at least be fixable, but merge-by-id is still rejected
outright until there's a conflict rule to drive it.

**Not in this section.** Cloud sync, automatic/scheduled backups, CSV or any other format, a merge or
conflict-resolution UI, sharing. Merge-by-id and additive import are rejected outright above, not
deferred — building either later means first adding `updatedAt`.

---

## Unit 4 — Delete a pin

**Problem.** A lead placed by mistake, duplicated, or no longer real has no way off the map except
editing every field into nonsense. Parked in "Later" since unit 2 — *"wants its own confirm/undo story;
deliberately excluded from unit 2's editing"* — because a delete is irreversible by nature, unlike an
edit.

**Done when.** From a clean checkout:
- A pin can be removed from the map and `localStorage` from its own open editor — the same interaction
  surface editing already uses, not a separate control on the map marker/popup.
- **The delete is confirmed, not one-click.** A first click arms a confirmation naming the pin; only an
  explicit second click actually removes it.
- **The delete is recoverable in-session.** Immediately after a confirmed delete, an Undo control
  restores the exact removed pin — id, position, strength, and notes, byte-for-byte — not a persisted or
  multi-level history, just the single most recent delete. It stays available through ordinary
  reads/writes (selecting a pin, adding one, editing one) and is only superseded by something that
  actually invalidates it: a newer delete, or a whole-store import replace. It does not need to survive
  a page reload.
- **Delete and undo obey the same write discipline as every other write.** Both re-read the store
  immediately before writing, acting on the pin actually in storage rather than a possibly-stale
  in-memory copy, so a stale tab cannot silently clobber — or resurrect an outdated version of — a pin
  another tab touched since this one loaded.
- **Undo refuses to write over a reused id.** `loadPins` treats two pins sharing an id as a corrupt
  store; if the deleted id has reappeared since the delete (e.g. another tab imported a backup
  containing it), undo declines rather than writing a duplicate.
- A delete attempted on a pin another tab already removed fails loud with a named error and resyncs this
  tab's view, rather than leaving a marker on screen for a pin that no longer exists anywhere.

**Not in this unit.** Bulk/multi-select delete, deleting from the map marker/popup directly, a persisted
or multi-level undo history, undo surviving a page reload.

Reviewed 2026-08-04: `docs/reviews/Delete a pin.md`. Findings F1–F6 landed; closed and mergeable.

---

## Unit 5 — Filter / search leads

**Problem.** As the number of pins grows, the map's "at a glance" promise (`CLAUDE.md`'s Winning
sentence) degrades: there is no way to ask "just my strong leads" or find a pin by something written in
its notes short of panning around reading every popup. Parked in "Later" since unit 2's review.

**Done when.** From a clean checkout, with pins of mixed strength and notes saved:
- A sidebar control lets the user narrow which strengths are shown (strong / weak / failed,
  independently toggleable) and enter a text query.
- **Search matches case-insensitively against both the pin's name and its notes.** A restaurant is
  findable by what happened there, not only by what it's called.
- Strength selection and the text query combine as AND, not OR: a pin must satisfy both to be visible.
- **Filtering only changes which pins render as markers.** It never re-fits or otherwise moves the map —
  Section A's "fit on mount only" rule is untouched, since a filter is a view of the same store, not a
  new mount.
- The sidebar names what's filtered ("Showing N of M leads") and offers a one-click way to clear back to
  showing everything, including from a zero-match state.
- Filtering never touches `localStorage`, pin data, the current selection, or the add-pin flow — it is
  read-only and cannot lose or corrupt anything, unlike every other unit so far. Clearing the filters
  always restores the full set exactly as stored.

**Not in this unit.** A dedicated list view of leads (a second, larger surface — a filterable map is the
smaller, higher-value slice; a list view is a legitimate future unit but is not required to make the map
itself filterable). Sorting. Saved/named filters. Fuzzy or ranked search. Filtering by position
(map-region search) — text and strength only.

---

## Unit 6 A — Persist the map view across reloads

**Problem.** Section A's own "Not in this section" named this as deferred, needing its own answer to a
conflict it didn't resolve: *"it partly conflicts with fit-on-mount and needs its own answer about which
wins."* Without it, every reload re-fits to every saved pin, which is right on a first-ever load but
wrong for an ordinary working session — zoom into the neighbourhood you're actually visiting, refresh,
and get yanked back out to a fit over every lead you've ever saved. Built directly from this "Later"
bullet with no prior spec; the Done-when below is written retroactively from what the review
(`docs/reviews/persist map view across reloads.md`) actually held it to.

**Done when.** From a clean checkout, with pins saved:
- **A saved pan/zoom wins over fitting the pins** on the next load, regardless of pin count — the
  position answers "where was I looking," independent of "what's there."
- **The saved view is independent of pin-store health**: a corrupt pins key does not block reading or
  honoring a perfectly good saved view, and vice versa.
- **A bad/corrupt saved view record fails soft** (falls back to fitting the pins), never crashes the app
  and never needs its own error banner or backup ceremony — unlike pin data, a lost view preference is
  fully and cheaply recoverable by refitting.
- **Only a real user gesture persists a view.** An incidental window resize (Leaflet's `trackResize` ->
  `invalidateSize` -> `moveend`) must never overwrite — or create — a saved view on its own.
- **What gets saved is what can be loaded back.** A pan past the antimeridian (Leaflet's `getCenter()` is
  unwrapped) must still round-trip through a reload, not silently fail validation and fall back to the
  fit with no error.
- **There is always a way back.** However the saved-view-wins answer is implemented, the app must offer
  an in-app control that re-fits to every saved pin — a saved view can never be a one-way door that
  stranded panning plus a reload cannot recover from.
- **A confirmed import clears the saved view**, so the reload right after a restore fits the *new* pins,
  not the pre-import position (the same failure shape as Unit 3 Section B's F1, one step later).

**Not in this unit.** Configuring or disabling the behaviour. A `.v2` migration story for the view key
(no legacy shape exists yet). Persisting keyboard arrow-key panning (Leaflet's `panBy` fires `moveend`
but not `dragend`; accepted as an edge case for a mouse/touch-first tool).

Reviewed 2026-08-05: `docs/reviews/persist map view across reloads.md`. Findings F1–F7 landed; closed
and mergeable.

## Unit 6 B— Git-syncable storage

**Problem.** `localStorage` is one browser profile on one machine. Unit 3B's Export/Import gives a manual
escape hatch (download a file, upload it back), but it's a *backup* mechanism, not a *sync* one — using
the tracker from a second device today means remembering to export, moving the file yourself, and
importing on the other end, every single time. Requested directly: multi-device access, without adding
the backend/database/server/accounts `CLAUDE.md`'s standing orders name as drift for this project.

**Approach.** The File System Access API (`showOpenFilePicker` / `showSaveFilePicker`) lets the browser
read and write a real file on disk with the user's permission — no server in between. Point it at a file
inside this git repo (`data/pins.json`); committing and pushing/pulling that file through the user's
normal git workflow *is* the sync. The app never talks to git itself — it only reads and writes bytes at a
path the user chose.

**Done when.** From a clean checkout, in a Chromium browser (Chrome/Edge):
- A sidebar control ("Link a data file") lets the user pick or create `data/pins.json` via the File System
  Access API. Once linked, every read and write (add, edit, delete, import/export) goes through that file
  instead of `localStorage`, via the same read-modify-write discipline the store already uses for every
  other write (re-read immediately before writing, so a stale tab can't clobber a concurrent one — same
  rule, new medium).
- **The link persists across reloads in the same browser.** The `FileSystemFileHandle` is remembered
  (stored via IndexedDB, still entirely local — not a new external dependency); reconnecting needs at most
  one permission-confirmation click per session, never a full re-pick of the file.
- **Linking for the first time reuses Unit 3B's import machinery, not a new one.** If the chosen file is
  empty/new, seed it from whatever is currently in `localStorage`. If the file already has content (the
  normal case on a second device, pulled from git), linking behaves exactly like a confirmed import:
  `parsePin`-validated, named counts, a pre-link backup snapshot via the existing `backupBeforeImport`
  path — never a silent merge, never a silent discard.
- **A browser without File System Access support** (feature-detected, not sniffed by UA) falls back to
  today's `localStorage`-only behavior with no crash and an honest, named message — not a silent no-op
  that leaves the user wondering why "Link a data file" did nothing.
- **An unreadable linked file — including one left mid-git-conflict with `<<<<<<<` markers — is treated
  exactly like a corrupt `localStorage` read is today:** backed up aside, a named error banner, no data
  loss, no crash.
- `CLAUDE.md`'s storage description and standing orders are updated to name both mechanisms and to state
  explicitly that git-file sync is not the backend/database/server/accounts system the charter forbids —
  so the charter stays accurate instead of reading as if it forbids the very thing just built.

**Not in this unit.** Automatic git operations — commit/push/pull stay manual, run by the user outside the
app, same as any other tracked file. Real-time/live sync or file-watching while the app is open. A
merge/conflict-resolution UI for the JSON — a git conflict here is resolved the same way as a conflict in
any other tracked file, by the user, in their editor or git tool. Non-Chromium support (Firefox/Safari
lack the API). Removing `localStorage` support — it remains the default for anyone who hasn't linked a
file.

---

## Unit 7 — Multi-view navigation

**Problem.** Today there is exactly one way to look at your leads: the map. As the pin count grows, the
map's markers/popups aren't a great surface for scanning — there's no way to review leads as a scannable
list. Requested directly, and consistent with what Unit 5's review already parked as "a legitimate future
unit": *"a dedicated list view of leads... a filterable map is the smaller, higher-value slice."*

**Done when.** From a clean checkout, with pins of mixed strength and notes saved:
- A view switcher lets the user toggle between the existing **Map** view and a new **List** view. The
  sidebar (filter/search, Backup/Import-Export, Legend) stays available in both — only the main pane
  switches; switching is pure UI/read state and never touches storage, the current selection, or the
  add-pin flow.
- **List view shows every currently-visible pin** — respecting Unit 5's active filter/search exactly as
  the map does, same AND semantics, same "Showing N of M" wording — as rows: name, strength (color-coded
  to match the map's palette), and a short notes preview. Clicking a row opens the same `PinEditor` the map
  uses today; nothing pin-specific is duplicated for the list.
- A sensible default order (alphabetical by name) so the list isn't presented in arbitrary/insertion
  order.
- **Placing a new pin still only happens via the Map view.** Click-to-place is inherently spatial; List is
  for reviewing and opening leads, not creating them. This is a deliberate narrowing, not a gap to fill
  later in this unit.
- No pin data or storage-shape changes — this unit is presentation-only, on top of whichever storage layer
  is live (today's `localStorage`, or Unit 6's linked file if that's shipped first) — it must not
  hard-depend on Unit 6 having landed.

**Not in this unit.** URL-based routing or deep links (no stated need yet — plain view-switch state is the
simpler thing that meets this bar). A dedicated stats/analytics view. Bulk actions from the list (bulk
delete, etc.). Multi-column/user-configurable sort. A map/list split-screen.

---

## Unit 8 — Visual redesign

**Problem.** The app works but looks like default browser styling, not "a platform" — requested directly:
a clean/minimal design pass.

**Done when.** From a clean checkout:
- A defined type scale and spacing scale applied consistently across every view that exists at build
  time — map sidebar, `PinEditor`, `PinFilterBar`, `ImportExport`, and Unit 7's List view.
- A cohesive neutral color system — **without** touching the strong=green / weak=amber / failed=red pin
  mapping `CLAUDE.md`'s DONE-WHEN depends on. The semantic three stay exactly as they are; everything
  around them (chrome, text, borders, buttons) gets the pass.
- **No functional regressions.** Every existing interaction — add/edit/delete/filter/import-export, plus
  Unit 7's view switch — keeps working exactly as before. The existing test suite (component tests query
  by role/label, not CSS) stays green through the whole pass, plus an in-browser check, since styling bugs
  are exactly the class of thing tests don't catch.
- Doesn't regress Unit 3A's `min-width: 240px` floor (the fix for the zoom-goes-`Infinity` bug) or repeat
  Unit 3B's review-caught bug where a plain class selector silently lost to a class+element selector of
  higher specificity — worth a specific check given this unit touches CSS broadly.
- Contrast meets WCAG AA at minimum; focus states stay visible; the existing `aria-live`/`role="status"`
  regions are restyled, not removed or functionally altered.

**Not in this unit.** New features or interactions. Animation/motion design beyond simple transitions. A
dark mode (not requested — park it in "Later" if it comes up separately). Icon or illustration work beyond
what legibility needs.

---

## Later — not scheduled

- `parsePin` accepts `name: ''` while `updatePin` refuses to save it, so such a pin can be loaded but
  not edited until it is renamed (NIT from unit 2's review).
- Memoize `pinIcon` per `(strength, selected)` — every marker's DOM is rebuilt on every render. Harmless
  at this scale (NIT from unit 2's review).
