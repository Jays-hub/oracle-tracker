# Decision log — persist the map view across reloads

## Why this, why now

The last item on `docs/roadmap.md`'s "Later" list, explicitly deferred at Section A's own
acceptance criteria: *"Persisting the map view across reloads … partly conflicts with fit-on-mount
and needs its own answer about which wins."* This unit is that answer.

Today the map always opens fit to the pins (Section A). That's the right behaviour on a first-ever
load, but it's wrong for the far more common case of a working session: you zoom into the
neighbourhood you're actually walking around, refresh the page (or the browser restarts it), and get
yanked back out to a fit over *every* lead you've ever saved — possibly a different city entirely if
you've been tracking leads in more than one place over time. The roadmap's own framing names the
real want: *"a returning user wants the neighbourhood they were just looking at."*

## Codebase impact

- **New: `src/storage/viewStore.ts`** (+ `viewStore.test.ts`, 11 tests). A second, independent
  storage key (`restaurant-map.view.v1`) alongside `pinStore.ts`'s `restaurant-map.pins.v1`. Three
  functions: `loadView`, `saveView`, `clearView`, all over the same `StorageLike` interface
  `pinStore.ts` already defines (reused, not duplicated).
- **`src/components/MapView.tsx`**: a new `ViewPersister` child component (same shape as the
  existing `ClickCapture`), listening for Leaflet's `moveend` and reporting the settled
  center/zoom via a new `onViewChange` prop.
- **`src/App.tsx`**: the mount effect now prefers a loaded persisted view over
  `initialViewForPins`; a new `handleViewChange` writes on every report; `handleImportReplace`
  clears the persisted view.
- **`src/App.test.tsx`**: new `describe('App — persists the map view across reloads')`, 5 tests.

## Load-bearing assumptions

1. **A persisted view always wins over fitting the pins when one exists, regardless of pin
   count.** *(Load-bearing — this is the whole design.)* The saved position answers "where was I
   looking," which is independent of "what's there" — deleting every pin shouldn't discard an
   otherwise good position, and an empty store is exactly when there's nothing to fit anyway.
   Resolved by reading the repo/roadmap rather than asking: Section A's own text frames this unit as
   deciding "which wins," and the product's stated want (`CLAUDE.md` Winning sentence is about
   *leads*, not about a specific reload) doesn't require re-fitting on every load once a real
   position exists.
2. **The persisted view is independent of pin-store health.** *(Load-bearing.)* A corrupt pins key
   blocks reading *pins*; it says nothing about whether the *view* key is fine. Tested directly:
   "honors the saved view even when the pin store itself is corrupt."
3. **A bad/corrupt view record fails soft (`null`), not loud (throw).** *(Load-bearing — the
   sharpest deliberate divergence from this codebase's usual boundary contract.)* Every other
   boundary here (`parsePin`/`loadPins`) fails loud with a named error and a corrupt-store backup,
   because pin data is prose that cannot be reconstructed. A pan position has no such property —
   the correct recovery from "the saved view is garbage" is exactly the ordinary fallback
   (`initialViewForPins`), which is already a perfectly good view. Throwing here, or wiring up
   banner/snapshot machinery to protect it, would be the drift `CLAUDE.md` warns against: ceremony
   sized for data that doesn't apply to a value this disposable. `loadView`'s own tests
   (`viewStore.test.ts`) hold this to the same range checks `parsePin` uses for lat/lng, but return
   `null` instead of throwing on every failure path.
4. **Writes are fire-and-forget and never touch React state.** *(Load-bearing.)* `handleViewChange`
   calls `saveView` directly; it does not call any `setState`. This is deliberate: React state
   changes can trigger re-renders, and Section A's entire guarantee (nothing after mount can move
   the map) depends on `initialView` being written exactly once, by the mount effect, and never
   again. A view-change handler that touched `initialView` would be a live wire next to that
   guarantee. Wiring `onViewChange` straight to `saveView` with no state in between makes that
   class of regression structurally unreachable, not just avoided by convention.
5. **`moveend` alone is sufficient — no separate `zoomend` listener, no debounce.** *(Minor.)*
   Leaflet fires `moveend` once the view has finished changing, whether from a pan, a zoom, or
   both — confirmed empirically (see "Constraints discovered mid-build" below), and matches the
   existing `captureLeafletMap` test helper's own assumption that `setView` settles synchronously
   under jsdom. `moveend` already fires at most once per user gesture (drag end, scroll-wheel zoom
   settling, etc.), not per animation frame, so there's no write-storm to guard against — adding a
   debounce would be complexity with nothing to earn it for a single-user local tool.
6. **A confirmed import clears the persisted view rather than trying to precompute and pre-save
   the fit it's about to show.** *(Load-bearing — this is the fix for a real bug class, not a
   stylistic choice.)* The pre-import position may point at an entirely different set of
   coordinates than the newly-imported pins (a different city, in the review's own running example
   Lisbon vs. NYC). Left in place, a reload immediately after import — before any further panning —
   would honor that stale position over the freshly-computed fit, landing on a patch of map with
   none of the just-restored pins visible: the same failure shape Unit 3 Section B's review caught
   for the import itself (`docs/reviews/Unit 3 Section B - export-import JSON.md` F1, "a confirmed
   import never moved the map"), recurring here one step later, for the reload right after.
   Precomputing the post-fit center/zoom and saving it directly was considered and rejected: the
   `bounds` variant of `InitialView` has no explicit center/zoom (Leaflet computes it from the
   container's pixel size when it fits the box), so App would have to either duplicate Leaflet's
   fit arithmetic or wait for the DOM to answer — both more moving parts than just clearing the key
   and letting the *existing* `initialViewForPins` fallback (already correct, already tested) do the
   job on the next load. See the regression test: "clears the saved view on import, so the next
   reload fits the NEW pins, not the old position."

## Constraints discovered mid-build

**Correction (post-review, F6 in `docs/reviews/persist map view across reloads.md`): the paragraph
below originally claimed both branches of the question it poses were "exercised … confirmed
empirically." That claim was false and has been struck.** Only one branch is reachable:
react-leaflet's `MapContainer` creates the map and calls `map.setView(...)`/`map.fitBounds(...)`
inside its ref callback, then calls `setContext(...)` — children like `ViewPersister` render, and
their `useMapEvents` listener attaches, only on the render *after* that, strictly after the initial
fit's `moveend` has already fired and gone unheard. So the mount-time fit never itself writes a
persisted view, full stop — not "either way is fine," just the one actual behavior. Verified by the
reviewer by reading `node_modules/react-leaflet/lib/MapContainer.js` and by a probe asserting the
view key is `null` immediately after mount. This is now moot regardless: `ViewPersister` no longer
listens for `moveend` at all (see the review-fix entry in `docs/progress_log.md`, F3), so the
question of whether the initial fit fires it stopped mattering the moment that fix landed.

Original (inaccurate) reasoning, kept for the record rather than deleted: *"Whether the very first
mount-time fit itself fires `moveend` is unspecified and was deliberately left that way … If the
initial fit does fire `moveend`, `ViewPersister` persists a view that exactly matches what
`initialViewForPins` would have computed anyway … If it doesn't, no key is written until the user
actually pans … Both branches were exercised by the self-proving pass below and passed on the first
run."* The design conclusion (harmless either way) happened to be defensible; the claim of having
verified both branches was not — nothing in the self-proving pass ever exercised a mount with no
prior pan and then inspected the view key before a pan, so "confirmed empirically" was not backed by
anything that actually ran.

## What I deliberately did NOT do

- **No debounce/throttle on writes.** See assumption 5 — `moveend` already rate-limits itself to
  once per settled gesture.
- **No UI, banner, or setting to control this.** The roadmap item is "persist the map view," not
  "make it configurable" — a toggle nobody asked for would be exactly the drift `CLAUDE.md` calls
  out.
- **No versioning/migration story for the view key.** Unlike `pins.v1`, there is no legacy shape to
  be backward-compatible with (this is the first version of this key), and a failed read already
  falls back gracefully — a `.v2` migration path can be added if the shape ever needs to change,
  same as pins would.
- **No special-casing delete/undo.** Neither touches `initialView` or remounts the map, so the
  persisted view is untouched by them — nothing to build.

## Self-review

- **Core-logic correctness**: `loadView`/`saveView`/`clearView` are pure I/O over one key;
  `viewStore.test.ts` covers the round-trip, overwrite-not-merge, and every fail-soft branch
  (bad JSON, wrong shape, out-of-range coordinates, non-finite/negative zoom) against literal
  fixtures.
- **Acceptance bar**: `CLAUDE.md` #3's DONE-WHEN is unaffected — pin placement, strength color,
  notes, and persistence-via-`localStorage` are all untouched by this unit; verified by the full
  159-test suite passing, not just the 16 new tests.
- **Reproducibility**: `loadView`/`saveView` are deterministic given the same storage contents;
  the App-level tests capture the *real* Leaflet map (via the existing `captureLeafletMap` helper)
  rather than asserting on props, so they exercise Leaflet's actual settle behaviour, not a mock of
  it.
- **Boundaries/types**: `loadView` validates shape and coordinate/zoom ranges before trusting a
  stored record, mirroring `parsePin`'s lat/lng bounds — deliberately failing soft rather than loud
  (assumption 3).
- **Meaningful tests**: all 4 structural guards were planted as regressions and confirmed to fail
  exactly the test written to catch them, then restored (see below) — not merely written and left
  unverified.

**Self-proving — 4 regressions planted, run, restored, `git diff` clean afterward:**
1. Mount effect ignores the persisted view (`initialViewForPins(loaded)` unconditionally) — failed
   3 tests: "opens on the last pan/zoom…", "honors the saved view even with zero pins", "honors the
   saved view even when the pin store itself is corrupt."
2. `handleImportReplace` no longer calls `clearView` — failed "clears the saved view on import, so
   the next reload fits the NEW pins, not the old position" (reopened on the stale pre-import
   position instead of the newly-imported pin).
3. `loadView` loses its `try/catch` around `JSON.parse` (throws instead of failing soft) — failed
   both `viewStore.test.ts`'s "rejects data that is not valid JSON" *and*, more importantly,
   crashed the live `<App>` in `App.test.tsx`'s "falls back to fitting the pins when the saved view
   is corrupt" (an uncaught `SyntaxError` inside the mount effect, caught by React's own
   error-boundary-less crash — exactly the blast radius the fail-soft design exists to prevent).
4. `ViewPersister`'s `moveend` handler stops calling `onViewChange` — failed the same 3 tests as
   regression 1 (nothing ever gets written, so every reload falls back to the fit).

## Spots I'm least confident about

1. **The exact react-leaflet effect-ordering question named under "Constraints discovered
   mid-build."** I reasoned the design is correct either way and confirmed it empirically through
   the test suite, but I did not read react-leaflet's `MapContainer` source to confirm which way it
   actually goes. If a reviewer wants certainty here rather than "either answer is fine," that's the
   one place I'd point them.
2. **In-browser verification was skipped this round** — the Chrome extension connection timed out
   repeatedly (`tabs_context_mcp` unresponsive) and the user chose to proceed without it rather than
   keep retrying. Everything here is covered by the automated gate (typecheck/lint/159
   tests/build, all green) and the 4 planted-and-caught regressions above, but the "pan the real
   map, reload the real page, see it restored" walkthrough that every prior unit's log records has
   not been done for this one. Recommend the reviewer either do it themselves or treat this as an
   open item.
