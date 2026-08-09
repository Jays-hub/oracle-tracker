# Progress Log

The running record of **product** work, newest first. Each entry is dated and tagged: `[built]` when a
unit is handed off to review, `[reviewed]` / `[fixed]` as the review closes, `[decided]` for a
consequential choice. `/session-start` reads the top of this file to orient; keep entries terse and
name the artifacts + the verified test count so the drift check has something real to compare against.

(Workflow/tooling changes go in `docs/agentic_workflow/current_state.md`, not here.)

---

## 2026-08-06 — [reviewed] [fixed] The two NIT closures below got a cold-context review after all

[reviewed] The entry below framed these two fixes as NIT-level and exempt from `/review`. On reflection
(and per the reviewer's own F4 finding) that call was wrong: tightening `parsePin` — the single
validation boundary for `loadPins`, `parseImportPayload`, and Unit 6's planned file-link — is a
decision-logic change at a persistence boundary, which `.claude/rules/00-process.md`'s "Scope of a unit"
defines as needing a review, not a mechanical edit. Ran one cold:
`docs/reviews/uncommitted-2026-08-06-pinicon-parsepin.md` (shasum `3bffb7f5`). **Verdict: yes, with one
MAJOR caveat** — both NITs were genuinely closed and verified by running (the reviewer independently
re-ran the suite, planted and reverted the same violations described below), but the `parsePin` tightening
silently changed the persistence/import contract for previously-loadable data, undocumented. 2 MAJOR + 2
MINOR + 4 NIT. All addressed:

[fixed] **MAJOR (F1) — tightening `parsePin` turns one stranded pin into a total, unrecoverable-in-app
store failure.** `loadPins` and `parseImportPayload` both reject their *entire* input on the first
invalid record, so a store or import file containing one blank-name pin among many now fails to load
*any* of them — worse than the original complaint (one uneditable pin) for the population it affects.
Chosen fix: **reject-and-document**, not coerce-to-placeholder (rejected — silently mutates a name the
user never typed, and breaks `parsePin`'s documented losslessness contract) and not revert-to-permissive
(rejected — reopens the exact strand this closes). Landed as documentation, not a behavior change: a
comment at `pin.ts`'s new check names all three consumers and the blast radius explicitly, links to the
review artifact, and states plainly that this can only happen via data edited outside the app (direct
`localStorage` editing, or — once Unit 6 lands — hand-editing/merging `data/pins.json`), never through
the app's own writes.

[fixed] **MAJOR (F2) — the corrupt-load banner dropped `err.cause`, so F1's new failure mode was
unactionable, while the import path solved this exact problem already.** `ImportExport.tsx`'s
`describeError` (message + cause's message) is now `src/errors.ts`, a shared helper; `App.tsx`'s two
load-error sites (`useEffect` mount-load catch, `storedPinsForWrite`'s catch) use it. The banner now
names the real reason ("...: name must not be empty") instead of the generic "stored data contains an
invalid pin."

[fixed] **MINOR (F3) — the `pinIcon` memoization shipped with zero coverage for the invariant it
created.** Nothing in the suite asserted `.pin-marker__dot--selected` at all; the reviewer's planted
mutation (dropping `selected` from the cache key) passed all 143 tests clean. Added
`src/components/MapView.test.tsx`: two same-strength pins, one selected, asserting exactly one
`--selected` dot and correct color on both regardless of shared cached-icon identity. Reran the exact
planted mutation against the new test: fails (`expected [] to have a length of 1`). Restored, confirmed
clean.

[decided] **MINOR (F4) — self-exemption from `/review`, and the hook meant to catch that structurally
can't.** The reviewer explicitly recommended *not* fixing the hook itself inside this change
(`require_build_note.py`'s `_existing_notes()` checks only whether any note exists in
`docs/build_notes/`, not whether one is current — with five prior notes on disk it can't fire again for
the life of the project). Tracked, not fixed here — re-scoping that check, or dropping the enforcement
claim, is a separate call about the tooling itself.

[fixed] **NIT — trim asymmetry for `name` was undocumented.** `parsePin` validates `name` on `.trim()`
but returns it unstrimmed (deliberately, for losslessness) — same treatment as `notes`, but the existing
comment only mentioned `notes`. One comment now covers both, including the consequence: a padded
imported name loses that padding on its first edit through `PinEditor`.

[decided] **NIT — `setLatLng` still fires on every marker on every render** (a fresh `[pin.lat, pin.lng]`
array each render defeats react-leaflet's identity check) — **left as-is.** The reviewer confirmed this
is harmless (no DOM rebuild, repositions to the same point) and offered no concrete minimal fix; adding
memoization here would be new complexity for a cosmetic perf NIT explicitly called harmless, which
`.claude/rules/00-process.md`'s "name the drift" standing order weighs against. The prior entry's framing
below ("every marker rebuilt on every render") overstated what landed — `setIcon` churn is what's fixed
(verified: 0 calls across no-op re-renders, was N per render); `setLatLng` churn is a separate, unfixed,
harmless artifact.

[fixed] **NIT — `CLAUDE.md`'s always-loaded "Current status" was stale**: didn't mention Units 6–8 being
scoped, Unit 6 being in progress, or these two closures. Updated.

[decided] **NIT — "can't collide with Unit 6" holds for code, not for docs.** Confirmed by reading Unit
6's worktree directly: it touches `ImportExport.tsx`, `pinStore.ts`/`.test.ts`, and adds new
`fileStorage`/`DataFileLink`/`types` files — none of `pin.ts`, `pin.test.ts`, or `MapView.tsx`. But both
sessions edit `docs/progress_log.md`, `docs/roadmap.md`, and now `CLAUDE.md`'s status section — a
guaranteed textual merge conflict at handoff, to be resolved by hand like any other, not avoided.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **144 passed** (10 files;
was 143/9 — the new `MapView.test.tsx`) · `npm run build` succeeds (87 modules, 315.15 kB JS).
**Self-proving:** F3's planted mutation (dropping `selected` from the cache key) reintroduced, confirmed
to fail exactly `MapView.test.tsx`'s new assertion, then reverted — `git diff` shows no leftover markers.

Both NITs remain genuinely closed; the store/import blast-radius trade-off in F1 is now a documented,
deliberate choice instead of a silent one, and the load-error banner (F2) makes it self-diagnosing instead
of requiring DevTools guesswork.

---

## 2026-08-06 — [fixed] Two parked NITs closed: `pinIcon` memoization, `parsePin` empty-name gap

Picked up while Unit 6 was being built in a separate session — deliberately scoped to files Unit 6
doesn't touch, so the two sessions can't collide. Not a unit (mechanical/NIT-level, both already
specified by a prior review's findings), so no new `/review` cycle.

- **`src/components/MapView.tsx`** — `pinIcon` took a `color` string, so every marker rebuilt its
  `L.DivIcon` on every render even though only `(strength, selected)` — 6 combinations, ever — determine
  its contents. Now keyed and cached in a module-level `Map`, called as `pinIcon(pin.strength, selected)`.
  NIT from `docs/reviews/Unit 2 - notes + editing per pin.md`.
- **`src/domain/pin.ts`** — `parsePin` accepted `name: ''` (only checked `typeof`) while `createPin`/
  `updatePin` both reject an empty/whitespace-only name after trim. The gap meant a stored or imported
  record with an empty name would load, then get stuck: `PinEditor` disables Save until the name is
  non-empty, so nothing about that pin — not even notes — could be edited until it was renamed. `parsePin`
  now rejects the same way (`name.trim().length === 0`) at the same boundary as every other corrupt field,
  same NIT source. Two cases added to `pin.test.ts`'s `rejects invalid shapes` table
  (`name: ''`, `name: '   '`); confirmed the fix is load-bearing by reverting `pin.ts` alone and rerunning
  — the new cases fail without it, pass with it.

Both were already proposed verbatim by that review ("Fix: require a non-empty `name` in `parsePin` too" /
"Memoize `pinIcon` per `(strength, selected)`"), so implementing them directly rather than re-reviewing
was a judgment call, not a shortcut around Standing Order 1. Removed both from `docs/roadmap.md`'s Later
list.

Gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **143 passed** (9 files, same count —
new assertions landed inside the existing `parsePin` table test, no new `it` blocks) · `npm run build`
succeeds (86 modules, 315.22 kB JS).

Next: Unit 6 (git-syncable storage) is being built in a separate session — pick up wherever that lands,
or continue pulling isolated Later-list items if more show up.

---

## 2026-08-05 — [reviewed] [fixed] Persist the map view across reloads — review closed

[reviewed] Cold-context adversarial review: `docs/reviews/persist map view across reloads.md` (shasum
`d7bf24d…`). **Verdict: No.** The core mechanism (a saved view over `initialViewForPins`, independent
of pin-store health, fail-soft on corruption) was sound, but the "which wins" answer had no way back
once it went wrong, and the persistence itself silently failed for ordinary gestures. 1 BLOCKER + 2
MAJOR + 2 MINOR (test-coverage) + 2 MINOR (doc accuracy) + 2 NIT. All 7 substantive findings (F1–F7)
fixed below; the 2 NITs (zoom upper bound, listener re-attached per render — the latter shared with
the existing `ClickCapture` pattern, consistency-neutral) deferred, unchanged from the artifact.

[fixed] **BLOCKER (F1) — a saved view won unconditionally and there was no way back to the leads.**
Reproduced by the reviewer: pan to the mid-Pacific, reload, and the map reopens there — 0 of 2
markers on screen, sidebar still reading "2 leads on the map," no control anywhere that re-fits. This
reintroduced the exact defect Unit 3 Section A shipped to fix, permanently. Added a "Show all leads"
control (`src/App.tsx`, `handleShowAllLeads`), always visible in the sidebar (not gated behind any
other state — it has to work exactly when everything else is off screen), routed through the same
`initialViewForPins` + `mapEpoch` remount `handleImportReplace` already uses, and clearing the saved
view so the recovery — not the position that stranded the user — is what a reload restores from here
on. New test: "recovers from a stranded view via 'Show all leads', and the recovery survives a
reload."

[fixed] **MAJOR (F2) — `saveView` wrote longitudes `loadView` would reject.** Leaflet's
`getCenter()` is unwrapped; a pan past the antimeridian (ordinary use — NYC is only ~600px of
dragging from it at zoom 3) produced a longitude past ±180, which the load-side range check then
silently rejected, falling back to the fit with no error. `ClickCapture` already wraps for this exact
hazard 20 lines away — `ViewPersister` didn't. Fixed: `map.getCenter().wrap()` before handing off
(`src/components/MapView.tsx`). New test: a pan past the antimeridian, reload, map reopens exactly
where it was left (wrapped), not re-fit.

[fixed] **MAJOR (F3) — a window resize persisted a view the user never chose.** `moveend` is not a
proxy for user intent: Leaflet fires it for a resize too (`trackResize` → `invalidateSize`), so the
"no saved view yet → fit the pins" fallback was a one-shot for most real users, and the most likely
path into F1 without ever deliberately panning. `ViewPersister` now listens for `dragend` + `zoomend`
instead of raw `moveend` — the cheapest correct version the reviewer named. Deliberate, documented
gap: keyboard arrow-key panning (Leaflet's `panBy` fires `moveend` but not `dragend`) is no longer
persisted; accepted as an edge case not worth chasing for a mouse/touch-first personal tool. New
test: a bare view change with no drag/zoom gesture (the resize's exact shape) persists nothing.

[fixed] **MINOR (F4) — no test guarded the *pan* half of "pan/zoom".** The reviewer's mutation
(`moveend` → `zoomend`) killed 0 of 57 tests, because every existing test changed the zoom alongside
the centre. New test isolates a pure pan (centre changes, zoom doesn't) ended by `dragend`, the real
terminal event a drag fires — the same mutation, replanted against the fixed code, now fails exactly
this test.

[fixed] **MINOR (F5) — nothing tied `saveView`'s output range to `loadView`'s accepted range**, which
is precisely the gap F2 lived in. Closed by F2's fix plus its regression test (an actual round-trip
through the range Leaflet can produce, not just hand-written in-range fixtures); added a doc comment
on `PersistedView` in `src/storage/viewStore.ts` naming the wrap contract explicitly so a future
reader lands on it from either side of the seam.

[fixed] **MINOR (F6) — the decision log claimed an empirical verification that never happened**: both
branches of "does the mount-time fit itself write a view" were claimed "exercised … confirmed
empirically," when only one branch is reachable (react-leaflet mounts children, where the listener
attaches, strictly after the initial fit's `moveend` has already fired and gone unheard — confirmed
by the reviewer reading `MapContainer.js`). Corrected in place in
`docs/build_notes/persist map view across reloads.md`, with the original inaccurate text kept
alongside the correction rather than silently rewritten. Moot regardless post-F3: `ViewPersister` no
longer listens for `moveend` at all.

[fixed] **MINOR (F7) — a code comment asserted nothing moves the map after mount, which is false**
and was the exact false premise that hid F3 (`invalidateSize` pans on resize; Popup's `autoPan` can
too). Reworded in `src/components/MapView.tsx`: nothing in this app's *React state* moves the map;
Leaflet itself still can.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **163 passed** (10
files; was 159) · `npm run build` succeeds. **Self-proving — all 4 code-level findings (F1–F4)
planted, run, restored:** removing the "Show all leads" button/handler fails the F1 test; dropping
`.wrap()` fails the F2 test; reverting `dragend`+`zoomend` to plain `moveend` fails the F3 test
specifically (not the others — confirming it's the one test that isolates this exact regression);
the reviewer's own exact mutation (`dragend`+`zoomend` → `zoomend` alone) now fails exactly the new
F4 pan-only test — 1 of 163, where before the fix it was 0 of 57.

**In-browser verification was not possible this round** — the Chrome extension connection
(`tabs_context_mcp`) remained unresponsive across both the build and this fix pass. All fixes are
verified by the automated gate and by planting-and-restoring the reviewer's own reproductions
(including their exact F4 mutation) rather than by a live walkthrough. Flagged as the one open item
for a human to confirm in a real browser before this ships.

Persist the map view across reloads is **done and mergeable**. The escape hatch (F1) means the
"which wins" answer this unit exists to give — a saved view over fitting the pins — no longer comes
at the cost of `CLAUDE.md`'s "at a glance" bar in the one state that mattered: being unable to find
your own leads again.

Next: pick another unit from `docs/roadmap.md`'s "Later" list, or scope a new one.

---

## 2026-08-05 — [built] Persist the map view across reloads

[built] Closes the last item on `docs/roadmap.md`'s "Later" list, and the "which wins" question
Section A's own acceptance criteria left open: the map now opens on wherever it was last panned/
zoomed to, instead of re-fitting to every saved pin on every load. Fitting the pins
(`initialViewForPins`, Section A, unchanged) is now the fallback for when there's no saved position
yet — first run, or right after a confirmed import, which deliberately clears the saved position
since it may point at an entirely different set of coordinates than the pins that just replaced it.

Artifacts: `src/storage/viewStore.ts` (`loadView`/`saveView`/`clearView` over a new
`restaurant-map.view.v1` key) + `src/storage/viewStore.test.ts` (11), `src/components/MapView.tsx`
(new `ViewPersister` child reporting Leaflet's settled `moveend` position via a new `onViewChange`
prop), `src/App.tsx` (mount effect prefers a loaded view over the fit; `handleViewChange`;
`handleImportReplace` clears the stale view), 5 new tests in `src/App.test.tsx`. Decision log:
`docs/build_notes/persist map view across reloads.md`.

[decided] **A bad/corrupt saved view fails soft (`null`) rather than loud, unlike every other
boundary in this codebase.** `parsePin`/`loadPins` throw and snapshot on corruption because notes
are prose that cannot be reconstructed; a pan position has no such property — the correct recovery
from "the saved view is garbage" is exactly the ordinary fit-to-pins fallback, which is already a
perfectly good view. Throwing, or wiring up banner/backup machinery to protect a value this
disposable, would itself be the drift `CLAUDE.md` warns against. Full reasoning in the decision log.

[decided] **Writes are fire-and-forget, wired straight from `onViewChange` to `saveView` with no
React state in between.** Section A's whole guarantee — nothing after mount can move the map — rests
on `initialView` being written exactly once. A view-change handler that touched any state React
re-renders on would be a live wire next to that guarantee; skipping state entirely makes that class
of regression structurally unreachable rather than merely avoided by convention.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **159 passed** (10 files; was
143) · `npm run build` succeeds. **Self-proving — 4 regressions planted, run, restored:** the mount
effect ignoring the saved view fails 3 tests; `handleImportReplace` skipping `clearView` fails the
dedicated post-import test (reopens on the stale pre-import position instead of the new pins);
`loadView` losing its `try/catch` around `JSON.parse` fails both its own unit test and — more
sharply — crashes the live `<App>` uncaught in the App-level corrupt-view test, exactly the blast
radius the fail-soft design exists to prevent; `ViewPersister` no longer calling `onViewChange` fails
the same 3 tests as the first regression. Each caught by exactly the test written to guard it.

**In-browser verification was skipped this round** — the Chrome extension connection
(`tabs_context_mcp`) timed out repeatedly; rather than keep retrying, proceeded on the strength of
the automated gate and the 4 planted-and-caught regressions above. Flagged as an open item in the
decision log's "least confident" section — the reviewer should either do the real pan-reload-restore
walkthrough themselves or treat it as unverified.

Not marked done — awaiting the review.

Next: `/review persist map view across reloads`.

---

## 2026-08-05 — [decided] Units 6–8 scoped: git-synced storage, multi-view navigation, visual redesign

[decided] Three new units specced in `docs/roadmap.md`, requested directly rather than pulled off the
"Later" list: a way to use this tracker from more than one device, more than one way to look at the same
data, and a real design pass instead of default styling. All three are scoped to stay inside `CLAUDE.md`'s
charter — no server, no accounts, no external API — the storage *mechanism* changes in Unit 6, but nothing
server-side is added; nothing here is the backend/database/server the standing orders name as drift.

- **Unit 6 — Git-syncable storage.** Swap the storage backend to the File System Access API pointed at a
  git-tracked file (`data/pins.json`), so committing/pushing/pulling that file *is* the multi-device sync
  mechanism — no server, no accounts, nothing added to the network surface beyond map tiles. Chromium-only
  API; `localStorage` stays as the default for anyone who hasn't linked a file, or whose browser lacks the
  API. Reuses Unit 3B's `parsePin`/replace/backup machinery for the first-link case rather than inventing a
  new one. Because this changes what `CLAUDE.md`'s own charter text currently says ("persisted to the
  browser's `localStorage`"), this unit's Done-when includes updating that language — not loosening the
  "no backend" order, just making it name both mechanisms accurately.
- **Unit 7 — Multi-view navigation.** A List view alongside the current Map view, both reading the same
  store and the same Unit 5 filter/search state. Deliberately *not* adding a router dependency for two
  views sharing one sidebar — plain view-switch state in `App` is enough; revisit only if a third view or
  a deep-linking need shows up later.
- **Unit 8 — Visual redesign.** A clean/minimal styling pass — type scale, spacing, a coherent neutral
  palette — applied consistently across every view, including Unit 7's List view. Sequenced last, after
  Unit 7, so there are two views to design consistently instead of one now and one later. Must not touch
  the strong=green/weak=amber/failed=red mapping `CLAUDE.md`'s DONE-WHEN depends on, or regress the
  `min-width` floor Unit 3A's review added.

Proposed build order: **6 → 7 → 8** — storage first as the riskiest, most foundational change (everything
else is presentation on top of whatever store shape results); design last since it should cover every view
that exists by then. Not yet built. Full specs, "Done when" bars, and exclusions in `docs/roadmap.md`.

---

## 2026-08-05 — [reviewed] [fixed] Unit 5: filter/search leads — review closed

[reviewed] Cold-context adversarial review: `docs/reviews/filter-search-leads.md` (shasum `7181bc8c`).
**Verdict: yes** against Unit 5's own "Done when" bullets — all six met and verified by running, not by
reading — but **no** against `CLAUDE.md`'s "see the pin rendered" bar in one state: a save made while a
filter is active could render nothing. 1 MAJOR + 5 MINOR + 4 NIT — all addressed below.

[fixed] **MAJOR — a pin placed or edited while a filter is active saved correctly but rendered nothing,
with no indication why.** Reproduced: filter to hide "Strong", place a new (default-strength) lead — the
store went 3→4, the sidebar said "Showing 1 of 4 leads", and no marker existed for the just-placed lead
anywhere on the map; the same held for an edit that moved a pin's strength into a hidden bucket, with its
own editor left open over an invisible marker. `handleMapClick` and `handleSaveEdits` now check the
resulting pin against the active filter with `matchesFilter`; if it would be hidden, the filter resets to
`allPinsFilter()` rather than leaving the save silently invisible — the cheaper of the reviewer's two
options, needing no new copy. Two new App tests guard both paths.

[fixed] **MINOR — the unit's headline safety claim, "filtering never re-fits or moves the map," had zero
tests.** The behaviour was correct but undefended: mutation-planting a forced remount on every filter
toggle (`setMapEpoch` in `handleToggleStrength`) passed the whole 139-test suite untouched. Added a test
that captures the *live* Leaflet map instance (intercepting `TileLayer.prototype.onAdd`, the same
technique the reviewer used), pans/zooms it away from the mount-time fit, then toggles a strength, types a
query, and clicks Clear — asserting `getCenter()`/`getZoom()` never move. Reran the planted mutation
against the new test: fails (the stale map reference throws once remounted).

[fixed] **MINOR — "filtering never touches `localStorage`" was guarded on one of three paths, and by
length rather than content.** Only the strength-toggle test asserted anything about storage, and even
that only checked `toHaveLength(3)` — the reviewer's planted mutation (writing `visiblePins` into
`handleClearFilter`, silently emptying the store while narrowed to zero matches) passed clean. All three
paths (toggle, query, Clear) now assert full content equality (`toEqual([alpha, beta, gamma])`); the same
mutation now fails exactly that assertion.

[fixed] **MINOR — export-while-filtered was correct but unguarded**, the one place a regression here could
cause permanent data loss. Added a test that filters the map down to a subset, exports, and asserts the
blob contains every saved lead; mutating the `ImportExport` `pins` prop to `visiblePins` now fails it
(confirmed: the filtered-out pin is missing from the exported JSON).

[fixed] **MINOR — the unfiltered sidebar wording branch ("N leads on the map …") had no test at all**; the
reviewer's mutation collapsing both wording branches into the filtered one passed clean. Added the
count-text assertion to the existing "Clear filters restores every pin" test, closing exactly the gap the
builder had flagged as their own least-confident spot.

[fixed] **MINOR — the filtered result count wasn't announced to screen readers, and the "click a pin" hint
disappeared while filtering.** `.sidebar__count` gets `aria-live="polite"` rather than `role="status"`:
the import/delete banners already claim the sole `role="status"` in the sidebar, and several existing
tests call `getByRole('status')` expecting exactly one match — adding a second `status` region would have
broken three passing tests for an accessibility fix. A plain live region announces changes without
claiming that role. The "click a pin to read or edit its notes" hint now also shows in the filtered
non-empty branch, not just the unfiltered one.

[fixed] **NIT — `handleToggleStrength`'s parameter shadowed the add-form's `strength` state** (harmless
today, a landmine for a future edit inside that function). Renamed to `toggled`.

[fixed] **NIT — `useState<PinFilter>(allPinsFilter())` allocated a throwaway `Set` every render.** Changed
to the lazy form, `useState(allPinsFilter)`.

[decided] **NIT — a whitespace-only search query shows visible characters in the box while every other
affordance (Clear control, "Showing N of M" wording) says nothing is filtered.** The reviewer confirmed
the underlying semantics are correct (whitespace genuinely isn't a query) and offered no fix, only naming
the affordance as inconsistent. Considered and left unchanged: trimming the query on every keystroke would
strip a trailing space the instant it's typed, silently merging the next word into the current one —
worse than the cosmetic mismatch it would fix. Documented the tradeoff in `pinFilter.ts` so a future
reader doesn't "fix" it into that regression.

[fixed] **NIT — `README.md`'s Roadmap section was stale**, still listing "Unit 1 — Map + colored pins
_(next)_" and filter/search as unbuilt future work. Replaced with a pointer to `docs/roadmap.md` and
`docs/progress_log.md` instead of a hand-maintained unit list, so this can't go stale the same way again.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **143 passed** (9 files; was
139) · `npm run build` succeeds (86 modules, 315.07 kB JS). **Self-proving — all 5 testable findings
planted, run, restored:** F1 (both the add-path and edit-path guards, independently), F2 (the exact
force-remount mutation), F3 (the exact Clear-path store-wipe mutation), F4 (the exact `visiblePins`-export
mutation), and F5 (the exact always-filtered-wording mutation) were each reintroduced in turn and
confirmed to fail exactly the test written to catch it, then reverted — `git diff` shows no leftover
markers.

**In-browser verification passed** (Google Chrome, dev server): seeded a strong lead, unchecked "Strong,"
confirmed the marker vanished and the sidebar read "No leads match your filters."; placed a second strong
lead while still filtered — **both markers appeared immediately**, "Strong" re-checked itself, and "Clear
filters" disappeared, with no reload needed. Repeated the edit-path case: unchecked "Weak," opened the
first lead, changed its strength to Weak and saved — the marker recolored to amber and **stayed visible**,
"Weak" re-checked itself. Typed "cafe" into search: sidebar correctly read "Showing 1 of 2 leads · click a
pin to read or edit its notes" (F6's hint now present under an active filter). Reloaded the page: both
leads persisted with the filter correctly reset to unfiltered (a filter is a view, never persisted, by
design). Console clean across the session. Fixture data cleared from that origin afterward.

Unit 5 is **done and mergeable**. `CLAUDE.md`'s "see the pin rendered" bar now holds even while a filter
is active — placing or editing a lead is never invisible.

Next: pick another unit from `docs/roadmap.md`'s "Later" list, or scope a new one.

---

## 2026-08-04 — [built] Unit 5: filter/search leads

[built] Scoped and closed the last outstanding item on `docs/roadmap.md`'s "Later" list. A new sidebar
control (`PinFilterBar`) lets you narrow the map to selected lead strengths and/or a case-insensitive text
search over both name and notes; the two combine as AND. Filtering only changes which pins render as
markers — it's read-only over `localStorage`, pin data, the current selection, and the add-pin flow, and
never re-fits the map (Section A's mount-only fit rule is untouched). The sidebar names what's showing
("Showing N of M leads" / "No leads match your filters.") with a one-click Clear back to everything.

[decided] Split "a list view of leads" out of the roadmap's original one-liner into its own future unit —
a filterable map is the smaller slice that satisfies `CLAUDE.md`'s "at a glance" bar on its own; a list
view is a materially bigger surface with its own map-sync story. Also decided a confirmed import does
**not** reset the filter (it's a view preference, not pin data — worst case is a visible "no leads
match" plus the always-present Clear control, never silent data loss).

Artifacts: `src/domain/pinFilter.ts` (`PinFilter`, `allPinsFilter`, `isFilterActive`, `matchesFilter`,
`filterPins`) + `src/domain/pinFilter.test.ts` (9 tests), `src/components/PinFilterBar.tsx`, `src/App.tsx`
(`filter` state + 3 handlers, `visiblePins` passed to `MapView`, sidebar count wording) + 5 new tests in
`src/App.test.tsx`, `src/index.css` (`.pin-filter*`). New roadmap section (`Unit 5`) written with a
"Done when" before the build, since this was a "Later" one-liner with no acceptance criteria yet — same
pattern Unit 4 followed. Decision log: `docs/build_notes/Unit 5 - filter-search leads.md`.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **139 passed** (9 files; was 125)
· `npm run build` succeeds. **Self-proving — 3 regressions planted, run, restored:** AND swapped for OR
in `matchesFilter` fails 11 tests across 2 files (including the dedicated AND-combination test); dropping
the notes half of the text match fails exactly the 2 tests guarding it; letting an empty strength
selection silently fall back to "match everything" fails exactly its dedicated edge-case test.

**In-browser verification passed** (Google Chrome, dev server): seeded 3 pins (strong/weak/failed, one
with "wine" only in a failed pin's notes and one in a strong pin's notes) — unchecking Weak hid exactly
the amber marker and left `localStorage` holding all 3, byte-identical; searching "wine" combined with
Weak unchecked correctly showed only the one pin matching **both** the strength and text filters (AND,
confirmed live, not just in tests); a query matching nothing showed "No leads match your filters." with
every marker gone (confirmed via zoom that the only remaining icon was an OSM basemap hospital glyph, not
an app marker); Clear filters restored all 3 markers and the unfiltered count text. Opened a pin's editor,
then filtered out its own strength — the marker disappeared but the editor stayed open, undisturbed.
Console clean across two loads. Fixture pins cleared from that origin (`localStorage.clear()`) afterward.

Not marked done — awaiting the review.

Next: `/review filter/search leads`.

---

## 2026-08-04 — [reviewed] [fixed] Delete a pin — review closed

[reviewed] Cold-context adversarial review: `docs/reviews/Delete a pin.md` (shasum `53f3d917`).
**Verdict: No.** `CLAUDE.md` #3's product bar held throughout, but the unit's own contract — Undo
"restores the exact pin, byte-for-byte" — did not. 2 MAJOR + 4 MINOR + 2 NIT. The reviewer ran the gate
itself (`npm test` **120 passed**, matching the log) and wrote 9 probe tests plus re-planted 2 of the
builder's own 5 regressions to verify each finding by running it, not just reading the diff. All 6
substantive findings (F1–F6) are fixed below; the 2 NITs (button contrast, build-note filename case) are
deferred, unchanged from the artifact.

[fixed] **MAJOR (F1) — Undo restored this tab's stale copy of the deleted pin, not the record actually
in storage at delete time.** `handleDeletePin` re-read the store for the *write* (`storedPinsForWrite()`)
but took `pinToDelete` — the value Undo would later resurrect — from `pins`, React state captured at
this tab's last load or save. Reproduced by the reviewer: another tab edits the pin's notes, this tab
deletes it (correctly removing the *current* record), Undo comes back with the pre-edit notes — silent
prose loss, exactly the failure mode `docs/roadmap.md` Section B calls the worst kind. Fixed by sourcing
`pinToDelete` from the same freshly re-read list the write uses (`src/App.tsx`, `handleDeletePin`). New
regression test: `App.test.tsx` — "undoes onto the record actually in storage at delete time, not a
stale copy" (a concurrent-edit-then-undo scenario the old headline "byte-for-byte" test could not
detect, per the reviewer's F3).

[fixed] **MAJOR (F2) — the only Undo for a destructive action was destroyed by a read-only action.**
`setDeleteInfo(null)` fired in `handleSelectPin` (and `handleMapClick`/`handleSaveEdits`), so clicking
any marker — including checking "did I delete the right one?" — permanently killed the Undo button.
None of those three actions can make the held pin stale or collide with its id, so nothing was being
protected. Dropped the clear from all three; it stays only where it's real — a newer delete (which
naturally supersedes the held pin via the same state write) and an import replace (`src/App.tsx`).
Old test asserting the opposite ("clears the Undo banner once another action happens") replaced with
three that assert the corrected contract: it survives selecting/adding/editing, a second delete replaces
rather than stacks it, and an import replace still clears it.

[fixed] **MINOR (F4) — a failed rescue during Undo threw uncaught instead of surfacing a banner.**
`handleUndoDelete` called `storedPinsForWrite()` outside its own `try`; when the store is unreadable and
the corrupt-store snapshot also fails, the exception escaped the click handler — Undo stayed on screen,
did nothing, forever, no explanation. Moved the call inside `try`, reusing the existing "Couldn't
restore…" message (`src/App.tsx`). New test: "surfaces a named error instead of throwing when Undo
cannot read the store."

[fixed] **MINOR (F6) — deleting a pin another tab had already removed reported "it was not removed,"**
which was false (the pin really was gone from storage), and left a ghost marker that every further
delete attempt on it would just repeat. `handleDeletePin` now checks for the pin in the freshly re-read
list before attempting the removal; on a miss it resyncs `pins` to what's actually stored, closes the
editor, and names the real cause ("it was already deleted elsewhere"). New test: "fails loud and resyncs
when the pin was already deleted elsewhere."

[decided] **MINOR (F5) — no written acceptance criteria for this unit; the roadmap was stale.**
`docs/roadmap.md` still listed "Delete a pin" under "Later — not scheduled" with no Done-when, despite
the build note's claim that one existed. Added a proper "Unit 4 — Delete a pin" section with a Done-when
written from the reviewer's own corrected contract, removed the "Later" bullet, and updated Section B's
now-stale premise ("There is no delete yet" → footnoted as historical) plus its "honest prerequisites"
line, which no longer needs delete now that it exists.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **125 passed** (8 files;
was 120) · `npm run build` succeeds. **Self-proving — F1, F2, F4, F6 each individually replanted, run,
restored:** sourcing `pinToDelete` from stale `pins` state fails the new F1 test (and cascades into the
F6 test, since both paths share the same read); restoring `setDeleteInfo(null)` in `handleSelectPin`
fails the new "keeps the Undo banner through selecting…" test; moving `storedPinsForWrite()` back outside
`handleUndoDelete`'s `try` reproduces the reviewer's exact uncaught `PinStoreError` crash, caught by the
F4 test; removing the not-found guard in `handleDeletePin` fails the F6 test with the old "It was not
removed" message. Each regression was caught by exactly the test written to guard it, then restored.

**In-browser verification passed** (Google Chrome, dev server): seeded Alpha/Beta, opened Alpha,
injected a concurrent-tab edit directly into `localStorage` (notes → "THREE PARAGRAPHS WRITTEN IN
ANOTHER TAB."), deleted Alpha here, clicked Undo — restored notes matched the concurrent edit exactly,
confirming F1 live. Selected Beta (a read), edited and saved its notes, and added a new pin — the Undo
banner survived all three (F2), and clicking it afterward restored Alpha alongside Beta's edit and the
new pin, three pins total in storage. Separately: opened a pin, had "another tab" delete it from
`localStorage`, then confirmed delete here — got "Couldn't delete that pin: it was already deleted
elsewhere. Your view has been refreshed.", the ghost marker vanished, and the sidebar count matched
storage (F6). Console clean throughout. Fixture data cleared from that origin.

Unit 4 ("Delete a pin") is **done and mergeable.**

Next: pick from `docs/roadmap.md`'s "Later" list (filter/search by strength, persist the map view across
reloads) or scope a new unit.

---

## 2026-08-04 — [built] Delete a pin

[built] Closes the first item on `docs/roadmap.md`'s "Later" list: a lead placed by mistake, duplicated,
or no longer real had no way off the map short of editing every field into nonsense. `PinEditor` gets a
**Delete lead** control, gated by a two-step confirm (arm, then confirm — matching the pattern
`ImportExport`'s destructive Replace already uses). A confirmed delete removes the pin from `pins` state
and `localStorage` through the same re-read-before-write path add/edit already use, closes the editor,
and arms an in-session **Undo** banner holding the exact removed pin, so a misclick is recoverable
without reaching for the whole-store Export/Import backup.

Artifacts: `src/domain/pin.ts` (`removePin`, mirrors `replacePin`'s fail-loud contract) + 5 new tests in
`src/domain/pin.test.ts`; `src/components/PinEditor.tsx` (`onDelete` prop, confirm-armed delete button)
+ 3 new tests; `src/App.tsx` (`deleteInfo` state, `handleDeletePin`, `handleUndoDelete`, a new
`role="status"` Undo banner) + 6 new tests in `src/App.test.tsx`; `src/index.css` (delete button states,
`.banner__undo`). Decision log: `docs/build_notes/delete a pin.md` — this item was a "Later" one-liner
with no spec'd "Done when," so the log covers how "confirm/undo story" was scoped (in-session,
single-delete undo; explicitly rejected reusing Section B's whole-store snapshot mechanism as drift for
a single pin) and the duplicate-id hazard the undo path guards against.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **120 passed** (8 files; was
106) · `npm run build` succeeds. **Self-proving — 5 regressions planted, run, restored:** `removePin`'s
not-found throw removed, delete's multi-tab re-read swapped for stale `pins` state, undo's duplicate-id
guard removed, the `deleteInfo`-clears-on-add call removed, and PinEditor's confirm gate bypassed —
each independently caught the test written to guard it, then was restored.

**In-browser verification passed** (Google Chrome, dev server): seeded 2 pins, deleted one through the
full confirm flow, saw the Undo banner, clicked Undo, and confirmed the restored `localStorage` record
was byte-identical to the original. Console clean throughout. Full walkthrough in the decision log.

Next: `/review Delete a pin`. Not marked done — the review closes on the code, not this entry.

---

## 2026-08-04 — [reviewed] [fixed] Unit 3 Section B: export/import JSON — review closed

[reviewed] Cold-context adversarial review: `docs/reviews/Unit 3 Section B - export-import JSON.md`
(shasum `e85b6fa4`). **Verdict: yes, with reservations.** Every literal roadmap bullet was implemented and
genuinely tested, but two MAJORs kept it short of `CLAUDE.md`'s "at a glance" bar in the restore scenario;
mutation testing (a repo copy) also caught 2 of 8 planted defects the suite missed. 2 MAJOR + 7 MINOR + 2
NIT — all fixed below.

[fixed] **MAJOR — a confirmed import never moved the map; the restored pins sat off screen until the next
reload.** Named as an unresolved conflict between Section A ("fit on mount only") and Section B ("the
pins in it become the pins on the map") — nothing had ever decided which wins for a *confirmed whole-store
replace*. Resolved: treat a confirmed import as a new mount, not an ordinary save. `App.handleImportReplace`
now recomputes `initialView` via `initialViewForPins(imported)` and force-remounts `MapView` through a
`mapEpoch` key bumped only on import — Section A's rule (never re-fit on an ordinary save) is untouched,
since `mapEpoch` never moves on add/edit.

[fixed] **MAJOR — the destructive confirmation, and the banner after it, counted React state (`pins.length`)
instead of what a replace would actually destroy.** With another tab having written since load, the
confirmation could read "replace 1" while the store held 3, then report "replacing 1 previously saved"
after all 3 were gone. Both the `ImportExport` confirmation (`getSavedCount` prop, read fresh at file-select
time) and `App`'s post-import banner (`countStoredPins()`, read from storage right before the write) now
name what's actually in `localStorage`, wording it as "the saved data (currently unreadable)" rather than a
number when the store can't be read at all.

[fixed] **MINOR — a failed pre-import snapshot told the user their good data was "unreadable."** The
snapshot helper's error message was written for its original caller (a corrupt read) and never updated for
its second one (a routine import, where the data is normally fine). Made caller-neutral: "could not copy
the saved data aside."

[fixed] **MINOR × 2 — pre-import snapshots accumulated without bound, filed under a key that said
`corrupt`.** Split `backupCorruptStore` into two callers of a shared `writeSnapshot`: `backupCorruptStore`
(unchanged, `.corrupt-` prefix, not pruned — rare) and new `backupBeforeImport` (`.backup-` prefix — honest,
since these bytes are normally fine — pruned to the `MAX_IMPORT_BACKUPS` (5) most recent via new
`removeItem`/`length`/`key` on `StorageLike`, which the real `Storage` type already satisfies).

[fixed] **MINOR — the browser-download mechanic (anchor `download`, `revokeObjectURL`, `removeChild`) had
no test coverage**; mutation-confirmed deleting any of the three left the suite green. Added a component
test that stubs `HTMLAnchorElement.prototype.click` and asserts the filename pattern plus both cleanup
calls.

[fixed] **MINOR — the "file input resets so the same file can be retried" test could not fail**: jsdom's
`fireEvent.change` never sets `.value`, so the assertion held whether or not the component reset it. The
shared `selectFile` test helper now seeds a fakepath `.value` via `Object.defineProperty` first, giving the
post-selection reset something real to observe (mutation-confirmed: removing the reset now fails it).

[fixed] **MINOR — a success banner from an earlier import survived a later one that failed**, showing a
contradictory success + failure pair. `handleImportReplace`'s catch block now clears `importInfo`.

[fixed] **MINOR — an armed placement survived an import.** The first click after a restore could silently
add a pin the user never meant to place, into the store they'd just restored. `handleImportReplace` now
resets `armed`/`name`, matching `handleSelectPin`. Confirmed in Chrome: armed, imported, confirmed — the
crosshair state cleared and a map click added nothing.

[fixed] **NIT — a rejected file only ever said "the file contains an invalid pin,"** discarding
`parsePin`'s specific reason. `ImportExport` now appends `err.cause`'s message when present (e.g. `…got
"lukewarm"`), unfixable-by-the-user feedback turned fixable.

[fixed] **NIT × 2.** Picking a second file before the first's `FileReader` resolved could show a stale
confirmation or silently drop the real error — a `selectionRef` "latest request wins" guard in
`ImportExport` now drops superseded reads. The destructive Replace button was styled identically to Export.

[decided] **Found and fixed during in-browser verification, not by the reviewer: `.import-export__cancel`
and the new `.import-export__replace` never actually applied.** `.import-export button` (class+element,
specificity 0,1,1) beats a single class selector (0,1,0) regardless of source order — both buttons rendered
the same blue in Chrome even after the CSS was added. Re-verified the reviewer's own read of the source
("only Cancel is differentiated") was itself wrong for the same reason. Fixed by matching specificity:
`.import-export button.import-export__cancel` / `…__replace`.

[decided] **Self-proving surfaced a real test-isolation gap, fixed on the spot.** The F8 regression test
mocks `window.localStorage.setItem` and calls `vi.restoreAllMocks()` at the end of the test body; planting
the F8 regression made that test fail *before* reaching its own restore, leaking the mock into every later
test in the file (7 cascading failures, not 1). Moved the restore into the shared `afterEach` in both
`App.test.tsx` and `ImportExport.test.tsx` so a failing test can never leak a mock into its neighbours —
this is a standing hygiene fix, not specific to this one test.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **106 passed** (8 files; was
92) · `npm run build` succeeds. **Self-proving — all 11 findings planted, run, restored:** each of F1–F11
was individually reverted and confirmed to fail exactly the test(s) written to guard it (F1 and F2 each
independently on both their App-level and component-level assertions; F5's revert alone failed 5 tests
across 3 files). No regression needed more than the one intended guard to catch it after the isolation fix
above.

**In-browser verification passed** (Google Chrome, dev server): seeded 2 NYC pins, armed a placement,
imported a 2-pin Portugal file (Porto + Lisbon, nowhere near NYC) — **map re-fitted to both pins
immediately, no reload**, banner read "Imported 2 leads, replacing 2 previously saved. Your previous data
was backed up to "restaurant-map.pins.v1.**backup**-…"" (not `.corrupt-`). Re-armed a placement, imported a
single-pin file, confirmed — map centred on the new pin at street zoom, the add-pin pane showed **not**
armed (`map-pane` with no `--armed` class, form reset to empty), and a click on the map added nothing:
`localStorage` still held exactly the one imported pin. Replace rendered red, Cancel rendered grey, Export
stayed blue. Console clean across three loads and two imports. Fixture data cleared from that origin.

Unit 3 Section B is **done and mergeable**. Unit 3 ("See it all, and keep it") is complete: Section A
(fit-to-pins) and Section B (export/import) are both built, reviewed, and fixed.

Next: pick the next unit from `docs/roadmap.md`'s "Later" list (delete a pin, filter/search, or persisting
the map view), or scope a new one.

---

## 2026-08-04 — [built] Unit 3 Section B: export/import JSON

[built] Closes the "keep it" half of unit 3: a **Backup** section in the sidebar exports every pin to a
dated JSON file (`Blob` + `URL.createObjectURL`, no network) and imports one back, replacing the whole
store — per the roadmap's settled decision, not a merge — behind an explicit confirmation naming both
counts ("Replace 1 saved lead with the 2 leads in…?"). Import validates every record through `parsePin`
(the same boundary `loadPins` uses) and rejects the whole file on any invalid record, duplicate id, or
non-array payload, leaving the current store untouched. Before a confirmed replace actually writes, the
pre-import store is snapshotted via the existing `backupCorruptStore` mechanism — reused outright, not
reimplemented — so a bad import always has an undo; a failed snapshot hard-aborts.

Artifacts: `src/storage/importExport.ts` (`parseImportPayload`, `exportFilename`, `importPins`,
`ImportError`), `src/storage/importExport.test.ts` (13, incl. the spec's literal round-trip test:
export → wipe → import → byte-identical store), `src/components/ImportExport.tsx` (+ `.test.tsx`, 7),
`src/App.tsx` (`handleImportReplace`, `importInfo` banner), `src/App.test.tsx` (+6), `src/test/setup.ts`
(jsdom stub for `URL.createObjectURL`/`revokeObjectURL` — jsdom implements `Blob`/`File` but not the
blob-URL registry, verified directly), `src/index.css`. Decision log:
`docs/build_notes/Unit 3 Section B - export-import JSON.md`.

[decided] **`handleImportReplace` skips the read-modify-write guard the add/edit paths use.** Those
re-read the store immediately before writing so a stale tab can't clobber another tab's additions
(unit 2). Import is the opposite case on purpose: the user just confirmed "replace with exactly this
file, N for M" — merging in a concurrent write here would silently turn a confirmed replace into
neither the file nor the pre-confirmation state. The pre-import snapshot still reads storage fresh, so
the backup itself is never stale.

[decided] **The open editor is always closed on import (`setSelectedPinId(null)`), even when the
imported file reuses the same pin id.** The different-id case is already handled for free (`pins.find`
returns nothing). The reset exists for the sharper case — a same-id record with different data (a
plausible restore-from-backup shape) — where `PinEditor`'s `key={pin.id}` would otherwise NOT remount
and the sidebar would keep showing stale draft state. Caught by planting the regression: the first
version of the guarding test used different ids and didn't catch it; rewritten to the same-id case, it
did.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **92 passed** (8 files; was 66) ·
`npm run build` succeeds. **Self-proving — 5 regressions planted, run, restored:** skipping the
pre-import backup fails 2 tests across two files; letting `parseImportPayload` silently drop invalid
records instead of rejecting the whole file fails 3 tests across three files; removing the duplicate-id
check fails 2; skipping the post-import `setSelectedPinId(null)` reset was NOT caught by the first
version of its guarding test (see decision above) until the test was rewritten to the same-id case, which
then failed as expected.

**In-browser verification passed** (Google Chrome): seeded 3 pins with multi-line/unicode/quoted notes →
exported → downloaded file byte-identical to the seed. Cleared `localStorage`, re-imported that same
file onto an empty store → confirmation read "Replace 0 saved leads with the 3 leads in
'restaurant-map-2026-08-04.json'?" → confirmed → all 3 pins restored, store byte-identical, no spurious
backup key (nothing to back up). Seeded 1 different pin, imported a different 2-pin file → confirmation
named both counts correctly → confirmed → store held exactly the 2 new pins, a timestamped backup key
held the original pin exactly, sidebar banner named it. An invalid file (`strength: "lukewarm"`) was
rejected immediately with a named error, no confirmation offered, store unchanged. Cancelling a pending
import left the store unchanged. Console clean throughout. Fixture leads and the fixture download file
cleared from that origin/folder afterward.

Not marked done — awaiting the review.

Next: `/review Unit 3 Section B`.

---

## 2026-08-04 — [reviewed] [fixed] Unit 3 Section A: fit the map to the pins

[reviewed] Cold-context adversarial review: `docs/reviews/Unit 3 Section A - fit the map to the pins.md`
(shasum `b226bd17`). **Verdict: yes, with one MAJOR caveat.** The reviewer re-ran everything, confirmed
all four planted regressions, independently re-measured every spec bullet off the *rendered* map (tile
zooms: 0 pins → 12, 1 pin → 15, Lisbon+Porto → 7 fitted), and verified in react-leaflet 4.2.1's installed
source that the mount-only claim is real. Four findings; all fixed below.

[fixed] **MAJOR — the fit was a function of a container size nothing ever varied.** Leaflet fits a box
into the container *minus* the padding on both sides; once the map pane is narrower than
`2 × FIT_PADDING_PX` that figure goes negative, the zoom comes out `Infinity`, our own `maxZoom` clamps
it to street level, and the map opens on the centre of the bounding box with **no pin on screen** — no
throw, no warning. Reproduced in Chrome: without a floor the pane collapses to 80 / 10 / 0 px at window
widths of 400 / 330 / 200, and the failure threshold is a ~433px window (pane 113px, one above the 112px
cliff). Fixed in CSS rather than with a re-fit, so the by-construction mount-only guarantee is untouched:
`.map-pane { min-width: 240px }` and `.app { min-height: 240px }` (the pane is stretched to `.app`, so
the vertical floor belongs on the flex container); a narrower window scrolls instead of losing the pins.

[fixed] **MINOR — the padding assertion was circular.** `expectOnScreen(at, FIT_PADDING_PX)` imported the
constant that drives the fit and asserted the view against it, so it could never fail on what it existed
to protect: with `FIT_PADDING_PX = 0` the whole suite stayed green while the top pin moved to 12px from
the frame. Now asserts an independent literal (`MIN_EDGE_MARGIN_PX = 24`, justified by the 22px marker).

[fixed] **MINOR — neither zoom constant was pinned.** Both were asserted against the symbols the code
returns, and both App tests were zoom-blind by construction. Added literal assertions for
`DEFAULT_CENTER` / `DEFAULT_ZOOM` / `CLOSE_UP_ZOOM` / `FIT_PADDING_PX`, plus a `renderedZoom()` helper
that reads the zoom off the tile URLs Leaflet actually requested — the map's answer, not our prop.

[fixed] **MINOR (pre-existing) — `map--armed` never reached the DOM.** `MapContainer` does
`const [props] = useState({className, id, style})`: the *same* read-once freeze this unit's design
depends on also swallows `className`, so the crosshair for "place on map" had never worked. Moved to the
wrapping `.map-pane` (`.map-pane--armed .leaflet-container`). Confirmed in Chrome: cursor now goes
`grab → crosshair` on arm and back on cancel. Both NITs accepted as-is, as the reviewer suggested.

[decided] **The CSS floor is checked against the padding, not trusted.** The reviewer's "known gap" was
that the padding was asserted through the fit and never against the CSS. `mapFit.test.ts` now reads
`index.css` (via `?raw`) and asserts both floors are `>= 2 * FIT_PADDING_PX + MARKER_SIZE_PX`, so raising
the padding past what the pane affords turns the suite red. That needed `css: { include: [...] }` in
`vite.config.ts` — Vitest stubs CSS imports to an empty string by default, which would have made the
assertion vacuously pass. Scoped to `index.css` alone; nothing asserts on leaflet.css.

Verified: `npm test` **66 passed** (6 files; was 59) · `npm run lint` clean · `npm run typecheck` clean ·
`npm run build` succeeds. **Self-proving — 8 regressions planted, run, restored:** removing the
`.map-pane` floor fails the CSS-tie test; `FIT_PADDING_PX = 120` (exceeding what the floor affords) fails
3; `FIT_PADDING_PX = 0` now fails 2 including the App-level padding test *that used to stay green*;
shifting either zoom constant fails 4; putting the armed class back on `MapContainer` fails the crosshair
test; and the builder's original four all still fail as claimed (NYC hardcode → 4 App tests now, re-fit
effect → the no-yank test, degenerate branch → 2, first/last corners → 3). The new small-pane test was
checked against the reviewer's own failing case: at 90×600 it reproduces their exact figure
(`x = -6112`), and passes at the 240px floor.

**In-browser verification passed** (Google Chrome, the layout case jsdom cannot reach): pane width
measured at six window widths with and without the floor — never below 240px with it, 0–80px without;
crosshair arm/cancel confirmed; console clean across reloads. Fixture leads cleared from that origin.

Unit 3 Section A is **done**. Next: Section B (export/import JSON).

---

## 2026-08-04 — [built] Unit 3 Section A: fit the map to the pins

[built] The map now opens on your leads instead of on lower Manhattan. On load it fits the viewport to
the bounding box of every saved pin (padded, capped at zoom 15); a single pin — or several at one
address — centres at zoom 15 instead of fitting a box with no extent; an empty or unreadable store keeps
unit 1's default NYC view. Closes the "at a glance" gap unit 2's review flagged: leads outside New York
were rendering correctly and thousands of kilometres off screen.

**Fit-on-mount-only is structural, not a flag.** react-leaflet reads `center`/`zoom`/`bounds` once, when
it constructs the map, and ignores them afterwards — so the view is passed as a mount-time prop and no
save, re-render or state change has a path to move the map. `App` holds the view in state written by the
load effect alone and mounts `MapView` only once the store has been read, so Leaflet is constructed
already knowing what it has to show.

Artifacts: `src/domain/mapFit.ts` (`initialViewForPins` + the view constants, pure), `src/domain/mapFit.test.ts`,
`src/components/MapView.tsx` (`initialView` prop → `MapContainer` mount props), `src/App.tsx`,
`src/App.test.tsx` (+4), new `src/test/setup.ts` + `vite.config.ts` (`setupFiles`). Decision log:
`docs/build_notes/Unit 3 Section A - fit the map to the pins.md`.

[decided] **jsdom needs a real map size, and it is load-bearing.** Leaflet divides by the container's
pixel size when fitting a box; at jsdom's 0×0 the zoom is `NaN` and the map throws while mounting, so
without a stubbed 800×600 container *no* component test can render an app with more than one pin. The
stub is scoped to `.leaflet-container` and is also what lets the tests assert the real bar — they read
each pin's rendered position with `DomUtil.getPosition` and check it lands inside the viewport, rather
than checking which props were passed.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **59 passed** (6 files; was 47)
· `npm run build` succeeds. **Self-proving — each regression planted, run, restored:** the hardcoded NYC
centre fails 3 App tests; an effect re-fitting on every `pins` change (same padding and `maxZoom`) fails
"never moves the map again once it has opened"; removing the degenerate-box branch fails 2 `mapFit`
tests; taking corners from the first/last pin instead of the extremes fails 3. Planting also exposed a
weak version of the no-yank test (a re-fit that pushed pins to the frame slipped past it) — it now grows
the pin list to Reykjavík mid-edit, which no re-fit can absorb.

**In-browser verification passed** (Google Chrome): 3 Portuguese leads → opened fitted to all three,
padded, correct colours; edited notes and saved → markers pixel-identical; placed a 4th lead near
Sevilla, outside the fitted box → the original three did not move; reload → re-fitted to include all
four; single Tokyo pin → centred at street-level zoom; empty store → the unit-1 NYC default; console
clean across five loads. Fixture leads cleared from that origin. Not marked done — awaiting the review.
(Superseded by the `[reviewed]` / `[fixed]` entry above: this browser pass only ever looked at one
comfortable window size, which is exactly where the review found the MAJOR.)

Next: `/review Unit 3 Section A`, then Section B (export/import JSON).

---

## 2026-08-03 — [decided] Unit 3 scoped: "See it all, and keep it"

[decided] Unit 3 has two sections, specced in the new `docs/roadmap.md` (the project had nowhere to put
a unit's acceptance criteria *before* it was built — units 1–2 were specced in one-line "Next" notes;
unit 3 is too big for that):
- **A — Fit the map to the pins.** Closes the MINOR from unit 2's review: the hardcoded NYC center means
  leads elsewhere aren't visible without panning, which is exactly what `CLAUDE.md`'s "at a glance"
  Winning sentence promises. Fit on mount only — never re-fit on save, or the map yanks out from under
  an edit in progress.
- **B — Export/import JSON.** Requested after the realization that `localStorage` is one browser on one
  machine with no way out: a new laptop or "clear browsing data" loses every visit note, and notes are
  prose that can't be reconstructed. Local-first (`Blob` download, `FileReader` upload — no network).
  Import validates every record through `parsePin` and rejects the whole file on any bad one, snapshots
  the existing store before replacing it, and must round-trip losslessly under test.

[decided] **Import replaces the whole store** — not merge-by-id, not additive. Three facts in today's
code decide it: `Pin` has no `updatedAt`, so "newest wins" isn't implementable and the remaining rules
are replace applied per-pin — the worse version, since a conflicting pin loses prose *inside* a lead you
have no reason to open; `crypto.randomUUID` ids mean the same restaurant pinned on two machines gets two
ids, so merge yields overlapping duplicates rather than sync; and there is no delete yet to clean those
up. Additive-only was rejected too: restoring a backup into a non-empty store would silently skip the
file's version of every pin already present — exactly the notes being recovered. Replace is destructive
but visible, confirmed, and undoable via the pre-import snapshot. Real two-machine sync is a later unit
whose prerequisites are `updatedAt` + delete. Reasoning recorded in `docs/roadmap.md` §3B.

Also parked in the roadmap's "Later": delete a pin, filter/search, persisting the map view, and the two
unfixed NITs from unit 2's review.

---

## 2026-08-03 — [reviewed][fixed] Unit 2: notes + editing per pin — review closed

[reviewed] Cold-context adversarial review (`docs/reviews/Unit 2 - notes + editing per pin.md`, shasum
`e4b02023…`): **VERDICT Yes** — meets acceptance criteria, no BLOCKER. The reviewer disproved unit 1's
"jsdom can't render Leaflet" claim by bundling the real `App` and driving the real component tree
(~30 assertions), and used that harness to reproduce every finding. 2 MAJOR + 4 MINOR + 4 NIT.

[fixed] Landed the top 3 plus all MINORs (the two NITs about `parsePin` accepting `name: ''` and
`pinIcon` re-allocation are deferred):
1. **Read-modify-write on every save** (`src/App.tsx`) — new `storedPinsForWrite()` re-reads the store
   immediately before each write, so a stale tab can no longer rewrite the whole key from a list
   captured at load and delete pins another tab added while reporting "Saved.". Closes the reviewer's
   single biggest risk; applied to both the edit path and the add path.
2. **The UI layer is now tested** — added `jsdom` + `@testing-library/react`, widened the vitest glob to
   `src/**/*.test.{ts,tsx}` (it silently excluded `.tsx`), and added `src/App.test.tsx` (6) and
   `src/components/PinEditor.test.tsx` (5) covering the notes-survive-a-reload bar, marker recolor on a
   strength edit, cross-pin draft isolation, the two stale-tab paths, and the corrupt-store backup.
   **Self-proving, verified by planting each regression:** removing `key={selectedPin.id}` fails the
   wrong-lead test; reverting to the stale in-memory list fails both stale-tab tests; removing the
   backup fails the corrupt-store test — each caught by exactly the intended test, suite clean when
   restored.
3. **Corrupt bytes are snapshotted before anything overwrites them** (`backupCorruptStore` in
   `pinStore.ts`) — on a failed read the raw data is copied to
   `restaurant-map.pins.v1.corrupt-<ISO timestamp>` and the banner names that key; if the copy itself
   fails, the write is refused rather than destroying unbacked-up notes. (Unit 1's review deferred this
   to "when notes/editing land".)
4. **`loadPins` rejects duplicate pin ids** — they would route an edit onto the first matching record,
   i.e. notes silently written to the wrong lead.
5. **"Done" → "Close" / "Discard changes" when dirty**, and the unsaved hint is now warning-colored —
   it was a commit verb sitting next to Save on the one control that throws away typed notes.
6. **Softened the `CLAUDE.md` status claim** the reviewer called overstated: the DONE-WHEN checklist is
   met, but the hardcoded NYC center with no fit-to-pins means leads elsewhere aren't visible "at a
   glance". Recorded as the strongest unit-3 candidate.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **47 passed** (5 files;
was 32) · `npm run build` succeeds. Browser re-verification (Google Chrome): seeded a genuinely corrupt
store → banner named the backup key and the backup bytes matched the original; adding a pin then
overwrote the main key **with the original notes still recoverable from the backup**. Left-over fixture
leads cleared from that origin. **Unit 2 is done and mergeable.**

Deferred to unit 3: fit the map view to the pins (closes the "at a glance" gap); `parsePin` accepting
an empty `name` that `updatePin` then refuses to save; memoizing `pinIcon`; delete a pin.

---

## 2026-08-03 — [built] Unit 2: notes + editing per pin

[built] Second slice of the product bar: click any pin to open it in a sidebar editor and write, edit,
or clear free-form notes on it — plus correct its name and change its lead strength (a lead that goes
weak → strong is the point of the tracker, and there is no delete to work around a frozen strength).
Saving persists immediately; the marker recolors on a strength change and its popup reads the notes
back with their line breaks. Placing a new pin now opens its editor straight away so notes can be
written while the visit is fresh.

Artifacts: `src/domain/pin.ts` (`Pin.notes`, `updatePin`, `replacePin` + `PinNotFoundError`,
backward-compatible `parsePin`), `src/storage/pinStore.ts` (serializes `notes`), new
`src/components/PinEditor.tsx`, `src/components/MapView.tsx` (marker select, selection ring, notes in
popup), `src/App.tsx` (`selectedPinId` + save-then-commit edit handler), `src/index.css`. Decision log:
`docs/build_notes/Unit 2 - notes + editing per pin.md`.

[decided] **Storage key stays `restaurant-map.pins.v1`.** Records written by unit 1 have no `notes`
key; `parsePin` reads an absent `notes` as `''` (a *present* non-string `notes` is still a hard error),
so existing pins keep loading and the first save upgrades them in place. Requiring the field — or
bumping to `.v2` — would have sent the user's real pins down the corrupt-store path.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **32 passed** (3 files; was 15)
· `npm run build` succeeds · **in-browser verification passed** (Google Chrome): seeded a genuine
unit-1 record with no `notes` → loaded with no error banner; wrote multi-line notes + changed strength
→ pin recolored amber, notes stored with `\n` intact; **full reload** → notes and strength persisted
and the editor re-seeded from them; added a second pin → its editor opened with an *empty* notes draft
(no cross-pin draft leakage) and saved as red; second full reload → both pins, both colors, both notes
intact; console clean across three loads. Not marked done — awaiting the review.

Next after review closes: Unit 3 — candidates are delete-a-pin and filtering the map by lead strength.

---

## 2026-08-03 — [reviewed][fixed] Unit 1: Map + colored pins — review closed

[reviewed] Cold-context adversarial review (`docs/reviews/Map + colored pins.md`, shasum
`04b0e0ed…`): **VERDICT Yes** — meets acceptance criteria, no BLOCKER/MAJOR. Reviewer reproduced
typecheck/lint/test/build and verified the color mapping, lat/lng order, local-first, and lossless
persistence. Findings were 2 MINOR + 2 NIT (edge robustness + coverage).

[fixed] Applied the reviewer's top 3 fixes:
1. **Guarded `handleMapClick`** (`src/App.tsx`) — now saves *before* committing to UI state and wraps
   `createPin`/`savePins` in try/catch surfacing a named `saveError` banner, so a failed
   `localStorage.setItem` (quota/disabled storage) can no longer leave a pin visible-but-unpersisted
   (closes the silent-drop path). Longitude is `wrap()`-ed at the click source in `MapView` so a
   wrapped-world-copy click still places a pin.
2. **Added a multi-pin round-trip test** (`src/storage/pinStore.test.ts`) simulating the add flow
   (load→append→save ×3) — defends "a second pin doesn't wipe the first" against regression.
3. **Clear `loadError` after a successful save** so a repaired store dismisses the banner.

Re-ran the gate: `npm run typecheck` clean · `npm run lint` clean · `npm test` **15 passed** (was 14) ·
`npm run build` succeeds. Browser re-verification (Google Chrome): placed a **weak/amber** and a
**failed/red** pin — both render in the correct colors, the second didn't wipe the first, and both
persisted across a full reload. **Unit 1 is done and mergeable.**

---

## 2026-08-03 — [built] Unit 1: Map + colored pins

[built] Scaffolded the app (React + Vite + TS + Leaflet/OSM) and delivered the first slice: a
full-screen map where you add a restaurant (name + click-to-place), the pin renders in its lead-strength
color (strong=green / weak=amber / failed=red), and pins persist across reload via `localStorage`.

Artifacts: `src/domain/leadStrength.ts` (total strength→color map, exhaustive at compile time),
`src/domain/pin.ts` (model + boundary validation), `src/storage/pinStore.ts` (lossless load/save, throws
on corruption), `src/components/{MapView,AddPinForm,Legend}.tsx`, `src/App.tsx`, plus tooling
(`package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`). Decision log:
`docs/build_notes/Map + colored pins.md`.

Verified: `npm run typecheck` clean · `npm run lint` clean · `npm test` **14 passed** (3 files) ·
`npm run build` succeeds · **in-browser smoke test passed** (Google Chrome): map renders, click-to-place
drops a green Strong pin, it persists to `localStorage` and survives a full reload, console clean with no
StrictMode/leaflet warning. (The earlier automation failure was the extension running on Arc, not a code
issue.) Not marked done — awaiting the review.

Next after review closes: Unit 2 — notes + editing per pin.

---

## 2026-08-03 — Project initialized from agentic-starter

[decided] Adopted the build→review loop: `/session-start` to orient, `/build` to build one unit,
`/review` for a cold-context adversarial review, `/ship` to open the PR.

[decided] Scoped the product: **restaurant-map** is a personal, standalone, local-first visiting
tracker for restaurant-development work — pins for restaurants I've visited, color-coded by lead
strength (strong = green / weak = amber / failed = red), with free-form notes per pin. Stack: React +
Vite + TypeScript + Leaflet over OSM tiles, `localStorage` persistence, Vitest + ESLint/`tsc`. No
backend/DB/API (single-user, local-first). Product DONE-WHEN lives in `CLAUDE.md` #3.

Next: build the first unit — **"Map + colored pins"**: scaffold the Vite app, render the Leaflet map,
add-restaurant (name + click-to-place), lead-strength → pin color, persist across reload. Notes +
editing are a later unit.
