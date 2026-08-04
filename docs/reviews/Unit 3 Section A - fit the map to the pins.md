# Review — Unit 3 Section A: fit the map to the pins

Adversarial, cold-context review. Read-only over the repo; everything below that says "confirmed" was
confirmed by **running** it, in a copy of the repo under `/private/tmp/.../scratchpad/sandbox` (repo tree
untouched, `git status` unchanged by this review).

**Scope reviewed:** the uncommitted working-tree delta against `eabaf08` — `src/domain/mapFit.ts`,
`src/domain/mapFit.test.ts`, `src/App.tsx`, `src/App.test.tsx`, `src/components/MapView.tsx`,
`src/test/setup.ts`, `vite.config.ts` (`git diff` for the modified files, direct read for the untracked).
Spec: `docs/roadmap.md` §"Unit 3 — Section A"; bar: `CLAUDE.md` standing order #3.

## Step 0 — What this unit had to deliver

- Open the map **on the user's pins**, not on the hardcoded NYC centre: with ≥2 pins, fit the bounding
  box of every saved pin, padded enough that edge pins aren't clipped or hidden under the sidebar.
- 1 pin (or several at one coordinate) → centre on it at a readable zoom, because a box with no extent
  fits at maximum zoom.
- 0 pins → keep unit 1's default view (`[40.7128, -74.006]`, zoom 12).
- **Fit on mount only.** No save, edit or added pin may move the view; pan/zoom after load sticks until
  reload.
- Out of scope by spec: persisting the map view across reloads.

No conflict found between the spec and the code's apparent intent. The unit is a genuine slice of the
DONE-WHEN bar ("at a glance I can see where my strong, weak and failed leads sit"), and it is the
simplest thing that closes the gap unit 2's review flagged — no drift into a backend, a geo API, or
premature "persist the view" work.

---

## Step 2 — Hunt list

| Area | Verdict |
| --- | --- |
| Core logic — bounding box over all pins, degenerate-box branch | **pass (verified by running)** — 8 domain tests against hand-computed boxes; I re-planted the builder's regressions 3 and 4 and reproduced the claimed failures exactly (2 and 3 `mapFit` tests). |
| Acceptance bar measured, not proxied | **pass (verified by running)** — I read the *rendered* opening zoom independently, off the tile URLs Leaflet requests: 0 pins → `12`, 1 pin → `15`, two pins at one address → `15`, two pins 100 m apart → `15` (maxZoom cap works), Lisbon+Porto → `7` (fitted). Every spec bullet reproduced on the real map, not from props. |
| Fit-on-mount-only guarantee | **pass (verified by running)** — react-leaflet 4.2.1 `node_modules/react-leaflet/lib/MapContainer.js` reads `center`/`zoom`/`bounds`/`boundsOptions` inside `useCallback(..., [])`; builder's assumptions 1 and 2 both hold in the installed source (`if (center != null && zoom != null) map.setView(...) else if (bounds != null) map.fitBounds(...)`). I planted a `useMap()`-based re-fit effect on `pins`: "never moves the map again once it has opened" fails, at step (2), the Reykjavík growth — the builder's account of *why* the weaker version of that test was insufficient is accurate. |
| Boundary / degenerate inputs | **pass (verified by running)** — I rendered the app with same-lat/different-lng, same-lng/different-lat, `[-90,-180]`/`[90,180]`, an antimeridian straddle (`179`/`-179`), near-poles (`±89.9`), pins metres apart, and Tokyo+New York. None throws; in all seven cases every pin lands inside an 800×600 pane. |
| **Viewport-size boundary** | **fail (verified by running)** — see BLOCKER/MAJOR finding 1. Below `2 × FIT_PADDING_PX` in either axis the fit silently produces a view with *no pin on screen*. |
| Data integrity / assumption 3 (`parsePin` guarantees finite in-range coords) | **pass** — traced every producer: `initialViewForPins` is called only with `loadPins()` output, and the only other pin source is `createPin`; both funnel through `parsePin`, which rejects non-finite/out-of-range lat/lng (`src/domain/pin.ts:47-55`). Not re-validating is the right call. |
| Reproducibility | **pass** — `initialViewForPins` is pure, order-independent (tested with a shuffle), non-mutating, no clock, no randomness, no absolute paths. Re-ran the suite 3× with identical results. |
| Split/leakage | **n/a** — no learned/fitted transform in this unit. |
| Persistence lossless + durable (`CLAUDE.md` #3) | **pass** — untouched by this unit; store round-trip tests still green. The corrupt-store path now also *mounts a map* (the default view), which is a real improvement: the corrupt-store tests click the map, so they would fail if an early return left the pane blank. |
| Lead-strength → colour mapping (`CLAUDE.md` #3) | **pass (verified)** — `src/domain/leadStrength.ts` is total (`satisfies Record<LeadStrength, string>`), `colorForStrength` throws rather than defaulting, strong `#2e9e4f` green / weak `#e8a33d` amber / failed `#d64545` red; the recolour test asserts the rendered dot's colour. Unchanged by this unit and still correct. |
| Local-first / standalone (`CLAUDE.md` #2) | **pass (verified)** — grep for `fetch(`/`XMLHttpRequest`/`http` across `src/` returns nothing but the OSM tile URL. No backend, no accounts, no geo API added. |
| Tests meaningful (would they fail on the bug you fear?) | **concern** — 3 of 4 claimed plants reproduced and are load-bearing; but the *padding* half of the spec's first bullet has no load-bearing test (finding 2), and neither zoom constant is pinned end-to-end (finding 3). |
| Error handling / friendly failure | **concern** — the narrow-pane case (finding 1) fails silently rather than loudly; nothing else regressed. |
| Anti-drift | **pass** — one pure function, one prop, one setup file. No premature abstraction; the deferred items (view persistence, zoom-to-fit button, antimeridian wrap) are correctly parked. |
| Structure / style | **pass (LOW)** — one NIT below. |

---

## Step 3 — Where a subtle bug would hide here, and what I found

1. **The interaction between a fixed pixel padding and a variable container size.** This is where I
   found the real defect (finding 1): the tests stub exactly one viewport (800×600), so the entire
   padding/zoom computation is only ever exercised at one size, and the size is the one input the tests
   can't vary without the assertions moving with it.
2. **The circularity of asserting a constant against itself.** `expectOnScreen(at, FIT_PADDING_PX)`
   looked like it measured the bar; planting `FIT_PADDING_PX = 0` showed the whole suite stays green
   while the view demonstrably changes (finding 2).
3. **The "react-leaflet reads props once" mechanism the whole design rests on.** It holds for the view —
   and it silently swallows `className`, which is passed on the same JSX line (finding 4).

---

## Step 4 — Findings

### [MAJOR] A map pane narrower/shorter than `2 × FIT_PADDING_PX` silently opens with every pin off screen
`src/components/MapView.tsx:63-74` (`boundsOptions.padding: [56, 56]`) · `src/domain/mapFit.ts:39`

**What's wrong.** Leaflet's `getBoundsZoom` computes `size = map.getSize().subtract(paddingTL + paddingBR)`
— i.e. the container size minus **112 px in each axis**. When that goes negative, `scale` is negative,
`getScaleZoom` returns `Infinity`, and `_getBoundsCenterZoom` then clamps it with the `maxZoom` this unit
supplies: `Math.min(15, Infinity) = 15`. The map therefore opens at **street zoom on the centre of the
bounding box**, with no error, no warning and — for any real spread of leads — **no pin in the viewport**.
That is precisely the pre-unit failure the unit exists to remove, reintroduced at a boundary.

**How I confirmed it.** Rendered the real `App` with two Portuguese leads while stubbing the Leaflet
container size, and read each marker's container position off the rendered map:

```
pane 800x600: [{x:376,y:444},{x:424,y:156}]  all on screen? true
pane 400x600: [{x:176,y:444},{x:224,y:156}]  all on screen? true
pane 200x600: [{x: 76,y:444},{x:124,y:156}]  all on screen? true
pane 120x600: [{x: 57,y:318},{x: 63,y:282}]  all on screen? true   <- already degraded: 36px apart
pane  90x600: [{x:-6112,y:37127},{x:6203,y:-36527}]  all on screen? FALSE
pane 800x90 : [{x:-5757,y:36872},{x:6558,y:-36782}]  all on screen? FALSE
```

No exception is thrown; the app renders, the pins exist, and the map shows an empty patch of somewhere.

**Consequence.** `.sidebar` is `flex: 0 0 320px` and `.map-pane` is `flex: 1` (`src/index.css:243-246`),
so the map pane is `window width − 321`. The failure triggers at a **window narrower than ~433 px** or
**shorter than ~112 px**, and the 113–200 px band is technically "on screen" but useless (pins crushed
into an 8 px strip). On a phone or a snapped-narrow window the unit's acceptance criterion is violated
silently. Nothing in the suite can see this: `src/test/setup.ts` hard-codes a single 800×600 viewport.

**Minimal fix (one of):** (a) clamp the padding to what the pane can afford — a mount-only `useMap()`
child that re-fits with `padding: [0,0]` when `map.getSize()` is smaller than `2 × FIT_PADDING_PX`
(empty dep array keeps the mount-only guarantee, and the planted re-fit test still catches a
`pins`-dependent effect); or (b) `.map-pane { min-width: 240px }` in `src/index.css` so the container can
never be smaller than the padding needs. Either way add a test at a small stubbed viewport asserting the
pins are still inside it.

**Confidence:** high (reproduced by running; mechanism traced through Leaflet's `getBoundsZoom` /
`_getBoundsCenterZoom`).

---

### [MINOR] The "padded away from the edges" assertion is circular — deleting the padding leaves the suite green
`src/App.test.tsx:274-292` (`expectOnScreen(at, FIT_PADDING_PX)`)

**What's wrong.** The test imports the same constant that drives the fit and uses it as the margin it
asserts. Any change to `FIT_PADDING_PX` moves the code *and* the expectation together, so the assertion
can never fail on the thing it exists to protect — the spec bullet "enough padding that edge pins aren't
… clipped at the edges".

**How I confirmed it.** Planted `FIT_PADDING_PX = 0` in the sandbox: `npx vitest run src/App.test.tsx`
→ **10 passed**, full suite still green. The rendered view really does change (top pin moves from
`y=156` to `y=12` at 800×600) — 12 px from the frame, with an 11 px marker radius, i.e. the dot touching
the edge and the popup with nowhere to open. The suite reports nothing.

**Consequence.** The one part of the acceptance bar the builder's self-review claims is "measured, not
asserted" is in fact unguarded; a future edit can silently drop the padding.

**Minimal fix.** Assert against a literal independent of the constant (e.g. `expectOnScreen(at, 24)`,
justified as marker radius + slack), or add a direct assertion that the outermost pin's margin is
`>= 11` (the dot radius) *and* that `FIT_PADDING_PX >= 11`.

**Confidence:** high (planted and run).

---

### [MINOR] Neither zoom constant is pinned by any test — `DEFAULT_ZOOM` and `CLOSE_UP_ZOOM` are asserted against themselves
`src/domain/mapFit.test.ts:24-40` · `src/App.test.tsx:296-320`

**What's wrong.** The domain tests assert `zoom: DEFAULT_ZOOM` / `zoom: CLOSE_UP_ZOOM` — the same symbols
the code returns. The App-level tests are zoom-blind by construction: the single-pin test checks the pin
is at the viewport centre (true at any zoom), and the zero-pin test checks a click at the centre maps to
the NYC coordinate (also true at any zoom). So "keep today's default view" (spec: zoom 12) and "a
readable zoom" (15) would both survive being changed to any other number with a green suite.

**How I confirmed it.** Read the assertions, then verified the *actual* rendered zooms independently, off
the tile URLs Leaflet requests: 0 pins → `12`, 1 pin → `15`, identical coords → `15`, 100 m apart → `15`,
Lisbon+Porto → `7`. The behaviour today is correct; it is only unprotected.

**Consequence.** Low: a regression here is visible on first load. Worth one literal assertion, given the
zero-pin bullet is specified as an exact view.

**Minimal fix.** One test asserting `DEFAULT_ZOOM === 12` and `CLOSE_UP_ZOOM === 15` with the rationale in
a comment, or read the rendered zoom (tile URL / `leaflet-tile` `src`) in the App tests.

**Confidence:** high.

---

### [MINOR] `map--armed` never reaches the DOM: react-leaflet freezes `className` at construction (pre-existing, but it lives on the line this unit rewrote)
`src/components/MapView.tsx:77` · `src/index.css:253-255`

**What's wrong.** `MapContainer` does `const [props] = useState({ className, id, style })` — the same
"read once at construction" mechanism this unit's design *depends on* for `bounds`/`center` also freezes
`className`. So `className={\`map${armed ? ' map--armed' : ''}\`}` is evaluated once, when `armed` is
always `false`, and the crosshair cursor for "place on map" never appears.

**How I confirmed it.** Rendered `App`, armed the add-pin flow, and read the container's class list:
`before: "map leaflet-container …"` → `after: "map leaflet-container …"` — `map--armed` never present.
Test fails on `expect(after).toContain('map--armed')`.

**Consequence.** A dead CSS rule and a missing affordance: nothing tells the user the map is armed except
the sidebar. Present at `HEAD` too (`git show HEAD:src/components/MapView.tsx:49`), so **not introduced
by this unit** — but this unit rewrote that JSX line and made the freeze its central design claim, so it
belongs in this review rather than being carried forward unnoticed.

**Minimal fix.** Put the armed class on the wrapping `<main className="map-pane">` in `App.tsx` (or a
`<div>` around `MapContainer`) and scope the CSS to `.map-pane--armed .leaflet-container`.

**Confidence:** high (reproduced by running).

---

### [NIT] The one-render empty map pane has no placeholder
`src/App.tsx:219-229`

The builder's own "least confident" item. Confirmed harmless in the test environment (the store read is
synchronous; one render). If it ever wants covering, `MapContainer` accepts a `placeholder` prop — but
holding the map back until the store is read is the right trade for the by-construction guarantee, and I
would not spend a unit on it.

### [NIT] The "Leaflet-free" domain module still encodes Leaflet's conventions
`src/domain/mapFit.ts:4-17, 78-89`

`LatLngTuple` is re-declared locally (Leaflet exports one) and the bounds tuple is documented as
"south-west corner first, north-east second — Leaflet's `LatLngBounds` order". The decoupling is
nominal: the shape is Leaflet's. Harmless, and keeping the domain suite off jsdom is worth it — noting
it only so the boundary isn't over-claimed later.

---

## Step 5 — Sign-off

- **VERDICT:** **Yes, with one MAJOR caveat.** Every spec bullet is met and I verified each one against
  the rendered map rather than the props: ≥2 pins fit their padded bounding box (Lisbon+Porto opens at
  zoom 7 with both pins inside), 1 pin and N-pins-at-one-address centre at zoom 15, 0 pins keep the
  unit-1 view (zoom 12 over `[40.7128, -74.006]`), and fit-on-mount-only holds structurally — verified
  in react-leaflet 4.2.1's installed source *and* by planting a re-fit, which the suite catches. The
  caveat: on a map pane under 112 px in either axis the fit silently opens with no pin on screen, which
  is the acceptance criterion failing without a sound. Fix before shipping; it does not invalidate the
  unit's work at normal window sizes.

- **TEST + LINT:** run by me in the repo, unmodified.
  `npm test` → **59 passed / 59, 6 files** (`mapFit` 8, `pin` 16, `pinStore` 16, `leadStrength` 4,
  `PinEditor` 5, `App` 10) · `npm run lint` (`eslint .`) → **clean, 0 problems** ·
  `npm run typecheck` (`tsc --noEmit`) → **clean** · `vite build` (run in the sandbox copy so the repo's
  `dist/` stayed untouched) → **succeeds**, 307.68 kB JS. The progress log's numbers are accurate.
  All four of the builder's planted-regression claims reproduced: NYC hardcode → 3 App tests fail;
  re-fit-on-`pins` effect → "never moves the map again" fails; degenerate branch removed → 2 `mapFit`
  fail; corners from first/last pin → 3 `mapFit` fail.

- **TOP 3 FIXES**, in priority order:
  1. Guard the fit against a container smaller than its own padding (finding 1) — clamp the padding at
     mount or give `.map-pane` a `min-width`, plus a small-viewport test.
  2. De-circularize the padding assertion (finding 2) — assert a literal margin, so deleting the padding
     turns the suite red.
  3. Move the `armed` class off `MapContainer` (finding 4) — it has never worked.

- **WHAT I COULD NOT VERIFY** even after trying:
  - **The in-browser check claimed in `docs/progress_log.md`** (Chrome, 3 Portuguese leads, Sevilla, Tokyo,
    reload, "console clean across five loads"). No browser automation is installed here and I am
    read-only, so I could not reproduce it. I substituted the strongest available proxy: rendering the
    real `App` with real Leaflet and reading rendered marker positions and requested tile zooms. The one
    browser-only input is the container's real pixel size — which is exactly where finding 1 lives, and
    which the builder's 800×600 stub can never exercise.
  - **Whether zoom 15 is "readable"** for a real user — a judgement call, one constant, cheap to change.
  - **Real CSS layout** (jsdom has no layout engine): I confirmed by reading `src/index.css` that
    `.sidebar` is a flex sibling, not an overlay, so symmetric padding is right — but no test ties the
    padding to the CSS, exactly as the builder's decision log admits.

- **SINGLE BIGGEST RISK:** The fit's correctness is a function of the container's pixel size, and both the
  tests and the browser check only ever look at one comfortable size — so the map can silently open on
  nothing at a size nobody measured, which is indistinguishable, to the user, from the bug this unit was
  built to fix.
