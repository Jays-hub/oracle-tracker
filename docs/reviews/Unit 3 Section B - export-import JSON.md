# Review — Unit 3 Section B: export / import JSON

Adversarial, cold-context review. Read-only over the repo. Everything below marked "confirmed" was
confirmed by **running** it — either the repo's own suite in place, or a full copy of the repo at
`/tmp/rmrev/mut` (for planted-regression / mutation runs), or reviewer-written probe tests executed
against the real `src/` via a config in `/private/tmp/.../scratchpad`. The repo tree was not modified:
`git status --short` is byte-identical before and after this review (`dist/` is gitignored; `npm run
build` was run).

**Scope reviewed:** the uncommitted working-tree delta on top of `1224972` —
`src/storage/importExport.ts`, `src/storage/importExport.test.ts`, `src/components/ImportExport.tsx`,
`src/components/ImportExport.test.tsx` (untracked, read directly) plus `git diff` of `src/App.tsx`,
`src/App.test.tsx`, `src/storage/pinStore.ts`, `src/test/setup.ts`, `src/index.css`,
`docs/progress_log.md`. Spec: `docs/roadmap.md` §"Unit 3 — Section B"; ultimate bar: `CLAUDE.md`
standing order #3 (DONE-WHEN) and the "Winning" sentence; process law: `.claude/rules/00-process.md`.

## Step 0 — What this unit had to deliver (my words)

- **Export**: one sidebar control writes every pin — position, name, strength, notes — to a dated JSON
  file, purely locally (`Blob` + `URL.createObjectURL`, no upload).
- **Import**: `<input type="file">` + `FileReader`; the file's pins become the pins on the map and in
  `localStorage`, as a **whole-store replace** (settled in the roadmap, not revisited here), behind an
  explicit confirmation naming the counts.
- **Round-trip is lossless and test-verified**: export → wipe → import the same file → byte-identical
  store, notes and line breaks intact.
- **Boundary discipline**: every record through `parsePin`; any invalid record, duplicate id, or
  non-array payload rejects the *whole file* with a named error and leaves the store untouched. Legacy
  (pre-`notes`) records import as `notes: ''`.
- **No silent destruction**: snapshot the current store aside before replacing (same mechanism as
  `backupCorruptStore`), tell the user where it went, and treat a failed snapshot as a hard abort.

### Spec conflict I have to name before anything else

`docs/roadmap.md` §Section A says **"Fit on mount only. It must not re-fit on every save."**
§Section B says **"the pins in it become the pins on the map."** Nothing anywhere resolves which of
those governs a *confirmed whole-store replace*, and the build notes never raise the question. The code
silently takes the Section A reading, and the observable result is that the flagship scenario ("new
laptop, restore my backup") ends with a success banner over a map showing nothing. See **F1** — I am
treating this as an unresolved spec conflict plus a real defect, not as a matter of taste.

---

## Step 2 — Hunt list

| Area | Verdict | Evidence |
| --- | --- | --- |
| Core logic: `parseImportPayload` / `importPins` | **pass** (verified-by-running) | 92/92 green; 5 planted regressions all caught (below) |
| Acceptance bar judged by the real criterion, not a proxy | **concern** | round-trip bullet is genuinely tested with `toBe` on `serializePins` output; but "the pins become the pins on the map" is satisfied only in the DOM layer, not in the viewport — F1 |
| "Replace, not merge" structural law | **verified-by-running** | planted a real merge-by-id in `importPins` → 2 tests fail (`importExport.test.ts`, `App.test.tsx`) |
| No partial import / whole-file rejection | **verified-by-running** | planted "drop invalid records" → 3 tests fail across all three files |
| Duplicate-id rejection | **verified-by-running** | planted removal → 2 tests fail |
| Pre-import snapshot + hard abort | **verified-by-running** | planted "skip the backup" → 2 tests fail; snapshot-write failure leaves `STORAGE_KEY` untouched (tested) |
| Split / leakage integrity | **n/a** | no learned model, no fitted transform, no eval set in this unit |
| Reproducibility / determinism | **pass** | `exportFilename` and `importPins` take an injectable `now`; `serializePins` fixes field order; no hardcoded absolute paths; no order dependence found (suite re-run repeatedly, stable) |
| Data / boundary integrity (null, NaN, types, same transform in and out) | **pass** | export and import both go through `serializePins` / `parsePin`; legacy no-`notes` record → `''` tested; non-array, bad JSON, bad `strength` all rejected |
| **Domain: lead-strength → colour is total and fixed** | **pass** (verified) | imported pins can only carry a `LeadStrength` (`parsePin` → `isLeadStrength`); `colorForStrength` is `satisfies Record<LeadStrength,string>` and throws rather than defaulting. No path in this unit can produce an unmapped strength or a default colour |
| **Domain: persistence lossless + durable, degrades or fails loud** | **concern** | round-trip byte-identity verified; corrupt-store import still hard-aborts correctly; but the failure *message* is factually wrong (F3) and backup keys grow without bound with no way to remove them (F4, F5) |
| **Domain: local-first / standalone** | **pass** (verified) | `grep` for `fetch(`/`XMLHttpRequest`/`axios` over `src/` → nothing; only URLs in non-test source are the OSM tile layer + attribution. Import/export is `File`/`FileReader`/`Blob` only |
| Tests meaningful (would they fail on the bug I fear?) | **concern** | 8 mutations planted: 6 caught, 2 not — the whole browser-download mechanic is untested (F6) and one test is vacuous (F7) |
| Error handling / friendly named errors | **concern** | named errors throughout, but one names the wrong condition (F3) and one throws away the specific reason (F10) |
| Anti-drift / over-engineering | **pass** | no backend, no sync, no merge UI, no scheduled backups; `backupCorruptStore` reused rather than reimplemented; the one new abstraction (`ImportError`) is justified — see note under F3 |
| Structure / style | **pass, minor nits** | F11 |

Suite as found: **92 passed / 8 files**, lint clean, `tsc --noEmit` clean, `npm run build` succeeds —
matching the progress-log claim (I re-ran all four rather than trusting it).

---

## Step 3 — Where a subtle bug would hide here, and what I found when I looked

1. **The seam between "the store changed wholesale" and "the map was set up once."** This is the
   riskiest spot in the unit, because Section A deliberately froze the view at mount and Section B is
   the one feature that can replace the entire dataset afterwards. Looked deliberately; found **F1**
   (confirmed by measuring rendered marker positions: ~189,000 px outside an 800×600 viewport after a
   confirmed import, on-screen after a reload).
2. **Counts that come from React state while the bytes come from storage.** The builder documents the
   deliberate decision not to re-read on write (correct), but the *confirmation text* silently inherits
   that decision, and the confirmation is the roadmap's only safety gate for a destructive action.
   Found **F2** (confirmed: store holds 3, confirmation says "1 saved lead", 3 destroyed).
3. **A function reused across two callers whose error message names only the first caller.** The
   docstring was widened for import; the thrown string was not. Found **F3** (confirmed by forcing a
   quota failure and reading the banner the user actually sees).

---

## Step 4 — Findings

### F1 — [MAJOR] A confirmed import leaves the map parked where it was; the imported pins are off-screen until a reload
`src/App.tsx:70` (`setInitialView` written once, in the mount effect) · `src/App.tsx:194` (import sets
`pins` but nothing re-derives the view) · `src/App.tsx:276-284` (MapView mounted once) ·
`src/components/MapView.tsx:58-77` (`MapContainer` reads `bounds`/`center` only at creation).

**What's wrong.** `handleImportReplace` replaces `pins` but `initialView` — and therefore Leaflet's
view — is fixed at mount. Import the backup you exported on your old laptop into a fresh browser and
you get: banner "Imported 3 leads…", sidebar "3 leads on the map", and a map still sitting on the
default lower-Manhattan view with every restored pin thousands of pixels outside the viewport. This is
exactly the scenario Section B exists for, and the "at a glance I can see where my leads sit" sentence
in `CLAUDE.md` is the project's stated definition of winning.

**How I confirmed it.** Probe test against the real `App`, reading the rendered marker positions off
Leaflet (`DomUtil.getPosition`, the same technique `App.test.tsx` already uses):
- fresh browser (0 pins → default view) → import 2 Lisbon pins → positions `{x: 189338, y: 7839}` and
  `{x: 189307, y: 7735}` in an 800×600 viewport.
- existing NYC pins → import 2 Lisbon pins → `{x: 756198, y: 30410}`, `{x: 756074, y: 29996}`.
- same file, then `cleanup()` + re-render (a page reload) → `{x: 462, y: 507}`, `{x: 338, y: 93}` —
  on-screen. So the fit is correct; it just never runs for the one action that swaps the whole dataset.

**Consequence.** The restore flow's success state is indistinguishable from "nothing imported" until
the user reloads or pans blindly. No data is lost, and a reload fixes it — that is why this is MAJOR
and not BLOCKER, and why the literal Section B bullet ("the pins in it become the pins on the map")
is arguably satisfied. It is still the unit's biggest user-visible hole.

**Minimal fix.** Decide the A-vs-B conflict explicitly and record it. Cheapest code that honours both:
in `handleImportReplace`, after a successful write, `setInitialView(initialViewForPins(imported))` and
force a remount of `MapView` (e.g. `key={initialViewKey}`) — an import is a user-confirmed wholesale
replace, not the incremental save Section A's rule was written to protect. If you'd rather not remount
Leaflet, the honest fallback is one clause in the existing info banner ("reload to see them"), which is
worse but at least not silent.

**Confidence:** high (measured).

### F2 — [MAJOR] The destructive confirmation, and the banner after it, count in-memory pins — not the leads actually about to be destroyed
`src/components/ImportExport.tsx:67-68` (`pins.length` in the confirm text) · `src/App.tsx:183`
(`previousCount = pins.length`).

**What's wrong.** The roadmap makes the confirmation the sole gate on a destructive replace
("replace 12 saved leads with the 9 in this file?"). Both counts in that sentence, and the count in the
post-import banner, are read from React state captured at load, not from the store that is about to be
overwritten. The build notes justify skipping `storedPinsForWrite()` for the *write* (I agree with that
reasoning), but the *count* is a separate decision that was inherited rather than made.

**How I confirmed it.** Probe: load the app with 1 pin, then write 3 pins to `localStorage`
(another tab), then import a 1-pin file. Confirmation rendered
`"Replace 1 saved lead with the 1 lead in “leads.json”?"`; after confirming, the store held exactly
`['g']` — three leads destroyed — and the banner said *"Imported 1 lead, replacing 1 previously
saved."* Second probe: with a corrupt (unreadable but non-empty) store, the confirmation reads
`"Replace 0 saved leads with the 1 lead…"` even though the store holds bytes that are about to be
overwritten.

**Consequence.** The user approves destroying N and destroys M > N, then is told M = N. The pre-import
snapshot does make it recoverable, but nothing tells them there is anything to recover — the banner
actively says otherwise. This is the project's own established standard for staleness (unit 2 added
`storedPinsForWrite()` precisely because a stale tab must not silently clobber another tab's data).

**Minimal fix.** Count from storage at confirm time: pass a `savedCount` into `ImportExport` (or have
it call a `countStoredPins()` helper) derived from `loadPins(storage)` inside a `try`, falling back to
wording like "replace the saved data (currently unreadable)" when it throws. Same value for
`previousCount` in the banner.

**Confidence:** high (measured).

### F3 — [MINOR] A failed pre-import snapshot tells the user their saved data is unreadable, when it isn't
`src/storage/pinStore.ts:91` (`'could not back up the unreadable saved data'`) reached via
`src/storage/importExport.ts:74` and reported at `src/App.tsx:188-190`.

**What's wrong.** `backupCorruptStore`'s docstring was widened for its new import caller
(`git diff src/storage/pinStore.ts`), but the thrown message was not. On the import path the stored
bytes are perfectly good — the only thing that failed is the copy (typically quota).

**How I confirmed it.** Probe: made `setItem` throw `QuotaExceededError`, then imported a valid file.
The banner the user sees, verbatim:
`"Couldn’t import: Pin store: could not back up the unreadable saved data. Nothing was changed."`

**Consequence.** At the exact moment the user's store is full and they most need accurate information,
the app tells them their data is corrupt. The plausible next action — "clear it and start fresh" — is
the one that loses the notes.

**Minimal fix.** Make the message caller-neutral (`'could not copy the saved data aside'`) or take the
message as a parameter. (Aside, adjudicating the builder's stated open question: keeping `ImportError`
separate from `PinStoreError` was the right call — the `"Pin store: "` prefix leaking into an import
banner above is exactly the mismatch a shared class would have made permanent.)

**Confidence:** high (measured).

### F4 — [MINOR] Pre-import snapshots accumulate without bound, and the app can never remove one
`src/storage/importExport.ts:74` · `src/storage/pinStore.ts:79-96` · `src/storage/pinStore.ts:6-9`
(`StorageLike` exposes only `getItem`/`setItem`).

**What's wrong.** Every import writes another full copy of the store under a new timestamped key.
Nothing ever prunes them, nothing lists them, and no code path in the app can delete one — the storage
interface has no `removeItem` and `removeItem` appears nowhere in `src/` outside a test fake. Import
also roughly doubles peak usage at the moment it runs (copy + write), against a ~5 MB origin budget.

**How I confirmed it.** Probe: three consecutive imports left
`restaurant-map.pins.v1` plus three `restaurant-map.pins.v1.corrupt-<ts>` keys. A separate probe
(import onto an already-corrupt store) produced **two** copies of the same corrupt bytes — one from the
mount-time recovery, one from `importPins`.

**Consequence.** A user who restores backups regularly walks toward quota exhaustion; the terminal
state is that the *snapshot* fails, import correctly hard-aborts, and they are shown F3's misleading
message with no in-app way to free space.

**Minimal fix.** Either prune to the most recent N snapshots (needs `removeItem` on `StorageLike`), or
— cheaper and honest for this unit — say in the info banner that old snapshots can be cleared from
devtools, and log a finding-level note in the roadmap that pruning is owed.

**Confidence:** high (measured for accumulation; quota endpoint is arithmetic, not measured).

### F5 — [MINOR] Perfectly good pre-import data is filed under a key that says `corrupt`
`src/storage/pinStore.ts:65` (`CORRUPT_BACKUP_PREFIX = 'restaurant-map.pins.v1.corrupt-'`), surfaced to
the user at `src/App.tsx:204`.

**What's wrong.** The banner tells the user their previous data was backed up to
`"restaurant-map.pins.v1.corrupt-2026-08-04T…"`. That key is now the *only* undo for a replace, and its
name asserts the data in it is corrupt. The build note argues renaming would be churn across the
corrupt-read path; the cost of not renaming lands on the user who is deciding whether that key is junk.

**How I confirmed it.** Read the emitted banner text in the probe run (quoted in F2/F4 output).

**Consequence.** A user tidying `localStorage` deletes their only undo because the app told them it was
corrupt. Low probability, unrecoverable outcome.

**Minimal fix.** Rename the prefix to something neutral (`…​.backup-`) in one place and update the two
call sites + tests, or add a second exported prefix for import snapshots.

**Confidence:** medium-high (the naming is fact; the user's reaction is judgement).

### F6 — [MINOR] The entire browser-download mechanic is untested — including the dated filename the spec asks for
`src/components/ImportExport.tsx:27-37` (`a.download` at :32, `removeChild` + `revokeObjectURL` at
:35-36) · `src/components/ImportExport.test.tsx:36-46`.

**What's wrong.** The export test asserts only the Blob's type and content. Nothing asserts the anchor
that actually downloads it. Spec bullet: *"Filename carries the date."* `exportFilename` is unit-tested,
but nothing checks that it reaches `a.download`.

**How I confirmed it.** Mutation runs in the repo copy: deleting `a.download = exportFilename()` →
**92/92 still green**. Deleting `document.body.removeChild(a); URL.revokeObjectURL(url);` → **92/92
still green**. A separate probe confirms the current code is *correct* (anchor at click time:
`{download: 'restaurant-map-2026-08-04.json', href: 'blob:mock-1'}`) — so this is a test gap, not a
live bug.

**Consequence.** The one line whose loss turns "save a file" into "navigate away to a blob" is
unguarded; only the builder's manual Chrome pass covers it, and that doesn't run again.

**Minimal fix.** In the component test, stub `HTMLAnchorElement.prototype.click`, capture `this.download`
and `this.href`, and assert the filename matches `/^restaurant-map-\d{4}-\d{2}-\d{2}\.json$/` — that is
what I did in the probe, ~6 lines.

**Confidence:** high (measured, both directions).

### F7 — [MINOR] The "same file can be retried" test cannot fail
`src/components/ImportExport.test.tsx:117-121` guarding `src/components/ImportExport.tsx:44`.

**What's wrong.** The test selects a file and asserts `fileInput().value === ''`. Under jsdom,
`fireEvent.change(input, { target: { files: [file] } })` never sets `value` in the first place, so the
assertion holds whether or not the component resets it.

**How I confirmed it.** Mutation: deleted `e.target.value = '';` → **92/92 still green**, including that
test.

**Consequence.** A real browser *does* set `value`, and without the reset, re-picking the same file
after fixing it fires no `change` event — the file becomes unretryable until the user picks something
else first. That behaviour is currently defended by nothing.

**Minimal fix.** Either drop the vacuous assertion and mark the reset "browser-verified only" alongside
the download mechanic, or make the fixture set `value` (via `Object.defineProperty` on the input) so
the assertion has something to observe. Do not leave a test whose name claims coverage it doesn't have
— `.claude/rules/00-process.md` "prose is not mechanism" applies to test names too.

**Confidence:** high (measured).

### F8 — [MINOR] A stale "Imported N leads" success banner stays on screen next to a later import failure
`src/App.tsx:187-192` (the catch sets `saveError` and clears nothing).

**How I confirmed it.** Probe: successful import, then a second import with `setItem` throwing. Both
banners rendered simultaneously — `role="status"`: *"Imported 1 lead, replacing 1 previously saved.
Your previous data was backed up to …"* and `role="alert"`: *"Couldn’t import: … Nothing was changed."*

**Consequence.** The two banners contradict each other about whether anything was imported, at the one
moment the user needs to know exactly what state their store is in.

**Minimal fix.** `setImportInfo(null)` in the catch block (the other three handlers already clear it).

**Confidence:** high (measured).

### F9 — [MINOR] An armed placement survives an import, so the first click after a restore writes a phantom pin into the restored store
`src/App.tsx:182-208` (`armed` and the draft `name` are untouched by `handleImportReplace`; contrast
`handleSelectPin` at :135 which clears `armed`).

**How I confirmed it.** Probe: typed "Half-typed lead", clicked *Place on map*, then imported a 1-pin
backup and confirmed. The pane class stayed `map-pane map-pane--armed`; one click on the map produced
2 markers and a store of `[{"id":"g",…"Gamma"…},{"id":"df1758ef-…","name":"Half-typed lead",…}]`.

**Consequence.** The just-restored backup silently gains a lead the user didn't intend to add, and it's
persisted immediately. Likelihood is raised by F1: after an import the user's natural move is to click
and pan around the map hunting for the pins that didn't appear.

**Minimal fix.** `setArmed(false); setName('');` in `handleImportReplace`, matching `handleSelectPin`.

**Confidence:** high (measured).

### F10 — [NIT] A rejected file never tells the user *why* it was rejected
`src/storage/importExport.ts:38` — `parsePin`'s messages are specific
(`strength must be one of strong|weak|failed, got "lukewarm"`) and are preserved in `cause`, but the UI
only ever shows `"Import: the file contains an invalid pin"` (`ImportExport.tsx:55`). For a local-first
tool whose JSON the owner may hand-edit, surfacing `cause.message` (and ideally the record index) turns
an unfixable rejection into a fixable one. Confidence: high (read + confirmed in probe output).

### F11 — [NIT] Two small ones
- The second of two files picked before the first `FileReader` resolves has its parse error silently
  swallowed: the panel shows the confirmation for the *earlier* file and no error at all. Confirmed by
  probe (picked `good.json` then `bad.json` in the same tick → panel read
  `"Replace 1 saved lead with the 1 lead in “good.json”?"`, no `array` error anywhere). Requires two
  file-dialog interactions inside one macrotask, so it is near-unreachable by a human; a latest-request
  token in `handleFileSelected` would close it. `src/components/ImportExport.tsx:49-59`.
- The destructive **Replace** button is styled identically to the primary **Export as JSON** button
  (`src/index.css`, `.import-export button` — same blue); only `.import-export__cancel` is
  differentiated. The confirmation's only destructive affordance is its prose.

---

## Step 5 — Sign-off

- **VERDICT:** **Yes, with reservations** — every literal "done when" bullet in `docs/roadmap.md`
  §"Unit 3 — Section B" is implemented and genuinely tested (round-trip byte-identity, whole-file
  rejection, duplicate ids, non-array, legacy records, snapshot-then-replace, hard abort — each
  confirmed by planting the corresponding regression and watching the suite fail). It does **not**
  fully meet `CLAUDE.md`'s "Winning" bar in the flagship restore scenario: F1 means the pins you just
  restored are off-screen until you reload, and F2 means the confirmation can understate what it is
  about to destroy. Both are fixable in a handful of lines; neither loses data outright.
- **TEST + LINT:** ran myself — `npm test`: **92 passed / 92, 8 files** (jsdom logs
  `Not implemented: navigation to another Document` to stderr, expected, not a failure).
  `npm run lint`: clean, 0 problems. `npm run typecheck` (`tsc --noEmit`): clean.
  `npm run build`: succeeds. Mutation testing in a repo copy: **6 of 8 planted defects caught, 2 not**
  (F6, F7).
- **TOP 3 FIXES**, in priority order:
  1. **F1** — decide and record the Section A / Section B conflict, then make a confirmed import land
     the map on the imported pins (or, minimum, say "reload to see them" in the banner).
  2. **F2** — count *saved* leads from storage, not from React state, in both the confirmation and the
     post-import banner.
  3. **F3 + F8** — stop telling the user their good data is "unreadable" when a snapshot fails, and
     clear the stale success banner in the failure path. (Then **F6/F7**: the two mutations that got
     through.)
- **WHAT I COULD NOT VERIFY** even after trying:
  - The real browser download (`blob:` URL → anchor click → file on disk) and the real file-picker
    `change`-event semantics that make `e.target.value = ''` necessary. jsdom cannot exercise either; I
    verified everything up to the anchor's attributes at click time and no further. The builder's Chrome
    pass is the only evidence for the last hop, and it is not re-runnable.
  - Actual `localStorage` quota behaviour (F4's endpoint). I forced `setItem` to throw to see the
    handling, but never filled a real 5 MB origin.
  - Whether the two "not caught" mutations (F6, F7) correspond to defects the *builder* would have
    caught by hand — I can only report that the suite would not.
- **SINGLE BIGGEST RISK:** the app can report a completely successful restore — banner, count, markers
  in the DOM — while the user is staring at an empty map and the confirmation they approved understated
  how many leads it destroyed; both failures look exactly like "it worked."
