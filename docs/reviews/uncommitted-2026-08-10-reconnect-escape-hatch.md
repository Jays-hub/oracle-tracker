# Review — uncommitted 2026-08-10: reconnect escape hatch + remember-failure warning

Adversarial, cold-context review. Read-only over the repo; this file is the reviewer's only artifact.

**Diff base.** `git status --short` on branch `main` at `9acd7a1`, four modified tracked files, nothing
untracked: `src/App.tsx`, `src/App.test.tsx`, `src/components/DataFileLink.tsx`,
`src/components/DataFileLink.test.tsx`. Scoped by `git diff` (working tree vs. `9acd7a1`); I read the
whole of both changed source files, not just the hunks. Judged against `CLAUDE.md` #3 (product
DONE-WHEN), `docs/roadmap.md` § "Unit 6 B — Git-syncable storage", and `.claude/rules/00-process.md`.

**No decision log exists for this change** (`docs/build_notes/` has notes for prior units only, and
`docs/progress_log.md`'s newest entry is Unit 6's close). Intent below is inferred from code and from
the comments the change itself carries; every inference is flagged.

---

## Step 0 — What this change had to deliver (my words), and one conflict worth naming first

- **Make a remembered file handle escapable.** Before this diff, a recalled handle replaced the
  choose/create controls with a lone `Reconnect` button. If that file was renamed, deleted, or simply
  the wrong one, `Reconnect` was the only control and it could only fail — no in-app way to link a
  different file. The diff adds `Forget this file` to the reconnect state, wired to the existing
  `handleUnlink`. This closes the reconnect-state half of the prior review's F2/F8.
- **Stop swallowing a failed "remember".** `await rememberFileHandle(handle).catch(() => {})` became
  `rememberLink()`, which returns a warning string that is surfaced as `fileLinkError` on both link
  paths. Deliberately a warning, not an abort — the link still works for the session.
- **Tell the user where the permission prompt is.** The denied-reconnect error and the reconnect
  paragraph now say the prompt opens in browser chrome at the top of the window.
- **"Done when"** for this slice, inferred: a remembered handle is never a dead end; a link that can't
  be remembered says so instead of evaporating silently; nothing else regresses. It must also not break
  `CLAUDE.md` #3 (pins render in the right color and survive a full reload) or Unit 6B's Done-when.

**Conflict to name up front (not papered over).** `src/App.test.tsx:1628-1632` states this was *"Found by
hand-running the walkthrough in real Chrome (F5) … Clearing site data in DevTools was the only escape."*
`docs/progress_log.md`'s Unit 6 close entry says the opposite about that walkthrough: *"Could **not**
complete the full create → link → reload → reconnect walkthrough."* One of those is now stale. The
comment implies a reload **did** surface a remembered handle in real Chrome — which is direct evidence on
Unit 6B's headline bullet ("the link persists across reloads") — yet no artifact records it, and the
comment never says whether one Reconnect click then actually restored the file's pins. Unit 6B's most
load-bearing unverified claim is therefore *still* unverified in the record while a code comment hints it
was partly answered. See F7.

---

## Step 2 — Hunt list

| Area | Verdict |
|---|---|
| Core logic: `Forget` in the reconnect state reaches `handleUnlink` and restores choose/create | **pass** (verified-by-running, probe P1/P5) |
| Core logic: `handleUnlink` genuinely re-reads `localStorage` rather than trusting state | **pass** (verified-by-running, P5: storage changed underneath → 2 markers after Forget) |
| Core logic: `rememberLink` warning reaches the UI on **both** link paths | **pass** (verified-by-running, P3 confirms the untested confirm/existing-file path also warns) |
| Concurrency: `Forget` vs. an in-flight `Reconnect` permission request | **fail** — F1, reproduced both ways (P7a re-links a just-forgotten file; P7b posts an error naming a vanished button) |
| Error handling: failure of the escape hatch itself (`forgetFileHandle` rejects) | **fail** — F2, silently swallowed at `App.tsx:377`; reproduced, incl. the stranded state returning after a reload (P2) |
| Boundary integrity: banner state after the escape hatch runs | **fail** — F3, "use Reconnect below" survives the removal of the Reconnect button (P1) |
| Anti-drift: does `Forget` do more than forget? | **concern** — F4: full store-replace ceremony (map remount + re-fit, editor closed, placement disarmed) for a state where no data changed |
| Tests meaningful (would they fail on the bug feared?) | **concern** — the remember-warning test is genuinely self-proving (mutation M3 fails it); the forget test's "and browser storage" half is vacuous (mutation M1 leaves it green) — F5 |
| Test coverage of the new code paths | **concern** — F6: no test for the warning on the confirm/existing-file path; no test for a failed forget; no test for the race |
| Persistence lossless + durable (`CLAUDE.md` #3) | **pass** for the ordinary path (verified-by-running, P8: multi-line + curly-quote notes round-trip byte-identical through a simulated full reload, 3/3 markers back); **concern** via F1's granted-race, where post-forget writes land in a file the app will not reopen |
| Lead-strength → color total, fixed mapping (`CLAUDE.md` #3) | **pass** (verified-by-running, not read off the legend: rendered marker HTML is `background:#2e9e4f` / `#e8a33d` / `#d64545` for strong/weak/failed; `colorForStrength` throws rather than defaulting; `satisfies Record<LeadStrength,string>` keeps it exhaustive) |
| Local-first, standalone (`CLAUDE.md` #2) | **pass** — no network surface added; no backend/accounts/places API; File System Access + IndexedDB only |
| Degrade to empty-but-usable or fail loud, never crash | **pass** — Forget leaves localStorage active and readable; no crash in any probe |
| Reproducibility / determinism / absolute paths | **pass** — no new randomness, no new paths, no ordering dependence |
| Structure / style / CSS | **pass** — the Unit 3B specificity trap was avoided again: `.data-file-link button.data-file-link__unlink` (class+element) beats `.data-file-link button`, so `Forget this file` renders grey, not the blue default |
| "Prose is not mechanism" (`00-process.md`) | **concern** — F7 (browser evidence lives only in a test comment; no build note, no progress-log entry) and F8 (a comment justifying an ordering constraint that does not exist) |

---

## Step 3 — Where a subtle bug would hide here, and what I found

1. **The gap between "the user clicked Forget" and "the permission promise resolves."** `handleReconnect`
   captures `handle` in a local, `await`s `requestReadWritePermission`, and then acts with **no re-check
   that this handle is still the current one**. Putting a second button next to `Reconnect` is exactly
   what makes that window clickable. Looked deliberately, drove it, and it reproduces both ways — **F1**.
2. **The escape hatch's own failure mode.** The diff argues at length that a silent `.catch(() => {})`
   is unacceptable for `rememberFileHandle`, and leaves the identical swallow on `forgetFileHandle`, the
   one call this change exists to make. Reproduced the silent-success plus the stranded-again reload —
   **F2**.
3. **State that `handleUnlink` does *not* reset.** It clears `fileLinkError` but not `loadError` /
   `loadErrorBackend`, and the `file-unreadable` copy is written to point at a control Forget removes.
   Reproduced — **F3**. The same handler *over*-resets elsewhere (map view, selection, arm state) — **F4**.

---

## Step 4 — Findings

### F1 · **[MAJOR]** `Forget this file` does not cancel an in-flight `Reconnect`; a late permission grant re-links the file the user just forgot
`src/App.tsx:343-363` (`handleReconnect`), reachable because of `src/components/DataFileLink.tsx:106-113`

**What's wrong.** `handleReconnect` does `const handle = reconnectHandle;` then `await
requestReadWritePermission(handle)` and, on `'granted'`, `await adoptLinkedFile(handle)` — with no check
that the handle is still current. The prompt is browser chrome and the page stays interactive (the
change's own comment at `:349-354` says so). So the user can click `Forget this file` while the prompt is
open. `handleUnlink` deletes the IndexedDB record and returns the UI to choose/create; the pending
promise then resolves and adopts anyway.

**How I confirmed it.** Probe against the real `App` with a hand-controlled `requestPermission`
(`/tmp/rmprobe/src/probe2.test.tsx`):
```
P7a PANEL AFTER FORGET:          Sync via file | Choose existing file… | Create new file…
P7a PANEL AFTER PROMPT RESOLVES: Linked to “pins.json”. Every read and write goes through this file…
P7a MARKERS: 1   P7a EDITOR SHOWS PIN: From File     <- the file's pin, not localStorage's
P7a forgetFileHandle calls: 1 | rememberFileHandle calls: 0
P7b ALERTS: ["Access to that file was not granted. … click Reconnect and choose “Allow”, or forget the file…"]
P7b RECONNECT BUTTON PRESENT: false
```
**Consequence.** Two shapes. (a) `granted`: the app becomes linked to a file the user explicitly
disconnected, `rememberFileHandle` was never called for it and the record was just deleted — so every pin
added afterwards is written to that file and is **gone from view after the next reload**, which is
`CLAUDE.md` #3's persistence bar failing silently. (b) `denied` — the likelier one in Chrome, since the
change's own comment says clicking into the page dismisses the prompt: an error banner telling the user to
"click Reconnect" while no Reconnect button exists.

**Minimal fix.** Hold the current reconnect handle in a ref (or a generation counter) and bail out after
the `await` if it is no longer the current one; additionally disable both buttons while a request is in
flight. Same guard belongs on `adoptLinkedFile`'s startup path.

**Confidence.** High that the code path exists and behaves as shown (reproduced). Medium on how reachable
variant (a) is in real Chrome — it needs the prompt to survive a page click, which the change's own
comment doubts. Variant (b) is reachable on the comment's own account. **If (a) is reachable in Chrome
this is a BLOCKER, not a MAJOR** — that is exactly the question a 2-minute browser check settles, and I
could not run it (jsdom has no File System Access API).

---

### F2 · **[MAJOR]** The escape hatch's own failure is swallowed by the exact `.catch(() => {})` this change declares unacceptable
`src/App.tsx:377` — `await forgetFileHandle().catch(() => {});`

**What's wrong.** The diff replaces `await rememberFileHandle(handle).catch(() => {})` with a warning
path, arguing in `src/App.tsx:398-406` and `src/App.test.tsx:1652-1655` that a silent catch there is
unacceptable because "the link is one reload from evaporating with no explanation." The symmetric —
and more consequential — swallow on `forgetFileHandle` is left untouched. On failure the UI still
switches to choose/create, i.e. it *asserts* the handle was forgotten, and the next reload recalls it.

**How I confirmed it.** Probe `P2`: `forgetFileHandle` rejects with `IndexedDB unavailable`, then a
second `render(<App />)` simulates the reload:
```
P2 ALERTS AFTER FAILED FORGET: []                    <- nothing said
P2 UI CLAIMS FORGOTTEN (choose/create shown): true
P2 AFTER RELOAD — stranded on Reconnect again: true
```
**Consequence.** The one thing this change ships — "a remembered handle is never a dead end" — silently
does not hold across a reload when the delete fails. The user is returned to the state they used
DevTools to escape from, with no explanation and no reason to suspect the button lied.

**Minimal fix.** Mirror `rememberLink`: catch, and set a named `fileLinkError` ("Stopped using
“pins.json” here, but this browser couldn't forget it — it may reappear after a reload").

**Confidence.** High on mechanism (reproduced). Reachability is narrower than the remember case: if
`indexedDB` is entirely absent or `openDb` always fails, `recallFileHandle` fails too and no reconnect
state appears at all, so this needs a *transient* or delete-specific failure. It is still a silent catch
on the one operation whose success the UI asserts, held to a standard the same diff sets.

---

### F3 · **[MAJOR]** After `Forget this file`, the error banner still tells the user to "use Reconnect below" — the button it just removed
`src/App.tsx:376-396` (`handleUnlink` clears `fileLinkError` but never `loadError` / `loadErrorBackend`),
text at `src/App.tsx:1046`

**What's wrong.** The `file-unreadable` startup path (a remembered handle whose file is gone/renamed —
precisely the case the new button exists for) sets `loadError` + `loadErrorBackend='file-unreadable'`,
whose copy ends "use Reconnect below to try the file again." `handleUnlink` removes the Reconnect control
and leaves that banner standing.

**How I confirmed it.** Probe `P1` (recalled handle, `permission: 'granted'`, `getFile()` rejects
`NotFoundError`):
```
P1 BEFORE ALERTS: ["Couldn’t read the linked file: NotFoundError. Your browser-saved data is untouched
                    and stays active — use Reconnect below to try the file again."]
P1 AFTER  ALERTS: [ …identical… ]
P1 RECONNECT BUTTON PRESENT: false     P1 MARKERS: 1
```
**Consequence.** The success state of the new escape hatch contradicts itself: a red banner reporting an
active linked-file problem, instructing the user to click a button that no longer exists, on an app that
is now correctly running on browser storage. It persists until some later write happens to call
`setLoadError(null)`. The same gap applies to a stale `saveError` after unlinking from the linked state.

**Minimal fix.** In `handleUnlink`, clear `loadError`, `loadErrorBackend` and `saveError` when the error
came from the file backend (`'file-unreadable'` / `'file-corrupt'`), leaving a localStorage-origin error
alone.

**Confidence.** High (reproduced).

---

### F4 · **[MINOR]** Forgetting a handle that was never adopted runs the full store-replace ceremony: the map jumps, the open editor closes, an unsaved notes draft is lost
`src/App.tsx:376-396`

**What's wrong.** In the reconnect state nothing is linked — the app is already on `localStorage` and
already showing its pins. `handleUnlink` nevertheless re-seeds `pins`, recomputes `initialView`, bumps
`mapEpoch` (forcing a `MapView` remount and a fit-to-all-pins), clears `selectedPinId`, disarms placement
and clears `importInfo`. None of that is warranted by a data change, because there wasn't one.

**How I confirmed it.** Probe `P4` with a saved view far from the pins:
```
P4 SAVED VIEW BEFORE: {"center":[1,1],"zoom":5}
P4 SAVED VIEW AFTER:  {"center":[1,1],"zoom":5}    <- unchanged on disk
P4 MARKERS AFTER: 2                                <- but the map remounted and re-fit in-session
```
**Consequence.** Three small ones: (1) the map yanks away from where the user was looking with no data
reason, and the in-session view now disagrees with what a reload restores (Unit 6A's "a saved view wins"
holds on reload but not here); (2) `setSelectedPinId(null)` closes `PinEditor`, and `PinEditor`'s own
close copy says closing discards the draft — so unsaved notes typed before clicking a sidebar button
labelled "Forget this **file**" are lost; (3) `importInfo` is wiped.

**Minimal fix.** Branch `handleUnlink`: when `linkedHandle === null` (reconnect-state forget), just
`forgetFileHandle()` + `setReconnectHandle(null)` + clear the file error state — skip the re-seed,
remount, selection reset and disarm.

**Confidence.** High (reproduced).

---

### F5 · **[MINOR]** The new forget test's "and browser storage" claim is vacuous — it passes with the storage re-read deleted
`src/App.test.tsx:1636-1650`, specifically `expect(markers()).toHaveLength(1); // localStorage's pin, still readable`

**What's wrong.** In the reconnect state the map already renders localStorage's one pin *before* the
click, so the assertion cannot distinguish "handleUnlink re-read storage" from "nothing happened."

**How I confirmed it.** Planted-violation run (mutation **M1**) on a `/tmp` copy: deleted
`setPins(seed); setInitialView(initialViewForPins(seed)); setMapEpoch(...)` from `handleUnlink`, then ran
this test alone → **passed**. (Running the whole `App.test.tsx` under M1 does fail — but on the
pre-existing *linked-state* Unlink test at `:1945`, not on the new one. So the behavior is covered
elsewhere; the new test's name over-promises.)

**Consequence.** Minor now, real later: the test reads as coverage for the reconnect-state re-read and
isn't.

**Minimal fix.** Change localStorage underneath before clicking Forget and assert the map picks it up —
my probe `P5` does exactly this and yields 2 markers, so the assertion has teeth.

**Confidence.** High (mutation-verified).

---

### F6 · **[MINOR]** Untested new paths: the warning on the existing-file link path, a failed forget, and the race
`src/App.tsx:588` (confirm path), `:377` (forget), `:343-363` (race)

The remember-warning test covers only the *create-new/empty-file* branch (`linkFile`, `:487-494`). The
`handleConfirmFileLink` branch has its own call site and its own ordering claim and is untested; I
verified by hand that it does warn (probe `P3` → the alert text appears), so this is a coverage gap, not
a bug. F1 and F2 are untested by construction. Credit where due: the shipped warning test **is**
self-proving — mutation **M3** (re-swallow: `return null` instead of the warning string) fails it at
`src/App.test.tsx:1669`, exactly as `00-process.md` asks.

**Confidence.** High.

---

### F7 · **[MINOR]** The only record of the real-Chrome finding is a code comment, and it contradicts the progress log
`src/App.test.tsx:1628-1632` vs. `docs/progress_log.md` (Unit 6 close entry)

The test comment asserts a hand-run Chrome walkthrough that discovered the dead end and needed DevTools
"clear site data" to escape. No `docs/build_notes/` entry and no `docs/progress_log.md` entry exists for
this change; the newest progress-log entry still says the create→link→reload→reconnect walkthrough could
not be completed. Two costs: (1) `00-process.md`'s "relay from the artifact, not the chat" and the
repo's own convention (decision logs in `docs/build_notes/`) are bypassed — the evidence lives where
nobody looking for the unit's status will find it; (2) the comment implies a reload *did* re-surface a
remembered handle in Chrome, which is partial evidence on Unit 6B's still-open headline bullet ("the link
persists across reloads … at most one permission click"), and that evidence is being thrown away because
it was never written down. The one thing still missing is whether a Reconnect click then restored the
file's pins.

**Minimal fix.** Write the build note / progress-log entry, stating explicitly what the Chrome session
did and did not establish about reload persistence.

**Confidence.** High (both texts read directly).

---

### F8 · **[NIT]** A comment justifies an ordering constraint that does not exist
`src/App.tsx:586-588` — *"Last, so the state resets above can't clear it."* None of the setters between
the `rememberLink` call and this line touches `fileLinkError` (`setSaveError`, `setLoadError`,
`setDeleteInfo`, `setPendingFileLink`, `setImportInfo`, …). The ordering is harmless, but the comment
asserts a guard that nothing enforces — if a future edit adds a `setFileLinkError(null)` there, the
comment will still read as if the ordering protects it. Minimal fix: state it as a preference, or add the
assertion to the test.

### F9 · **[NIT]** Duplicated "top of the window" copy, and a latent test fragility
`src/App.tsx:355-359` and `src/components/DataFileLink.tsx:96-99` both carry the sentence. After a denied
reconnect both render at once, so the sidebar says it twice. Separately,
`src/components/DataFileLink.test.tsx:74-77` uses `getByText(/top of the window/i)`, which throws on
multiple matches — it passes only because that test renders with `error={null}`. Minimal fix: keep the
wording in one place (the paragraph) and shorten the error to "Access was not granted — choose Allow in
the browser prompt, or forget the file."

### Good, briefly
The escape hatch is the right fix for the right defect, `rememberLink` is a genuine de-silencing with a
mutation-proof test behind it, and the CSS specificity trap from Unit 3B was avoided again
(`.data-file-link button.data-file-link__unlink`).

---

## Step 5 — Sign-off

- **VERDICT: No.** The product DONE-WHEN (`CLAUDE.md` #3) still holds — I verified it by running: colors
  render `#2e9e4f`/`#e8a33d`/`#d64545` for strong/weak/failed straight off the rendered markers, and a
  multi-line, curly-quoted note round-trips byte-identically through a simulated full reload. But this
  change does not fully deliver its own bar. "A remembered handle is never a dead end" holds only on the
  happy path: it is silently undone across a reload when `forgetFileHandle` fails (F2), it leaves a banner
  instructing the user to click the button it just removed (F3), and it opens a window in which a late
  permission grant re-links the very file the user forgot (F1). Unit 6B's "the link persists across
  reloads" bullet also remains unverified in the record (F7).
- **TEST + LINT (observed, not reported):**
  - `npm test` → **226 passed, 14 files, 0 failed** (2.55 s).
  - `npm run lint` → clean, 0 problems.
  - `npm run typecheck` (`tsc --noEmit`) → clean.
  - Reviewer probes (10 tests against a `/tmp/rmprobe` copy of `src` with the repo's own
    `fakeFileHandle`, real `App`, real Leaflet): F1 (P7a/P7b), F2 (P2), F3 (P1), F4 (P4) reproduced; P3
    and P5 confirmed working behavior; P8 verified colors + reload round-trip.
  - Planted-violation checks: **M1** (delete the storage re-read from `handleUnlink`) → the new forget
    test still passes (F5); **M3** (re-swallow the remember failure) → the new warning test fails, as it
    should.
- **TOP 3 FIXES (priority order):**
  1. **F1** — make `handleReconnect` bail after its `await` if the reconnect handle is no longer current
     (ref/generation check), and disable Reconnect + Forget while a permission request is in flight.
  2. **F2** — surface a failed `forgetFileHandle` as a named warning instead of `.catch(() => {})`; the
     UI must not assert "forgotten" when it isn't.
  3. **F3 + F4** — clear the file-origin `loadError`/`saveError` in `handleUnlink`, and skip the
     store-replace ceremony (remount, re-fit, close editor, disarm) when nothing was actually linked.
- **WHAT I COULD NOT VERIFY (after trying):**
  - **Real-browser behaviour**, which is where this change was reportedly discovered: whether Chrome's
    File System Access permission prompt survives a click on the page (this decides whether F1's
    data-losing `granted` variant is a MAJOR or a BLOCKER), and whether `Forget this file` is actually
    clickable while that prompt is open. jsdom has no File System Access API; I reproduced against the
    project's own fake handle only.
  - **Whether a real `FileSystemFileHandle` survives real IndexedDB and reconnects in one click** — Unit
    6B's headline bullet, carried over as F5 from the prior review and still unrecorded (F7). The new
    test comment implies the recall half works in Chrome; nothing states the one-click restore half does.
  - **How often `forgetFileHandle` can fail while `recallFileHandle` succeeds** in real Chrome (F2's
    reachability). The silent catch is a defect either way; only its frequency is unknown.
  - **The visual result of two buttons in the reconnect row** at the sidebar's `--sidebar-width`: the CSS
    cascade is correct (grey Forget, blue Reconnect), but jsdom has no layout engine, so I could not check
    for wrapping/overflow.
- **SINGLE BIGGEST RISK:** The escape hatch can quietly fail to escape — a forget that IndexedDB refuses
  is never reported, and a permission grant that lands after the forget re-links the abandoned file, so
  pins the user adds next go to a file the app will not reopen on the following reload.
