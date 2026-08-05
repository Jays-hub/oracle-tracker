# Review — Unit 5: filter / search leads

Cold-context adversarial review of the **uncommitted working tree** on branch `filter-search`
(base commit `7153d0d`). Scope taken from `git status --short` + `git diff` (tracked files) plus the
four untracked files: `src/domain/pinFilter.ts`, `src/domain/pinFilter.test.ts`,
`src/components/PinFilterBar.tsx`, `docs/build_notes/Unit 5 - filter-search leads.md`.

Spec read: `docs/roadmap.md` § "Unit 5 — Filter / search leads" (added by this unit) and the ultimate
bar, `CLAUDE.md` standing order #3. Governance read: `.claude/rules/00-process.md` (the only rule file;
domain hazards therefore cite `CLAUDE.md`).

## Step 0 — What this unit had to deliver (in my words)

- A sidebar control that narrows the map by **lead strength** (three independently toggleable
  checkboxes) and by a **text query**, where the query matches **case-insensitively against both name
  and notes** — find a lead by what happened there, not just what it's called.
- The two narrowings **combine as AND**, not OR.
- Filtering **only changes which pins render as markers**: it must never re-fit or move the map
  (Section A's mount-only fit stays intact), and must never touch `localStorage`, pin data, the current
  selection, or the add-pin flow.
- The sidebar **names what's filtered** ("Showing N of M leads") and offers a **one-click Clear** back
  to everything, reachable even from a zero-match state.
- Judged, as every unit is, against `CLAUDE.md` #3: place a pin, set its strength, **see it rendered in
  the matching color**, edit notes, everything surviving a reload.

No spec/intent conflict found: the code's apparent intent matches the roadmap section, and the roadmap
section was written before the build (visible in the diff) rather than back-fitted to the code.

---

## Step 2 — Hunt list

| # | Item | Verdict |
|---|------|---------|
| 1 | Core filter logic (AND, substring, case-fold, order preservation) | **verified-by-running** — pass |
| 2 | Empty strength selection means "show nothing", not "show everything" | **verified-by-running** — pass |
| 3 | Acceptance bar: every Unit 5 "Done when" bullet actually met | **verified-by-running** — pass |
| 4 | CLAUDE.md #3 "place a pin and see it rendered" holds *while a filter is active* | **fail** → F1 |
| 5 | "Never re-fits / moves the map" — behaviour | **verified-by-running** — pass (live Leaflet `getCenter()`/`getZoom()` unchanged across 5 filter transitions after a user pan+zoom) |
| 6 | "Never re-fits / moves the map" — *guarded* by a test | **fail** → F2 (mutation kills 0 tests) |
| 7 | "Never touches `localStorage`" — behaviour | **verified-by-running** — pass (raw store string byte-identical) |
| 8 | "Never touches `localStorage`" — *guarded* by a test on all three paths | **concern** → F3 (Clear-path mutation that wipes the store kills 0 tests) |
| 9 | Export/backup unaffected by the filter — behaviour | **verified-by-running** — pass (3 of 3 pins exported while 1 visible) |
| 10 | Export/backup unaffected by the filter — *guarded* | **concern** → F4 (mutation kills 0 tests) |
| 11 | Unfiltered sidebar wording branch covered | **fail** → F5 (mutation kills 0 tests) — builder's least-confident #1, confirmed |
| 12 | Selection / open editor / unsaved draft survive filtering | **verified-by-running** — pass (draft, popup, focus and caret all survive; popup *is* torn down with its own marker, no orphan) |
| 13 | Delete + Undo still correct under an active filter | **verified-by-running** — pass |
| 14 | Import under an active filter degrades visibly, never silently | **verified-by-running** — pass ("No leads match your filters." + Clear present + info banner) |
| 15 | Lead-strength → color total & fixed (CLAUDE.md #3) | **verified-by-running** — pass (swatches render `rgb(46,158,79)` / `rgb(232,163,61)` / `rgb(214,69,69)` for strong/weak/failed; visible markers keep their own colors while filtered) |
| 16 | Persistence lossless & durable; reload round-trip | **verified-by-running** — pass (filter is not persisted, and that is right: a fresh load always shows everything) |
| 17 | Local-first, standalone — no backend/API/network for user data | **pass** (only network reference in `src/` is the OSM tile URL/attribution) |
| 18 | Boundary/data integrity (`pin.notes` always a string, no NaN/undefined path into `matchesQuery`) | **pass** — `parsePin` (`src/domain/pin.ts:70-78`) makes `notes` a guaranteed string on every path that reaches `filterPins` |
| 19 | Reproducibility / determinism / no absolute paths | **pass** — pure functions over plain data, no clock, no randomness, no order dependence |
| 20 | Text query treated as a literal substring (no regex injection) | **verified-by-running** — pass (`.*` matched literally) |
| 21 | Unicode / accent case-folding | **verified-by-running** — pass (`élan` ↔ `ÉLAN`, `CAFÉ` ↔ `Café`) |
| 22 | Tests meaningful, not smoke (builder's 3 planted regressions) | **verified-by-running** — pass, reproduced exactly: AND→OR kills 11, name-only kills 2, empty-set fallback kills 1 |
| 23 | Anti-drift / over-engineering | **pass** — pure domain module + one dumb component; `MapView` untouched; no memoisation, no list view, no saved filters. Correct call. |
| 24 | Accessibility of the new control | **concern** → F6 (count text is not a live region) |
| 25 | Structure/style | **NIT** → F7–F10 |

**How I verified (so nothing here is "trust me").** I copied the working tree to `/tmp` (reviewer is
read-only over the repo), and against that copy: (a) ran the repo suite, lint, typecheck and a
production build; (b) ran 21 purpose-written probe assertions, including one that captures the **live
Leaflet map instance** (via a `TileLayer.prototype.onAdd` shim) so "the map didn't move" is read off the
map itself, not off props; (c) ran **12 mutations** of the shipped source and recorded, for each, how
many of the repo's own tests died.

---

## Step 3 — Where a subtle bug would hide here

1. **The read-only claim at its edges (write paths that happen to be near the filter).** Filtering is
   trivially pure; the risk is a *neighbouring* consumer accidentally being handed `visiblePins`. The
   one that matters is `ImportExport` — a backup built from the filtered subset would be a silently
   lossy "export everything". **Looked deliberately:** `src/App.tsx:490-494` passes `pins` (correct),
   and I confirmed by capturing the exported Blob while filtered to 1 of 3 visible — 3 pins exported.
   But mutating it to `visiblePins` kills **zero** tests (F4).
2. **The mount-only fit contract.** Filtering changes the `pins` prop of an already-mounted `MapView`;
   the contract holds "by construction" only as long as nobody bumps `mapEpoch` or recomputes
   `initialView` on a filter change. **Looked deliberately:** behaviour is correct even after a user
   pan+zoom (probe 1), but both plausible violations pass the suite untouched (F2).
3. **State that outlives every write.** `filter` is the app's first piece of state that survives
   add/edit/delete/import by design. That is what makes F1 possible: a save can produce a pin that the
   surviving filter immediately hides, and nothing in the UI names that.

---

## Step 4 — Findings

**[MAJOR] A pin placed — or edited — while a filter is active is saved but never rendered, with no
named reason** · `src/App.tsx:82` (`visiblePins`), write paths `src/App.tsx:178-212` (add) and
`src/App.tsx:226-255` (edit) · The add flow stays enabled under an active filter and saves correctly,
but the new pin is only rendered if it happens to match the filter; the same applies when an edit moves
a pin's strength into a hidden bucket. Nothing tells the user their lead is hidden rather than missing.
· **Confirmed by running:** with the filter set to "weak only", I named and placed a new lead — store
went 3 → 4 pins, markers stayed at **1**, sidebar read `"Showing 1 of 4 leads"`, and the editor opened
for a pin with no marker anywhere on the map. Separately, opening a strong pin and saving it as
`failed` while "Failed" was unchecked made its marker vanish while its editor stayed open
(`"Showing 1 of 3 leads"`). · **Consequence:** `CLAUDE.md` #3 requires that I can "pin a restaurant on
the map by name and location, mark its lead strength ... **and see the pin rendered in the matching
color**" — that is false for as long as any filter is active, which is a state this unit newly makes
persistent across every write. No data is lost (I re-read the raw store: the pin is there), and the
`armed` flag is cleared so there's no duplicate-placement risk, but the app's most important
affordance silently produces nothing visible. · **Minimal fix:** in `handleMapClick` (and after
`handleSaveEdits`), test the resulting pin with `matchesFilter`; if it fails, either reset the filter
(`setFilter(allPinsFilter())`) or render one sidebar line — e.g. *"“Brand New Lead” is hidden by your
current filters."* next to the existing Clear control. The first is one line and needs no new copy. ·
**Confidence:** high on the behaviour (reproduced), medium on the severity tier — it is a real
user-facing hole in the core flow, not a data defect.

**[MINOR] "Filtering never re-fits or moves the map" — the unit's headline safety bullet — is guarded
by exactly zero tests** · `src/App.tsx:85-103`, `src/App.tsx:525-534` · The behaviour is correct, but
nothing detects a regression. · **Confirmed by running two mutations against the repo's own suite:**
(M9) adding `setMapEpoch((e) => e + 1)` to `handleToggleStrength` — i.e. every checkbox click force-
remounts the map and throws away the user's pan/zoom — **0 failed, 59 passed**; (M10) recomputing
`initialView` from the *filtered* subset and remounting on every keystroke in the search box — **0
failed, 59 passed**. The existing "never moves the map again once it has opened" test never touches a
filter, and because `initialView` is unchanged a remount reproduces identical marker pixels, so it
cannot see this class of break. I separately proved today's behaviour is right by capturing the live
Leaflet map, calling `map.setView([48.8566, 2.3522], 9)` to simulate a user pan+zoom, and asserting
`getCenter()`/`getZoom()` are byte-identical after: strength off, strength on, all three off (0
markers), Clear, and text narrowing 3→1→0. · **Consequence:** the exact "prose is not mechanism"
failure `.claude/rules/00-process.md` names — the strongest claim in the decision log rests on care,
not on a self-proving guard. This is also the builder's least-confident spot #2, and the honest answer
is worse than they guessed: not "covered by the general test", but **not covered at all**. ·
**Minimal fix:** one App test — pan/zoom the map (or just capture `markerPositions()` + `renderedZoom()`),
toggle a strength checkbox and type a query, assert both unchanged. · **Confidence:** high.

**[MINOR] "Filtering never touches `localStorage`" is guarded on one of three paths, and by length
rather than content** · `src/App.test.tsx:967` (`expect(stored()).toHaveLength(3)`) · Only the
strength-toggle path asserts anything about storage; the query path and the Clear path assert nothing.
· **Confirmed by running:** mutation (M12) inserting `savePins(storage, visiblePins)` into
`handleClearFilter` — i.e. clicking "Clear filters" while narrowed to zero matches **overwrites the
whole store with an empty array** — leaves the suite green: **0 failed, 59 passed**. (Today's code is
clean: I compared the raw `localStorage` string before and after five filter interactions — identical,
and the key count was unchanged.) · **Consequence:** the unit's "read-only and cannot lose or corrupt
anything" bullet would not survive a careless future edit; the failure mode it hides is total pin loss.
· **Minimal fix:** assert `expect(stored()).toEqual([alpha, beta, gamma])` (content, not length) after
a toggle, after a query, and after Clear. · **Confidence:** high.

**[MINOR] Export-under-filter is correct but unguarded — the one place filtering could cause permanent
data loss** · `src/App.tsx:490-494` · `ImportExport` receives `pins`, not `visiblePins` (right). ·
**Confirmed by running:** exporting while filtered down to 1 visible marker produced a blob with **3**
pins; then mutation (M4) swapping the prop to `visiblePins` — **0 failed, 79 passed**. · **Consequence:**
a future refactor could ship a "backup" containing only what happened to be on screen; the user finds
out months later, at restore time, when the omitted leads are gone for good. · **Minimal fix:** extend
the existing export test to set a filter first and still assert the full set in the blob. ·
**Confidence:** high.

**[MINOR] The unfiltered sidebar wording branch has no test at all** · `src/App.tsx:496-513` ·
**Confirmed by running:** mutation (M5) replacing `{filterActive ? (` with `{true ? (` — so the app
always uses the filtered wording, and an empty store with no filter would read the outright false *"No
leads match your filters."* — **0 failed, 79 passed** across the whole suite. So the builder's
least-confident spot #1 is real and total: the entire "N leads on the map · click a pin to read or edit
its notes" branch could be deleted unnoticed. Behaviour today is correct — I read the rendered text
directly: `"3 leads on the map · click a pin to read or edit its notes"` → `"Showing 2 of 3 leads"` →
after Clear, back to `"3 leads on the map …"`; empty store + active filter reads `"No leads match your
filters."`, empty store + no filter reads `"0 leads on the map"`. · **Consequence:** the sidebar is the
only surface that explains *why* markers are missing; an unnoticed regression there turns a filtered map
into an apparently empty one. · **Minimal fix:** add the count-text assertion to the existing "Clear
filters restores every pin" test (`src/App.test.tsx:997`) — one line, closes exactly the gap the builder
flagged. · **Confidence:** high.

**[MINOR] The filtered result count is not announced, and the "click a pin" hint disappears while
filtering** · `src/App.tsx:496-513` · `.sidebar__count` has no `role="status"` / `aria-live`
(verified: both attributes are `null` on the rendered element), unlike every other status surface in
the sidebar (`role="alert"` on errors, `role="status"` on import/delete banners). A keyboard/screen-
reader user toggling a checkbox gets no feedback that 4 of 7 leads are now hidden — and the map itself
is not an accessible surface. The filtered branch also drops the "· click a pin to read or edit its
notes" hint, so the affordance vanishes exactly when fewer pins are on screen. · **Confirmed by
running** (attribute dump + rendered text under both branches). · **Minimal fix:** `role="status"` on
the count paragraph; keep the hint in both branches. · **Confidence:** high.

**[NIT] `handleToggleStrength(strength)` shadows the add-form's `strength` state** · `src/App.tsx:85`
vs `src/App.tsx:67` · Correct today (the parameter is what's wanted), but inside that function the
add-form's selected strength is unreachable and a future edit would silently bind to the parameter.
ESLint's `no-shadow` is not enabled, so nothing flags it. · **Minimal fix:** rename the parameter to
`toggled`. · **Confidence:** high.

**[NIT] `useState<PinFilter>(allPinsFilter())` allocates a throwaway `Set` on every render** ·
`src/App.tsx:81` · The lazy form `useState(allPinsFilter)` calls it once. Harmless at this scale;
noted only because it is free to fix. · **Confidence:** high.

**[NIT] A whitespace-only query shows text in the search box while the UI insists no filter is active**
· `src/domain/pinFilter.ts:28`, `:32-33` · Verified: typing three spaces leaves all 3 markers, the count
text unfiltered, and **no** Clear control — yet the box visibly contains characters. The semantics are
right (whitespace is not a query); only the affordance is inconsistent. · **Confidence:** high.

**[NIT] `README.md:52-56` is now stale** · Still lists "Unit 1 — Map + colored pins _(next)_" and
"Later, as earned: filter/search by strength or name" — the second of those is what this unit just
shipped, and the README is the first thing a clean checkout reads. Pre-existing drift, but line 56 is
this unit's to correct. · **Confidence:** high.

### Explicitly re-derived, not taken on trust (all three load-bearing claims hold)

- **AND semantics.** `matchesFilter` (`src/domain/pinFilter.ts:38-40`) is `strengths.has(...) &&
  matchesQuery(...)`. I re-ran the OR mutation myself: **11 tests fail across both test files**, matching
  the decision log exactly. Live check: "Failed" unchecked + query `wine` (a word appearing only in the
  failed pin's notes) → 0 markers, `"No leads match your filters."` Under OR it would have been 3.
- **Empty strength selection = show nothing.** `filterPins` with `new Set()` returns `[]`, and
  `isFilterActive` returns `true` so the Clear control is on screen — I unchecked all three in the real
  App: 0 markers, Clear present, one click restored all 3. The `size === 0 → all` fallback mutation
  fails exactly the one dedicated test.
- **Filtering touches nothing.** Raw `localStorage` string identical across toggles/queries/Clear; key
  count unchanged; a full unmount + remount ("reload") shows all 3 pins with the filter reset;
  delete + Undo under a 0-visible filter still wrote and restored correctly; the open editor's *unsaved
  draft*, the open Leaflet popup, and the search box's focus all survive filtering; a filtered-out pin's
  popup is properly torn down with its marker (no orphan popup). The behaviour is sound — F3/F4 are
  about the *guards*, not the current code.

---

## Step 5 — Sign-off

- **VERDICT:** **Yes** against Unit 5's own "Done when" — all six bullets in `docs/roadmap.md` § Unit 5
  are met and I verified each by running, not by reading. **No** against `CLAUDE.md` #3 in one state:
  while any filter is active, placing a pin does not render it and nothing says why (F1). That is a
  MAJOR to fix before ship, not a reason to bin the unit.
- **TEST + LINT:** `npm test` → **139 passed / 139, 9 files, 0 failed** (was 125; +9 `pinFilter.test.ts`,
  +5 `App.test.tsx`). `npm run lint` (`eslint .`) → clean, no output. `npm run typecheck`
  (`tsc --noEmit`) → clean. `npm run build` (verified in a `/tmp` copy so as not to write into the repo)
  → succeeds, 86 modules, 314.94 kB JS. Reviewer's own additions in the `/tmp` copy: **21 probe
  assertions, all passing**, and **12 source mutations** run against the repo suite — 8 killed tests as
  expected, **4 (M4, M5, M9, M10 — plus M12 in the second batch) killed nothing**, which is F2–F5.
- **TOP 3 FIXES (priority order):**
  1. **F1** — don't let a save produce an invisible pin: after add/edit, either clear the filter or name
     the fact that the new lead is hidden by it.
  2. **F2/F3/F4 as one commit** — three cheap tests that turn the unit's three "never" claims into
     mechanism: (a) filter changes don't move the map (with the map panned first), (b) exact store
     equality after toggle/query/Clear, (c) export is the full set while filtered.
  3. **F5** — one assertion on the count text after Clear, closing the wording-branch hole the builder
     flagged (and confirmed here to kill zero tests when broken).
- **WHAT I COULD NOT VERIFY, even after trying:**
  - Real-browser rendering. Everything above ran under jsdom with **real Leaflet** (real map instance,
    real markers, real popups, real `getCenter()`/`getZoom()`), which is strong — but not pixels. The
    builder's Chrome walkthrough (including "the only remaining icon was an OSM basemap glyph") I could
    not reproduce and did not attempt to.
  - Native `<input type="search">` behaviours: the browser's built-in "×" clear button, `Esc`-to-clear,
    and IME composition. My probes drive `change` events, so a Chrome-specific path (e.g. clearing via
    the × firing only `input`) is untested here. React's `onChange` should cover it; unverified.
  - Multi-tab/concurrent-write behaviour *with a filter active* — e.g. another tab adding a pin that the
    active filter hides. The existing read-modify-write discipline makes this look safe; not exercised.
  - Performance at large pin counts (`filterPins` runs on every render, every keystroke). Deliberate,
    defensible at this app's scale, unmeasured.
- **SINGLE BIGGEST RISK:** The filter is invisible, sticky state that now outlives every write, so the
  most likely silent wrongness is a user concluding "that lead never saved" or "I have nothing in this
  area" while a forgotten filter quietly hides the pin they just placed (F1) — with none of the unit's
  three "filtering never touches X" guarantees currently defended by a test that would fail if they
  broke (F2–F4).
