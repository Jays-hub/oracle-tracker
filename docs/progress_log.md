# Progress Log

The running record of **product** work, newest first. Each entry is dated and tagged: `[built]` when a
unit is handed off to review, `[reviewed]` / `[fixed]` as the review closes, `[decided]` for a
consequential choice. `/session-start` reads the top of this file to orient; keep entries terse and
name the artifacts + the verified test count so the drift check has something real to compare against.

(Workflow/tooling changes go in `docs/agentic_workflow/current_state.md`, not here.)

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
