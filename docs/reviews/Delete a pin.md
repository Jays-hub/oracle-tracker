# Review — Delete a pin

Cold-context adversarial review, read-only over the repo. Base: working tree on top of `55c3761`
(all of this unit is uncommitted). Reviewed: `git diff` of `src/App.tsx`, `src/App.test.tsx`,
`src/components/PinEditor.tsx(.test)`, `src/domain/pin.ts(.test)`, `src/index.css`,
`docs/progress_log.md`, plus the untracked `docs/build_notes/delete a pin.md`.

Everything marked "verified by running" was reproduced in a throwaway copy of the repo at `/tmp/rmrev`
(rsync of the tree + node_modules), where I could add probe test files without touching the repo.

## What this unit had to deliver (restated)

- Close `docs/roadmap.md`'s "Later" one-liner: *"Delete a pin (wants its own confirm/undo story;
  deliberately excluded from unit 2's editing)"* — i.e. a lead can leave the map, and the removal is
  guarded by a confirmation and recoverable afterwards.
- Judged against `CLAUDE.md` standing order #3: the delete is additive to the product bar, so
  place / color-by-strength / notes / persist-across-reload must all still hold, tests green, lint and
  types clean.
- Obey the repo's existing structural disciplines: every write is a read-modify-write against a
  freshly re-read store (`storedPinsForWrite`), the strength→color mapping stays total, storage stays
  the only backend, failures surface as named errors rather than crashes.
- Builder's own interpretation of "confirm/undo story": two-step confirm before the write + an
  in-session, single-level Undo after it.

**Spec conflict, flagged first (see F5):** there is no written acceptance criterion for this unit
anywhere. `docs/roadmap.md` is unmodified — "Delete a pin" is still listed under **"Later — not
scheduled"**, and Section B's rationale still reads "There is no delete yet." The decision log
(`docs/build_notes/delete a pin.md:14`) says *"I wrote one from `CLAUDE.md`'s real acceptance bar …
rather than either skipping the ceremony"* — but the build note contains no Done-when block
(`grep -i "done when" docs/build_notes/delete\ a\ pin.md` returns only that sentence). So the unit was
built and self-assessed against criteria that were never written down. I reviewed against the roadmap
one-liner + `CLAUDE.md` #3 + the log's stated intent, and I hold the log's own claims ("restores the
exact pin, byte-for-byte") to be part of the contract.

---

## Step 2 — Hunt list

**Silent killers**

| Item | Verdict |
| --- | --- |
| Core logic (`removePin` index math, no-mutation, fail-loud) | **pass — verified by running.** `slice(0,i)+slice(i+1)` hand-checked; the 5 domain tests re-run green; no off-by-one, no in-place mutation, `findIndex === -1` throws `PinNotFoundError`. |
| Acceptance bar judged by the real criterion | **concern.** The project bar (#3) is genuinely unaffected — I re-ran it end to end (probe 4/9: delete persists across a full remount, restored pin comes back on its mapped color, 3 strengths intact). But this unit's *own* bar was never written (F5), and the one claim that stands in for it — "Undo restores the exact pin, byte-for-byte" — is false in the multi-tab case (F1). |
| Split / leakage integrity | **n/a** — no learned model, no train/val/test split in this unit. |
| Reproducibility | **pass — verified by running.** No stochastic sources touched; `removePin` deterministic; `serializePins` fixed field order; no absolute paths. Undo re-appends at the end so array order changes after an undo — deliberate, documented, and nothing reads pin order. |
| Data / boundary integrity | **concern.** Delete and undo both go through `savePins`; undo enforces the `loadPins` unique-id invariant. But `handleUndoDelete` calls `storedPinsForWrite()` **outside** its `try` (F4), and the undo payload never crosses the store boundary at all (F1). |

**Domain hazards (`CLAUDE.md`)**

| Item | Verdict |
| --- | --- |
| Lead-strength → color total, fixed mapping (#3) | **pass — verified by running.** Probe 9: delete + undo + reload for all three strengths yields exactly `#2e9e4f` (strong/green), `#e8a33d` (weak/amber), `#d64545` (failed/red), read off the rendered `.pin-marker__dot` styles, not off the legend. No default/unknown color path is reachable — the restored object is the same validated `Pin`. |
| Persistence lossless and durable (#3) | **fail (narrow).** Delete and undo both survive a full remount (probes 4, 7). But undo writes **this tab's stale copy** of the pin, so a concurrent edit from another tab is silently reverted (F1). Corrupt/absent store still degrades to empty-but-usable, except for one uncaught-throw path in undo (F4). |
| Local-first, standalone (#2) | **pass — verified by running.** No `fetch`/XHR/URL introduced in any changed file; `npm run build` clean; no new key, schema, dependency, or server. |
| Anti-drift (#2) | **pass.** The scope call — an in-memory single-delete Undo instead of reusing `backupBeforeImport`'s whole-store snapshot — is correct and well argued; a snapshot key per delete with no restore UI would have been the drift. No premature abstraction. This is the strongest part of the unit. |

**Software engineering**

| Item | Verdict |
| --- | --- |
| Confirm gate is self-proving | **pass — verified by running.** I planted the bypass (arm button calls `onDelete` directly): 9 tests fail across `PinEditor.test.tsx` and `App.test.tsx`. |
| Multi-tab guard on the *delete write* is self-proving | **pass — verified by running.** Planted `removePin(pins, id)`: "does not clobber a pin another tab added since this one loaded" fails. |
| Undo test is meaningful | **fail — verified by running.** `App.test.tsx:304` "offers an Undo that restores the exact pin, byte-for-byte" cannot detect the bug it appears to guard: I applied the minimal fix for F1 in the sandbox and the whole suite stayed **120 green**, while my probe flipped from fail to pass. The test only exercises the single-tab case where state and store are identical by construction (F3). |
| Edge cases / named errors | **concern.** Quota, not-found, duplicate-id and failed-save all surface named errors; one path throws uncaught instead (F4), and one error message is factually wrong (F6). |
| Structure / style | **pass, minor.** New CSS follows the `.pin-editor button.<class>` specificity pattern the 3B review established. Two NITs below. |

---

## Step 3 — Where a subtle bug would hide here, and what I found

1. **`handleUndoDelete` — the one write in this unit that resurrects data (`src/App.tsx:261-287`).**
   Every other write in the app derives its payload from a freshly re-read store; this one derives it
   from React state captured before the delete. Looked deliberately, found **F1** (stale restore) and
   **F4** (uncaught throw). This is the riskiest spot in the unit and it is where the defect is.
2. **The `deleteInfo` lifecycle (`src/App.tsx:170, 184, 215, 248, 313, 335`).** The clearing policy was
   copied wholesale from `importInfo`, which is a purely informational banner. `deleteInfo` is not
   informational — it is the only recovery affordance for an irreversible action. Found **F2**.
3. **`removePin` itself (`src/domain/pin.ts:167-173`).** Deliberately probed for off-by-one and
   duplicate-id behaviour; it is correct. One line is enough: this function is right.

---

## Step 4 — Findings

**[MAJOR] Undo restores this tab's stale copy of the pin, not the record that was actually deleted** ·
`src/App.tsx:228` (and `:248`) · `handleDeletePin` takes the write list from `storedPinsForWrite()` (a
fresh re-read) but takes `pinToDelete` from `pins` — React state, which is stale the moment another tab
writes. The two come from different snapshots, so Undo re-inserts an older version of the lead. ·
**Confirmed by running** (probe 1, `/tmp/rmrev/src/Probe.test.tsx`): open Alpha in the editor → another
tab writes `notes: "THREE PARAGRAPHS WRITTEN IN THE OTHER TAB"` → delete Alpha here (the delete itself
correctly removes the *current* record) → click Undo → stored notes come back as `""`. The other tab's
prose is gone with no error, no banner, and no trace. · **Consequence:** silent loss of free-form prose
— precisely the failure mode `docs/roadmap.md` Section B singles out as the worst kind ("three
paragraphs silently reverting to an older draft"). It also falsifies the log/progress-log claim that
the undo holds "the exact pin that was removed", and it is a hole in the repo's own stale-tab law,
which `docs/progress_log.md` claims was planted-and-caught for this unit (it was — for the delete
write, not for the undo payload). · **Minimal fix:** capture the pin from the same list the write uses:
```ts
const current = storedPinsForWrite();
const pinToDelete = current.find((p) => p.id === id);
next = removePin(current, id);
```
(inside the existing `try`, with `setDeleteInfo(pinToDelete ? { pin: pinToDelete } : null)`), and add a
test that seeds a concurrent edit before the delete. · **Confidence: high** — I applied exactly this in
the sandbox: probe 1 passes and the existing suite stays 120 green.

**[MAJOR] The only undo for a destructive action is destroyed by a read-only action** ·
`src/App.tsx:184` (`setDeleteInfo(null)` in `handleSelectPin`; same at `:170` add, `:215` save) ·
Clicking any marker — a pure read, the natural next move after "wait, did I delete the right one?" —
clears `deleteInfo` and the Undo button vanishes for good. · **Confirmed by running** (probe 2): after
a delete, one click on the surviving marker → `queryByRole('button', {name: /^undo$/})` is `null`,
store still missing the pin. Probe 5 confirms the window is narrow in the other direction too: a second
delete silently discards the first delete's undo. · **Consequence:** the "undo story" the roadmap
demanded exists only until the user touches anything, including looking at another lead. A misclicked
delete of a lead with months of notes becomes permanent, recoverable only from a manually exported
JSON file. · **Note:** the clearing is not protecting anything — the genuine invalidation hazards are
already handled elsewhere (the duplicate-id guard at `:265`, and `setDeleteInfo(null)` on both import
branches at `:313`/`:335`). Selecting, adding, or editing another pin leaves the deleted id absent, so
the held pin stays valid. · **Minimal fix:** drop `setDeleteInfo(null)` from `handleSelectPin` (and
arguably from `handleMapClick`/`handleSaveEdits`); keep it on the import paths and on a new delete. If
the banner's persistence is the worry, add an explicit dismiss. · **Confidence: high** on the
behaviour (verified by running); the severity is a product judgment the user may want to weigh.

**[MINOR] The unit's headline test asserts a property it cannot detect** · `src/App.test.tsx:304`
("offers an Undo that restores the exact pin, byte-for-byte") · It deletes and undoes in a single tab,
where `pins` state and the store are identical by construction, so it passes identically with and
without F1's bug. · **Confirmed by running:** with F1's minimal fix applied in the sandbox the suite is
still exactly 120 passed — the test cannot tell the two implementations apart. Meanwhile the *neighbouring*
multi-tab test only adds an unrelated pin, so it never exercises the undo payload. · **Consequence:**
this is the reason F1 shipped through a five-regression planted-defect exercise. · **Minimal fix:** the
test that comes with F1's fix (concurrent edit to the pin being deleted, then Undo, then assert the
stored notes are the *newer* text). · **Confidence: high.**

**[MINOR] `handleUndoDelete` calls `storedPinsForWrite()` outside its `try`, so a failed rescue throws
uncaught** · `src/App.tsx:264` · `handleDeletePin` puts the same call inside `try` and turns any failure
into a named banner; undo does not. When the store is unreadable *and* the corrupt-store snapshot
cannot be written, `backupCorruptStore` throws straight out of the click handler. · **Confirmed by
running** (probe 3): Vitest reports `Uncaught Exception … PinStoreError: Pin store: could not copy the
saved data aside ❯ storedPinsForWrite src/App.tsx:119 ❯ handleUndoDelete src/App.tsx:264`, with zero
`role="alert"` banners rendered. The Undo button stays on screen and does nothing, forever. ·
**Consequence:** narrow reachability (corrupt store + failing snapshot), but the failure mode is the
one the codebase explicitly rejects everywhere else — silent nothing instead of a named error. ·
**Minimal fix:** move `const current = storedPinsForWrite();` inside the existing `try`, reusing the
"Couldn't restore …" message. · **Confidence: high.**

**[MINOR] No written acceptance criteria for this unit; roadmap left stale** · `docs/roadmap.md`
(unmodified) and `docs/build_notes/delete a pin.md:14` · The roadmap's header says it is "where a unit's
acceptance criteria live *before* it is built … `/review <unit>` judges against it", and delete is
still under **"Later — not scheduled"** with no section. The decision log claims a Done-when was
written; there is none in the build note either. Section B's rationale text ("There is no delete yet",
"its honest prerequisites are `updatedAt` … and delete") is now wrong. · **Confirmed by reading/grep**
(`grep -n -i "done when\|acceptance" docs/build_notes/delete\ a\ pin.md` → only the claim itself). ·
**Consequence:** the reviewer has no independent bar, so "done" is defined post-hoc by the builder —
the exact loop `.claude/rules/00-process.md` separates build from review to avoid; and the roadmap will
keep advertising delete as unbuilt for the next session. · **Minimal fix:** add a short "Delete a pin"
section to `docs/roadmap.md` with an explicit Done-when (including what "undo" covers and for how
long), remove it from "Later", and footnote Section B's now-stale premise. · **Confidence: high.**

**[MINOR] "It was not removed" is false when another tab already deleted the pin, and a ghost marker
survives** · `src/App.tsx:237` · If the store no longer contains the id, `removePin` throws and the
banner reads `Couldn't delete that pin: Pin not found: "a". It was not removed.` — but the pin *is*
gone from storage; only this tab's stale state still renders it. · **Confirmed by running** (probe 6):
banner text as above, `stored()` = `["b"]`, `markers().length` = 2. Every further delete attempt
repeats the error; only a reload clears the ghost. · **Consequence:** the user is told a lead still
exists when it does not, and cannot clear it from this tab. Same shape as the pre-existing edit path,
so this is inherited rather than introduced. · **Minimal fix:** on `PinNotFoundError` specifically,
re-sync `pins` from the re-read store and say "that lead was already deleted somewhere else." ·
**Confidence: high** (behaviour), **medium** on whether it is worth fixing now.

**[NIT] Both new delete buttons fall just below WCAG AA text contrast** · `src/index.css:246` and `:265`
· `#d64545` text on white and white text on `#d64545` are both **4.38:1** at `0.9rem`/14.4px (AA needs
4.5:1). The app's existing primary button (`#2f6fed`) is 4.55:1, so this is a small regression against
the project's own de facto baseline. · **Confirmed by computing** the WCAG relative-luminance ratio. ·
**Minimal fix:** darken to ~`#c02f2f` (or bump the button font-size). · **Confidence: high** on the
numbers, low on whether the user cares.

**[NIT] Build-note filename case is inconsistent** · `docs/build_notes/delete a pin.md` vs.
`Map + colored pins.md`, `Unit 2 - notes + editing per pin.md` (capitalised). · Cosmetic; matters only
for finding the file later. · **Confidence: high.**

### Checked deliberately and found sound

- `removePin` (`src/domain/pin.ts:167`) — correct, non-mutating, fail-loud; mirrors `replacePin`.
- Two-step confirm gate — real mechanism, not prose: planted bypass fails 9 tests.
- Delete's re-read-before-write — real: planted stale list fails its test.
- Duplicate-id guard on undo (`src/App.tsx:265`) — correct call, and its test is honest.
- Undo into a store another tab has wholly replaced with different ids appends cleanly (probe 10:
  `["c","a"]`, no duplicate-id corruption).
- Scope discipline (rejecting a snapshot-per-delete) — the right call, correctly argued.

---

## Step 5 — Sign-off

- **VERDICT:** **No.** The project-wide DONE-WHEN bar (`CLAUDE.md` #3) still holds — I re-ran it: pins
  place, colour correctly per strength, keep their notes, and survive a full reload, with delete and
  undo persisting through a remount. But this unit's own contract does not: Undo does **not** restore
  the pin that was deleted when another tab has touched it (F1, verified by running), and the undo it
  does offer evaporates on any subsequent click including a read-only one (F2, verified by running).
  Since no Done-when was ever written for the unit (F5), that judgment is made against the roadmap
  one-liner and the builder's own stated claims.
- **TEST + LINT:** `npm test` → **120 passed, 8 files, 0 failed** (matches the log's claim).
  `npm run lint` → clean, 0 problems. `npm run typecheck` (`tsc --noEmit`) → clean. `npm run build` →
  succeeds (84 modules). My own 9 probe tests in a `/tmp` copy: 3 confirmed defects (probes 1, 2, 3),
  5 confirmations of correct behaviour (probes 4, 6, 7, 9, 10), 1 confirmation of documented design
  (probe 5). Planted-regression re-checks: confirm-gate bypass → 9 failures; stale delete list → 1
  failure; F1's fix applied → suite still 120 green (proving the undo test is blind to it).
- **TOP 3 FIXES**
  1. **F1** — capture `pinToDelete` from the same re-read store list the delete writes, and add the
     concurrent-edit test that would have caught it.
  2. **F2** — stop clearing `deleteInfo` on `handleSelectPin` (selection is a read); keep clearing it
     only where the undo is genuinely invalid (import replace, a new delete).
  3. **F4 + F5** — move `storedPinsForWrite()` inside `handleUndoDelete`'s `try`; write the unit's
     Done-when into `docs/roadmap.md` and take delete off the "Later" list.
- **WHAT I COULD NOT VERIFY**
  - The double-click-through hazard the builder flagged (same "Delete lead" label on arm and confirm).
    jsdom has no layout engine, so I could not measure hit boxes. Reading the CSS, the confirmation
    paragraph (`padding: 10px` + ~2 lines + `margin-bottom: 8px`) pushes the confirm button ≈50px below
    where the arm button sat, so a fast double-click should land in the prose, not the button — but
    that is reasoning, not a measurement.
  - The builder's in-Chrome walkthrough: I did not drive a browser. Everything I could reach was
    reproduced through the real `App` + real Leaflet + a real `Storage` fake in jsdom instead.
  - Real `localStorage` quota behaviour (mocked, not exercised).
  - Whether a single-level, in-session, non-persisted undo is *enough* "undo story" for the user —
    there is no spec to judge that against, so it stays a product question (see F5).
- **SINGLE BIGGEST RISK:** Undo can hand back an older copy of a lead's notes than the one it deleted,
  and neither the UI nor the 120-test suite would ever tell you.
