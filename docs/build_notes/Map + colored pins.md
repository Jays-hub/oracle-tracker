# Build note — Map + colored pins (unit 1)

## Why this, why now
The repo had zero application code — only governance scaffolding. Nothing downstream (notes, editing,
filtering) can exist until the app skeleton, the pin model, the strength→color mapping, and persistence
exist. This unit is the foundation *and* the first genuinely useful slice: a map where I drop
color-coded lead pins that survive a reload. It also proves the whole stack (React + Vite + TS +
Leaflet/OSM + localStorage) end-to-end.

## What it delivers (this unit's slice of the product DONE-WHEN)
- Leaflet map over OSM tiles renders full-screen.
- Add a restaurant: type a name, pick a lead strength, arm placement, click the map to place it.
- Pin renders in the strength's color: **strong = green `#2e9e4f` / weak = amber `#e8a33d` / failed =
  red `#d64545`**.
- Every pin (position, name, strength) persists across a full reload via `localStorage`.
- A legend and a read-only popup (name + strength) make the color semantics legible.

**Deferred to later units (deliberately NOT built):** notes, editing/deleting pins, search/filter by
strength, persisting the map view, and any address/geocoding search (that would add a network dep and
violate local-first — click-to-place avoids it).

## Files
- `src/domain/leadStrength.ts` — `LeadStrength` union, the total strength→color map, `colorForStrength`,
  `isLeadStrength`. **Core hazard handled by construction.**
- `src/domain/pin.ts` — `Pin` model, `parsePin` (boundary validation), `createPin` (input → validated pin).
- `src/storage/pinStore.ts` — `loadPins` / `savePins` / `serializePins` over an injectable `StorageLike`.
- `src/components/MapView.tsx` — react-leaflet map, colored `divIcon` markers, click capture.
- `src/components/AddPinForm.tsx`, `src/components/Legend.tsx` — the sidebar UI.
- `src/App.tsx` — state + wiring; `src/main.tsx`, `index.html`, `src/index.css` — shell.
- Tooling: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `vite-env.d.ts`.
- Tests: `src/domain/leadStrength.test.ts`, `src/domain/pin.test.ts`, `src/storage/pinStore.test.ts`.

## Non-obvious design decisions (chose X over Y because Z)
1. **The strength→color map is exhaustive at compile time** via
   `... satisfies Record<LeadStrength, string>`, and `colorForStrength` *throws* (`UnknownLeadStrengthError`)
   rather than returning a default. This is the reviewer's #1 BLOCKER hazard prevented by construction:
   add a strength without a color and the build fails; a value that bypasses the type system fails loud
   instead of drawing a wrong/neutral color that would silently misrepresent a lead.
2. **Persistence is saved imperatively in the add handler, never via a `useEffect([pins])`.** A
   save-on-change effect would fire on mount with the initial empty `[]` *before* the load effect
   populates state — overwriting the store with `[]` and silently wiping every saved pin. Saving only
   inside `handleMapClick` makes that class of data-loss impossible. This is the single most important
   correctness decision in the unit.
3. **`loadPins` throws on any corruption and leaves the stored bytes untouched** — it never returns a
   partial/filtered list. On load error `App` shows a banner and starts with an empty *in-memory* list
   but does not re-save, so corrupt data is preserved for recovery rather than silently dropped. (Hazard
   #2: lossless & durable, or fail loud — never silently drop pins.)
4. **`StorageLike` is injected** so the store is unit-tested with a fake `Map` — deterministic, no jsdom.
5. **Tests run in `environment: 'node'` over the pure domain/storage modules.** Those hold the logic that
   can be silently wrong; the Leaflet rendering is integration and is verified by running, not by brittle
   jsdom tests of a map library.
6. **Click-to-place, not geocoding.** Coordinates come straight from the map click — no places/geo API,
   which keeps the app local-first and network-free apart from tiles.
7. **`divIcon` colored dots**, not default Leaflet markers — sidesteps the classic Leaflet+bundler
   broken-default-icon-path problem and makes the color the whole marker. The color is interpolated into
   the icon HTML, but it comes only from the fixed `STRENGTH_COLORS` constants (never user input), so no
   injection risk; the user-supplied name goes through JSX (`<Popup>`), which auto-escapes.

## Load-bearing assumptions
- **[load-bearing]** Single-user, one browser: `localStorage` is sufficient persistence. (From `CLAUDE.md`
  #3 / product scope.)
- **[load-bearing]** Lat/lng from a Leaflet click are the pin's location; no reverse-geocoding needed.
- **[minor]** Default map center (NYC, zoom 12) is a neutral starting view; persisting the last view is
  out of scope.
- **[minor]** Popup showing name + strength is in-scope "view a pin minimally"; full notes/editing is unit 2.

## Verification I actually ran
- `npm run typecheck` → clean (exit 0). *(First run caught a real bug: `Error`'s `cause` option needs
  the ES2022 lib; I bumped `target`/`lib` to ES2022. Modern browsers + Node support it.)*
- `npm run lint` → clean, no warnings.
- `npm test` → **14 passed** across 3 files (leadStrength 4, pin 4, pinStore 6).
- `npm run build` → succeeds, 80 modules transformed (Leaflet bundled).

## Browser smoke test — RAN and PASSED (2026-08-03, Google Chrome)
Confirmed end-to-end in a real browser (the earlier failure was the extension running on **Arc**;
re-ran in Google Chrome cleanly):
- Map renders over OSM tiles; legend shows the three colors correctly.
- Typed "Joe's Diner", strength Strong, click-to-place → a **green** pin dropped at the click; counter
  went to "1 lead on the map"; the form reset.
- `localStorage['restaurant-map.pins.v1']` held
  `[{id, name:"Joe's Diner", lat:40.7126…, lng:-73.9850…, strength:"strong"}]` — correct shape.
- **Full reload → pin persisted** at the same spot, count still 1.
- **Console clean across three loads** — only Vite HMR + the React DevTools note. **No "Map container is
  already initialized" StrictMode/leaflet warning** — that least-confident spot is resolved.
- (Test data note: the smoke test left one "Joe's Diner" pin in Chrome's localhost:5173 localStorage.)

## Spots to look first (remaining)
1. **Corrupt-store UX path** (`App` load `catch`): confirm that after a corrupt read, adding a pin
   overwrites cleanly and the banner wording matches behavior. (Not exercised in the smoke test.)
2. **Only "strong" was placed interactively** — the weak/amber and failed/red *render* paths are covered
   by the unit test on `colorForStrength` + the legend, but weren't clicked onto the map by hand.

## Known, deferred (not blockers for this unit)
- `npm audit` reports 5 advisories, all in the `esbuild`/Vite **dev-server** chain
  (GHSA-67mh-4wv8-2f99) — dev-time only, not in the shipped static bundle. The `npm audit fix --force`
  remedy forces a Vite major bump; deferred rather than applied blindly.
