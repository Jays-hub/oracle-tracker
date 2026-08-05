# Unit 5 — Filter / search leads

## Why this, why now

`docs/roadmap.md`'s "Later" list had one item outstanding with a written "Done when": filter/search by
lead strength or note text. It's the highest-value remaining gap against `CLAUDE.md`'s Winning sentence
("at a glance I can see where my strong, weak, and failed leads sit") — as pin count grows, the map alone
stops being a glance-able surface, and there was no way to ask "just my strong leads" or find a pin by
what happened there. It had no acceptance criteria yet (a "Later" one-liner, like Unit 4 was before its
own build), so this unit's Step 0 scoped it into `docs/roadmap.md` first (new "Unit 5" section, following
the Unit 3/4 pattern) before writing any code.

## Codebase impact

- `src/domain/pinFilter.ts` (new) — pure functions: `PinFilter` type, `allPinsFilter`, `isFilterActive`,
  `matchesFilter`, `filterPins`. No dependency on React or storage; only `Pin` and `LeadStrength`.
- `src/domain/pinFilter.test.ts` (new) — 9 tests.
- `src/components/PinFilterBar.tsx` (new) — the sidebar control: a text search input plus three strength
  checkboxes, and a "Clear filters" button shown only while a filter is active.
- `src/App.tsx` — new `filter` state (`useState<PinFilter>(allPinsFilter())`), three handlers
  (`handleToggleStrength`, `handleQueryChange`, `handleClearFilter`), `visiblePins = filterPins(pins,
  filter)` passed to `MapView` instead of `pins`, and the sidebar count text branches on
  `isFilterActive(filter)`.
- `src/App.test.tsx` — +5 tests under `App — filter/search narrows the map`.
- `src/index.css` — `.pin-filter*` rules, matching the existing sidebar-section style (`.import-export`,
  `.legend`).
- `MapView.tsx` is **untouched**. It already renders whatever `pins` array it's handed; the filter is
  applied entirely in `App` before that prop is passed, so the marker-rendering code has no idea
  filtering exists.

## Load-bearing assumptions

1. **Filtering hides markers; it never re-fits the map.** (Load-bearing.) Section A's "fit on mount only"
   contract is that no state change after mount moves the view. Filtering only changes which pins are in
   the array `MapView` receives, not `initialView`/`mapEpoch` — so this is true by construction, not by
   care taken at each call site. Verified in Chrome: narrowing to 0 pins left the map centered exactly
   where it was, no re-fit.
2. **Strength selection and text query combine as AND.** (Load-bearing — this is the unit's core
   semantic, and the obviously-wrong alternative, OR, would have looked almost the same in casual
   testing with one active filter at a time.) Deselecting "weak" while searching "wine" means
   strong-or-failed leads mentioning wine, not everything weak plus everything mentioning wine. Guarded
   by an explicit test (`filterPins — strength and text combine as AND`) and confirmed live: unchecking
   "failed" while searching "wine" (which only gamma, a failed pin, mentions) correctly hid gamma instead
   of showing it because the text matched.
3. **An empty strength selection is a valid state meaning "show nothing," not a fallback to "show
   everything."** (Load-bearing — the tempting bug is `size === 0 ? allStrengths : selected`, which reads
   like defensive programming but silently defeats the "uncheck all three" state a user might reach while
   toggling quickly.) Explicitly tested and planted as a regression (see Self-review below).
4. **Filtering never touches `localStorage`, pin data, the current selection, or the add-pin flow.**
   (Load-bearing.) Every other piece of App state gets reset or protected somewhere (delete's undo,
   import's snapshot); filter needed the opposite decision — it's the first read-only, side-effect-free
   piece of UI state in the app, so it survives every write (add/edit/delete/import) untouched by design,
   the same "reads don't clobber other state" precedent Undo relies on
   (`docs/reviews/Delete a pin.md` F2). Verified: seeding 3 pins, filtering down to 0, and reading
   `localStorage` directly still showed all 3, byte-identical.
5. **Filtering does not close the currently-open editor, even when the filter hides that pin's own
   marker.** (Minor — a plausible alternative was "closing the editor is more honest since its marker
   just vanished," but that would make toggling a checkbox destructive to in-progress note-writing for no
   reason.) Tested and confirmed live: opened Alpha's editor, unchecked "Strong" (hiding Alpha's own
   marker), editor stayed open and unaffected.
6. **A confirmed import does not reset the filter.** (Minor design decision, not tested explicitly.) The
   filter is a view preference, not pin data, so there's no data-loss risk in leaving it set across an
   import the way there was with `armed`/`selectedPinId` (which import already resets, because leaving
   *those* set risked writing into or editing the wrong data). Worst case after an import is a filter that
   now matches nothing from the new data — visible immediately via "No leads match your filters" plus the
   always-present Clear control, never silent.

## What I deliberately did NOT do

- **A dedicated list view of leads.** The roadmap's original one-liner bundled this with filter/search;
  split it out explicitly in the Unit 5 scope ("Not in this unit") as its own future unit. A filterable
  map is the smaller, self-contained slice that satisfies the "at a glance" bar on its own; a list view is
  a materially bigger surface (its own selection/sync story with the map) that doesn't need to ship
  together with this.
- Sorting, saved/named filters, fuzzy or ranked search, filtering by map region — none of these were
  implied by the roadmap's phrasing ("filter or search by lead strength or note text") and each is its
  own scope decision.
- No `useMemo` around `filterPins(pins, filter)` — recomputed on every render. At this app's scale
  (single-user, a personal lead list) this is the same "don't pre-optimize" call the roadmap already made
  for `pinIcon` (deferred as a NIT); revisit only if it's ever measured as a real cost.

## Self-review

Ran core-logic correctness, the acceptance bar (Unit 5's "Done when" above), reproducibility, boundaries,
and meaningful tests against the finished code:

- **Core-logic correctness:** `pinFilter.test.ts` hand-verifies AND-combination, case-insensitive
  substring matching against both name and notes, whitespace-only queries treated as no query, and the
  all-strengths-deselected edge case.
- **Acceptance bar:** every bullet in the roadmap's Unit 5 "Done when" has a corresponding test or a
  direct in-browser check (see the App-test list and the Chrome walkthrough below).
- **Reproducibility:** pure functions over plain data; no stochastic input.
- **Boundaries/types:** `PinFilter.strengths` is `ReadonlySet<LeadStrength>` so a filter object can't be
  mutated by a caller holding a reference to it; `matchesFilter`/`filterPins` take `Pin[]`, the same
  already-validated type every other domain function uses — no new parsing boundary was needed since
  filtering never touches raw/untrusted data.
- **Tests are meaningful, not smoke tests:** confirmed by planting and reverting three regressions (below)
  — each was caught by exactly the test written to guard it.

**Self-proving — 3 regressions planted, run, restored:**
1. Changed `matchesFilter`'s `&&` to `||` (AND → OR) — failed 11 tests across both `pinFilter.test.ts` and
   `App.test.tsx`, including the dedicated AND-combination test.
2. Removed the `pin.notes` half of the substring check (name-only search) — failed exactly the 2 tests
   written to guard it (one domain, one App-level).
3. Made an empty `strengths` set silently fall back to matching every strength — failed exactly the
   dedicated edge-case test (`matches nothing when every strength is deselected`).

All three were reverted after confirming the failure, and the full gate was re-run clean afterward.

## Least confident spots (reviewer: look here first)

1. **The sidebar wording branch in `App.tsx`** (`filterActive ? (...) : (...)`) is the one piece of this
   unit not covered by a pure-function test — it's JSX conditional on two derived booleans/counts, tested
   only via the rendered text in `App.test.tsx`, not via a table of every count/active combination. I
   believe the three App-level assertions (`Showing 2 of 3`, `No leads match your filters`, and the
   unfiltered fallback implicitly covered by every other App test that reads `screen.getByText(/leads on
   the map/i)`... actually **that implicit coverage is the part I'm least sure of** — no App test
   explicitly re-asserts the ordinary "N leads on the map" text still renders once a filter is active and
   then cleared back to inactive via the Clear button; the "Clear filters restores every pin" test asserts
   marker count and the search box's value, not the count text's wording reverting.
2. **Whether "no re-fit" is airtight for every filter transition, not just the one path I drove in
   Chrome.** I verified narrowing text-search-to-zero doesn't move the map, but did not separately verify
   toggling strength checkboxes with the map already panned/zoomed away from its initial fit — logically
   it's the same code path (a `pins` prop change on an already-mounted `MapView`, no different from any
   ordinary add/edit), and `mapFit.test.ts`/the App-level "never moves the map again once it has opened"
   test already cover that no non-import pins-prop change re-fits — but I did not add a filter-specific
   variant of that specific test, relying on the existing one being general enough.
