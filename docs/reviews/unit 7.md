# Review — Unit 7: Multi-view navigation (uncommitted, on top of `282fb1a`)

Reviewer: cold-context adversarial reviewer (`/review`), read-only over the repo.
Diff base: `git status --short` working tree vs `282fb1a`.
Spec: `docs/roadmap.md` §"Unit 7 — Multi-view navigation"; top-level bar: `CLAUDE.md` standing order #3
(DONE-WHEN); process law: `.claude/rules/00-process.md`.

## Step 0 — What this unit had to deliver (my words)

- A Map/List switcher in the sidebar; the sidebar keeps working in both views; **only the main pane
  switches**, and switching is pure UI/read state — no storage write, no change to the selection or the
  add-pin flow.
- The List shows **exactly the currently-visible pins** (Unit 5's filter/search, same AND semantics, same
  "Showing N of M" wording) as rows of name / strength (color-coded to the map's palette) / short notes
  preview.
- Clicking a row opens **the same `PinEditor`** the map uses — nothing pin-specific duplicated.
- Alphabetical default order (not insertion order).
- **Placing a pin stays Map-only.** No pin-data or storage-shape changes; no hard dependency on Unit 6.

No spec/code intent conflict found. One reading worth flagging up front: the spec's "the sidebar stays
available in both" enumerates filter/search, Backup/Import-Export and Legend, but the sidebar also holds
Unit 6A's **"Show all leads"**, which this unit leaves reachable in List view where it has no observable
effect and silently clears persisted state (F1). Under a strict reading of that bullet, F1 is a
BLOCKER; I have scored it MAJOR because the enumerated controls do all work.

## Step 2 — Hunt list

| Area | Verdict |
| --- | --- |
| Core logic (`sortPinsByName`, `previewNotes`, row wiring) | **pass (verified-by-running)** — order, stability, non-mutation, exact truncation boundary all reproduce; one code-unit-slicing edge (F5) |
| Acceptance bar — switcher, filtered list, same editor, alphabetical, Map-only placement, no storage change | **pass with concerns (verified-by-running)** — every bullet reproduces in the real app; "Map-only placement" holds only because of a stylesheet (F2) |
| "Switching is pure UI/read state" | **verified-by-running** — after List→Map→List the only storage key present is `restaurant-map.pins.v1`; armed draft + open editor + unsaved textarea text all survive a round trip |
| Same `visiblePins` for both surfaces (no second filter implementation) | **pass** — single `filterPins` result passed to both; verified by toggling a strength and a search in List view |
| Split/leakage integrity | **n/a** — no learned/fitted state in this unit |
| Reproducibility / determinism | **pass** — pure props-in/render-out components, no new randomness, no absolute paths; `localeCompare(undefined, …)` uses the ambient locale (NIT, F8) |
| Data/boundary integrity | **pass** — List/Switcher consume already-validated `Pin[]`; no new untrusted boundary; corrupt store still degrades to "No leads to show." + named error banner, no crash |
| **Lead-strength → color (CLAUDE.md #3)** | **pass (verified-by-running)** — list swatches render `rgb(46,158,79)` / `rgb(232,163,61)` / `rgb(214,69,69)` for strong/weak/failed, byte-identical to the map markers, sourced from `colorForStrength`; strength also carried as text. **But zero tests assert it on this new surface (F6)** |
| **Persistence lossless + durable (CLAUDE.md #3)** | **pass (verified-by-running)** — no storage shape change; pins/strength/notes round-trip through a remount; delete + undo driven entirely from a list row works; corrupt store degrades, doesn't drop pins |
| **Local-first / standalone (CLAUDE.md #2)** | **pass** — no network, no backend, no new dependency; tiles unchanged |
| Meaningful tests | **concern** — the map-identity test is genuinely load-bearing and good; but the two invariants that carry this unit's architecture (opaque cover, z-index) are CSS-only and **no test in the suite can fail on them** (F2, F3), and the color mapping is untested on the list (F6) |
| Edge cases / error handling | **pass** — empty list, whitespace-only notes, corrupt store, filtered-to-nothing all handled |
| Accessibility | **concern** — `aria-hidden` wrapper still holds 7 tabbable controls (F4); run-together row accessible name (F9) |
| Anti-drift | **pass** — no routing, no stats view, no bulk actions, plain `useState`. The layering-over-swapping choice is more complex than a ternary but is justified (it prevents losing the pan); the JS truncation duplicating the CSS ellipsis is the one bit of avoidable ceremony (F10) |

## Step 3 — Riskiest spots, and what I found when I looked

1. **The covering overlay (`.list-pane`) — the whole architecture rests on two CSS declarations that
   jsdom cannot see.** Looked deliberately: `background:#fff` is what stops clicks reaching the map, and
   `z-index:1000` is what stops Leaflet's controls bleeding through. Both true today; neither is
   defended by anything executable. Worse, `z-index:1000` does not *beat* Leaflet — it *ties* it
   (`node_modules/leaflet/dist/leaflet.css:139-142` sets `.leaflet-top,.leaflet-bottom{z-index:1000}`),
   and the list only wins because it is the later sibling in `.map-pane` (confirmed: children render in
   the order `['map-pane__map','list-pane']`). → F2, F3.
2. **The sidebar controls that only affect the map, now clickable while the map is invisible.** "Show
   all leads" is the one with a persisted, destructive effect. Reproduced: it clears the saved view and
   force-remounts the map with nothing at all changing on screen. → F1.
3. **`previewNotes` truncation.** Boundary looked fine for ASCII (the existing test uses `'x'.repeat`);
   pushing a non-BMP char across the boundary produces a lone surrogate. → F5.

## Step 4 — Findings

**[MAJOR] "Show all leads" silently discards the persisted map view when clicked from List view** ·
`src/App.tsx:191-195` (`handleShowAllLeads`), rendered at `src/App.tsx:514-516` · The button is
deliberately always visible, but in List view its entire effect is invisible: it re-fits the covered
map, force-remounts `MapView` (`mapEpoch`), and calls `clearView(storage)` — while the list rows, the
active filter and the active view are all unchanged. · **Confirmed by running** (probe against the real
`App` + real `localStorage` fake): seeded `restaurant-map.view = {center:[48.8566,2.3522],zoom:9}`,
switched to List, clicked "Show all leads" → saved view key is now `null`, `.leaflet-container` is a
*different* DOM node (remount happened), rows byte-identical, still in List view. · **Consequence:** the
user's saved pan/zoom — the preference Unit 6A shipped and whose loss its own review called a BLOCKER —
is destroyed with zero feedback and no undo; and in List context the label reads like "show all the
leads in this list" (i.e. clear the filter), so it is exactly the button a filtered-list user will click
by mistake. · **Minimal fix:** `setActiveView('map')` inside `handleShowAllLeads` (one line) so the
action happens where it is visible; optionally re-word/hide it in List view. · Confidence: high.

**[MAJOR] "Placement is Map-only" is an acceptance criterion with no mechanism — only a stylesheet** ·
`src/App.tsx:236` (`handleMapClick` has no `activeView` guard) + `src/index.css:509-523` · The decision
log ("the constraint holds structurally") and `docs/progress_log.md` ("Placing a new pin stays Map-only,
by construction … a click can't land on it") both assert an invariant that exists only as
`background:#fff` on `.list-pane`. · **Confirmed by running:** armed a placement named "Ghost Lead",
switched to List, dispatched a real click on `.leaflet-container` → the pin was created **and written to
`localStorage`**, and the list immediately grew to 3 rows. (In a real browser the opaque overlay does
block the mouse — I verified the stacking statically, see F3 — so the product bar is met *today*; what
is missing is any executable guard or test.) · **Consequence:** the criterion is one CSS edit away from
silently failing, and the suite would stay green; jsdom does no layout, so no existing or future
component test can ever catch it. This is precisely what `.claude/rules/00-process.md` §"Prose is not
mechanism" says to flag: a "must" that traces to neither a hook, a test, nor a self-proving guard. ·
**Minimal fix:** `if (activeView !== 'map') return;` as the first line of `handleMapClick`, plus a test
that arms → switches to List → clicks the map → asserts storage unchanged (that test fails today). ·
Confidence: high.

**[MINOR] `.list-pane`'s `z-index: 1000` ties Leaflet's control layer rather than beating it; the fix
works only by DOM order, and the comment says otherwise** · `src/index.css:509-523` · The comment claims
1000 was chosen "because Leaflet … sets z-index: 1000", implying it wins; equal z-index in the same
stacking context is resolved by tree order. · **Confirmed:** `node_modules/leaflet/dist/leaflet.css`
lines 139-142 set `.leaflet-top,.leaflet-bottom{z-index:1000}`; `.map-pane` is `position:relative` with
no `z-index` so it creates no stacking context; `.map-pane` children render in the order
`['map-pane__map','list-pane']`, so the list paints (and hit-tests) last. · **Consequence:** the natural
fix for F4 — rendering the list *before* the map so keyboard focus reaches it first — would silently
resurrect the exact bug the builder caught by eye in Chrome, with 187 tests still green. ·
**Minimal fix:** `z-index: 1001` (strictly above Leaflet's) and correct the comment to say the number
must *exceed* 1000. · Confidence: high.

**[MINOR] The `aria-hidden` map wrapper still contains 7 tabbable controls, and activating one rewrites
persisted state** · `src/App.tsx:621` · `aria-hidden="true"` hides the covered map from the
accessibility tree but not from the tab order. · **Confirmed by running:** while List is showing, under
`.map-pane__map` there are `DIV.leaflet-container` (`tabindex="0"`, keyboard-pannable/zoomable), two
`pin-marker` marker icons (`leaflet-interactive`, focusable — Enter fires `onSelectPin`), and four
anchors (`leaflet-control-zoom-in`, `leaflet-control-zoom-out`, two attribution links). Dispatching a
click on `.leaflet-control-zoom-in` while List was up took `restaurant-map.view` from `null` to
`{"center":[40.710000750875054,-74.00999999999999],"zoom":15}`. · **Consequence:** a keyboard user must
tab through seven invisible controls to reach the first list row, and can silently change *and persist*
a map view they cannot see (next reload opens there). It is also a textbook `aria-hidden-focus` (WCAG
4.1.2) violation. The decision log parks the tabbability but does not mention the persisted-state
effect. · **Minimal fix:** set `inert` on `.map-pane__map` while `activeView === 'list'` (React 18
needs a small ref effect: `el.toggleAttribute('inert', activeView === 'list')`), which subsumes the
`aria-hidden`. · Confidence: high.

**[MINOR] `previewNotes` slices UTF-16 code units, so truncation can split an emoji into a replacement
glyph** · `src/components/PinList.tsx:16` · `collapsed.slice(0, NOTES_PREVIEW_LENGTH)` cuts mid
surrogate pair. · **Confirmed by running:** `previewNotes('x'.repeat(79) + '😀' + …)` returns a string
whose char at index 79 is the lone high surrogate `U+D83D` (`0xd83d`), immediately followed by `…` —
renders as `xx�…`. The existing boundary test only uses `'x'.repeat(...)`, so it cannot see this. ·
**Consequence:** cosmetic garbage in a notes preview containing an emoji at the boundary — plausible in
free-form visit notes. · **Minimal fix:** `[...collapsed].slice(0, NOTES_PREVIEW_LENGTH).join('')`, plus
a test with a non-BMP character on the boundary. · Confidence: high.

**[MINOR] No test asserts the strength→color rendering on the new List surface** ·
`src/components/PinList.test.tsx:85-91` asserts the *labels* ("Strong"/"Weak") only; nothing asserts
`.pin-list__swatch`'s color · **Confirmed:** grep shows hex-color assertions exist only in
`MapView.test.tsx:59`, `App.test.tsx:199,208` and `leadStrength.test.ts`; and by running, the list's
rendered colors are in fact correct today and identical to the markers. · **Consequence:** `CLAUDE.md`
standing order #3 makes strength→color a total, fixed mapping and a wrong color a BLOCKER-class defect;
this unit adds a second surface that renders that mapping with no executable guard. A future edit that
hardcodes or transposes the list palette passes all 187 tests. · **Minimal fix:** three assertions on
`.pin-list__swatch` `style.background` (or one assertion that it equals `colorForStrength(strength)`)
in `PinList.test.tsx`. · Confidence: high.

**[MINOR] A search hit living past the 80-character preview leaves a row with no visible reason to be
in the filtered list** · `src/components/PinList.tsx:5,42` · **Confirmed by running:**
`previewNotes('a'.repeat(120) + ' truffle')` does not contain `truffle`, while `matchesFilter` matches
it — so a "truffle" search in List view shows a row whose preview never mentions truffle. · The map does
not have this problem (its popup shows the full notes), so List is a step down in explainability. ·
**Consequence:** looks like a filter bug to the user; low severity, no wrong data. · **Minimal fix:**
none required for this unit's bar — either note it, or later centre the preview on the match. ·
Confidence: high.

**[NIT] "Alphabetical" has three surprising cases** · `src/domain/pin.ts:48-52` · **Confirmed by
running** on a mixed list, `sortPinsByName` yields
`['  Zulu', '10 Downing', '2 Fish', 'café', 'cafe', "L'Ami", 'Lami']`: (a) a name with leading
whitespace — which `parsePin` deliberately preserves for imported data (`src/domain/pin.ts:116-123`) —
sorts above every letter; (b) `'10 Downing'` sorts before `'2 Fish'` (no numeric collation);
(c) `'café'`/`'cafe'` are *equal* under `sensitivity:'base'`, so their relative order is insertion
order. Also, `localeCompare(undefined, …)` follows the ambient locale, so order is only deterministic
within one environment. · **Minimal fix (optional):** compare on `name.trim()` and add
`{ numeric: true }`. · Confidence: high.

**[NIT] List rows have a run-together accessible name** · `src/components/PinList.tsx:44-66` ·
**Confirmed by running:** `getByRole('button', { name: 'Alpha CafeStronggood' })` matches;
`'Alpha Cafe Strong good'` does not. · Screen readers announce the row as one glued token. ·
**Minimal fix:** an `aria-label` on the row button, or `{' '}` separators. · Confidence: high.

**[NIT] Two truncation mechanisms that can disagree** · `src/components/PinList.tsx:5-17` +
`src/index.css:587-595` · The CSS `text-overflow: ellipsis` already truncates at the real rendered
width; the JS 80-char cut is a second, differently-behaving truncation (and the one that carries F5).
The decision log accepts the disagreement; worth noting it as the only avoidable complexity in the unit.
· Confidence: medium (a judgment call, not a defect).

**Verified-good, stated once:** the "layer, never swap" architecture is the right call and its test (real
Leaflet `setView`, then assert `.leaflet-container` node identity and center/zoom across a List→Map round
trip) is the one test here that a naive implementation would actually fail.

## Step 5 — Sign-off

- **VERDICT:** **Yes** — Unit 7 meets its `docs/roadmap.md` acceptance criteria and does not regress
  `CLAUDE.md`'s DONE-WHEN bar, with one MAJOR to fix first (F1) and one unguarded invariant (F2). Caveat
  stated in Step 0: read strictly, "the sidebar stays available in both views" is not true of the
  "Show all leads" control, and a reviewer who reads that bullet strictly would call F1 a BLOCKER.
- **TEST + LINT:** run by me, in-repo: `npm test` → **187 passed / 187, 13 files** (matches the builder's
  claim); `npm run lint` → clean, 0 problems; `npm run typecheck` (`tsc --noEmit`) → clean. In a scratch
  copy outside the repo: `vite build` → **90 modules, 317.82 kB JS / 22.95 kB CSS** (matches the claim
  exactly). All Step-4 "confirmed by running" evidence comes from probe suites I ran against the real
  `App`, real Leaflet and a real `Storage` shim in that scratch copy; those probe files live only in the
  scratchpad and touch nothing in the repo.
- **TOP 3 FIXES (priority order):**
  1. **F1** — `setActiveView('map')` in `handleShowAllLeads` (one line) so the control can't silently
     wipe the persisted view from a view where nothing visibly happens.
  2. **F2** — guard `handleMapClick` with `if (activeView !== 'map') return;` and add the test that
     fails today, so "placement is Map-only" is a mechanism instead of a stylesheet.
  3. **F3 + F6** — bump `.list-pane` to `z-index: 1001` and fix its comment; add the three
     strength→color assertions to `PinList.test.tsx`.
- **WHAT I COULD NOT VERIFY** even after trying: (a) anything requiring real layout/paint — I have no
  browser in this environment, so the opaque-cover and stacking behaviour is verified *statically*
  (Leaflet's own `z-index: 1000`, `.map-pane` creating no stacking context, DOM sibling order) plus the
  builder's Chrome check, not by pixels; (b) that force-remounting `MapView` while it is covered
  (F1's path, and a confirmed import from List view) re-fits correctly in a real browser — jsdom's forced
  `clientWidth/Height` makes that test vacuous, though the container is laid out (not `display:none`) so
  the risk is low; (c) the `.map-pane__map` wrapper's effect on real percentage-height resolution — the
  chain is `.app(100vh, flex) → .map-pane(flex:1, stretched) → .map-pane__map(100%) → .map(100%)`, which
  is correct per spec for a stretched flex item and passed in Chrome per the build notes, but I could not
  measure it.
- **SINGLE BIGGEST RISK:** the two invariants this unit's whole design rests on — the list being opaque
  over the map, and beating Leaflet's controls in the stacking order — live only in CSS that no test in
  this project can ever see, so the day one of them regresses, placement-from-List and control bleed-through
  come back silently with the suite still green.
