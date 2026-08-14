# Review — Unit 8: Visual redesign

**Reviewer:** cold-context adversarial reviewer (`/review`), read-only over the repo.
**Date:** 2026-08-13
**Scope reviewed:** the uncommitted working tree on `fix-unit-7-merge-breakage` — `git diff` against
`2efe84d` (10 modified files) plus the two untracked files `docs/build_notes/unit 8.md` and
`src/styles.test.ts`. This is what the task named as the diff base and it matches `git status --short`.
**Spec:** `docs/roadmap.md` § "Unit 8 — Visual redesign"; product bar `CLAUDE.md` standing order #3
(DONE-WHEN); process law `.claude/rules/00-process.md`.

---

## Step 0 — What this unit had to deliver ("done when"), in my own words

- A **defined type scale and spacing scale, applied consistently** across every surface that exists at
  build time: sidebar, `PinEditor`, `PinFilterBar`, `ImportExport`, `DataFileLink`, `Legend`, and Unit
  7's List view.
- A **cohesive neutral colour system for the chrome only** — the strong=green / weak=amber / failed=red
  pin mapping that `CLAUDE.md`'s DONE-WHEN rests on must come through **untouched**.
- **No functional regressions.** Add/edit/delete/filter/import-export and Unit 7's view switch all keep
  working; the existing suite stays green; plus an in-browser check, because styling bugs are precisely
  what the suite cannot see.
- **Two named traps must not be re-sprung:** Unit 3A's `min-width: 240px` map-pane floor (the
  zoom-goes-`Infinity` fix), and Unit 3B's class+element selector silently outranking a plain class.
- **WCAG AA contrast minimum, focus states stay visible, `aria-live`/`role="status"` regions restyled
  rather than removed.**

No spec/intent conflict found. The unit's stated intent (presentation-only: class attributes, wrapper
divs, and a rewritten stylesheet) matches what the diff actually does — I checked every changed
component and found no props, state, handler, copy or control-order change. The one structural change
is six wrapper `<div class="sidebar__block">`s in `App.tsx`, which the builder flags himself.

---

## Step 1 — Verified by running (not by reading)

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | **416 passed / 416, 17 files.** Includes the new `src/styles.test.ts` (154). |
| Lint | `npm run lint` | clean, exit 0 |
| Types | `npm run typecheck` (`tsc --noEmit`) | clean, exit 0 |
| Production build | `npx vite build --outDir <scratch>` | succeeds, 93 modules |
| Acceptance check (in-browser) | headless Chrome 1280x900 over the real production build, driven via CDP | see below |
| Unit 3A floor | CDP `Emulation.setDeviceMetricsOverride` at 500x400 and 360x300 | `.map-pane` width **240px** at both; document scroll width 560px, i.e. it scrolls sideways rather than collapsing. **Floor holds.** |
| Unit 8's own guard, self-proving claim | 8 planted violations into a scratch copy of `index.css`, `styles.test.ts` re-run against each | 3 of the builder's own plants fire correctly; **4 holes of mine pass silently** (F2, F3, F4) |

**In-browser acceptance check (mine, not the builder's).** I built the app to a scratch dir, served it
over `http://localhost`, seeded `localStorage` with one strong / one weak / one failed pin, and drove
headless Chrome over CDP. Measured:

- **Lead-strength → colour, read off the painted DOM:** markers `rgb(46,158,79)`, `rgb(232,163,61)`,
  `rgb(214,69,69)` = `#2e9e4f` / `#e8a33d` / `#d64545`, in strong/weak/failed order. Legend swatches and
  filter swatches match, each against its correct label. **The DONE-WHEN mapping is intact.**
- **Contrast sweep of every rendered text node against its real effective background**, across the
  initial state and the List+editor state: **zero failures in the app's own chrome**, including the
  disabled "Place on map…" button (4.78:1) that the builder says the earlier sweep caught at 3.95:1.
- **Selected list row while hovered** (forced via CDP `CSS.forcePseudoState`): stays
  `rgb(234,241,244)` = `--accent-tint`. The `.pin-list__row--selected:hover` restatement works; removing
  it makes `styles.test.ts` fail, which I confirmed by planting.
- No horizontal overflow at 1280px; nothing in the sidebar overflows its 320px box.

The builder's other in-browser claims (Unit 7 F4 `inert`, Map→List→Map `.leaflet-container` node
identity, the armed crosshair, "console clean") I did **not** reproduce — see "What I could not verify".

---

## Step 2 — Hunt list

**Silent killers**

| Item | Verdict |
|---|---|
| Correctness of core logic (off-by-one, inverted condition, wrong reduction) | **pass** — no logic changed; diff is class attributes + wrapper divs. Re-read every changed component to confirm. |
| The acceptance bar judged by the real criterion, not a proxy | **concern** — the tests are a *text* analysis of `index.css`. They are a real and unusually good mechanism, but they measure the stylesheet's grammar, not what is painted. My browser probe found a visual defect (F1) that 154 green tests cannot see. |
| Any held-out/eval set touched more than once | **n/a** — no data/model work in this unit. |
| Split / leakage integrity | **n/a**. |
| Reproducibility — seeds, absolute paths, run order | **pass, verified by running.** No absolute paths in the diff; `styles.test.ts` derives its expectations from `index.css` and `leadStrength.ts` rather than hardcoding, so it cannot drift silently. Suite is order-independent (ran clean repeatedly, including a standalone single-file run in a scratch root). |
| Data / boundary integrity, same transform at both ends | **pass** — persistence untouched; `STORAGE_KEY` and the pin shape are not in the diff. |

**Domain hazards (`CLAUDE.md`)**

| Item | Verdict |
|---|---|
| Lead-strength → colour is a total, fixed mapping (strong=green / weak=amber / failed=red) | **verified-by-running — pass.** Read off the painted DOM in Chrome for all three strengths in all four places they render (map marker, legend, filter, list row) plus the editor swatch path. `colorForStrength` is still the sole source; `satisfies Record<LeadStrength,string>` still makes it exhaustive at compile time; the three hexes are absent from `index.css`; `!important` is banned. **But the guard around this claim is weaker than the claim — see F2.** |
| Persistence lossless and durable; degrade to empty-but-usable or fail loud | **pass (unchanged).** No storage code in the diff; the 32 `pinStore` + 13 `importExport` + 11 `viewStore` tests pass. |
| Local-first, standalone — no backend/DB/server/accounts/external geo API | **pass.** No network call added. The only new network-facing CSS is `.leaflet-container` / `.leaflet-popup-content-wrapper` styling of the existing tile widget. |

**Software engineering**

| Item | Verdict |
|---|---|
| Tests meaningful — would they fail on the bug I fear? | **concern, verified by running.** Partly yes (3/3 of the builder's plants fire), partly **no** (4/4 of my plants pass). See F2/F3/F4. |
| Edge cases / error handling | **pass** — no error paths changed; `role="alert"`, `role="status"` and `aria-live="polite"` all survive the restructure (checked in the diff line by line). |
| Structure / style | flagged **LOW** only: F5–F8. |
| Anti-drift (`CLAUDE.md` #2 / `00-process.md`) | **pass.** Dark mode, breakpoints, motion design and a sticky header were all explicitly rejected with reasons. `styles.test.ts` is 154 tests for a stylesheet, which is a lot — but `00-process.md` demands auto-invoked, self-proving, recorded controls, and this is the honest attempt at exactly that. Not over-engineering. |

---

## Step 3 — Where a subtle bug would hide in *this* code

1. **A primitive reused in a context it wasn't shaped for.** A shared `.btn` / `.link-button` / `.field`
   carries layout properties that were correct in the component it was extracted from and wrong in the
   next one. I looked here deliberately, and this is where the live defect is: **F1**.
2. **The guard itself failing open.** A CSS-as-text test can only see the shapes it was taught. I
   attacked it with plants the builder did not try, and it failed open four times: **F2, F3, F4**.
3. **The six new wrapper divs in `App.tsx`** — the builder's own "least confident" item. I checked this
   directly: no test in the suite traverses *down* from the sidebar (the two structural traversals go
   *up* from a form input, `App.test.tsx:217` and `:1381`), so the suite genuinely cannot see it. I
   verified it in the browser instead: the sidebar renders exactly 7 blocks in the documented order,
   `DataFileLink` always renders content in every branch (no empty bordered band), nothing overflows,
   and the Legend/AddPinForm/PinEditor swap still works. **Clean — but F1 lives in this same block.**

---

## Step 4 — Findings

### [MAJOR] F1 — "Show all leads" is top-aligned, not centred, in the new sidebar header row
`src/index.css:299` (`.link-button { align-self: flex-start }`) vs `src/index.css:181-187`
(`.sidebar__controls { display:flex; align-items:center }`), used at `src/App.tsx:1185`.

**What's wrong.** `.link-button` was extracted from `.pin-filter__clear`, which lived in a *column*
flex container where `align-self: flex-start` meant "don't stretch to full width". Reused in
`.sidebar__controls` — a *row* with `align-items: center` — the same declaration now means "sit at the
top of the row", overriding the centring.

**How I confirmed it.** Measured in headless Chrome against the production build:
`.sidebar__controls` = `{y:82, h:32}`, `.view-switcher` = `{y:82, h:32}`, `.link-button` =
`{y:82, h:16}`. Centred it would be at `y:90`. It is 8px high.

**Consequence.** Presentation-only, no functional impact — but this unit's *entire* acceptance
criterion is presentation, and the misalignment is in the app's most prominent row, next to the
navigation control, on the one control that is the only escape hatch from a stranded saved map view
(the Unit 6A review's BLOCKER). It also means the claimed in-browser verification did not cover the
header row it restructured.

**Minimal fix.** Drop `align-self: flex-start` from `.link-button` and move it to the one place that
needs it (`.pin-filter` context) as a modifier, e.g. `.link-button--start`; or set
`align-items: flex-start` off and let the row centre. Either way the fix is one declaration.

**Confidence:** high (measured, not inferred).

---

### [MAJOR] F2 — The strength-palette guard bans one *notation*, not the colour; and the fill ban is a hardcoded four-name list
`src/styles.test.ts:273-307`; claim stated at `src/index.css:22-26` and repeated in
`docs/progress_log.md` ("no stylesheet change can drift it from CLAUDE.md's DONE-WHEN mapping").

**What's wrong.** Two gaps:
- The "never hardcodes the %s color in CSS" test greps for the literal lowercase hex string. The same
  colour written `rgb(214, 69, 69)` is invisible to it.
- The "carry shape but never a fill" test iterates a hardcoded list of four selectors
  (`.swatch`, `.pin-list__swatch`, `.pin-marker__dot`, `.pin-marker__dot--selected`). Any *new* class on
  a swatch element is unguarded — and `background-image` layers **on top of** the inline
  `background-color`, which is the one stylesheet change that can visually override a strength colour
  *without* `!important`.

**How I confirmed it.** Planted into a scratch copy of `index.css` and re-ran `styles.test.ts`:
- `.legend__item { background: rgb(214, 69, 69); }` → **155/155 pass**
- a new `.legend__swatch { background-image: linear-gradient(#000, #000); }` → **155/155 pass**

(The builder's own three plants that I sampled *do* fire, correctly: `--danger` set to `#d64545` fails
4 tests; deleting `.pin-list__row--selected:hover` fails 1; re-adding `.import-export button` fails 1.
So the mechanism is real — it just does not cover what the prose says it covers.)

**Consequence.** Nothing is wrong today — I verified the painted colours in Chrome and they are exact.
The defect is that `index.css` and `docs/progress_log.md` both assert a guarantee about the project's
core semantic that the mechanism does not provide. Per `.claude/rules/00-process.md` ("prose is not
mechanism… any 'must / always / enforced' that traces to none of these is hope"), an overclaimed
guarantee about the DONE-WHEN mapping is the highest-cost place to be wrong, because the next person
will trust it and stop looking.

**Minimal fix.** Either (a) tighten the test — normalise `rgb()`/`rgba()` to hex before grepping, and
replace the four-name list with "any rule whose selector matches `swatch|marker` may not set
`background*`"; or (b) if that is more machinery than it's worth, soften the comment at `index.css:22-26`
and the progress-log sentence to what is actually enforced.

**Confidence:** high (both holes reproduced by running; the main thread independently re-reproduced
them against the real repo).

---

### [MINOR] F3 — "Every foreground/background pair in use clears AA" is an enumerated list, not a sweep
`src/styles.test.ts:194-265`.

**What's wrong.** `TEXT_PAIRS` / `BOUNDARY_PAIRS` are hand-written. A new class introducing a new
pairing is simply not checked. The builder's decision log names this exact limitation ("an enumerated
pair list only checks the pairings someone thought of") — but the action taken was to tighten one token,
not to close the enumeration.

**How I confirmed it.** Planted `.pin-editor__notes-override { color: var(--paper); }` (white text,
which on every surface in this sheet is 1.0–1.2:1) → **155/155 pass**. Separately I computed the full
10x11 token contrast matrix myself: every pairing that actually occurs in the DOM today clears AA, so
the enumeration happens to be complete *right now*. The one live gap the enumeration misses is
`--line-control` on `--disabled-surface` at **2.88:1**, below the 3:1 this sheet holds every other
control boundary to — because `.field__control:disabled` (`src/index.css:349`) does not reset
`border-color`, the way `.btn:disabled` (`src/index.css:238`) does. WCAG exempts inactive controls, but
the sheet's own comment (`src/index.css:101-107`) explicitly refuses that exemption and says disabled is
carried by "the flat fill, **the missing border** and the not-allowed cursor" — for a disabled `<select>`
the border is not missing.

**Consequence.** The AA claim is true today and unenforced tomorrow; and one stated design rule is not
actually implemented for form controls.

**Minimal fix.** Add `border-color: transparent;` to `.field__control:disabled`, and add
`['--line-control','--disabled-surface']` to `BOUNDARY_PAIRS` so the pair is on the record. Closing the
enumeration properly would need a rendering check, which is out of scope here — say so rather than
implying coverage.

**Confidence:** high.

---

### [MINOR] F4 — "Sizes space from tokens" accepts *any* token, not a spacing token
`src/styles.test.ts:452-463` — the assertion is `/^var\(--[a-z0-9-]+\)$/`.

**What's wrong.** The regex proves "this value is a custom property", not "this value is on the 4px
grid". `padding: var(--radius-sm)` or `margin: var(--sidebar-width)` both satisfy it.

**How I confirmed it.** Planted `.overline { margin: var(--sidebar-width); }` — a 320px margin —
→ **154/154 pass**.

**Consequence.** The roadmap's "spacing scale applied consistently" is enforced one notch weaker than
it reads. Low blast radius, easy to fix.

**Minimal fix.** Restrict the pattern by property: spacing properties to `var(--space-N)`, `font-size`
to `var(--text-*)`, `border-radius` to `var(--radius-*)` (that last one is already correct at
`styles.test.ts:465-475`).

**Confidence:** high.

---

### [MINOR] F5 — Three tokens are declared and never applied; one of them is pinned by a test
`src/index.css:42` (`--text-xl`), `:55` (`--space-8`), `:59` (`--radius-lg`); test at
`src/styles.test.ts:187-191`.

**How I confirmed it.** Stripped `:root` and comments from `index.css` and grepped for `var(--x)` on
every declared token: `--radius-lg`, `--space-8`, `--text-xl` have zero uses.

**Consequence.** `styles.test.ts:190` asserts `--radius-lg: 12px` — a test guarding a value that
nothing renders, which is ceremony rather than mechanism. And against the roadmap's "a defined type
scale… applied consistently", one of seven type steps is never applied, which makes the scale partly
aspirational.

**Minimal fix.** Delete the three unused tokens (and the `--radius-lg` assertion), or apply them.

**Confidence:** high.

---

### [MINOR] F6 — The `.overline` primitive did not actually replace the copies it was created to replace
`src/index.css:207-214` (`.overline`), `:511-518` (`.pin-filter__legend`), `:760-767`
(`.pin-list__strength`).

**What's wrong.** The decision log's stated motive is "One rule, so every section titles itself the same
way instead of four components each inventing `0.78rem`". The sheet now contains **three** independent
declarations of the same small-uppercase treatment (`font-size: var(--text-2xs)`, `font-weight: 600`,
`letter-spacing: 0.08em`, `text-transform: uppercase`, `color: var(--ink-muted)`). Both of the other two
could compose the primitive (`<legend className="overline pin-filter__legend">`), exactly as
`PinList.tsx:67` already does with `className="swatch pin-list__swatch"`.

**How I confirmed it.** Read the three rules side by side; they are the same five declarations.

**Consequence.** The duplication the unit set out to remove is reintroduced at a smaller scale, and
nothing in `styles.test.ts` can detect duplication — so this is the claim most likely to decay first.

**Minimal fix.** Compose `.overline` on the `<legend>` and on `.pin-list__strength`, leaving only the
context-specific declarations behind.

**Confidence:** high.

---

### [MINOR] F7 — The Legend is now the only sidebar block with no visible title, directly under a block showing the identical three swatches
`src/App.tsx:1259-1261`, `src/components/Legend.tsx:9` (`aria-label` only, no visible heading).

**What's wrong.** Every other `.sidebar__block` announces itself — "Add a restaurant" (`h2`), "Sync via
file" and "Backup" (`.overline`), the filter's "Show" `<legend>`. The Legend block has none, and the
redesign put a hairline border around it directly beneath the filter's own Strong/Weak/Failed swatch
list. Confirmed in the browser: block 2 renders "ShowStrongWeakFailed", block 4 renders
"StrongWeakFailed" — two adjacent, visually equal, unlabelled colour lists.

**Consequence.** The builder deferred the duplication as "an IA question, not a styling one", which is
a fair call on *removing* a surface. But drawing a box around both made the ambiguity more prominent
than it was before, which is a regression against this unit's own goal, not a neutral deferral.

**Minimal fix.** Add `<p className="overline">Lead strength</p>` to the legend block — one line, uses
the primitive the unit already built, does not remove a surface.

**Confidence:** medium-high (the layout facts are measured; "more prominent than before" is a judgement).

---

### [NIT] F8 — `DataFileLink`'s props left under-indented when the wrapper div went in
`src/App.tsx:1260-1274`: the element sits at 10 spaces, its props at 10, its closing `/>` at 12.

**How I confirmed it.** Read the file; `npm run lint` passes, so nothing in the toolchain catches it
(there is no Prettier in `package.json`).

**Consequence.** Cosmetic, but it is the visible fingerprint of a mechanical wrapper insertion — which
is exactly the change the builder named as least protected. Worth fixing while the block is open.

**Confidence:** high.

---

### Checked and cleared (not findings — recorded so they are not re-litigated)

- **Leaflet attribution links.** My in-browser sweep flagged "Leaflet" / "OpenStreetMap" at 3.64:1 — but
  only because I blocked tile requests, leaving Leaflet's `#ddd` fallback behind them. Against the real
  attribution background (`rgba(255,255,255,.8)` over tiles) `#0078A8` measures **4.94:1 on white**.
  Not a finding.
- **Unit 3B trap.** No class+element selector anywhere in the sheet; re-adding
  `.import-export button` fails the guard. **Fixed by construction, verified by planting.**
- **Unit 3A floor.** `min-width: 240px` and `min-height: 240px` retained as literal px with their
  comments; `mapFit.test.ts` (13 tests) reads them and passes; measured 240px in Chrome at 500x400 and
  360x300. **Not regressed.**
- **`aria-live` / `role="status"` / `role="alert"`.** All present and unmoved after the restructure.
- **No dead or missing classes.** Every class referenced in `.tsx` has a rule (except `.pin-marker`,
  which is Leaflet's divIcon hook and never had one); no orphaned rules.
- **Class composition on shared elements** (`swatch pin-list__swatch`, `field__control
  pin-editor__notes`, `sidebar__block stack`): I checked each pair for property conflicts resolved by
  source order. None conflict except `font`/`font-family`/`line-height` on the textarea, where the later
  rule wins and the result is the intended one.

---

## Step 5 — Sign-off

- **VERDICT:** **Yes, with fixes.** The unit meets its acceptance criteria on substance — the scales are
  real and applied, the neutral system is cohesive, the strength mapping is untouched and verified
  painted-correct in a real browser, AA holds across every pairing that actually renders, focus rings
  exist on every interactive class, the live regions survived, and neither the Unit 3A floor nor the
  Unit 3B trap regressed. It does **not** fully meet the "consistent visual pass, verified in browser"
  bar while F1 stands, and two of the claims written into `index.css` and `docs/progress_log.md` are
  stronger than the mechanism behind them (F2, F3). No BLOCKER.

- **TEST + LINT:** `npm test` → **416 passed / 416, 17 files, 0 failed** (of which `src/styles.test.ts`
  is 154). `npm run lint` → **clean, exit 0**. `npm run typecheck` → **clean, exit 0**. `vite build` →
  **succeeds, 93 modules**. All four run by me, not taken from the log.

- **TOP 3 FIXES**, in priority order:
  1. **F1** — remove `align-self: flex-start` from `.link-button` so "Show all leads" centres in
     `.sidebar__controls`. One declaration; it is the one thing a user would actually see.
  2. **F2** — either close the two holes in the strength-palette guard (normalise `rgb()` to hex;
     replace the four-name fill list with a pattern) or downgrade the guarantee asserted at
     `index.css:22-26` and in `docs/progress_log.md` to what is enforced. Do not leave the overclaim
     standing on the DONE-WHEN mapping.
  3. **F3** — add `border-color: transparent` to `.field__control:disabled` (the sheet's own stated
     rule, currently unimplemented for form controls) and add that boundary pair to the test.
  *(F4–F8 are cheap and can ride along; F4 in particular is a two-line change.)*

- **WHAT I COULD NOT VERIFY** even after trying:
  - **The builder's specific in-browser re-verifications.** I reproduced the strength colours, the
    contrast sweep, the selected-row hover, the 240px floors and the absence of overflow. I did **not**
    reproduce: Unit 7 **F4** (`inert` set on the map pane while covered and cleared on return), the
    Map→List→Map round trip **preserving `.leaflet-container` node identity**, the **armed crosshair**
    cursor, or "**console clean**". Those four remain the builder's claim, unverified by me. My
    `elementFromPoint` probe for Unit 7 F3 hit the top-*right* of the list pane, not the top-left where
    Leaflet's zoom control actually sits — it returned a list row, which is consistent with the pane
    being on top, but it is **not** the F3 check the builder describes. Treat F3 as unverified by me
    too; `z-index: 1001` is unchanged from Unit 7 and the reasoning is sound on inspection.
  - **The remaining 5 of the builder's 9 planted violations.** I sampled 3 (all fired correctly) and
    added 4 of my own (all passed silently). I did not run the raw-`19px`, deleted-`:focus-visible`,
    transitioned-`transform`, `.btn--primary`-before-`.btn`, `var(--ink-mutd)` or `outline: none`
    plants. The guard code for each of those is present and looks correct on reading.
  - **Anything about how this looks to a human.** I measured geometry and colour; I did not look at a
    screenshot. "Cohesive" and "clean/minimal" are the user's call, not mine.
  - **A full reload round trip in the browser.** Persistence is untouched by this diff and is covered by
    56 storage tests, so I did not re-run it manually.

- **SINGLE BIGGEST RISK:** The 154 green tests read like proof that the design system holds, but they
  check the stylesheet's *grammar* rather than what is painted — so the most likely silent failure here
  is a second F1: a shared primitive reused in a container it was not shaped for, producing a visibly
  wrong layout that every guard in the file cheerfully passes.
