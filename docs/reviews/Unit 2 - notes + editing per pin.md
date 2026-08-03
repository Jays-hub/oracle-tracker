# Review — Unit 2: notes + editing per pin

Adversarial, read-only review. Cold to the build chat. Every number below was produced by the reviewer
running the command, not read from the build note.

Diff base: uncommitted working tree on detached HEAD `400e632` (tip of `main`, unit 1). `git diff` for
tracked files + the untracked `src/components/PinEditor.tsx` and
`docs/build_notes/Unit 2 - notes + editing per pin.md`.

## Step 0 — What this unit had to deliver ("done when")

- `CLAUDE.md` #3 (product DONE-WHEN), the half unit 1 did not cover: **attach and later edit free-form
  notes on a pin**, and have **every pin — position, strength, and notes — survive a full reload** via
  `localStorage`.
- Per `docs/build_notes/Unit 2 …`: click a pin → sidebar editor for notes + name + strength; save
  persists immediately; the marker recolors on a strength change; the popup reads notes back with their
  line breaks; a new pin opens its editor immediately.
- Structural laws it must not break: strength→color is total and fixed (strong=green `#2e9e4f`,
  weak=amber `#e8a33d`, failed=red `#d64545`); persistence lossless/durable, degrading to
  empty-but-usable or failing loud with a named error; local-first (no backend/DB/accounts/geo API).
- Backward compatibility is this unit's own added requirement: records written by unit 1 have no
  `notes` key and must keep loading (`parsePin` reads absent → `''`, key stays `.v1`).
- Tests green, lint/types clean.

**No spec conflict found.** The scope grew slightly beyond the literal title (name and strength are
editable, not just notes); the build note argues it (a lead tracker with a frozen strength and no
delete is broken by design) and I agree — that is not drift. Delete, filter, search, autosave and
map-view persistence are explicitly deferred, consistent with the roadmap.

---

## Step 1 — Verified by running

- `npm test` → **32 passed** (3 files: leadStrength 4, pin 16, pinStore 12). Reproduces the logged count.
- `npm run lint` → clean, exit 0. `npm run typecheck` → clean, exit 0.
- `npm run build` → succeeds, **81 modules**, `dist/assets/index-*.js` 306.19 kB.
- `npm run dev -- --port 5199` → HTTP 200 on `/` and `/src/main.tsx`; title `restaurant-map — lead tracker`.
- **I did not stop at the domain tests.** Unit 1's review said a jsdom render of Leaflet was unreliable;
  that is no longer true and I proved it. I installed `jsdom` **outside the repo** (`/tmp/rmreview`),
  bundled the real `src/App.tsx` with the repo's own esbuild, and drove the real component tree
  (real Leaflet, real markers, real `localStorage`) through the whole unit: seeded a genuine unit-1
  record, clicked the marker, typed notes, saved, reloaded, added a second pin, switched selection,
  reloaded again. **~30 assertions, 0 failures on the mainline path.** Everything in the build note's
  browser log reproduces headlessly. The extra probe runs (quota failure, corrupt store, duplicate ids,
  HTML in notes, two tabs, planted regression) are what produced the findings below.

---

## Step 2 — Hunt list

**Silent killers**

- **Core edit logic** — **pass (verified by running).** `updatePin` (`src/domain/pin.ts:117`) carries
  `id`/`lat`/`lng` from the original and re-validates through `parsePin`; `replacePin` replaces by
  `findIndex` and preserves order; the harness confirmed a save changes exactly the edited pin and
  leaves lat/lng byte-identical (`{"lat":40.71,"lng":-74}` before and after). No off-by-one, no
  inverted condition, no coercion.
- **Acceptance bar judged by the real criterion** — **pass (verified by running).** Notes typed →
  saved → *full remount from `localStorage`* → notes and strength re-seeded into the editor and the
  marker recolored. That is the charter's bar, not a proxy.
- **`edits.notes ?? pin.notes` vs clearing notes** — **pass (verified by running).** `??` (not `||`)
  means `''` genuinely clears; harness: typing `"   \n  "` enabled Save and stored `notes: ""`, and the
  popup fell back to the empty-notes hint.
- **Save-then-commit ordering** — **pass (verified by running).** With `Storage.prototype.setItem`
  patched to throw `QuotaExceededError`: banner `"Couldn't save those changes: exceeded the quota. The
  pin is unchanged."`, hint stayed **"Unsaved changes."**, stored bytes unchanged, marker kept its old
  color. The UI cannot say "Saved." over a write that did not happen. This is the best thing in the unit.
- **Cross-pin draft leakage (`key={selectedPin.id}`)** — **pass on today's code, undefended (verified
  both ways).** Shipped code: switching pins re-seeds the draft. With the `key` removed in a /tmp copy:
  pin B was silently overwritten with pin A's name, strength **and** notes. All 32 tests still pass in
  that world — see Finding 2.
- **Split / leakage** — **n/a** (no learning or eval data).
- **Reproducibility** — **pass.** `serializePins` fixes field order (`notes` appended last);
  determinism test passes; no hardcoded absolute paths in `src/`; ids come from `crypto.randomUUID`
  with a documented fallback.
- **Boundary integrity / NaN / types** — **pass, with one asymmetry.** `parsePin` rejects a *present*
  non-string `notes` (`{text:…}`, `42`, `null`, `['a']` all throw) and accepts an *absent* one. I
  attacked the asymmetry: it is not reachable by a truncated write (`setItem` is atomic and a truncated
  JSON string fails `JSON.parse` first), so the only producers are genuine unit-1 records and hand
  editing. **The migration decision is sound.** Separately, `parsePin` still accepts `name: ''` while
  `createPin`/`updatePin` reject it — see Finding 7.

**Domain hazards**

- **Lead-strength → color, total and fixed** — **pass (verified by running).** Read the mapping
  directly, not the legend: `colorForStrength` is `satisfies Record<LeadStrength, string>` and throws
  rather than defaulting. In the live DOM a strong pin rendered `background:#2e9e4f`, recolored to
  `#e8a33d` on save of `weak`, and a third pin rendered `#d64545` for `failed`. **The new selection
  ring does not touch the fill**: `.pin-marker__dot--selected` (`src/index.css:262`) sets only
  `box-shadow`, and the selected marker's inline style still carried its strength color in the DOM.
  Decision 9 is correctly implemented.
- **Persistence lossless and durable** — **concern.** Round-trip is exact, including `\n`, unicode,
  quotes and a 200 000-char note; a corrupt store fails loud with `PinStoreError`, leaves the bytes on
  disk, and the map stays usable and empty. But there are two reproduced silent-loss paths: a second
  tab's save deletes pins the first tab added (Finding 1), and one add after a corrupt read destroys
  the stored bytes with no backup (Finding 3).
- **Local-first, standalone** — **pass (verified by grep).** The only network references in `src/` are
  the OSM tile URL and its attribution (`src/components/MapView.tsx:52-53`). No fetch/XHR, no geo or
  places API, no accounts, no coupling to the restaurant-development project.
- **Injection through user-authored notes** — **pass (verified by running).** Notes containing
  `<img src=x onerror=…>` render as literal text in the popup; no `<img>` entered the DOM; the payload
  did not execute. The `divIcon` html still interpolates only a fixed color and a boolean.

**Software engineering**

- **Tests meaningful?** — **fail for this unit's riskiest code.** The 17 new tests are good at the
  domain/storage layer (the legacy-record test even asserts the input truly lacks the key). But **no
  test imports any component**: `grep` over the three test files finds `App`/`PinEditor`/`MapView` only
  inside comments. The guards the build note is proudest of — the `key` remount, save-then-commit,
  marker-click→select, popup notes — are defended by a comment and one manual browser session. Finding 2.
- **Error handling** — **pass.** Named errors (`InvalidPinError`, `PinNotFoundError`, `PinStoreError`)
  and both write paths are wrapped with a user-facing banner. `replacePin` failing loud on an unknown
  id (decision 4) is the right call.
- **Structure/style** — clean and consistent with unit 1. `normalizeNotes` wrapping `trim()` is a
  one-line indirection but it documents the parse-vs-write asymmetry; keep it.
- **Anti-drift** — **pass.** No backend, no DB, no API, no premature abstraction. Editing name and
  strength alongside notes is the simpler thing that meets the bar, not sophistication.

---

## Step 3 — Where a subtle bug would hide, and what I found there

1. **The `notes`-absent hole in `parsePin` (`src/domain/pin.ts:65-73`)** — the builder's own first
   suspect. I tried to widen it: non-string `notes` of four shapes all still throw; a truncated write
   cannot produce a missing key because `JSON.parse` fails first; a real unit-1 record loads with no
   banner and the first save upgrades it in place (verified end-to-end in the live DOM). **Clean.**
2. **Draft state vs. selection (`src/App.tsx:126-134`, `src/components/PinEditor.tsx:27-29`)** — the
   place where notes could land on the wrong lead. Correct today because of `key={selectedPin.id}`.
   I removed that one prop in a /tmp copy and the app happily wrote pin A's notes, name and strength
   onto pin B, with the suite still fully green. The behavior is right; the *guard* is unprotected.
3. **The whole-list write in `handleSaveEdits` (`src/App.tsx:93-94`)** — `replacePin(pins, …)` operates
   on the list captured at load time and then rewrites the entire key. I looked for a way to make that
   stale and found one that needs no exotic setup: a second tab. Reproduced pin loss (Finding 1).

---

## Step 4 — Findings

**[MAJOR] A save from a second tab silently deletes pins added in another tab** ·
`src/App.tsx:93-94` (and the same shape at `:53-54`)
- What's wrong: `handleSaveEdits` builds `next` from the in-memory `pins` captured when *this* tab
  loaded, then `savePins` overwrites the whole `restaurant-map.pins.v1` key. Nothing re-reads the store
  before writing and nothing listens for the `storage` event, so a tab holding a stale list silently
  destroys everything written since it loaded.
- How confirmed: **reproduced in the jsdom harness.** Two Apps mounted on one `localStorage`. Tab A
  adds "Added in tab A" → store holds 2 pins. Tab B (loaded before that) edits a note on the original
  pin and saves → hint reads **"Saved."**, store now holds **1 pin**: `["Joe's Diner"]`. "Added in tab A"
  is gone, with no error and no banner.
- Consequence: permanent, silent loss of a lead and its notes — precisely the "never silently drop
  pins" law in `CLAUDE.md` #3. Opening `localhost:5173` twice is an ordinary thing to do, and unit 2
  makes it likelier because the app is now something you sit inside writing prose. The failure is
  invisible until a reload much later.
- Minimal fix: make both writes read-modify-write — `const current = loadPins(storage); savePins(storage,
  replacePin(current, updatePin(selectedPin, edits)))` (and `[...loadPins(storage), created]` in
  `handleMapClick`), with the existing try/catch surfacing a `PinStoreError` if the store went bad
  meanwhile. Optionally add `window.addEventListener('storage', …)` to refresh `pins`.
- Confidence: **high** (reproduced, deterministic). Pre-existing in kind from unit 1's add path; this
  unit adds a second, more frequently used instance of it.

**[MAJOR] Nothing automated defends the unit's highest-risk guard — the whole UI layer is untested** ·
`vite.config.ts:10`, `src/App.tsx:129-131`, all three test files
- What's wrong: the 17 new tests stop at the domain/storage boundary. No test renders `PinEditor`,
  `App` or `MapView`; `grep` finds those names only in comments in `pinStore.test.ts:103,152`. The
  properties this unit actually invented — the `key` remount, save-then-commit, marker-click→select,
  notes in the popup — have zero mechanical protection. `.claude/rules/00-process.md` ("Prose is not
  mechanism") requires a control to be auto-invoked and **self-proving**; a comment plus a manual Chrome
  session is neither. Aggravating: `include: ['src/**/*.test.ts']` does not match `.tsx`, so the first
  component test someone adds as `PinEditor.test.tsx` will silently never run.
- How confirmed: **planted-regression test.** I copied `App.tsx` to /tmp, deleted only
  `key={selectedPin.id}`, rebuilt, and ran the same script against both bundles. Shipped: "no leak".
  Key removed: typing on pin Alpha then clicking pin Beta showed Alpha's draft under Beta, and saving
  wrote `{"id":"b","name":"Alpha","strength":"strong","notes":"UNSAVED TEXT TYPED ON ALPHA"}` — one
  lead's visit notes silently overwriting another's. The repo's suite is 32/32 green in that world.
  I also disproved the reason unit 1's review gave for skipping this ("jsdom render of Leaflet is
  unreliable"): real Leaflet, real markers and real marker clicks all work under jsdom — my harness ran
  ~30 assertions green in about a second.
- Consequence: today's behavior is correct, so this is a defense gap rather than a live bug — but it is
  the second consecutive unit shipping its riskiest logic with manual-only verification, and the blast
  radius is now "notes attached to the wrong restaurant", which is unrecoverable and easy not to notice.
- Minimal fix: `npm i -D jsdom`, change the glob to `include: ['src/**/*.test.{ts,tsx}']`, add
  `environmentMatchGlobs` (or a per-file `// @vitest-environment jsdom`), and add **two** tests:
  (a) render `PinEditor` for pin A, type, re-render with pin B under the same parent, assert the
  textarea shows B's notes; (b) render `App` with a seeded store, click a marker, type, save, unmount,
  remount, assert the notes came back. Both are a few lines each.
- Confidence: **high** (absence directly observable; regression demonstrated by running).

**[MINOR] One add after a corrupt read permanently destroys every stored lead, notes included — no
backup, no undo** · `src/App.tsx:54` + `src/storage/pinStore.ts:54-56`; banner text `src/App.tsx:113-118`
- What's wrong: on a corrupt store the app starts empty and keeps the bytes (good). But the editor is
  unreachable with zero pins, so the only available action is "add a pin", and the first add
  `setItem`s a one-element array over the top. Unit 1's review filed this as a NIT with the explicit
  deferral *"none required this unit; note it when notes/editing land"* — notes have now landed and it
  was not picked up.
- How confirmed: **reproduced.** Store seeded with three leads (one with a `strength: 'faled'` typo) →
  banner `"stored data contains an invalid pin"`, 0 markers, editor unreachable. One add later the key
  holds only the new pin, `"six months of visit notes"` is unrecoverable, and `Object.keys(localStorage)`
  is still just `["restaurant-map.pins.v1"]` — no backup was taken.
- Consequence: the data now at stake is free-form prose that cannot be reconstructed from memory. The
  banner warns, but a single normal action executes the destruction irreversibly.
- Minimal fix: in the `catch` in `loadPins`'s caller (or in `savePins` when `loadError` is set), copy
  the raw string to `restaurant-map.pins.v1.corrupt-<timestamp>` before the first overwrite, and say so
  in the banner ("your unreadable data was backed up to …").
- Confidence: high (reproduced).

**[MINOR] "Done" silently discards unsaved notes, and its label invites exactly that** ·
`src/components/PinEditor.tsx:88-90`, `src/App.tsx:133`
- What's wrong: `onClose` sets `selectedPinId = null`, unmounting the editor and dropping the draft with
  no prompt and no trace. The button sits immediately beside "Save changes" and is labelled **"Done"** —
  a commit verb. A user who types three paragraphs and presses Done loses them. The same silent discard
  happens on clicking another marker (easy to do by accident on a dense map).
- How confirmed: by code (draft is `useState` in a component that unmounts) and by the harness — after
  Done, the add form returns and no draft survives anywhere.
- Consequence: the only place in the app where a user can lose typed work. The build note accepts the
  no-confirm trade-off, which is defensible for a single-user tool; the *label* is not part of that
  trade-off.
- Minimal fix (cheapest first): rename the button to "Close" and, when `dirty`, either label it
  "Discard changes" or gate it behind `window.confirm`. Even just showing the "Unsaved changes." hint in
  a warning color would help.
- Confidence: high on the behavior; medium on how often it bites.

**[MINOR] Duplicate ids in the store make an edit land on a different pin than the one clicked** ·
`src/domain/pin.ts:143-151`, `src/storage/pinStore.ts:29-51`, `src/App.tsx:26`
- What's wrong: neither `loadPins` nor `parsePin` checks id uniqueness. `pins.find` and
  `replacePin`'s `findIndex` both take the *first* match, so with two records sharing an id, clicking
  the second marker edits the first record.
- How confirmed: **reproduced.** Store with two pins both `id: 'dup'` → clicking marker #2 opened pin
  "A" in the editor; saving wrote the note onto record #1 (`["edited via the second marker","B notes"]`);
  React logged "Encountered two children with the same key"; **both** markers wore the selection ring.
- Consequence: notes silently written to the wrong lead. Reachable in practice only via a hand-edited or
  merged store (`crypto.randomUUID` makes collisions negligible; the `pin-${Date.now()}-${n}` fallback
  needs a non-secure context *and* a same-millisecond collision across page loads), which is why this is
  MINOR rather than MAJOR.
- Minimal fix: in `loadPins`, throw `PinStoreError('stored data contains duplicate pin ids')` after the
  map — one `new Set(pins.map(p => p.id)).size !== pins.length` check, and it fails loud like everything
  else there.
- Confidence: high (reproduced).

**[MINOR] "The product DONE-WHEN is covered end to end" overstates it: the map always opens over New
York** · `CLAUDE.md` (Current status, this diff) vs `src/components/MapView.tsx:47`
- What's wrong: `center={[40.7128, -74.006]} zoom={12}` is hardcoded and the map view is not persisted
  and never fitted to the pins. For a user whose leads are not in NYC, every reload opens on an empty
  patch of Manhattan; with no list view, no search and no filter (all deliberately deferred), the leads
  exist but are not visible "at a glance" — which is `CLAUDE.md`'s "Winning" sentence.
- How confirmed: read `MapView` (no `bounds`/`fitBounds`/`whenReady` anywhere); confirmed in the harness
  that pins at lat/lng 1,1 and 2,2 render as markers while the viewport sits over NYC.
- Consequence: the literal DONE-WHEN checklist *is* met (I verified each item), so this is not a blocker
  — but the charter edit in this diff claims more than the code delivers, and the gap will be invisible
  to the builder, whose test data is in NYC.
- Minimal fix: either soften the CLAUDE.md sentence, or add the ~4-line `map.fitBounds(pins)` on mount
  when `pins.length > 0` (still no view persistence, still no drift).
- Confidence: high.

**[NIT] `parsePin` accepts `name: ''` but `updatePin` refuses to save it, stranding such a pin** ·
`src/domain/pin.ts:46-48` vs `:121-124`
- A stored record with an empty name loads and renders a nameless marker, but its editor opens with
  Save disabled ("A lead needs a name to be saved."), so the notes cannot be edited until the user
  invents a name. Harmless today (nothing in the app can write an empty name) but it is the one place
  where the read boundary is looser than the write boundary. Fix: require a non-empty `name` in
  `parsePin` too, or accept it knowingly and note it. Confidence: high.

**[NIT] The build session left two fixture leads in a browser origin the user may open, and there is no
delete** · `docs/build_notes/Unit 2 …` ("Test-data note")
- "Joe's Diner" and "Taqueria Norte" sit in Chrome's `localhost:5174` store. They are indistinguishable
  from real leads, and this unit deliberately ships no delete, so the only removal path is DevTools:
  `localStorage.removeItem('restaurant-map.pins.v1')` on that origin. Worth doing before the user's
  first real session. Confidence: high.

**[NIT] `pinIcon()` allocates a new `DivIcon` on every render, so every marker's DOM is rebuilt on every
App state change** · `src/components/MapView.tsx:60`
- react-leaflet calls `marker.setIcon` whenever the icon prop's identity changes, which is every render.
  Harmless at this scale (I clicked, saved and re-selected repeatedly with the popup staying open and no
  console errors), and pre-existing from unit 1. If markers ever get numerous, memoize per
  `(strength, selected)`. Confidence: high on the mechanism, low on it ever mattering.

**[NIT] The editor's swatch shows the *saved* strength while the select shows the draft** ·
`src/components/PinEditor.tsx:49-52`
- Arguably correct (it agrees with the map, which also waits for the save) and the "Unsaved changes."
  hint covers it. Flagged only so the choice is deliberate rather than accidental. Confidence: high.

---

## Step 5 — Sign-off

- **VERDICT: Yes** — the unit meets its acceptance criteria. I reproduced the whole bar against the real
  component tree, not the build log: a genuine unit-1 record (no `notes` key) loads with no banner and
  renders green; clicking the pin opens an editor seeded with its name/strength/notes; typed notes plus a
  strength change commit only on Save; the marker recolors to the exact amber `#e8a33d`; the popup reads
  the notes back with `\n` intact; a full unmount/remount from `localStorage` restores notes, strength and
  position; a second pin's editor opens with an empty draft and no leakage; a failed write shows a named
  error and changes nothing. Strength→color stayed total and fill-only under selection. No BLOCKER. The
  two MAJORs are a reproduced silent-data-loss path (multi-tab) and the absence of any mechanical defense
  for the unit's riskiest guard — neither invalidates the delivered feature, both should land before unit 3.
- **TEST + LINT:** `npm test` → **32 passed, 0 failed** (3 files: leadStrength 4, pin 16, pinStore 12).
  `npm run lint` → clean, exit 0. `npm run typecheck` → clean, exit 0. `npm run build` → succeeds, 81
  modules. `npm run dev` → serves HTTP 200. All reproduced by the reviewer; all match the build note.
- **TOP 3 FIXES (priority order):**
  1. Read-modify-write in `handleSaveEdits` and `handleMapClick` (Finding 1) — closes the reproduced
     silent pin-deletion path.
  2. Add `jsdom`, widen the vitest include glob to `.tsx`, and add the two component tests (Finding 2) —
     the planted-regression demo shows exactly what is currently undefended, and the harness proves the
     environment works.
  3. Back up the raw bytes before the first overwrite after a corrupt read (Finding 3) — unit 1's review
     deferred this to *this* unit; notes have made the stakes real.
- **WHAT I COULD NOT VERIFY even after trying:**
  - A real Chrome/WebKit render. My verification ran under jsdom with real Leaflet and real DOM events,
    which exercises the full `Leaflet → eventHandlers.click → handleSelectPin` chain, but not painting:
    `white-space: pre-wrap` on `.popup__notes` and the selection ring's box-shadow are confirmed as
    *rules and applied classes*, not as computed pixels (the builder reports computing `pre-wrap` in
    Chrome; the rule at `src/index.css:265-273` supports that).
  - `npm install` from a genuinely clean checkout — `node_modules` was already present, so I verified
    build/dev/test against the installed tree rather than a fresh resolve.
  - The build note's Chrome session itself (including the claim that steps 5–7 were driven by dispatched
    events after screenshot capture broke). I did not take it on trust; I re-derived every behavioral
    claim in it independently, and all of them held.
  - Real quota exhaustion and a browser with `localStorage` access disabled — I simulated the throw at
    `Storage.prototype.setItem` (handled correctly) but did not test a browser that throws on *reading*
    `window.localStorage` at module scope (`src/App.tsx:10`), which would still take the app down before
    any error boundary exists.
- **SINGLE BIGGEST RISK:** a stale whole-list write — a second tab (or any long-lived stale `pins`)
  saving one note over the entire store and deleting leads that were added elsewhere, reporting "Saved."
  the whole time.
