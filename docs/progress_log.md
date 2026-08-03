# Progress Log

The running record of **product** work, newest first. Each entry is dated and tagged: `[built]` when a
unit is handed off to review, `[reviewed]` / `[fixed]` as the review closes, `[decided]` for a
consequential choice. `/session-start` reads the top of this file to orient; keep entries terse and
name the artifacts + the verified test count so the drift check has something real to compare against.

(Workflow/tooling changes go in `docs/agentic_workflow/current_state.md`, not here.)

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
