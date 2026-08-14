# Decision log — Unit 8: Visual redesign

## Why this, why now

Every unit so far added a surface; none of them ever went back and decided what the app should look
like. The result is what `docs/roadmap.md`'s Unit 8 section names directly: it works, but it reads as
default browser styling — four components had each independently invented a button, a form field, and a
"small uppercase section title," and the numbers behind them (`0.78rem`, `0.85rem`, `0.9rem`, `9px 12px`,
`10px 12px`) were arrived at one at a time rather than chosen.

It is the right *next* step rather than a later one for two reasons. First, it is the last unit on the
roadmap, and the "Later" list is empty — there is no feature it would be blocking. Second, it gets
strictly harder with every surface added: the redesign has to touch every view that exists at build
time, so doing it now costs five components rather than eight.

This unit is presentation-only. No storage shape, no data flow, no interaction changed.

## Codebase impact

- **`src/index.css`** — rewritten. Design tokens (type scale, 4px spacing grid, radius scale, warm
  neutral palette) plus shared primitives (`.btn` + variants, `.field`, `.panel`, `.overline`,
  `.swatch`, `.link-button`, `.btn-row`, `.stack`, `.sidebar__block`) replacing the per-component
  copies. Load-bearing rules kept verbatim: `.map-pane { min-width: 240px }` and `.app { min-height:
  240px }` (Unit 3A's fit floor, read out of this file by `mapFit.test.ts`), `.list-pane`'s
  `z-index: 1001` and opaque background (Unit 7 F3), and `.map-pane--armed .leaflet-container`.
- **New: `src/styles.test.ts`** (154 tests). The mechanism behind every claim below — see
  "The guards" section.
- **`src/App.tsx`** — sidebar grouped into `.sidebar__block` sections so the dividers run edge to edge.
  Control order inside the sidebar is unchanged. `.sidebar__show-all` → `.link-button`.
- **`src/components/{AddPinForm,PinEditor,PinFilterBar,ImportExport,DataFileLink,Legend,PinList}.tsx`** —
  class attributes only, onto the shared primitives. No component's props, state, DOM nesting, handlers
  or copy changed.

## Load-bearing assumptions

1. **The tests query by role/label, not by CSS, so a restyle cannot break them.** *(Load-bearing —
   it is what makes a broad class rename safe.)* Verified before touching anything, not assumed: the
   only class-coupled queries in the suite are `.pin-marker`, `.pin-marker__dot(--selected)`,
   `.pin-list`, `.pin-list__row(--selected)`, `.pin-list__swatch`, `.map-pane(--armed)`,
   `.map-pane__map`, and Leaflet's own classes. All of those names are preserved. Where a primitive took
   over the styling of a queried element, the element carries both classes (`class="swatch
   pin-list__swatch"`) rather than losing the hook.
2. **Two form DOM shapes are structural, not cosmetic.** *(Load-bearing.)* `App.test.tsx:217` and
   `:1381` reach a form's `<select>` via `getByDisplayValue(...).parentElement.parentElement`, i.e.
   `form > label > input`. The `.field` primitive keeps exactly that nesting — no wrapper div was added
   inside `.add-pin` or `.pin-editor`, only classes.
3. **The strength palette is not this unit's to touch.** *(Load-bearing — it is `CLAUDE.md`'s
   DONE-WHEN.)* strong=green / weak=amber / failed=red stay in `src/domain/leadStrength.ts` and reach
   the DOM only as an inline `style` from `colorForStrength`. Rather than restating that in prose, the
   three hexes are now *banned from the stylesheet* and `!important` is banned outright — see below.
4. *(Minor)* A 16px root font-size, for the whole-pixel claim about the type scale. If a user has set a
   different browser default the scale still holds its ratios; only the "lands on whole pixels" property
   is relative to 16px, which is what the test says.

## Design decisions, and what was rejected

- **Warm neutrals over cool grey.** The chrome sits against OSM's warm tiles and against three highly
  saturated pin colors. A cool slate palette (the previous `#66707a`/`#e2e6ea`) fights both. Everything
  in the chrome is desaturated so the pins remain the only saturated thing on screen.
- **Ink primary buttons, not a brand blue.** The old `#2f6fed` cleared AA against white by 0.05
  (4.55:1) — passing, with no headroom — and blue on a map reads as water. Near-black gives 17:1 and
  reads as deliberate rather than default-Bootstrap. The single accent (`#20566b`) is reserved for
  navigational affordances, selection and focus, so "this moves you" and "this changes your data" never
  look alike.
- **A darker destructive red than the failed-lead pin.** White on `#d64545` is **4.38:1 — a real AA
  failure** that has been shipping on the import Replace and delete-confirm buttons since Unit 3B.
  Chrome red is now `#a3282a` (7.3:1). Deliberately the same hue family — this app already uses red to
  mean "this ends badly if wrong" — but a different file, so it can move without touching a pin.
- **Rejected: dark mode, responsive breakpoints, a sticky sidebar header, motion design.** The roadmap
  puts the first outside the unit; the others are not asked for anywhere, and the sidebar is a fixed
  320px by design. A sticky header would also have needed negative-margin gymnastics against the
  block padding for no stated benefit.
- **Rejected: `@media (prefers-reduced-motion)`.** Not because it does not matter, but because the
  honest version of it is *having no motion*, and a test enforces that (below). A media block would have
  been ceremony guarding nothing.

## The guards — why `src/styles.test.ts` exists

`.claude/rules/00-process.md`: a control is real only if it is auto-invoked, self-proving and recorded.
"We applied a consistent type scale and met AA" is exactly the kind of claim that decays silently, and
jsdom renders no CSS, so the existing suite cannot see any of it. The new test reads `index.css` as text
(the idiom `mapFit.test.ts` already established) and asserts:

- the type scale lands on whole pixels and is strictly increasing; `--space-N` is always N x 4px;
- every foreground/background pair in use clears WCAG AA (4.5:1 text, 3:1 boundaries) — with the
  contrast function itself pinned to the three reference values, since a broken one fails *open*;
- none of the three strength hexes appears in the stylesheet, read from `colorForStrength` rather than
  retyped; `!important` appears nowhere (it is the one thing that could beat the inline pin color);
- **every selector is a single class**, with a 6-entry documented allowlist. This is the roadmap's
  named hazard: Unit 3B's `.import-export button` (0,1,1) silently beat `.import-export__cancel`
  (0,1,0). Patching each instance with `button.` matched the trap; removing every class+element selector
  from the sheet removes it;
- **a modifier is declared after its base**, and **a state selector never silently outranks a
  modifier** — `.x:hover` is (0,2,0) and beats `.x--mod` (0,1,0) whatever the order. Overrides that are
  intended (a disabled button outranking its variant) are listed by name, so they are on the record
  instead of being accidents nobody noticed;
- every font-size/spacing/radius is a token, every `var()` resolves to something `:root` defines, no
  rule suppresses an outline, every interactive class has a `:focus-visible` ring, and transitions
  animate only colour and shadow.

**Self-proving: 9 planted violations, each reverted.** Re-adding `.import-export button`; setting
`--danger` to the failed-lead red; a raw `19px` padding; deleting `.btn:focus-visible`; transitioning
`transform`; declaring `.btn--primary` before `.btn`; a typo'd `var(--ink-mutd)`; an `outline: none`;
and removing the `.pin-list__row--selected:hover` restatement — each fails exactly the test written for
it (the `--danger` one fails four), and the suite is green again after each revert.

## What the browser found that the tests could not

Two defects, both in code written for this unit, neither visible to any test that existed when they
were introduced:

1. **`.pin-list__row:hover` silently beat `.pin-list__row--selected`.** Hovering the row of the pin open
   in the editor dropped its selected tint back to the ordinary hover tint. Found by looking at it. The
   fix is a `.pin-list__row--selected:hover` restatement — and the state-vs-modifier check above was
   written *because of* this, and reproduces it when the restatement is removed.
2. **Disabled control text at 3.95:1.** An in-browser sweep that measures what is actually painted —
   walking every text node and computing contrast against its real effective background, rather than
   against the token pairs the test happens to enumerate — caught a dedicated disabled grey below AA.
   WCAG exempts inactive controls, and that exemption is deliberately not taken: disabled labels now use
   `--ink-muted` (4.8:1), with the state carried by the flat fill, missing border and `not-allowed`
   cursor. The token test was tightened to match. The sweep is the generalisable lesson here: an
   enumerated pair list only checks the pairings someone thought of.

Also re-verified in Chrome, since the CSS underneath them was rewritten: Unit 7 F3 (`.list-pane` at
z-index 1001 over Leaflet's 1000 — `elementFromPoint` at the zoom control's own coordinates returns a
list row), F4 (`inert` present while covered, cleared on return), F1 ("Show all leads" from List
switches to Map), the Map→List→Map round trip preserving the `.leaflet-container` node identity, the
armed crosshair (the one allowlisted descendant selector), and Unit 3A's 240px floors as computed
values. Console clean throughout.

## Deferred / not done

- **Dark mode** — the roadmap parks it explicitly. The token structure would make it a `:root` swap,
  but the single-class rule and the reader in `styles.test.ts` both assume no at-rules; adding a media
  block means teaching the reader about nesting. Noted, not built.
- **The Legend duplicates the filter's own colour checkboxes.** Both list Strong/Weak/Failed with a
  swatch, one above the other. That is an information-architecture question, not a styling one, and
  removing a surface is outside "no functional regressions." Flagged, not acted on.
- **A narrow-viewport layout.** The sidebar is a fixed 320px and the app scrolls sideways below
  ~560px, exactly as before. Unchanged, not improved.

## Least confident about

1. **The single-class rule as a long-term constraint.** It removes a whole bug class and it is enforced,
   but it is a real restriction: any future need to style a descendant Leaflet element (a popup part, a
   control) needs an allowlist entry with a reason. That is the intended cost — an allowlist entry is a
   decision on the record — but a reviewer may reasonably think the ceiling is too low for a stylesheet
   that has to co-exist with a third-party widget's CSS. The `.leaflet-*` rules added here are all
   single-class and fit fine; I am less sure the next one will.
2. **The sidebar block restructuring is the one non-cosmetic change in App.tsx.** Six wrapper `<div>`s
   went in around existing children. The tests pass and the two structural traversals in the suite go
   *up* from a form input rather than down from the sidebar, so nothing in the suite could see it — but
   it is the change most likely to have broken something a test does not cover, and the least protected
   by the new guards, which read CSS and know nothing about markup.
