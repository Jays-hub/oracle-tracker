# Review — Unit 1: Map + colored pins

Adversarial, read-only review. Cold to the build chat. All commands below were run by the reviewer, not trusted from the log.

## Ground truth (what this unit had to deliver — "done when")
From `CLAUDE.md` #3 (the product DONE-WHEN, sliced to this unit) + `docs/progress_log.md`:

- From a clean checkout, `npm install && npm run dev` serves a full-screen Leaflet/OSM map.
- Add a restaurant by **name + location** (click-to-place is an acceptable "location"; geocoding is deliberately deferred to avoid a network dep — this is correct anti-drift, not a gap).
- Each pin renders in its lead-strength color, and the mapping is **total and fixed**: strong = green, weak = amber, failed = red.
- Every pin (position, name, strength) **persists across a full reload** via `localStorage`; a corrupt/absent store degrades to empty-but-usable or fails loud — never crashes the map or silently drops pins.
- Local-first / standalone: no backend, DB, accounts, or external places/geo API (map tiles excepted).
- Tests green, lint/types clean.

No spec/intent conflict found. Notes + editing are explicitly out of scope for this unit.

---

## Step 1 — Ran it (not trusted, executed)

- `npm run typecheck` → **exit 0, clean.**
- `npm run lint` → **exit 0, clean.**
- `npm test` → **14 passed** (3 files: leadStrength 4, pin 4, pinStore 6). Reproduced the logged count.
- `npm run build` → **succeeds**, 80 modules transformed, CSS 17.55 kB (Leaflet bundled), JS 302.95 kB.

All four match the builder's claims. The full **browser render + reload** path I could not execute headlessly (react-leaflet needs real layout); I verified its riskiest property by reading library source instead — see below.

---

## Step 2 — Hunt list

**Silent killers**
- Core logic / lat-lng order — **pass (verified by reading).** Consistent `[lat, lng]` everywhere: click `onClick(e.latlng.lat, e.latlng.lng)` → `handleMapClick(lat, lng)` → `createPin({lat,lng})` → `Marker position={[pin.lat, pin.lng]}`. No swap. Map center `[40.7128, -74.006]` is correctly `[lat, lng]` NYC.
- Acceptance bar judged by the real criterion — **pass.** Color + persistence are the criterion; not a proxy. (Automated coverage of the *integration* is thin — see Finding 2.)
- Split / leakage — **n/a** (no learning/eval data in this unit).
- Reproducibility — **pass (verified by running).** `serializePins` fixes field order; `serialization is deterministic` test passes; no hardcoded absolute paths; storage injected in tests.
- Data / boundary integrity — **concern.** `parsePin` rejects NaN/Inf and enforces lat∈[-90,90], lng∈[-180,180] (good). But the add path can *hand it* an out-of-range lng and has no catch — see Finding 1.

**Domain hazards**
- Lead-strength → color total & fixed — **pass (verified by running + reading).** `colorForStrength` maps strong→`#2e9e4f` (green), weak→`#e8a33d` (amber), failed→`#d64545` (red); `satisfies Record<LeadStrength,string>` makes it exhaustive at compile time; it *throws* `UnknownLeadStrengthError` rather than returning a default. Both render sites (MapView marker, Legend swatch) and the popup label use the same source of truth, paired by the same `s`/`pin.strength` key — no off-by-one between swatch and label. Test `maps each strength to its fixed color` + `is total and injective` pass.
- Persistence lossless & durable — **pass on read, concern on write.** Round-trip test passes; corrupt/non-array/invalid-pin all throw `PinStoreError` and leave stored bytes untouched (tests confirm); App catches load errors, shows a banner, starts empty in-memory, does **not** re-save. The **write** side is unguarded — Finding 1.
- Local-first / standalone — **pass (verified by grep).** Only network reference in `src/` is the OSM tile URL + attribution. No fetch/XHR/geocode/places/api, no coupling to the restaurant-development project.

**Software engineering**
- Tests meaningful — **mostly.** Domain/storage tests are strong and would catch a broken color map or a lossy round-trip. The end-to-end wiring (App save-on-click, load-on-mount, multi-pin persistence) has **no** test — Finding 2.
- Error handling — friendly named errors exist (`UnknownLeadStrengthError`, `InvalidPinError`, `PinStoreError`) and are surfaced on load, but the add path can throw uncaught — Finding 1.
- Structure/style — clean. Injected `StorageLike`, boundary `parsePin`, and fail-loud color map are defensive but directly serve the stated hazards; not over-engineering. No drift found (click-to-place instead of geocoding is the *correct* simpler step).

**Anti-drift** — **pass.** No backend/DB/API reached for. Scope matches the roadmap.

---

## Step 3 — Riskiest spots, looked at deliberately

1. **The click-handler closure — "does a second pin wipe the first?"** This is the classic react-leaflet stale-closure trap, and the builder's own notes admit only ONE pin was placed by hand. I read the installed source (`node_modules/react-leaflet/lib/hooks.js`, v4.2.1): `useMapEvents` runs its `map.on/off` effect with deps `[map, handlers]`, and `ClickCapture` passes a **fresh `{ click }` object literal every render**, so the effect rebinds on every render, always binding the latest closure (fresh `pins`). App re-renders after each add (`setPins`), so the next click sees the updated list. **Conclusion: no stale-pins closure; the second-pin case is sound by construction.** (Verified by source, not by browser — see "could not verify".)
2. **The add path's error handling.** `handleMapClick` (App.tsx:31-41) wraps neither `createPin` nor `savePins` in try/catch — Finding 1.
3. **Corrupt-store UX.** Fails loud with a banner and preserves bytes on read; the first added pin then overwrites them (documented, banner warns). Acceptable — see Finding 4.

---

## Step 4 — Findings

**[MINOR] `handleMapClick` has no error handling around `createPin` / `savePins`** · `src/App.tsx:31-41` (throws originate at `:35` and `:38`)
- What's wrong: the only try/catch in App guards the mount-time `loadPins` (`:24-26`). The add path is unguarded. Two reachable throws surface as an uncaught exception in Leaflet's event dispatch with **no user feedback**:
  - (a) `savePins` → `localStorage.setItem` throws on quota-exceeded or disabled storage (e.g. Safari private browsing). `setPins(next)` has already run, so the pin renders on the map but is never persisted → it **silently vanishes on the next reload** — the exact "silently drop pins" the durability hazard forbids, with no loud error.
  - (b) Leaflet has no world-wrap config here (no `maxBounds`/`worldCopyJump`), so a click on a repeated world copy (zoom out + pan) yields `lng` outside ±180; `createPin`→`parsePin` throws `InvalidPinError` before `setPins`, so the pin is **silently not placed**.
- How confirmed: read App.tsx (no catch on the add path — grep confirmed only the mount catch); read react-leaflet default map options (no wrap clamp); `parsePin` range check at `pin.ts:43`. Trigger (a) is uncommon in normal Chrome single-user use (quota ~5 MB, pins tiny); trigger (b) needs zoom-out + pan onto a wrapped copy.
- Consequence: contradicts the "never crash the map / never silently drop pins / fail loud with a named error" hazard, but only under uncommon conditions. Would be MAJOR in a private-browsing/quota context (silent data loss).
- Minimal fix: wrap the body of `handleMapClick` in try/catch; on failure surface a named error to the user (reuse the banner) and don't leave the map in an armed-but-nothing-happened state. Optionally clamp/normalize `lng` (Leaflet's `LatLng.wrap()`) before `createPin` so a wrapped-copy click still places a pin.
- Confidence: high that the code path is unguarded; medium on how often trigger (a)/(b) fires in practice.

**[MINOR] No test — automated or manual — exercises a SECOND pin + reload** · `src/App.tsx`, test suite
- What's wrong: the unit's whole point is "pins persist across reload," yet every test targets the pure domain/storage modules in isolation. Nothing exercises App's save-on-click + load-on-mount wiring, and the builder's smoke test placed exactly one "strong" pin (per their own "spots to look" note). The likeliest regression site (multi-pin accumulation through the store) is unverified end-to-end.
- How confirmed: read all three test files (only leadStrength/pin/pinStore); read the build note's own admission; `vitest.config` is `environment: 'node'`, `include: ['src/**/*.test.ts']` — no component/integration test exists.
- Consequence: a future refactor of the click/save wiring (or a react-leaflet bump that changes `useMapEvents` deps) could reintroduce a stale-closure "second pin wipes first" bug with a green suite. I verified today's behavior is correct by reading library source, but no test defends it.
- Minimal fix: add a small store-level integration test that simulates `handleMapClick`'s logic (append + `savePins`, twice) then `loadPins` and asserts both pins round-trip; ideally a jsdom render test asserting a marker per pin.
- Confidence: high (absence is directly observable).

**[NIT] Load-error banner is never cleared after the store is repaired** · `src/App.tsx:23-29, 49-54`
- After a corrupt read, adding a pin overwrites the store with valid data, but `loadError` is never reset, so the "Couldn't read saved pins…" banner keeps showing even though the store is now fine.
- Fix: `setLoadError(null)` after a successful `savePins`.
- Confidence: high.

**[NIT] "Preserved for recovery" overstates write-side durability** · `src/storage/pinStore.ts:18-24` docstring + `src/App.tsx:20-22`
- The corrupt bytes survive only until the first added pin, which overwrites them (the banner does warn "new pins you add will overwrite it"). Behavior is documented and acceptable for a personal tool, but the "preserved for recovery" framing is true only until the next add — no export/recovery affordance exists.
- Fix: none required this unit; note it when notes/editing land.
- Confidence: high.

---

## Step 5 — Sign-off

- **VERDICT: Yes** — the unit meets its acceptance criteria on the mainline. The strength→color mapping is total, fixed, and correct (strong=green `#2e9e4f`, weak=amber `#e8a33d`, failed=red `#d64545`), verified at both render sites and by passing tests; pins round-trip through `localStorage` losslessly; a corrupt store fails loud and preserves bytes; the app is local-first (no user-data network calls). No BLOCKER or MAJOR found. The findings are robustness/coverage gaps at the edges, not failures of the core bar.
- **TEST + LINT:** `npm test` → 14 passed (3 files); `npm run lint` → clean (exit 0); `npm run typecheck` → clean (exit 0); `npm run build` → succeeds (80 modules). All reproduced by the reviewer.
- **TOP 3 FIXES (priority order):**
  1. Wrap `handleMapClick` in try/catch and surface a named error; normalize/`wrap()` `lng` before `createPin` (Finding 1) — closes the only silent-data-loss path.
  2. Add a multi-pin save→load round-trip test (Finding 2) — defends the unit's core promise against regression.
  3. Clear `loadError` after a successful save (Finding 3).
- **WHAT I COULD NOT VERIFY even after trying:** the live browser render + full reload cycle (react-leaflet needs real DOM layout; jsdom render of Leaflet is unreliable, so a failure there would be environmental, not logical). I therefore confirmed the one property that a single-pin smoke test can't — that a *second* pin doesn't wipe the first — by reading `react-leaflet@4.2.1` `useMapEvents` source (rebinds handlers every render → no stale-`pins` closure), not by clicking. I also did not reproduce the localStorage-quota/disabled path in a real browser; the code gap is confirmed by reading, the frequency is not.
- **SINGLE BIGGEST RISK:** a `localStorage.setItem` failure (quota/disabled storage) inside the unguarded `handleMapClick` shows the pin on the map but silently loses it on reload with no error — the durability hazard's forbidden "silent drop," reachable only under uncommon browser conditions.
