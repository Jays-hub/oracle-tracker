# Review — uncommitted working tree, 2026-08-06: `pinIcon` memoization + `parsePin` empty-name gap

Reviewer: cold-context adversarial reviewer, read-only over the repo (`.claude/hooks/enforce_agent_write_scope.py`).
Diff base: uncommitted working tree on detached HEAD `1eb8f98`. Scope taken from `git diff` over the
five modified files (`docs/progress_log.md`, `docs/roadmap.md`, `src/components/MapView.tsx`,
`src/domain/pin.ts`, `src/domain/pin.test.ts`). No `docs/build_notes/` entry exists for this work;
intent inferred from the code and the 2026-08-06 `docs/progress_log.md` entry, which I read directly.

Everything below marked "verified-by-running" was executed. Because I may not write to the repo, all
experiments ran in a byte-identical sandbox copy at
`/private/tmp/.../scratchpad/sandbox` (`diff -r` against `src/` clean before each run).

## Step 0 — What this had to deliver ("done when")

- Close **NIT #1** from `docs/reviews/Unit 2 - notes + editing per pin.md:268` — "`pinIcon()` allocates a
  new `DivIcon` on every render… memoize per `(strength, selected)`."
- Close **NIT #2** from the same review at `:253` — "`parsePin` accepts `name: ''` but `updatePin`
  refuses to save it, stranding such a pin. Fix: require a non-empty `name` in `parsePin` too, **or
  accept it knowingly and note it**." (Both options were sanctioned; the builder chose the first.)
- Not regress `CLAUDE.md` #3: lead-strength→colour rendering (strong=green / weak=amber / failed=red),
  lossless-and-durable `localStorage` persistence across a full reload, and the existing green suite.
- Stay local-first (`CLAUDE.md` #2): no backend/DB/server/accounts/external geo API.
- Remove both items from `docs/roadmap.md`'s "Later" list.

**Spec conflict flagged up front:** the builder's own log declares this work exempt from `/review`
("Not a unit (mechanical/NIT-level…), so no new `/review` cycle"). `.claude/rules/00-process.md`
§"Scope of a unit" defines a unit as "any new module, feature, data transform, or **decision-logic
change**", and exempts only "mechanical edits already specified and understood (typos, formatting, a
rename the user requested)". Tightening the validation predicate that gates **both** `loadPins` and
`parseImportPayload` is decision logic at the persistence boundary, not a typo. The exemption was
self-granted under a rule that does not grant it. See F4.

---

## Step 2 — Hunt list

| Area | Verdict |
|---|---|
| Core logic — cache key totality, off-by-one, inverted conditions | **verified-by-running** — key `${strength}:${selected}` over a fixed 3×2 space; no separator collision (no strength contains `:`); `colorForStrength` throws *before* `iconCache.set`, so a bad value can never poison the cache. |
| Acceptance bar — NIT #1 actually closed | **verified-by-running (pass)** — `react-leaflet/lib/Marker.js:13` calls `setIcon` only on `props.icon !== prevProps.icon`. Spy on `L.Marker.prototype.setIcon`: **0 calls** across two no-op re-renders of a 4-marker map. Previously it fired once per marker per render. |
| Acceptance bar — NIT #2 actually closed | **verified-by-running (pass, with a caveat)** — `parsePin` now rejects `''` and `'   '`. But the review offered "require it **or** accept it knowingly and note it"; the builder took the stricter branch and did not note the resulting behaviour change anywhere. See F1. |
| Lead-strength → colour, total & fixed (`CLAUDE.md` #3) | **verified-by-running (pass)** — rendered 4 pins (2×strong, 1×weak, 1×failed) through the cache: `["rgb(46,158,79)","rgb(232,163,61)","rgb(214,69,69)","rgb(46,158,79)"]`. Two markers sharing one cached `DivIcon` instance each got their own DOM node with the correct green; no blank/default background; correct after full unmount→remount and after a filter round-trip (pin removed then re-added). `STRENGTH_COLORS` is a non-exported module const in `src/domain/leadStrength.ts:16` with no runtime mutation path — cache key space provably bounded at 6, never stale. Builder's assumption confirmed. |
| Persistence lossless & durable (`CLAUDE.md` #3) | **fail (regression, see F1)** — a store containing one empty-name record used to load fully; it now fails the **entire** load. Reproduced both ways. |
| Data / boundary integrity | **concern** — the new rejection is correct in kind but its blast radius (whole store / whole file) and its unactionable error text on the load path are unhandled. F1, F2. |
| Split / leakage integrity | n/a (no learned model or held-out data in this project). |
| Reproducibility | **pass** — no new randomness, no absolute paths, no run-order dependence. `iconCache` is module-scoped; Vitest isolates per file, and I confirmed correctness after remount within a file. |
| Local-first / no network (`CLAUDE.md` #2) | **pass** — diff introduces no fetch/XHR/import of any remote resource. |
| Tests meaningful — would they fail on the bug I fear? | **fail for the MapView half** — planted violation stays green. See F3. **Pass for the pin.ts half** — planted violation fails. |
| Error handling / friendly named errors | **concern** — `InvalidPinError('name must not be empty')` is well-named, but `App.tsx:124` drops `err.cause`, so the user never sees it. F2. |
| Anti-drift / over-engineering | **pass** — a 6-entry `Map` is the simplest thing that closes the NIT; no premature abstraction. |
| Structure / style | **pass (LOW)** — one call site, signature change applied consistently, lint and `tsc` clean. |
| Process law (`.claude/rules/00-process.md`) | **concern** — F4, F5. |

---

## Step 3 — Where a subtle bug would hide (and what I found when I looked)

1. **Sharing one `L.DivIcon` object across several markers.** This is the non-obvious hazard the diff
   creates: before, every marker owned a private icon; now up to N markers hold the *same* object. I
   suspected per-marker state written back onto `icon.options`. I read `leaflet`'s `DivIcon.createIcon`
   (it is a factory — reuses the marker's own `oldIcon` div, never a shared node) and then confirmed
   empirically with 4 markers, 2 of them sharing an icon: distinct DOM nodes, correct colours,
   correct-and-unique selection ring. **No defect.** Note that `options.html` here is a string, not an
   `Element` — had it been an `Element`, sharing would have moved a single node between markers. That
   invariant is now load-bearing and is not written down anywhere.
2. **The cache key.** Correct as written, but it is now the single point of failure for the colour law
   and the selection ring, and nothing tests it. See F3 — I broke it and the suite did not notice.
3. **`parsePin` as a shared boundary.** It gates `loadPins` *and* `parseImportPayload` *and* (per
   `docs/roadmap.md:185`) Unit 6's file-link. Tightening it is a three-consumer change made under a
   one-consumer rationale. See F1.

---

## Step 4 — Findings

**[MAJOR] Tightening `parsePin` converts a single stranded pin into a total, unrecoverable-in-app store
failure, and the change is documented nowhere** · `src/domain/pin.ts:62-64` (blast radius at
`src/storage/pinStore.ts:56-59`, `src/storage/importExport.ts:36-39`)
- What's wrong: `loadPins` maps `parsePin` over the whole array and throws on the first failure, and
  `parseImportPayload` rejects the whole file. A store or backup file containing **one** record with
  `name: ''` (or whitespace-only) now takes down every other pin with it. The progress-log entry frames
  the change purely as closing a NIT and never states that previously-loadable data becomes unloadable.
- How I confirmed it: seeded `restaurant-map.pins.v1` with `[{name:'Alpha Cafe',…}, {name:'',…}]` and
  rendered the real `App` in jsdom, once against the working tree and once against `git show
  HEAD:src/domain/pin.ts`.
  - HEAD: `LOADPINS RESULT: LOADED 2 pins` · `MARKERS RENDERED: 2` · `BANNERS: []`
  - Working tree: `LOADPINS RESULT: Pin store: stored data contains an invalid pin` ·
    `MARKERS RENDERED: 0` · one error banner · a `restaurant-map.pins.v1.corrupt-<ISO>` snapshot written.
  - Import path, working tree: `IMPORT RESULT: Import: the file contains an invalid pin`.
- Consequence: for such a store the `CLAUDE.md` #3 bar "every pin — its position, strength, and notes —
  persist across a full page reload" no longer holds; it held before. Worse, after the failed read
  `storedPinsForWrite()` (`src/App.tsx:155-167`) returns `[]`, so the user's very next "add a pin"
  writes a one-element array over the live key. The real bytes survive only under the corrupt-backup
  key, and there is **no in-app path to restore from a `localStorage` key** — Import reads a *file*.
  Recovery is DevTools-only. Probability is genuinely low (neither `createPin` nor `updatePin` can ever
  emit an empty name, so only a pre-change import of a hand-made file or a manual edit can produce one),
  but the failure is total and silent-until-reload.
- Minimal fix (pick one, don't do all): (a) keep the check and **state the behaviour change explicitly**
  in the progress-log entry, plus a one-line comment at `pin.ts:62` naming the two other consumers; or
  (b) coerce rather than reject — treat a blank stored name as a recoverable "(unnamed lead)" so the pin
  loads and can be renamed, which is closer to "degrade to empty-but-usable" than to a hard fail; or
  (c) take the review's second sanctioned branch and leave `parsePin` permissive, fixing the strand in
  `PinEditor` instead (allow saving notes/strength while the name is blank).
- Confidence: **high** on the mechanism and the reproduction; **medium** on which fix is right — (a) is
  the cheapest and I'd accept it.

**[MAJOR] The corrupt-load banner drops `err.cause`, so this new failure mode is unactionable — while the
import path right next to it already solves exactly this** · `src/App.tsx:124` (and `:162-164`) vs
`src/components/ImportExport.tsx:9-12`
- What's wrong: `setLoadError(e instanceof Error ? e.message : String(e))` shows only the outer
  `PinStoreError` message. `ImportExport.tsx` already has `describeError()`, which appends
  `cause.message`; `App.tsx` doesn't use it.
- How I confirmed it: the rendered banner text, captured verbatim from the jsdom run —
  `"Couldn't read saved pins: Pin store: stored data contains an invalid pin. The unreadable data was
  copied to …"`. The cause `Invalid pin: name must not be empty` exists on the error object (I printed
  it: `CAUSE: Invalid pin: name must not be empty`) and is thrown away. The import path, by contrast,
  correctly produces `Import: the file contains an invalid pin: Invalid pin: name must not be empty`.
- Consequence: a user hitting F1 is told their data is "invalid" with no field, no record, and no hint —
  the difference between a 30-second DevTools fix and an unrecoverable-feeling data loss. Pre-existing in
  kind, but this diff adds a **new reachable cause on the load path for data that used to load**, which
  is what promotes it from latent to live. It also gets worse under Unit 6, whose spec
  (`docs/roadmap.md:190-192`) routes a hand-editable, git-merged `data/pins.json` through the same path.
- Minimal fix: lift `describeError` out of `ImportExport.tsx` into a shared helper and use it at
  `App.tsx:124` and `:162`. Three lines.
- Confidence: **high** (observed the exact rendered string).

**[MINOR] The memoization introduces a new invariant and ships with zero coverage — a realistic break
leaves all 143 tests green** · `src/components/MapView.tsx:27` · cites `.claude/rules/00-process.md`
§"Prose is not mechanism" (self-proving)
- What's wrong: the correctness of every marker's colour and selection ring now depends on the cache key
  containing *every* input that affects the icon HTML. Nothing tests that. No test anywhere in the repo
  asserts `pin-marker__dot--selected` (I grepped `src/App.test.tsx` and `src/components/*.test.tsx`).
- How I confirmed it: planted `const key = \`${strength}\`;` (dropping `selected`) in the sandbox and ran
  the project suite — **`Test Files 9 passed (9) · Tests 143 passed (143)`**. My own probe against the
  same planted build shows the real damage: `SELECTED COUNT: 0` — the selection ring never appears on
  any pin, silently. (The colour half is partly defended by accident: `App.test.tsx:192` "recolors the
  marker when the strength is edited" does fail if `strength` is dropped from the key. Only the
  `selected` half is naked.)
- Consequence: a future refactor of this cache can break the "which pin am I looking at" affordance with
  a fully green gate.
- Minimal fix: one `MapView` test — render two pins of the same strength, set `selectedPinId` to one,
  assert exactly one `.pin-marker__dot--selected` and that both still carry `#2e9e4f`. That single test
  kills the planted bug and pins the shared-instance invariant at the same time.
- Confidence: **high** (planted, ran, both directions observed).

**[MINOR] Self-exempted from `/review`, and the hook that is supposed to catch that structurally cannot**
· `docs/progress_log.md:14-16` · `.claude/hooks/require_build_note.py:72-80,136-137`
- What's wrong: the log declares "Not a unit… so no new `/review` cycle". Per `.claude/rules/00-process.md`
  §"Scope of a unit", a decision-logic change at a validation boundary *is* a unit. Separately, the hook
  meant to make Step 3 mechanical checks only whether **any** `.md` exists in `docs/build_notes/`
  (`_existing_notes()` returns a directory listing; `main()` exits 0 if it is non-empty) — it is not
  keyed to the current unit, so with five prior notes on disk it can never fire again for the life of the
  project.
- How I confirmed it: read the hook; `ls docs/build_notes/` is non-empty, so line 136-137 short-circuits.
  Consistent with the observed fact that this change landed with no note and no block.
- Consequence: the "build note is enforced, not remembered" claim is prose, not mechanism — precisely what
  §"Prose is not mechanism" says to flag. Mitigated for *this* change only because the user requested this
  review manually.
- Minimal fix: no code change owed here; either scope `_existing_notes` to notes newer than the merge-base
  (or matching the current branch/unit), or drop the enforcement claim. Track it, don't fix it inside this
  change.
- Confidence: **high** on the hook's behaviour (read the code path); **medium** on whether the user wants
  this change re-scoped as a unit — that is their call, not mine.

**[NIT] The "can't collide with Unit 6" claim is true for code and false for docs** ·
`docs/progress_log.md:13-14`
- How I confirmed it: `git -C /Users/owner/.treehouse/restaurant-map-92aae0/1/restaurant-map status
  --porcelain` — Unit 6's worktree modifies `src/components/ImportExport.tsx`, `src/storage/pinStore.ts`,
  `src/storage/pinStore.test.ts`, `package.json`, `package-lock.json` and adds `src/storage/fileStorage.ts`,
  `fileHandleRegistry.ts`, `DataFileLink.tsx`, `src/types/`. **None** of them is `pin.ts`, `pin.test.ts`
  or `MapView.tsx`, so the file-level claim holds. But this change edits `docs/progress_log.md` and
  `docs/roadmap.md`, which Unit 6's handoff will certainly also edit — a guaranteed textual conflict.
- I also closed the gap the builder admitted leaving open: grepped Unit 6's worktree for `name: ''` /
  `"name": ""` fixtures — **none**, and none of its new files call `parsePin` directly. `data/` does not
  exist yet. So the tightening does not break Unit 6's in-flight work. Confirmed, not assumed.
- Confidence: high.

**[NIT] `setLatLng` still fires for every marker on every render — the NIT's stated symptom is only half
gone** · `src/components/MapView.tsx:103`
- `position={[pin.lat, pin.lng]}` allocates a fresh array each render, and `react-leaflet/lib/Marker.js:9`
  compares by identity. Measured: **4 `setLatLng` calls on a single no-op re-render of a 4-pin map**
  (spy on `L.Marker.prototype.setLatLng`). Harmless (no DOM rebuild, repositions to the same point), but
  the log's framing ("every marker rebuilt on every render" → fixed) overstates what landed.
- Confidence: high (measured).

**[NIT] The trim asymmetry for `name` is now half-resolved and undocumented** · `src/domain/pin.ts:62`
vs `:86-88`
- `parsePin` validates on `.trim()` but deliberately stores the untrimmed value; `createPin`/`updatePin`
  store the trimmed one. Verified: `parsePin({…name:'  Alpha  '})` yields `"  Alpha  "`, so an imported
  padded name silently changes on its first edit. The "Deliberately NOT trimmed here" comment sits on
  `notes` only; a reader will not know the same choice was made for `name`. One comment line.
- Confidence: high (ran it).

**[NIT] `CLAUDE.md`'s always-loaded "Current status" still lists both NITs as outstanding work** ·
`CLAUDE.md` "Current status" / "Next"
- `docs/roadmap.md`'s Later list was correctly pruned, but the charter — the file every session loads —
  wasn't touched and still points "Next" at a Later list whose contents it misdescribes (it also names
  "a list view of leads", which is Unit 7, not a Later item; that part is pre-existing staleness).
- Confidence: high.

---

## Step 5 — Sign-off

- **VERDICT: Yes, with one MAJOR caveat.** Both NITs are genuinely closed and I verified each by
  running, not by reading: the icon memoization provably eliminates `setIcon` churn (0 calls on no-op
  re-renders) without disturbing the strength→colour law, and the `parsePin` tightening is real and
  load-bearing. The caveat is F1: the second fix silently changed the persistence and import contract
  for previously-loadable data, with no in-app recovery and no mention in any artifact. That is a
  documented-decision gap and an error-message gap, not a wrong computation — hence "yes, but fix F1/F2
  before this is merged."

- **TEST + LINT (observed, not quoted from the log):**
  - `npm test` → **Test Files 9 passed (9) · Tests 143 passed (143)**.
  - `npm run lint` → exit 0, no output.
  - `npm run typecheck` (`tsc --noEmit`) → exit 0, no output.
  - Pre-change baseline (`git show HEAD:` for all three source files, run in sandbox) → also **143
    passed (9 files)**, so the log's "same count — no new `it` blocks" claim is **accurate**. Note the
    flip side: the two new assertions are invisible to any count-based drift check.
  - Planted-violation check on `pin.ts` (new tests vs. HEAD `pin.ts`) → **1 failed | 20 passed**,
    `"expected function to throw an error, but it didn't"`. The builder's load-bearing claim is
    **independently confirmed**.
  - `vite build` (run in sandbox, outside the repo) → **86 modules transformed, 315.22 kB JS**. The
    log's build numbers are **exact**.

- **TOP 3 FIXES**, in priority order:
  1. **F1** — state the `parsePin` behaviour change explicitly (it now rejects whole stores *and* whole
     import files), or soften it to a recoverable "(unnamed lead)". Right now a user's map can go empty
     on reload for a reason no artifact records.
  2. **F2** — surface `err.cause` on the load path by reusing `ImportExport.tsx`'s existing
     `describeError`. Three lines; turns an unactionable banner into a fixable one, and pre-pays for
     Unit 6's hand-editable `data/pins.json`.
  3. **F3** — add the one `MapView` test that asserts exactly one `.pin-marker__dot--selected` across two
     same-strength pins. Without it the new cache is guarded by nothing.

- **WHAT I COULD NOT VERIFY, even after trying:**
  - Whether any of the user's **real** exported backup JSON files (outside this repo, on their disk)
    contains a record with an empty name. I checked everything I can reach — all of `src/`, `docs/`,
    `dist/`, every `*.json` in the repo, and Unit 6's parallel worktree: **no such fixture anywhere**.
    But files on the user's machine outside the repo are invisible to me, and that is exactly the
    population F1 would break. **Ask the user, or have the builder add the coercion in F1(b).**
  - Real-browser behaviour. Every render check ran under jsdom with a stubbed viewport; Leaflet's
    `DivIcon` path is DOM-only and behaved identically, but I did not open Chrome. The colour and
    selection results are strong evidence, not a browser smoke test.
  - Whether Unit 6, once finished, will introduce a `parsePin` consumer that needs the looser boundary.
    Its spec (`docs/roadmap.md:185`) says it reuses `parsePin` deliberately; its current in-flight code
    does not call it directly. Re-check at Unit 6's merge.
  - Whether the user considers this change a "unit" requiring the full `/review` cycle (F4). That is a
    governance call for them, not for me.

- **SINGLE BIGGEST RISK:** The `parsePin` tightening is a three-consumer change (`loadPins`,
  `parseImportPayload`, and Unit 6's future file-link) made and documented as a one-consumer NIT fix —
  so the day it fires, the user will see an empty map and an error message that names neither the pin
  nor the field, for data that loaded fine yesterday.
