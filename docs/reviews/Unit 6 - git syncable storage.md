# Review — Unit 6: git-syncable storage

Adversarial, cold-context review. Read-only over the repo; this file is the reviewer's only artifact.
Reviewed against `docs/roadmap.md` § "Unit 6 — Git-syncable storage", `CLAUDE.md` (charter + standing
orders), and `.claude/rules/00-process.md`. Diff base: the entire unit is uncommitted (working-tree
changes + untracked files) on top of `1eb8f98`; I scoped by `git diff` + `git status` and read every
untracked new file.

## Step 0 — What this unit had to deliver (my words)

- A sidebar control links storage to a real on-disk JSON file via the File System Access API; **once
  linked, every read and write — add, edit, delete, import *and export* — goes through that file**, using
  the same re-read-immediately-before-writing discipline the localStorage store already uses.
- The link **survives a reload** (handle in IndexedDB), needing at most one permission click per session,
  never a re-pick.
- First link **reuses Unit 3B's import machinery**: empty file → seed from localStorage; non-empty file →
  `parsePin`-validated, counts named, pre-link snapshot, explicit confirm. Never a silent merge or discard.
- Unsupported browser → honest named fallback, no crash. An **unreadable linked file (incl. `<<<<<<<`
  conflict markers) is treated exactly as a corrupt `localStorage` read**: backed up aside, named error,
  **no data loss, no crash**.
- `CLAUDE.md` updated so git-file sync reads as explicitly not the forbidden backend/accounts drift.

Carried-forward law this unit inherits and must not break (roadmap Unit 3B, restated in
`src/storage/importExport.ts:55-68`): *"Import cannot destroy data silently. Before replacing the store,
snapshot the current one aside… treat a failed snapshot as a hard abort."*

No spec/intent conflict worth stopping over: the charter change is genuinely required by the Done-when's
last bullet and is correctly worded. The unit is inside the charter — no server, no accounts, no external
data API.

---

## Step 2 — Hunt list

| Area | Verdict |
|---|---|
| Core logic: `parsePinsPayload` extraction is behaviour-preserving | **pass** (verified-by-running: 29 pinStore tests green, pre-existing 22 unmodified) |
| Core logic: read-modify-write on the file for add/edit/delete/undo | **verified-by-running** — probe D2 drove edit → delete → undo through a linked fake handle; all three landed in the file and `localStorage` stayed `[]` |
| Acceptance bar: "every read and write … (import/export) goes through that file" | **fail** — export reads React state, not the file (F3); import has a destructive gap (F1) |
| Acceptance bar: "unreadable linked file … no data loss, no crash" | **fail** on the import path (F1); **concern** on the startup path (F2) |
| Acceptance bar: "link persists across reloads, ≤1 click" | **concern** — never proven end-to-end; App tests mock the registry, registry tests store a non-handle stand-in, no browser pass (F5) |
| Acceptance bar: unsupported-browser fallback | **pass** (verified-by-running) |
| Acceptance bar: empty-file seed / existing-file confirm-replace / cancel paths | **pass** (verified-by-running) |
| Acceptance bar: `CLAUDE.md` updated | **pass** |
| Silent-killer: inverted/short-circuit conditions in the new branches | **concern** — `raw !== null && raw !== ''` in `handleImportReplace` silently converts "couldn't read" into "nothing was there" (F1) |
| Boundary integrity: one validation boundary for both media | **pass** — `parsePinsPayload` is genuinely shared; conflict-marker bytes fail as plain invalid JSON |
| Boundary integrity: null/empty/`''` handling at the file boundary | **concern** — `''` and unreadable are conflated in the import banner (F1) |
| Reproducibility: seeding/determinism/absolute paths | **pass** — `serializePins` is order-fixed; `now` remains injectable; no hardcoded paths |
| Persistence lossless + durable (`CLAUDE.md` #3) | **concern** — round-trip through the file is lossless (probe D2), but a stale export can produce a lossy "backup" (F3) |
| Degrade to empty-but-usable or fail loud, never crash | **fail** — startup adopt of an unreadable file degrades to empty-and-**unusable** with no escape (F2) |
| Lead-strength → color total, fixed mapping (`CLAUDE.md` #3) | **pass** — `src/domain/leadStrength.ts` untouched; `satisfies Record<LeadStrength, string>` still exhaustive; strong `#2e9e4f` green / weak `#e8a33d` amber / failed `#d64545` red |
| Local-first, standalone (`CLAUDE.md` #2) | **pass** — no network surface added; IndexedDB and the File System Access API are both local |
| Tests meaningful, not smoke | **concern** — the four planted regressions are real self-proving work, but *zero* tests cover edit/delete/undo/import/export against a linked file, which is exactly where F1 and F3 live (F7) |
| Error handling: friendly named errors, not bare crashes | **concern** — one uncaught promise rejection in a click path (F6); one banner that states the opposite of what happens (F11) |
| Anti-drift / over-engineering | **concern** — `forgetFileHandle` built, tested, never wired (F8) |
| Structure / style | **pass** — CSS mirrors `.import-export`, and the class+element specificity trap from Unit 3B's review was pre-empted correctly |
| "Prose is not mechanism" (`00-process.md`) | **concern** — Assumption 1 ("the localStorage branch must contain zero `await`s") is guarded only by a comment (F13) |

---

## Step 3 — Where a subtle bug would hide here, and what I found

1. **`handleImportReplace`'s new linked branch** (`src/App.tsx:736-805`) — the only new code path that
   *destroys* data, and the only one with no test. Looked deliberately: found **F1**, a silent-destroy.
2. **`adoptLinkedFile`'s catch block** (`src/App.tsx:200-229`) — it sets `linkedHandle` *after* the catch,
   so a failed read still adopts. Found **F2**.
3. **The two refs behind one banner** (`corruptBackupRef` / `fileCorruptBackupRef`, `src/App.tsx:816-820`)
   — the builder's own least-confident spot #2. Reproduced it: found **F5b/F9** (wrong key named).

---

## Step 4 — Findings

### F1 · **[BLOCKER]** Import-replace against a linked file whose read fails destroys the file with no snapshot, and the banner says nothing was there
`src/App.tsx:740-757` (and the banner at `:794-804`)

**What's wrong.** In the linked branch:
```ts
try { raw = await readFile(linkedHandle); } catch { raw = null; } // "the write below will still be attempted"
…
backupKey = raw !== null && raw !== '' ? backupRawBeforeReplace(storage, raw) : null;
await writeFile(linkedHandle, serializePins(imported));
```
A failed read collapses into `raw = null`, which then means *both* "don't snapshot" **and** "there was
nothing there". The pre-replace snapshot — the only undo for a replace — is skipped, and the write
proceeds anyway. This directly breaks the law the localStorage path documents and enforces
(`src/storage/importExport.ts:63-67`: *"a failed snapshot hard-aborts the import … nothing is ever
overwritten without a safety copy existing first"*), and it contradicts the unit's own Assumption 4
("mid-session hard read failure refuses the write").

**How I confirmed it.** Probe test (`/tmp` copy of `src`, real `App`, real Leaflet, the repo's own
`fakeFileHandle`): link a file containing 2 pins with notes, then make `getFile()` reject while
`createWritable()` still works, then import a 1-pin JSON and click Replace. Observed:
```
CONFIRM TEXT: Replace the saved data (currently unreadable) with the 1 lead in “leads.json”?
FILE NOW:     [{"id":"a","name":"Alpha Cafe",…}]        <- the 2 pins are gone
IMPORT BACKUPS before/after: 1 1                        <- no snapshot taken
BANNER: Imported 1 lead, replacing the previously saved data (which was unreadable).
        There was nothing saved before this import.
```
**Consequence.** Irreplaceable free-form notes destroyed with no undo, while the app affirmatively tells
the user nothing was lost. This is the exact failure class `CLAUDE.md` #3 and Unit 3B were written to
prevent, and it is a *silent* one — output looks plausible, conclusion is wrong.

**Minimal fix.** Treat "couldn't read the linked file" as a hard abort in `handleImportReplace`, the same
way `backupBeforeImport`'s throw aborts the localStorage path: on read failure, `setSaveError(…)` and
return without writing. Keep `raw === ''` (genuinely empty file) as the only case that legitimately
produces `backupKey = null` / "there was nothing saved before this import".

**Confidence:** high (reproduced). Reachability of the read-fails-but-write-succeeds combination in real
Chrome is the one thing I could not settle — see "what I could not verify".

---

### F2 · **[MAJOR]** A linked file that can't be read at startup is adopted anyway, hiding every localStorage pin and dead-ending the app
`src/App.tsx:200-229` (`adoptLinkedFile`), with `src/components/DataFileLink.tsx:80-84`

**What's wrong.** `adoptLinkedFile` catches the read failure, then unconditionally runs
`setLinkedHandle(handle); setPins(loaded /* [] */); setInitialView(initialViewForPins([]))`. So a
remembered handle whose permission is still `granted` but whose file is gone (a `git checkout` to a branch
without `data/pins.json`, a rename, a moved repo) becomes the live backend with zero pins. The decision
log's Assumption 4 claims startup "continues on localStorage"; it does not — it only does so for a
*denied/prompt* permission.

**How I confirmed it.** Probe: seed localStorage with 1 pin, recall a handle with `permission: 'granted'`
whose `getFile()` rejects `NotFoundError`. Observed:
```
MARKERS: 0
LINKED LINE: Linked to “pins.json”. Every read and write goes through this file — commit and push it…
ALERT: Couldn’t read saved pins: NotFoundError. Your saved data is untouched; new pins you add will overwrite it.
AFTER ADD ATTEMPT: … | Couldn’t save that pin: Pin store: could not read the linked file. It was not added.
```
**Consequence.** Empty map, the user's localStorage leads invisible, *every* write refused, a status line
asserting reads/writes go through a file that can't be read, and a banner promising the opposite of what
happens. Because there is deliberately **no Unlink / relink control** (`DataFileLink`'s `linked` branch
renders a status `<p>` only), this state repeats on every reload; the only in-app escape is clearing site
data. That is "degrade to empty-but-**unusable**", which `CLAUDE.md` #3 rules out.

**Minimal fix.** In `adoptLinkedFile`, only adopt on a successful read. On a read failure leave
`linkedHandle` null, keep the localStorage-backed `pins`/`initialView` untouched, and surface the handle
as a `reconnectHandle` (the retry affordance already exists). Independently: add an **Unlink** control —
it is the missing escape hatch here and `forgetFileHandle` (F8) is already written for it.

**Confidence:** high (reproduced).

---

### F3 · **[MAJOR]** "Export as JSON" while linked exports React state, not the linked file
`src/App.tsx:896-900` (`<ImportExport pins={pins} …>`)

**What's wrong.** Every other operation was converted to re-read the active backend; export was not. The
roadmap bullet is explicit: *"every read and write (add, edit, delete, import/export) goes through that
file instead of `localStorage`."* Before Unit 6 this was harmless (App was the only writer of
localStorage). With a git-tracked file, an external writer — `git pull`, the whole point of the unit — is
expected by design, and the unit deliberately ships no file-watching.

**How I confirmed it.** Probe: link a file with 1 pin, then replace the handle's `getFile()` so the file
now holds 2 (simulating a pull), then click Export and read the Blob:
```
EXPORTED: [{"id":"g","name":"Gamma Bistro",…}]   <- 1 pin, not the 2 now in the file
```
**Consequence.** The user takes a "backup" that silently omits everything pulled since the tab was opened.
If they later restore it (import = whole-store replace), the omission becomes real data loss.

**Minimal fix.** Make the export source the active backend: when `linkedHandle` is set, read the file and
`parsePinsPayload` it before building the Blob (mirroring `countStoredPins`), or refuse with a named error
if unreadable. Same change also fixes the progress log's claim.

**Confidence:** high (reproduced).

---

### F4 · **[MAJOR]** The git-synced file is written as single-line minified JSON, which guarantees a git conflict on every concurrent edit
`src/storage/pinStore.ts:230-241` (`serializePins`, reused verbatim for the file at `App.tsx:321,381,522,584,647,707,757`)

**What's wrong.** `JSON.stringify(pins.map(...))` with no indentation. The linked `data/pins.json` is
therefore one long line (confirmed in the probe output above). Git merges line-by-line: a one-line file
cannot auto-merge, so *any* change made on two devices between pulls conflicts, and resolution means
hand-editing a single multi-kilobyte line. The unit's entire value proposition is "commit and push this
file; git is the sync". Pretty-printing turns the common case (two devices touch different pins) into a
clean auto-merge.

**How I confirmed it.** Read the serializer; observed the committed bytes in every probe
(`[{"id":"a","name":"Alpha Cafe","lat":40.7,…}]`, one line). Not a runtime failure — a design defect
against the unit's stated purpose.

**Consequence.** Sync degrades to "one device at a time, or hand-merge a minified blob" — and a botched
hand-merge lands in the corrupt-file path (which is handled, but is the failure mode the unit was
supposed to make rare).

**Minimal fix.** A separate `serializePinsForFile(pins)` = `JSON.stringify(records, null, 2) + '\n'`
(trailing newline so the file is POSIX-clean and diffs don't show "\ No newline"). Leave `serializePins`
as-is for `localStorage`. `parsePinsPayload` already accepts either.

**Confidence:** high on the mechanism; medium on how much the user will care — worth a one-line decision
from the user rather than silently keeping the minified form.

---

### F5 · **[MAJOR]** "The link persists across reloads" is never verified end-to-end — the two halves of the proof are both mocks
`src/App.test.tsx:32-36` (registry module mocked) + `src/storage/fileHandleRegistry.test.ts:22-23` (a
plain `{kind,name}` object, not a handle)

**What's wrong.** The App tests replace `recallFileHandle`/`rememberFileHandle` with `vi.fn()`s; the
registry tests exercise real IndexedDB but store a stand-in *because* a function-bearing fake can't be
structured-cloned. So the one property the Done-when actually asserts — that a **real
`FileSystemFileHandle` survives a real IndexedDB round-trip and can then be re-permissioned in one click**
— has no test anywhere, and the build note confirms no browser pass was done. The stand-in's own docstring
concedes real browsers give `FileSystemFileHandle` "special structured-clone support"; that special case
is precisely what is untested.

**How I confirmed it.** Read both test files; ran the suite (both green, neither touches a real handle).
I cannot close this gap from Node/jsdom.

**Consequence.** If handle persistence doesn't work in real Chrome (wrong object store options, a clone
rejection, a permission model surprise), the unit's headline promise fails on first real use and every
automated test still reports green.

**Minimal fix.** A manual Chrome walkthrough recorded in the build note: link a file, reload, confirm the
Reconnect control appears with the right filename and one click restores the file's pins. This is the one
finding a test genuinely cannot replace.

**Confidence:** high that it's unverified; unknown whether it actually works.

---

### F6 · **[MINOR]** Unhandled promise rejection from `linkFile` when the corrupt-store rescue copy fails
`src/App.tsx:319` (`const seed = storedPinsForWrite();`, outside any `try`), called via
`void linkFile(...)` at `:364,368`

**What's wrong.** `storedPinsForWrite()` throws by design when `localStorage` is corrupt *and*
`backupCorruptStore` also fails. In `linkFile` that call is not wrapped, so the rejection escapes the
`void`-ed promise: no `fileLinkError`, no new banner, the link silently does nothing.

**How I confirmed it.** Probe with a `setItem` that throws for `…corrupt-…` keys, then "Create new file…":
```
G2 UNHANDLED: [ 'PinStoreError: Pin store: could not copy the saved data aside' ]
G2 LINK PANEL: Sync via file / Choose existing file… / Create new file…   (no link, no link error)
G2 FILE CONTENT: ""                                                        (empty file left on disk)
```
**Consequence.** Narrow, but it's a click that appears to do nothing, plus an orphaned empty file on disk.
The pre-existing "adding or editing pins is blocked" banner is on screen but doesn't mention the link.

**Minimal fix.** Wrap the seed read in the same `try/catch` the file-write below it already has, and set
`fileLinkError`.

**Confidence:** high (reproduced).

---

### F7 · **[MINOR]** No test covers edit, delete, undo, import or export against a linked file
`src/App.test.tsx:1180-1438` — the Unit-6 describe has 9 tests: unsupported, empty-seed, existing-link
(+ one add), cancel-confirm, cancel-picker, corrupt-on-adopt, reconnect-granted, reconnect-denied,
mid-session-read-failure.

**What's wrong.** The Done-when names five operations; only *add* is covered. The two defects above (F1,
F3) live in the two uncovered operations. This is the "would the test fail on the bug you fear" test, and
the answer is no.

**How I confirmed it.** Grepped/read the describe block, then wrote the missing coverage myself in /tmp:
edit/delete/undo pass (`D2 OK — file: [{…"notes":"edited notes"}]`, `localStorage` untouched), import and
export fail as documented in F1/F3.

**Minimal fix.** Port the four probe cases into `App.test.tsx` once F1/F3 are fixed — especially an
import-while-linked test asserting a snapshot exists *and* the banner names it.

**Confidence:** high.

---

### F8 · **[MINOR]** `forgetFileHandle` is written and tested but never called — and it is exactly the affordance F2 needs
`src/storage/fileHandleRegistry.ts:77-91`; 2 of the 6 registry tests exercise it; zero callers in `src/`.

**What's wrong.** Unused export with test coverage that proves nothing about shipped behaviour. Per
`CLAUDE.md` #2 / `00-process.md` "name the drift", this is capability built ahead of the step that needs
it — while the *actual* gap (no way out of a broken link, F2) stays open.

**How I confirmed it.** `grep -rn forgetFileHandle src/ | grep -v test` → the definition only.

**Minimal fix.** Either wire it to an Unlink control (preferred — it closes F2) or delete it with its
tests.

**Confidence:** high.

---

### F9 · **[MINOR]** With both `localStorage` and the linked file corrupt, the error banner names the wrong rescue key
`src/App.tsx:816-820` (`corruptBackupRef.current ?? fileCorruptBackupRef.current`)

**What's wrong.** The message text comes from the *latest* failure (the file) while the key comes from the
*first* non-null ref (localStorage). The builder flagged this as least-confident spot #2; it is real.

**How I confirmed it.** Probe: corrupt `localStorage` + a conflict-marker file, both adopted on mount.
```
CORRUPT KEYS: [".corrupt-…750Z", ".corrupt-…753Z"]
BANNER: … The unreadable data was copied to “…750Z” …
NAMED KEY HOLDS: {not json          <- localStorage's bytes, not the file's conflict markers
```
**Consequence.** A user following the banner during recovery opens the wrong snapshot and may conclude
their file's contents weren't saved. Both keys do exist, so nothing is lost — this is misdirection, not
destruction.

**Minimal fix.** Track the two errors/keys as a pair (or name both keys in the banner) instead of `??`-ing
two refs that describe different media.

**Confidence:** high (reproduced).

---

### F10 · **[MINOR]** Linking an existing file immediately rewrites it, dirtying the git working tree for no data change
`src/App.tsx:381` (`await writeFile(handle, serializePins(imported))` inside `handleConfirmFileLink`)

The file's content is re-serialized and written back on link even when it parses cleanly. Combined with
F4 (single line), the result is a whole-file diff in `git status` immediately after linking on a second
device — the moment the user is most likely to be confused about whether the app touched their data.
Minimal fix: skip the write when `raw === serializePins(imported)`, or write only on the first real
mutation. **Confidence:** high (read + observed in probe A's baseline).

---

### F11 · **[NIT]** The load-error banner's advice is false for a file-backed read failure
`src/App.tsx:816-817` — *"Your saved data is untouched; new pins you add will overwrite it."* When the
failure is an unreadable linked file, adding a pin does **not** overwrite anything; the write is refused
(F2's transcript shows both messages on screen simultaneously, contradicting each other). Minimal fix:
branch the copy on which backend produced the error. **Confidence:** high.

### F12 · **[NIT]** `pendingFileLink.savedCount` is captured at pick time, not at confirm time
`src/App.tsx:359` — a pin added between the picker resolving and the confirm click makes the
"replacing N currently shown" count stale. Unit 3B's review (F2) established that this confirmation must
name what is *actually* about to be destroyed. Minimal fix: recompute in `handleConfirmFileLink`.
**Confidence:** high (read); low impact.

### F13 · **[MINOR]** Assumption 1 is guarded by a comment, not a mechanism
`src/App.tsx` — every write handler is `async`, and ~40 existing tests depend on the `else`
(localStorage) branch containing zero executed `await`s. `.claude/rules/00-process.md` ("prose is not
mechanism") asks for a hook/test/CI job rather than an assertion. The failure mode is loud (tests break),
not silent, so this is maintainability, not correctness — but the breakage will look inexplicable to
whoever hits it. Minimal fix: one lint rule or a comment-anchored test naming the invariant, or accept it
explicitly in the build note. **Confidence:** high.

### Good, briefly
`parsePinsPayload` as a single shared validation boundary is the right refactor and is genuinely proven by
the conflict-marker test; the four planted-regression cycles are real self-proving work; the
`useCallback([], …)` reasoning is correct; the CSS specificity trap from Unit 3B was pre-empted rather than
repeated; the charter edit is accurate and necessary.

---

## Step 5 — Sign-off

- **VERDICT: No.** Three Done-when bullets are not met. (1) *"every read and write (add, edit, delete,
  import/export) goes through that file"* — export doesn't (F3), and import does so destructively (F1).
  (2) *"an unreadable linked file … no data loss"* — F1 loses the file's contents with no snapshot while
  reporting that nothing was there. (3) *"the link persists across reloads"* is unverified end-to-end
  (F5). F2 additionally breaks `CLAUDE.md` #3's "degrade to empty-but-usable" requirement.

- **TEST + LINT (observed, not reported):**
  - `npm test` → **186 passed, 12 files, 0 failed** (2.37 s).
  - `npm run lint` → clean, **0 errors / 0 warnings**.
  - `npm run typecheck` (`tsc --noEmit`) → clean.
  - `npm run build` → succeeds, 89 modules.
  - Reviewer probes (11 tests, run against a `/tmp` copy of `src` with the repo's own `fakeFileHandle`):
    F1, F2, F3, F6, F9 reproduced; edit/delete/undo-while-linked verified working.

- **TOP 3 FIXES (priority order):**
  1. **F1** — hard-abort the linked-file import when the pre-replace read (and therefore the snapshot)
     fails; never emit "There was nothing saved before this import" for a file that couldn't be read.
  2. **F2** — don't adopt a handle whose read failed: stay on `localStorage`, offer Reconnect, and add an
     **Unlink** control (wiring the already-written `forgetFileHandle`, F8) so a broken link is escapable.
  3. **F3 + F4** — make Export read the linked file, and pretty-print the file serialization so git can
     actually merge the file the unit exists to sync.

- **WHAT I COULD NOT VERIFY (after trying):**
  - **Real-browser behaviour**: the native pickers, a real permission prompt on reconnect, and — the big
    one — whether a real `FileSystemFileHandle` round-trips through real IndexedDB and re-permissions in
    one click (F5). Blocked: jsdom has no File System Access API and `fake-indexeddb` cannot clone a
    function-bearing handle; the builder also reports no Chrome pass this session.
  - **How reachable F1 is in Chrome specifically**: whether `createWritable()` can succeed on a handle
    whose `getFile()` throws. I reproduced it against the project's own fake; I could not test real Chrome.
    Note this affects *likelihood* only — the missing hard-abort is a defect either way.
  - **Interleaved concurrent writes** to the linked file. There is no serialization around the async
    read-modify-write, so two in-flight writes could last-writer-wins. I tried to build a reproduction
    (double map click while armed, double Save) and **could not** — React flushes `armed = false` between
    dispatched clicks, and the double-Save case resolves correctly. Unproven risk, not a finding.
  - **The mount-effect race** (builder's least-confident spot #1): I confirmed the settled DOM is correct
    and the ordering is safe (the localStorage effect is fully synchronous, so it always completes first),
    but I did not measure the intermediate flash. Judged harmless; agreed with the builder here.

- **SINGLE BIGGEST RISK:** A pull-then-import (or any read hiccup) on a linked file silently overwrites
  the file's contents with no snapshot while the banner tells the user nothing was there — the one class
  of failure this project's whole backup discipline exists to make impossible.
