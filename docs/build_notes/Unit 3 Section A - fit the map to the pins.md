# Unit 3 Section A — Fit the map to the pins

Decision log for the reviewer. Spec: `docs/roadmap.md` §"Unit 3 — Section A".

## Why this, why now

`MapView` opened on a hardcoded `center={[40.7128, -74.006]} zoom={12}`, so the app only showed you
your leads if your leads were in New York. Everywhere else the pins existed, persisted, and rendered in
the right colour — several thousand kilometres off screen. `CLAUDE.md`'s Winning sentence is *"at a
glance I can see where my strong, weak, and failed leads sit on the map"*, and unit 2's review flagged
the gap; every item of the DONE-WHEN checklist was already met, which is precisely why this was next:
the remaining distance to the product bar was in the opening view, not in the data model.

It comes before Section B (export/import) because it is the smaller of the two and shares nothing with
it — no shared code, no ordering constraint — so it lands and closes on its own.

## Codebase impact

| Path | What it does |
| --- | --- |
| `src/domain/mapFit.ts` (new) | `initialViewForPins(pins)` → `InitialView`, plus the view constants. Pure; no Leaflet, no React. |
| `src/domain/mapFit.test.ts` (new) | 8 tests over that function against hand-computed boxes. |
| `src/components/MapView.tsx` | Takes an `initialView` prop and hands it to `MapContainer` as mount-time props, instead of the hardcoded NYC centre. |
| `src/App.tsx` | Computes the view once in the load effect; mounts `MapView` only once the store has been read. |
| `src/App.test.tsx` | 4 new tests reading pin positions off the rendered map; 2 existing map-click blocks folded into a `clickMapAt` helper. |
| `src/test/setup.ts` (new) | Gives the Leaflet container a size under jsdom. |
| `vite.config.ts` | Registers that setup file. |

Downstream: `initialViewForPins` is where a "persist the map view" unit would later plug in (the roadmap
defers it, and it conflicts with fit-on-mount — that conflict is now localised to one function). Nothing
else in the app reads or writes the view.

## Design decisions

**Fit on mount is enforced by react-leaflet's own contract, not by a flag.** `MapContainer` reads
`center`/`zoom`/`bounds`/`boundsOptions` inside a `useCallback(..., [])` ref that fires once, when it
constructs the Leaflet map, and ignores every later change (`node_modules/react-leaflet/lib/MapContainer.js`).
So handing the view over as a prop means there is no code path that can move the map after mount — no
`useEffect` on `pins`, no `didFit` ref, nothing to accidentally re-arm. The alternative (fit inside an
effect, guarded by a boolean) is one careless dependency array away from yanking the map out from under
an edit in progress, which is the failure the spec names.

**Which forced the map to mount *after* the store is read.** `pins` starts `[]` and is filled by a mount
effect, so a map mounted on the first render would be constructed knowing nothing and could only fit
itself afterwards — the re-fit we just designed out. `App` therefore holds `initialView: InitialView |
null` and renders `<MapView>` only when it is set. Cost: the map pane is empty for the one render it
takes to read `localStorage`. Considered and rejected: reading the store in a `useState` lazy
initializer instead (removes the gap entirely, but that initializer is double-invoked under StrictMode
and it is where `backupCorruptStore` writes — restructuring unit 2's hardened corrupt-store path to save
one frame is a bad trade).

**`initialView` is set on both load paths, in one place.** The effect declares `let loaded: Pin[] = []`,
assigns in the `try`, and calls `setInitialView(initialViewForPins(loaded))` after the `try/catch`. A
corrupt store therefore opens at the default view (correct: there are no pins to fit) and, more
importantly, still mounts a map — an early return there would have left the error banner floating beside
a blank pane.

**A point and a box are different answers, so `InitialView` is a union.** Leaflet picks its own zoom for
a box from the container's pixel size, and cannot for a point. A box around a single point has no
extent: Leaflet fits it at maximum zoom, i.e. a roof. Rather than invent a fake box (± some degrees) the
function returns `{kind:'center'}` for that case, and `MapView` passes `center`+`zoom`. Note
`MapContainer` prefers `center`+`zoom` over `bounds` when given both, so exactly one form is ever
passed — sending both would silently drop the fit.

**Constants, and why those numbers.** `CLOSE_UP_ZOOM = 15` is street level: enough to read which block a
restaurant is on. `FIT_PADDING_PX = 56` is the gap between the outermost pins and the frame — the marker
dot is 22px and centred on its coordinate, so under ~11 the dot itself clips; the rest is so an edge pin
reads as a pin and its popup has somewhere to open. The spec asks that edge pins not sit "under the
sidebar": no allowance is needed for that, because `.sidebar` is a flex sibling of `.map-pane`
(`index.css`), not an overlay — it never covers the map. Asymmetric padding would have been drift.

**`CLOSE_UP_ZOOM` doubles as the fit's `maxZoom`,** so two leads on the same street don't open at the
tile layer's maximum.

## Load-bearing assumptions

1. **(Load-bearing, verified in the installed source.)** react-leaflet v4 applies `bounds`/`center` only
   at map construction. The whole "by construction" claim above rests on it. Verified by reading
   `node_modules/react-leaflet/lib/MapContainer.js`, and defended by a test that plants the re-fit.
2. **(Load-bearing, verified.)** `MapContainer` prefers `center`+`zoom` when both are present — same
   source, the `if (center != null && zoom != null) ... else if (bounds != null)` branch.
3. **(Load-bearing.)** Every `Pin` reaching `initialViewForPins` has already passed `parsePin`, so
   `lat`/`lng` are finite and in range. The function therefore does **not** re-validate: a second silent
   filter here would hide a broken boundary rather than fix one, and `parsePin` is where a bad
   coordinate must fail loudly. If that invariant ever breaks, `Math.min` propagates `NaN` and Leaflet
   throws `Invalid LatLng object` at mount — loud, not silent.
4. **(Minor.)** Zoom 15 is "readable". Judgement, checked in the browser against a real Tokyo pin;
   trivially changed in one constant.
5. **(Minor.)** Pins are few (personal tracker), so the fit is a plain O(n) pass with no indexing.

## Deliberately not done

- **Persisting the map view across reloads.** Excluded by the spec; it partly conflicts with fit-on-mount
  and needs its own answer about which wins. Still in the roadmap's "Later".
- **Re-fitting on demand** (a "zoom to fit" button, or fitting when a pin is added off screen). Not in
  the spec, and the second one is the yank the spec forbids. Worth considering only if using the app
  shows it is missed.
- **Antimeridian-aware bounds.** Leads straddling ±180 produce a box the long way round the globe. That
  box still *contains* every pin — the acceptance bar holds — it just opens further out than necessary.
  Wrap-aware fitting is real complexity for a case a personal restaurant tracker will not see.
- **Anything about lead-strength filtering or a list view.** Roadmap "Later".

## Least confident about

1. **The one-render gap before the map mounts.** In the browser it is invisible (tiles take far longer),
   and it buys the by-construction guarantee. But it is the one user-visible behaviour change beyond the
   view itself, and it is the sort of thing a reviewer should look at with fresh eyes — particularly
   whether an empty `.map-pane` for a frame is acceptable, or whether it wants a placeholder.
2. **The jsdom size stub in `src/test/setup.ts`.** It is load-bearing for the component suite, not
   cosmetic: Leaflet divides by the container size when fitting, and at jsdom's 0×0 the zoom comes out
   `NaN` and the map throws while mounting — so without it, *no* component test can render an app with
   more than one pin. That means the tests assert against an 800×600 viewport that only exists in the
   test process. The browser check below is what covers the real-layout case.

## Self-review against the project's bar

- **Core-logic correctness** — bounding box over every pin, hand-computed expectations in
  `mapFit.test.ts`, plus an in-test containment check that each pin lies inside the returned box.
- **The acceptance bar, not a proxy** — the App-level tests read each pin's position off the *rendered*
  Leaflet map (`DomUtil.getPosition`) and assert it lands inside the viewport, padded. That is "I can
  see all my leads without panning", measured, rather than "the right props were passed".
- **Reproducibility** — `initialViewForPins` is pure and order-independent, with a test that shuffles
  the input and one that checks the caller's array isn't mutated. No clock, no randomness.
- **Boundaries and types** — `InitialView` is a discriminated union, so `MapView` cannot pass a
  half-formed view; coordinate validation stays at `parsePin` (assumption 3). Extremes `[-90,-180]` /
  `[90,180]` are covered by test.
- **Meaningful tests, proven by planting the regressions** — each was planted, the suite run, and the
  original restored:
  1. hardcoded NYC centre (i.e. unit 2's code) → 3 App tests fail;
  2. an effect that re-fits whenever `pins` changes, with identical padding and `maxZoom` → *"never
     moves the map again once it has opened"* fails;
  3. the degenerate-box branch removed → 2 `mapFit` tests fail;
  4. corners taken from the first and last pin instead of the extremes → 3 `mapFit` tests fail.
- **A gap the planting exposed and I fixed.** The first version of "never moves the map again" added the
  third pin by clicking inside the viewport, and plant 2 slipped past it — an unpadded re-fit pushes the
  pins to the frame, so no click can land outside their box and the view doesn't change. The test now
  also grows the pin list to Reykjavík between saves (the other-tab path), which no re-fit can absorb.
  Both plants fail it now.
- **Known gap:** the padding constant is asserted through the fit, not against the CSS. If the sidebar
  ever becomes an overlay, the padding would need to become asymmetric and no test would say so.
