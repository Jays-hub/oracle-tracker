# Progress Log

The running record of **product** work, newest first. Each entry is dated and tagged: `[built]` when a
unit is handed off to review, `[reviewed]` / `[fixed]` as the review closes, `[decided]` for a
consequential choice. `/session-start` reads the top of this file to orient; keep entries terse and
name the artifacts + the verified test count so the drift check has something real to compare against.

(Workflow/tooling changes go in `docs/agentic_workflow/current_state.md`, not here.)

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
