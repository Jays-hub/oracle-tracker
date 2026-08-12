# Decision log — Unit 7: Multi-view navigation

## Why this, why now

Today there is exactly one way to look at your leads: the map. As pin count grows, markers/popups
aren't a great surface for scanning — there's no scannable list of leads. `docs/roadmap.md`'s Unit 7
section frames this directly, and it doesn't depend on anything else in the roadmap: Unit 6B
(git-syncable storage) isn't required, and the spec explicitly says this unit "must not hard-depend on
Unit 6 having landed." It's presentation-only on top of whichever storage layer is live.

## Codebase impact

- **New: `src/components/ViewSwitcher.tsx`** (+ `.test.tsx`, 3 tests). A two-button Map/List toggle
  (`role="group"`, `aria-pressed`), exporting `MainView = 'map' | 'list'`.
- **New: `src/components/PinList.tsx`** (+ `.test.tsx`, 10 tests). The List view itself: rows of
  name/strength/notes-preview, sorted via the new `sortPinsByName`. Exports `previewNotes` and
  `NOTES_PREVIEW_LENGTH` for direct unit testing of the truncation logic.
- **`src/domain/pin.ts`**: new `sortPinsByName(pins)` — alphabetical, case-insensitive, stable, pure.
  Kept in the domain layer (not inlined in `PinList.tsx`) because ordering is part of the acceptance
  bar ("a sensible default order"), not incidental rendering, and it's directly unit-testable there
  without mounting a component. 5 new cases in `pin.test.ts`.
- **`src/App.tsx`**: new `activeView` state (`MainView`, default `'map'`); `<ViewSwitcher>` added to the
  sidebar; the main pane restructured (see "Load-bearing assumptions" #1 below) to layer `PinList` over
  `MapView` instead of swapping between them.
- **`src/index.css`**: new `.view-switcher*` rules; `.map-pane` gains `position: relative`; new
  `.map-pane__map` wrapper (fills `.map-pane`, unchanged sizing chain for `.map` inside it); new
  `.list-pane`/`.pin-list*` rules.
- **`src/App.test.tsx`**: new `describe('App — multi-view navigation (List view)')`, 5 tests.

## Load-bearing assumptions

1. **MapView must never unmount on a view switch.** *(Load-bearing — this is the whole architecture.)*
   The obvious naive implementation — `{activeView === 'map' ? <MapView/> : <PinList/>}` — would
   remount `MapView` every time the user switches back to Map. Because `initialView` in `App` state is
   written exactly once at mount (Unit 3 Section A's rule) and is *not* updated as the user pans, a
   remount would reopen the map on whatever `initialView` was at the last mount — silently discarding
   any pan/zoom done since, every single time you check the list and come back. That's a real
   regression the spec's "switching is pure UI/read state" line rules out implicitly (it doesn't
   *mention* the map position, but losing it isn't "pure UI state," it's data loss of a kind Unit 6
   ("persist the map view") shipped specifically to prevent). Fixed by keeping `MapView` permanently
   mounted inside a `.map-pane__map` wrapper, and layering `PinList` on top via `.list-pane`
   (`position: absolute; inset: 0`) only when List is active. `aria-hidden` (not conditional rendering)
   keeps the covered map out of the accessibility tree. Verified in `App.test.tsx`: pan the real Leaflet
   map via `captureLeafletMap`, switch to List and back, assert the `.leaflet-container` DOM node
   identity is unchanged and the center/zoom are exactly as left.
2. **List renders exactly `visiblePins` — the same filtered array MapView gets.** *(Load-bearing.)*
   Not a second, independently-filtered read of `pins`. This is what makes "same AND semantics, same
   'Showing N of M' wording" true by construction rather than by two implementations happening to
   agree — there's only one filtered array, and both views read it.
3. **The z-index of `.list-pane` had to beat Leaflet's own control layer, not just be "on top."**
   *(Load-bearing — caught by in-browser verification, not by any test, since jsdom does no layout/
   paint and can't see a z-index bug.)* Leaflet's zoom control lives in `.leaflet-top`/`.leaflet-bottom`,
   which Leaflet's own CSS sets to `z-index: 1000`. A first pass at `.list-pane { z-index: 1 }` looked
   fine in the jsdom test suite (which doesn't render CSS at all) but in Chrome left the +/− buttons
   visibly floating over the list rows, still clickable. Fixed by raising `.list-pane` to
   `z-index: 1000`. Documented at the CSS site so a later reader doesn't "simplify" it back down.
4. **The AddPinForm stays visible in the sidebar during List view; only click-to-place is
   Map-only.** *(Minor, but a deliberate reading of the spec worth stating.)* "Placing a new pin still
   only happens via the Map view" reads as being about the *click* (inherently spatial — List is
   reviewing, not creating), not about hiding the sidebar's name/strength form while List is active.
   The sidebar `stays available in both` per the same "Done when" bullet, and arming a placement while
   viewing List, then switching to Map to click, is a perfectly normal flow this doesn't need to block.
   Since the map is fully covered while List is shown, a click physically can't land on it anyway —
   the constraint holds structurally, not by disabling the form.
5. **Sorting stability relies on `Array.prototype.sort` being stable (ES2019+).** *(Minor.)* True for
   every JS engine this project runs on (Vite/Vitest on Node, and every evergreen browser); a duplicate
   or case-varying name keeps its original relative order rather than reordering nondeterministically.
   Tested directly in `pin.test.ts`.
6. **Notes preview truncates on a fixed character count (`NOTES_PREVIEW_LENGTH = 80`), not on
   available row width.** *(Minor.)* CSS `text-overflow: ellipsis` on `.pin-list__notes` also clips
   visually at the actual rendered width, so the two truncations can disagree by a few characters at
   unusual window sizes — accepted as harmless (the CSS clip is what's actually seen; the JS truncation
   exists so a very long note doesn't bloat the DOM/markup or defeat a future non-CSS renderer, and
   caps how much text needs collapsing).

## What was deliberately NOT done

- No URL routing / deep links — plain `useState` for `activeView` is the simpler thing that meets the
  bar, per the spec's own "Not in this unit."
- No stats/analytics view, no bulk actions from the list, no user-configurable sort, no split-screen —
  all explicitly out of scope per the roadmap.
- Did not thread `filterActive` into `PinList` to distinguish "no leads at all" from "everything
  filtered out" in its empty-state message — both read as "No leads to show." The sidebar's
  `sidebar__count` region already gives the precise wording ("No leads match your filters." vs. "0
  leads on the map"); duplicating that distinction inside `PinList` for a one-line message would be
  ceremony the drift rule warns against.
- Did not add `inert` or fully block keyboard-tab focus into the covered map's controls while List is
  shown — `aria-hidden` keeps it out of the accessibility tree, but Leaflet's zoom buttons remain
  physically tabbable (though invisible and, once covered, unclickable by mouse). Judged proportionate
  to this codebase's existing accessibility bar (aria-live/role usage is targeted, not exhaustive) —
  flagged here rather than silently skipped.

## Self-review against the acceptance bar

- **Core-logic correctness**: `sortPinsByName` and `previewNotes` are pure functions with hand-checked
  expected values in their own tests (case-insensitive order, stability on ties, exact truncation
  boundary).
- **The acceptance bar (`docs/roadmap.md` Unit 7 "Done when")**: view switcher ✓; List shows exactly
  the filtered pins as name/strength/notes rows ✓; same PinEditor on click ✓; alphabetical default
  order ✓; placement stays Map-only (structurally, via the covering overlay) ✓; no storage/pin-shape
  changes, no Unit 6 dependency ✓.
- **Reproducibility**: `sortPinsByName`/`previewNotes` determinism asserted directly; `ViewSwitcher`
  and `PinList` are pure props-in/render-out with no internal state.
- **Boundaries/types**: `PinList`/`ViewSwitcher` props are fully typed; no new untrusted-data boundary
  is introduced (List/Switcher consume already-validated `Pin[]`/`MainView`, nothing from storage).
- **Meaningful tests**: 23 new tests across 4 files, each stating in a comment what it protects against
  (not smoke tests) — notably the map-identity test (finding #1 above), which is the one a naive
  conditional-render implementation would have failed.

## Least confident spots — look here first

1. **Finding #3 above (the z-index fix).** It's a one-line CSS change verified by eye in Chrome, with
   no automated regression test — jsdom cannot render CSS/paint order, so nothing in the suite would
   catch a future reversion of `.list-pane`'s `z-index: 1000` back down. If Leaflet ever changes its own
   control z-index, or another overlay is added later, this could silently break again with zero test
   failure. Worth deciding whether that risk is acceptable for a personal tool or whether it needs some
   other guard (a documented convention, a lint rule, nothing obvious and cheap comes to mind, which is
   why it wasn't added here).
2. **The `.map-pane__map` wrapper's effect on the existing Leaflet-sizing tests.** `MapView`/`.map` now
   sit one DOM level deeper than before (`.map-pane` → `.map-pane__map` → `.map` instead of
   `.map-pane` → `.map`). The existing fit/viewport tests in `App.test.tsx` (`markerPositions`,
   `renderedZoom`, the `MAP_VIEWPORT` floor test) all still pass unchanged, and `test/setup.ts`'s
   `clientWidth`/`clientHeight` override is scoped to `.leaflet-container` specifically (not the new
   wrapper), so it shouldn't be affected — but this is exactly the kind of layout-chain change the
   codebase's own comments call fragile (`FIT_PADDING_PX`/min-width), so it's worth the reviewer's own
   read of whether the extra wrapper is truly inert for sizing, not just "tests still pass."

## Verified

`npm run typecheck` clean · `npm run lint` clean · `npm test` **187 passed** (13 files; was 164/11) ·
`npm run build` succeeds (90 modules, 317.82 kB JS / 22.95 kB CSS). **In-browser verification passed**
(Google Chrome, `npm run dev`): seeded 3 pins of mixed strength/notes; Map view rendered as before;
switched to List — rows in alphabetical order (case-insensitive: "gamma tavern" sorted between "Alpha
Cafe" and before nothing, i.e. correctly last), strength labels, notes preview truncated with an
ellipsis on the long note, "No notes yet" placeholder on the empty one; **caught and fixed the z-index
bug** (Leaflet's zoom control bled through the list at the initial `z-index: 1`); after the fix, the
list fully covers the map; panned the real map, switched List → Map, confirmed the pan survived (no
re-fit, no jump back to the pin-fit view); clicked a list row → the same `PinEditor` opened, seeded from
that pin, edited it, saved successfully; toggled the strength filter in List view → row count and
"Showing N of M" updated in lockstep with the map's own filtering; console clean across the whole
session, no errors/warnings.
