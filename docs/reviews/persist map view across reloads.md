# Review — unit "persist map view across reloads"

Cold-context adversarial review. Reviewer is read-only over the repo (enforced by
`.claude/hooks/enforce_agent_write_scope.py`); this file is the one artifact it may write.

**Diff base:** uncommitted working tree against `ba7ac47` (`git diff`, `git status --short`) —
`docs/progress_log.md`, `src/App.test.tsx`, `src/App.tsx`, `src/components/MapView.tsx` modified;
`src/storage/viewStore.ts`, `src/storage/viewStore.test.ts`,
`docs/build_notes/persist map view across reloads.md` new.

**Spec I judged against** (there is no dedicated roadmap section):
- `docs/roadmap.md` "Later" bullet: *"**Persist the map view** across reloads (see Section A's
  exclusion)."*
- `docs/roadmap.md` Unit 3 Section A, "Not in this section": *"Persisting the map view across reloads
  (deferred since unit 1 — decide it separately; it partly conflicts with fit-on-mount and needs its own
  answer about which wins)."*
- Section A's still-live acceptance criteria: *"loading the app shows **every** pin in the viewport
  without panning or zooming"*, *"fit on mount only"*.
- `CLAUDE.md` "Winning": *"at a glance I can see where my strong, weak, and failed leads sit on the
  map"*; standing order #3 DONE-WHEN; standing order #2 (drift).
- `.claude/rules/00-process.md`, especially "Prose is not mechanism".

**What this unit had to deliver, in my words:**
- Reopen the map where the user left it, instead of re-fitting to all pins on every load.
- Answer the deferred conflict question — saved view vs. fit-on-mount — *and live with the consequences
  of that answer*, since Section A's "every pin visible on load" is an already-shipped, reviewed
  criterion this unit is allowed to override but not allowed to quietly break.
- Do it local-first, in `localStorage`, without touching pins, colors, notes, or the DONE-WHEN bar.
- Keep the persisted value honest: what gets written must be what comes back.

**Spec conflict I have to name up front (Step 0 requirement).** The roadmap authorised this unit to
decide *which wins*. It did not authorise removing Section A's guarantee with nothing in its place. The
shipped answer ("a saved view always wins, at any pin count, forever") makes Section A's done-when
conditionally false and leaves the app with **no control anywhere that returns the user to their
leads**. That is F1 below, and it is the review's headline.

---

## Step 1 — Verified by running (not by reading)

Repo, unmodified working tree:

| Command | Result |
| --- | --- |
| `npm test` | **159 passed / 159**, 10 files, 0 failed (matches the builder's claim) |
| `npm run lint` (`eslint .`) | clean, no output |
| `npm run typecheck` (`tsc --noEmit`) | clean |

Scratchpad copy of the tree (`/private/tmp/.../scratchpad/sandbox1`, reviewer is read-only over the
repo):

| Command | Result |
| --- | --- |
| `npx vitest run src/App.test.tsx` | 46 passed — sandbox is faithful |
| `npx vite build` | succeeds, 315.90 kB JS / 21.26 kB CSS |
| 17 reviewer probe tests (3 files) | all ran; results below |
| 1 mutation (`moveend` → `zoomend`) | **killed 0 of 57 tests** → F4 |

Independent check of the builder's "4 regressions planted, restored, `git diff` clean": the builder's own
backups (`App.tsx.orig`, `MapView.tsx.orig`, `viewStore.ts.orig`, left in the session scratchpad) `diff`
byte-identical against the shipped sources. The restore was complete. Confirmed.

---

## Step 2 — Hunt list

| # | Item | Verdict |
| --- | --- | --- |
| 1 | Core logic: `loadView`/`saveView`/`clearView` round-trip for in-range values | **verified-by-running** — pass (11 unit tests + my own probes) |
| 2 | Core logic: mount effect prefers a persisted view, falls back to `initialViewForPins` | **verified-by-running** — pass |
| 3 | **Save/load contract symmetric** (everything `saveView` can write, `loadView` accepts) | **fail** → **F2** (verified: one drag writes lng −197.05, which `loadView` rejects) |
| 4 | The unit's acceptance bar: "the map opens where I left it" holds for real gestures | **fail** → **F2** (silently false after any pan past ±180 — one sub-screen drag at world zoom) |
| 5 | The unit's other half: the "which wins" answer does not break Section A's *purpose* | **fail** → **F1** (leads can be permanently off screen with no in-app recovery) |
| 6 | Only user-intended gestures persist a view | **fail** → **F3** (a window resize writes one; verified in jsdom + Leaflet source) |
| 7 | Section A "fit on mount only" — nothing after mount moves the map | **concern** → **F7** (comment claims this absolutely; `invalidateSize` pans, popup autoPan can too) |
| 8 | Mount-time fit does not itself write a view (builder's open question #1) | **verified-by-running** — pass, and now *settled*: react-leaflet renders children only after `setContext`, which is after `map.setView`/`fitBounds` (`node_modules/react-leaflet/lib/MapContainer.js`), so the listener is never attached in time. Probe A: view key `null` after mount with 2 pins, 0 pins, and a restored view. Only one branch is reachable → **F6** |
| 9 | Persistence is lossless for **pins** (CLAUDE.md #3) | **verified-by-running** — pass (probe I: a pan writes *only* `restaurant-map.view.v1`; pins key byte-identical; probe C asserts stored pins unchanged) |
| 10 | Corrupt **pin** store does not poison the view, and vice versa | **verified-by-running** — pass (probe J: pins key, view key and corrupt-backup key all present and independent) |
| 11 | Corrupt **view** record degrades to empty-but-usable, never crashes the map | **pass** — deliberate fail-soft; documented in the decision log; App-level test covers the mount path. Divergence from `parsePin`'s fail-loud is justified for a disposable preference (not pin data) — accepted |
| 12 | Import replace clears the stale view (real bug class, Unit 3 Section B F1 shape) | **verified-by-running** — pass (probe J2: key gone after a confirmed replace; still gone with no pan afterwards) |
| 13 | Lead-strength → color: total, fixed, strong=green/weak=amber/failed=red | **pass** — untouched by this unit; `STRENGTH_COLORS` still `satisfies Record<LeadStrength,string>` with `#2e9e4f` / `#e8a33d` / `#d64545`, `colorForStrength` throws rather than defaulting; 4 domain tests green |
| 14 | Local-first / standalone (CLAUDE.md #2) | **pass** — one new `localStorage` key, no fetch/XHR, only the OSM tile URL; no coupling to the restaurant-development project |
| 15 | Anti-drift (no backend/config UI/versioning ceremony) | **pass** — three functions, one key, no toggle. The *restraint* is right; the missing escape hatch (F1) is not "more sophistication", it's the simpler half of the same decision |
| 16 | Reproducibility / determinism | **pass** — pure I/O, no clock, no randomness, no absolute paths; results order-independent |
| 17 | Boundary/type validation of the stored record | **concern** → **F8** (lat/lng range-checked, zoom only `>= 0`; stored zoom 30 opens at 18 and stays 30 in the store) |
| 18 | Tests meaningful — would they fail on the bug I fear? | **fail** → **F4** (`moveend`→`zoomend` mutation kills 0/57: *no test isolates a pure pan*, the unit's headline gesture) and **F5** (nothing links `saveView`'s output range to `loadView`'s accepted range) |
| 19 | Error handling / friendly failure | **pass** — `saveView`/`clearView` swallow quota errors by design (a banner per pan would be worse); pin-write paths still fail loud |
| 20 | Durable record accurate (`00-process.md` "prose is not mechanism") | **fail** → **F6** (build note + progress log claim both effect-ordering branches were "exercised … confirmed empirically"; only one branch exists) |
| 21 | Structure / style | **NIT** → F9 |

**How I verified, so nothing here is "trust me".** `rsync`-free copy of the tree into the session
scratchpad (reviewer cannot write in-repo), then against that copy: the repo's own suite, `tsc`, `vite
build`, **17 purpose-written probes** that capture the *live* Leaflet map instance via the repo's own
`TileLayer.prototype.onAdd` shim (so every claim about "where the map opened" is read off the map, not
off props), plus **1 source mutation**. I also read `node_modules/react-leaflet/lib/MapContainer.js` and
`node_modules/leaflet/dist/leaflet-src.js` (`invalidateSize`, `trackResize`, `_onResize`) to settle the
two questions jsdom alone cannot.

---

## Step 3 — Where a subtle bug would hide here (and what I found when I looked)

1. **The seam between what Leaflet's `getCenter()` can produce and what `loadView` will accept.** This
   is where the bug was. Leaflet's map center is *unwrapped* — pan west from NYC at zoom 3 and it
   returns lng −197.05. `saveView` writes it happily; `loadView` rejects it as out of range; the reload
   silently re-fits instead. The sibling component 20 lines above (`ClickCapture`) already calls
   `e.latlng.wrap()` for exactly this hazard — `ViewPersister` does not. **F2.**
2. **What counts as "the user moved the map".** The design assumes `moveend` ⇒ intent. Leaflet fires
   `moveend` for a *window resize* too (`trackResize: true` → `invalidateSize({debounceMoveend:true})`
   → `fire('moveend')` after 200 ms). So the "no saved view yet, so fit the pins" fallback is destroyed
   by an incidental resize, in a browser, before the user ever pans. **F3.**
3. **The one-way door.** Once a view exists it always wins, and nothing in the UI can re-fit. I looked
   for an escape hatch and there is none: the sidebar's only buttons are "Place on map…", "Export as
   JSON" and (when filtering) "Clear". Panning to an empty patch and reloading strands the user with
   "2 leads on the map" and zero markers on screen. **F1.**

---

## Step 4 — Findings

### [BLOCKER] F1 — A saved view wins unconditionally, and there is no way back to the leads
`src/App.tsx:152-157` (mount effect prefers `loadView` over `initialViewForPins`); no re-fit control
exists anywhere in `src/components/`.

**What's wrong.** Section A exists because *"the pins exist but are invisible until you pan to them"* was
judged a defect worth a unit. This unit reintroduces that state and makes it **permanent**: any pan/zoom
that leaves the leads off screen is persisted, and every subsequent reload restores it. There is no
"fit to leads" / "show all" / "centre on this lead" control, and no other affordance that re-fits — the
only two paths back are manual panning to coordinates the user has no way to look up in-app, or
exporting and re-importing their own JSON (which happens to call `clearView`). Neither is discoverable.

**How I confirmed it (probe C, live Leaflet map).** Seeded 2 NYC pins → `map.setView([0,-150], 12)` (mid
Pacific) → `cleanup()` (the reload) → re-render:
```
C reopened center: 0 -150
C markers rendered: 2      C markers actually on screen: 0
C marker positions: [{"x":221766,"y":-129694},{"x":221708,"y":-129771}]   (viewport 800x600)
C sidebar count text: "2 leads on the map · click a pin to read or edit its notes"
C sidebar buttons: ["Place on map…","Export as JSON"]
```
Reachable in one gesture: an accidental scroll-wheel zoom over the map (the classic Leaflet mis-scroll)
or one drag, then a refresh.

**Consequence.** `CLAUDE.md`'s Winning sentence — *"at a glance I can see where my strong, weak, and
failed leads sit"* — becomes false with no recovery, while the sidebar actively asserts the opposite
("2 leads on the map"). This is the same failure shape the project already ruled a defect twice: Unit 3
Section A (pins invisible until you pan) and `docs/reviews/filter-search-leads.md` F1 (a pin saved but
never rendered, "with nothing telling the user why").

**Minimal fix (pick one, both small).**
1. Add a sidebar "Show all leads" button that calls `initialViewForPins(pins)` through the existing
   `mapEpoch` remount path — the mechanism already exists for import (`src/App.tsx:441-442`), so this is
   a button plus two lines; or
2. honour the saved view only when at least one pin falls inside it (else fit), which keeps the "which
   wins" answer for the case it was written for and self-heals the stranded case.

Option 1 is the smaller change and does not re-litigate the "which wins" decision.

**Confidence:** high (behaviour reproduced end-to-end; absence of a control confirmed by enumerating the
rendered buttons and grepping `src/components/`).

---

### [MAJOR] F2 — `saveView` writes longitudes `loadView` will reject: one drag silently kills the saved view
`src/components/MapView.tsx:63-67` (writes `map.getCenter()` raw) vs `src/storage/viewStore.ts:44-56`
(rejects `center[1] < -180 || center[1] > 180`).

**What's wrong.** Leaflet's map centre is not wrapped — pan past the antimeridian in either direction
and `getCenter().lng` keeps accumulating (±190, ±257, …). The save side accepts that; the load side
throws it away as invalid. The round-trip is therefore **not lossless**, and the failure is silent: the
next reload just re-fits the pins as if nothing had been saved, and the poisoned record sits in
`localStorage` being ignored on every load until some later in-range gesture overwrites it. The
neighbouring `ClickCapture` (`src/components/MapView.tsx:39`) already calls `e.latlng.wrap()` for exactly
this hazard, with a comment explaining why — `ViewPersister` was written without it.

**How I confirmed it (probes B, L, M).** Live map, seeded with the NYC pins:
```
L: zoom out to 3, then ONE 700px drag west (less than one 800px screen width)
   center after drag:  40.71, -197.05
   stored:             {"center":[40.713955826286046,-197.05078125],"zoom":3}
   loadView(...):      null
   reopened after reload: lng -74.01, zoom 14   <- the fit, not where the user was
M: from lng 179.5, a 300px pan east -> stored lng 186.09 -> loadView null -> same silent fallback
B: a 2000px pan east from lng 170 -> stored lng 257.89 -> loadView null
```
NYC (−74) is 106° from the −180 meridian; at zoom 3 that is ≈600 px of dragging. This is ordinary use,
not a corner case.

**Consequence.** The unit's own acceptance criterion ("persist the map view across reloads") fails
silently for a whole class of ordinary pans, with no error and no log. The user learns that the feature
"sometimes doesn't work".

**Minimal fix.** Wrap at the source, mirroring `ClickCapture`: in `ViewPersister`, use
`const center = map.getCenter().wrap();` (or `map.wrapLatLng(map.getCenter())`). Add the regression test
F5 asks for.

**Confidence:** high (reproduced three ways, with the rejected values printed).

---

### [MAJOR] F3 — A window resize persists a view the user never chose, destroying the fit-on-mount fallback
`src/components/MapView.tsx:63` (`moveend` treated as "the user moved the map").

**What's wrong.** `moveend` is not a proxy for user intent. Leaflet's `Map` defaults to
`trackResize: true` (`leaflet-src.js:3234`), and its resize handler calls
`invalidateSize({debounceMoveend: true})` (`leaflet-src.js:4446-4449`), which `_rawPanBy`s the map and
fires `moveend` 200 ms later (`leaflet-src.js:3699`). So resizing the browser window — or rotating a
phone, or opening devtools — writes a persisted view. The build note's stated model ("If it doesn't
[fire at mount], no key is written until the user actually pans") is therefore wrong in the real
browser: the key gets written without any pan.

**How I confirmed it (probe E + the Leaflet source above).**
```
E view at mount:        null
E view after resize:    {"center":[40.70998719702583,-74.01000022888185],"zoom":14}
```
(The container was resized 800x600 → 400x300 and `invalidateSize()` called — exactly what Leaflet's own
`_onResize` does.)

**Consequence.** Two compounding effects. (a) The "no saved view yet → fit the pins" path — the whole
fallback this design leans on — is a one-shot for most real users: after the first incidental resize the
app never fits again. (b) What gets frozen is a *centre+zoom snapshot of a fit computed for the old
container size*; reopening the app at a different window size no longer re-fits, so edge pins the fit
had padded into view can be clipped. It is also the most likely way an unsuspecting user reaches F1
without ever having deliberately moved the map.

**Minimal fix.** Persist only on genuine user gestures — e.g. `dragend` + `zoomend`, or keep `moveend`
but ignore events whose `e.hard`/resize origin says otherwise, or set a flag from Leaflet's `resize`
event and skip the next `moveend`. Cheapest correct version: listen to `dragend` and `zoomend` instead of
`moveend` (and then F4's missing pan test becomes mandatory, not optional).

**Confidence:** high for the mechanism (source + jsdom reproduction); medium-high for the exact
real-browser timing of the 200 ms debounce, which I could not exercise in a live browser.

---

### [MINOR] F4 — No test guards the *pan* half of "pan/zoom": `moveend` → `zoomend` kills 0 of 57 tests
`src/App.test.tsx:735-841` (the five new tests) — every one of them moves the map with
`map.setView(center, zoom)` where the **zoom also changes** (9, 11, 8, 9).

**What's wrong.** Because the zoom always changes, a `zoomend` listener satisfies all of them. I mutated
`src/components/MapView.tsx` in the scratchpad copy (`moveend(e)` → `zoomend(e)`, i.e. *pure pans are
never persisted — the single most common gesture in this app*) and ran the suite:
`src/App.test.tsx` 46 passed, `src/storage/viewStore.test.ts` 11 passed — **57/57 green, 0 killed.**

**Consequence.** The headline behaviour ("opens on the last **pan**") is unguarded. Any future refactor
of the event wiring — including the one F3 asks for — can silently drop pan persistence and ship green.
The builder's own planted regression #4 (removing `onViewChange` entirely) is strictly weaker than this
mutation and does not cover the gap.

**Minimal fix.** One test that changes only the centre (`map.panBy([250, 0], { animate: false })` or
`map.setView([lat, lng], map.getZoom())`), reloads, and asserts the centre moved and the zoom did not.

**Confidence:** high (mutation run, counts recorded).

---

### [MINOR] F5 — Nothing ties `saveView`'s output range to `loadView`'s accepted range
`src/storage/viewStore.test.ts` (11 tests, all one-sided: they feed literal fixtures into `loadView`).

**What's wrong.** `viewStore.test.ts` proves `loadView` rejects an out-of-range centre, and separately
proves a hand-written in-range view round-trips. Nothing tests the property that actually matters —
*everything the app can write is something the app can read back* — which is precisely the gap F2 lives
in. The App-level tests can't catch it either, since none of them pans out of range.

**Minimal fix.** After fixing F2, one test at the App level (pan past ±180, reload, assert the map
reopens where it was) and/or one `viewStore` test asserting `loadView(saveView(x)) === x` for the
extremes Leaflet can produce.

**Confidence:** high.

---

### [MINOR] F6 — The durable record claims a verification that cannot have happened
`docs/build_notes/persist map view across reloads.md`, "Constraints discovered mid-build": *"Both
branches were exercised by the self-proving pass below and passed on the first run, so this was confirmed
empirically rather than assumed."* Echoed in `docs/progress_log.md`.

**What's wrong.** Only one branch is reachable, so it cannot have been exercised "both" ways.
`node_modules/react-leaflet/lib/MapContainer.js` creates the map and calls `map.setView(...)` /
`map.fitBounds(...)` inside the ref callback, and only then `setContext(...)`; children (`ViewPersister`)
render on the *following* render, strictly after the initial fit's `moveend` has already fired. Probe A
confirms the consequence directly: after mount with 2 pins, with 0 pins, and with a restored view, the
view key is `null` / unchanged — **no mount-time write ever happens.** The design conclusion ("either way
is harmless") is fine; the claim of empirical coverage of both branches is not, and
`.claude/rules/00-process.md` ("prose is not mechanism") is the rule it trips.

**Minimal fix.** Correct the sentence to what is true — react-leaflet mounts children after the initial
view is applied, so the initial fit is never persisted — and, if the property matters, add the one-line
test probe A already is (`expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull()` after mount).

**Confidence:** high (source + reproduction).

---

### [MINOR] F7 — A code comment asserts something false, and that false premise hid F3
`src/components/MapView.tsx:52-55`: *"that rule is about what makes the map MOVE (nothing, after mount,
ever does); this only WATCHES where the map already is."*

**What's wrong.** Things after mount *do* move the map: `invalidateSize` on a window resize pans it
(`_rawPanBy`, `leaflet-src.js:3688`), and Leaflet's `Popup` `autoPan` (on by default) pans when a popup
near the edge opens. The comment's claim is what made "`moveend` ⇒ the user moved it" look safe.

**Consequence.** Documentation that will mislead the next reader in the same direction; the code is the
truth and the comment disagrees with it.

**Minimal fix.** Reword to "nothing in *this app's* React state moves the map; Leaflet itself still can
(resize, popup autoPan) — see F3".

**Confidence:** high for resize (verified); medium for popup autoPan (jsdom showed no movement in probe
D — it has no layout engine, so this is untested rather than disproven).

---

### [NIT] F8 — Asymmetric validation: lat/lng are range-checked, zoom is not
`src/storage/viewStore.ts:52-53` (`!isFiniteNumber(r.zoom) || r.zoom < 0`).

A stored `zoom: 30` is accepted; the map clamps to 18 and the store keeps saying 30 (probe F). Harmless
today — Leaflet clamps and the next gesture overwrites — but it is the one field where the "mirror
`parsePin`'s range checks" rationale in the doc comment isn't actually applied. An upper bound (say
`<= 22`) would make the record mean what it says.

---

### [NIT] F9 — The `moveend` listener is detached and re-attached on every App render
`src/App.tsx:164` (`handleViewChange` is re-created each render) + `useMapEvents`' `[map, handlers]`
dependency (`node_modules/react-leaflet/lib/hooks.js`). No leak (the cleanup closes over the same
handlers object) and identical to the existing `ClickCapture` pattern, so this is consistency-neutral —
noted only so it isn't mistaken for a finding later.

---

## Step 5 — Sign-off

- **VERDICT: No.** The unit does not meet its bar. Two of the three things it had to get right are
  broken: the "which wins" answer strands the user with no way back to their leads (**F1**, BLOCKER),
  and the persistence itself silently fails for ordinary pans past ±180 (**F2**, MAJOR). The
  implementation is otherwise clean, well-scoped and correctly restrained — pins, colors, notes and the
  DONE-WHEN bar are untouched (verified), the import interaction is right, and the fail-soft boundary
  choice is justified. Fix F1 + F2 (both small) and this unit is sound.
- **TEST + LINT:** repo, unmodified: `npm test` → **159 passed / 159, 10 files, 0 failed**;
  `npm run lint` → clean; `npm run typecheck` → clean. Scratchpad copy: `App.test.tsx` 46/46,
  `vite build` succeeds (315.90 kB JS). Reviewer's own additions in the copy: **17 probe tests, all
  ran**, and **1 mutation** (`moveend`→`zoomend`) which **killed 0 of 57 tests** (F4).
- **TOP 3 FIXES (priority order):**
  1. **F1** — give the user a way back: a sidebar "Show all leads" control routed through the existing
     `initialViewForPins` + `mapEpoch` remount (or: honour the saved view only when a pin is inside it).
  2. **F2** — wrap the centre before persisting it (`map.getCenter().wrap()`), exactly as `ClickCapture`
     already does, and add the reload-after-a-dateline-pan regression test.
  3. **F3 + F4 together** — persist on real gestures (`dragend`/`zoomend`) rather than every `moveend`,
     and add the pan-only test that currently lets `moveend`→`zoomend` pass green.
- **WHAT I COULD NOT VERIFY:**
  - **The real-browser walkthrough** (the builder's open item #2). There is no Playwright/Puppeteer in
    `node_modules` and no browser tool available to me, so I could not do "pan the real map, reload the
    real page". I closed the two mechanism questions it would have answered by reading
    `react-leaflet/lib/MapContainer.js` and `leaflet-src.js` and reproducing in jsdom against the live
    Leaflet map — but **F1, F2 and F3 all remain unconfirmed against a real browser**, and F3's 200 ms
    debounced resize `moveend` in particular is source-verified, not browser-verified.
  - **Popup `autoPan`** writing a view (F7): jsdom has no layout, so the probe showed no movement; in a
    real browser a popup opening near the edge pans the map and would persist that.
  - **React `StrictMode` double-mount in `npm run dev`** (`src/main.tsx` wraps `<App/>` in StrictMode):
    the test suite renders without StrictMode, so dev-mode remount behaviour of the new mount effect is
    untested here. I saw no mechanism by which it would write a view, but I did not run it.
  - **`npm ci` from a clean checkout** (DONE-WHEN's literal wording) — I reused the existing
    `node_modules` rather than reinstalling.
- **SINGLE BIGGEST RISK:** one accidental scroll-zoom or drag onto empty map, plus a refresh, now parks
  the app away from every lead permanently — with the sidebar still saying "N leads on the map" and no
  control anywhere that brings them back.
