# Unit 3 Section B — Export / import JSON

Decision log for the reviewer. Spec: `docs/roadmap.md` §"Unit 3 — Section B".

## Why this, why now

`localStorage` is one browser profile on one machine. A new laptop, a different browser, or "clear
browsing data" loses every visit note permanently — and notes are prose, not data that can be
reconstructed from anything else the app knows. Section A (fit-to-pins) closed the "see it all at a
glance" half of unit 3's title; this closes the "keep it" half. It comes second because it was scoped
that way and shares nothing with Section A — no code, no ordering constraint.

The roadmap had already settled the hard design question before this build started: **import replaces
the whole store**, not a merge, for three reasons recorded there — `Pin` has no `updatedAt` so "newest
wins" isn't implementable, ids are `crypto.randomUUID` so the same restaurant pinned on two machines
gets two different ids (merge → duplicates, not sync), and there's no delete yet to clean duplicates up
if it did. That decision is not revisited here; this build is the mechanism for it.

## Codebase impact

| Path | What it does |
| --- | --- |
| `src/storage/importExport.ts` (new) | `parseImportPayload` (file text → validated `Pin[]`, or throws `ImportError`), `exportFilename`, `importPins` (snapshot + replace). Storage-boundary logic, no React. |
| `src/storage/importExport.test.ts` (new) | 13 tests: parse boundary, filename, snapshot-then-replace, hard-abort, and the spec's literal round-trip test. |
| `src/storage/pinStore.ts` | `backupCorruptStore`'s docstring widened — it now has two callers (corrupt-read recovery, and this unit's pre-import snapshot). No behavior change. |
| `src/components/ImportExport.tsx` (new) | The sidebar control: Export button, file input, pending-confirm/cancel step. Owns file reading and validation; App owns the actual store write. |
| `src/components/ImportExport.test.tsx` (new) | 7 tests over the component in isolation. |
| `src/App.tsx` | New `handleImportReplace`, `importInfo` banner state (cleared alongside `saveError` in the existing handlers), `<ImportExport>` rendered after `<Legend>`. |
| `src/App.test.tsx` | 6 new tests driving the real file input against the real `localStorage`. |
| `src/test/setup.ts` | Stubs `URL.createObjectURL`/`revokeObjectURL` for jsdom (see Design decisions). |
| `src/index.css` | `.import-export*` rules (mirrors the existing `.add-pin`/`.pin-editor` button blocks) and `.banner--info`. |

Nothing else in the app changes shape. `parsePin` and `serializePins` — the two real boundary
primitives — are reused as-is; this unit adds no second implementation of per-record validation or
serialization.

## Design decisions

**Reuse `parsePin` and `serializePins`; do not reuse `loadPins`'s error type for files.**
`parseImportPayload` calls `parsePin` per record — the same function `loadPins` uses — so a file can
never import a pin the store would refuse to hold, and legacy (pre-notes) records import on identical
terms to a fresh `localStorage` read, verified by test. Export literally calls `serializePins`, so
"byte-for-byte what round-trips back in" is true by construction, not by keeping two formats in sync by
hand. What I did **not** reuse is `PinStoreError` for file-parsing failures: introduced `ImportError`
instead. The array/duplicate-id checks in `parseImportPayload` are ~10 lines that look like `loadPins`'s
— judged worth the small duplication over a shared helper parameterized on which error class to throw,
which would have been the generic-constructor kind of abstraction `CLAUDE.md` calls drift for a
one-off.

**The pre-import snapshot reuses `backupCorruptStore` outright, per the roadmap's own words** ("same
mechanism as backupCorruptStore"). The function already does exactly what's needed — copy whatever is
currently stored to a timestamped key, return `null` if there was nothing, throw if the copy fails — and
it doesn't care whether those bytes are valid or corrupt. I widened its docstring to name the second
caller rather than rename it; a rename would have touched the corrupt-read path (`App.tsx`,
`pinStore.test.ts`) for no behavior change, which is churn Section B doesn't need to make.

**Confirmation is in-sidebar state, not `window.confirm`.** The roadmap requires "an explicit
confirmation naming the counts". `AddPinForm` already has this exact shape for arming a placement
(controls → an armed sub-state with Cancel), so `ImportExport` does the same: picking a file only
*parses* it into `pending`; nothing is committed until Replace is clicked. This also sidesteps a real
testability cost — a native `confirm()` blocks the calling thread, which is awkward under jsdom and
would have made the App-level round-trip test (this unit's headline assertion) much harder to drive.

**`ImportExport` owns file I/O; `App` owns the write.** `FileReader` and `<input type="file">` are DOM
concerns, so the component reads and validates the file itself and only calls `onImport(pins)` once the
user confirms. `App.handleImportReplace` is the only function that touches `storage`, matching how
`handleMapClick`/`handleSaveEdits` are already the sole write paths for their flows.

**`handleImportReplace` does NOT call `storedPinsForWrite()`.** The add/edit paths deliberately re-read
the store immediately before writing, so a stale tab can't clobber what another tab added since load
(unit 2's hardened guard). Import is different on purpose: the user just confirmed "replace the store
with exactly this file, N leads for M". Re-merging in whatever another tab wrote in between would
silently turn a confirmed replace into a partial one — the store would end up holding neither the file
nor the pre-confirmation state, and not matching either count the user just approved. `importPins`
still snapshots whatever is *actually* in storage right before writing (not the possibly-stale React
`pins`), so the backup itself is never stale even though the replace doesn't merge.

**`setSelectedPinId(null)` on every successful import**, not just when the open pin's id is absent from
the new set. The obviously-necessary case (different ids) is already handled for free — `pins.find`
returns nothing and `selectedPin` computes to `null`. The reason to reset unconditionally is the
sharper case: an imported file that reuses the open pin's id with different data (a plausible
restore-from-backup shape). `PinEditor` is mounted with `key={selectedPin.id}` — same id, no remount —
so without the explicit reset the editor would keep showing whatever it already held (a *fourth* copy of
that pin's state, stale, alongside the two just-swapped in storage and the `pins` array). Caught by
planting the regression during self-review; see "Self-review" below.

**Export reads the component's `pins` prop (React state), not a fresh `loadPins(storage)` call.** Export
never writes, so the worst case of a concurrent other-tab write is exporting a snapshot one save behind
what's on disk — not data loss, and it matches what the sidebar count already displays ("N leads on the
map"). Re-reading fresh on every click for a read-only action would be solving a problem the multi-tab
tests don't actually pose here.

**jsdom needs a stub for `URL.createObjectURL`/`revokeObjectURL`.** Verified directly: jsdom implements
`Blob` and `File` (from Node's own globals) but not the blob-URL registry — calling
`URL.createObjectURL` under jsdom throws `TypeError: URL.createObjectURL is not a function`. Without a
stub, every component test that clicks Export would fail regardless of whether the export logic is
correct, which would have meant either not testing Export at component level at all, or only testing it
in the browser. Stubbed once in `src/test/setup.ts` (same file that already stubs the Leaflet container
size for the same reason: a real jsdom gap, not app behavior), documented inline, and narrow: it only
installs the stub if the real one isn't present, so a jsdom version that adds support later is
unaffected. Tests that need the actual content `vi.spyOn(URL, 'createObjectURL')`, which wraps the stub
and still calls through to it.

## Load-bearing assumptions

1. **(Load-bearing, verified.)** jsdom lacks `URL.createObjectURL`/`revokeObjectURL` but has a working
   `FileReader`, `Blob`, and `File` under the `.tsx` (jsdom) environment — confirmed by direct
   experiment before writing any component code, not assumed. This is what makes it possible to test
   Import fully at the component/App level and Export down to the exact Blob content, while only the
   real anchor-click download mechanic needs the browser check below.
2. **(Load-bearing.)** `FileReader.readAsText` is asynchronous even for an in-memory `File` under jsdom
   — confirmed by experiment. Every test that selects a file awaits the resulting UI change (`waitFor`)
   rather than asserting immediately after `fireEvent.change`; getting this wrong would have produced
   tests that pass by accident (assertions racing a callback that hasn't fired) rather than by
   verifying anything.
3. **(Load-bearing.)** `importPins` never needs to be re-entrant or interruptible — `backupCorruptStore`
   then `savePins` run synchronously in one call, so there's no window where a second import (or any
   other write) could interleave. Matches how the rest of the store is used; nothing here introduces
   concurrency that didn't already exist.
4. **(Minor.)** The confirmation counts current `pins.length` (in-memory) as "saved leads", not a fresh
   `loadPins(storage)` — same reasoning as the export-freshness decision above; the number the user is
   confirming against is the number they can already see in the sidebar.
5. **(Minor.)** `exportFilename` uses the UTC date, not the browser's local date, so a laptop set to a
   timezone behind UTC never gets a filename dated "tomorrow". Covered by test at a near-midnight
   instant.

## Deliberately not done

- **Merge or per-pin conflict resolution.** Rejected in the roadmap itself, not deferred — building it
  later needs `updatedAt` and delete first.
- **Scheduled/automatic backups, cloud sync, any format but JSON.** Out of scope per the roadmap; this
  project has no backend and isn't getting one for this unit.
- **Blocking import while an edit draft is open or a placement is armed.** The confirmation step already
  states this is a replace; an unsaved draft was already only ever held in memory (never persisted), so
  losing it to an import is the same risk as losing it to closing the tab, not a new one this unit
  introduces. Adding a second, import-specific warning would be scope beyond what the spec asks for.
- **Disabling Export at zero pins.** Exporting `[]` is harmless and simpler than adding a condition for
  it.
- **Retrying a failed `importPins` automatically, or partial rollback of a stray backup key.** If
  `backupCorruptStore` succeeds but `savePins` then fails (e.g. quota), a snapshot key exists that
  didn't strictly need to — harmless (an extra recovery point, not silently lost data) and not worth
  add complexity to avoid, matching how the corrupt-read path already accepts the same trade.

## Least confident about

1. **The `setSelectedPinId(null)` reasoning above.** The "different ids" case needs no explicit code at
   all (verified: removing the line and testing only that case, the suite stayed green). The line
   exists entirely for the same-id-different-data case, which I had to go looking for — it's the kind
   of thing that's easy to read as defensive-but-unnecessary on a first pass. I added a second,
   specific test for exactly that shape (`App.test.tsx`, "closes the editor even when the imported file
   reuses the open pin's id with different data") after the first version of the test didn't catch the
   regression at all; worth the reviewer's second look.
2. **`ImportError` as a new class rather than reusing `PinStoreError`.** Both are "a named error from a
   validation boundary that rejects the whole payload". I judged the semantic mismatch (a *file* is not
   *the store*, and `PinStoreError`'s message is literally prefixed `"Pin store: "`) worth a second
   class; a reviewer could reasonably call this an unnecessary third error type in a small codebase that
   already has `InvalidPinError`, `PinNotFoundError`, and `PinStoreError`.

## Self-review against the project's bar

- **Core-logic correctness** — `parseImportPayload` reuses `parsePin` (already covered by 16 tests in
  `pin.test.ts`) and adds its own boundary checks (array shape, duplicate ids), each with a hand-written
  test. `importPins`'s snapshot-then-replace is tested against a fake store with explicit before/after
  assertions.
- **The acceptance bar, not a proxy** — the round-trip test is the spec's own scenario, written almost
  verbatim: export, wipe, import the same file, assert the store is byte-identical (`toBe`, not
  `toEqual`, against `serializePins`'s output). The App-level tests drive the real `<input type="file">`
  with a real `File` and read the result back out of real `localStorage`, not out of component props.
- **Reproducibility** — `exportFilename` and `importPins` both take an injectable `now`; the filename
  test asserts determinism directly (`exportFilename(now) === exportFilename(now)`) rather than only
  checking the format.
- **Boundaries and types** — every record entering the store from a file goes through `parsePin`; the
  array/non-array and duplicate-id checks are structural, not best-effort. Edge cases covered by test:
  legacy (no-`notes`) records, unicode/multi-line notes, a file with one invalid record among otherwise
  valid ones (whole file rejected, not partial), a UTC-midnight filename.
- **Meaningful tests, proven by planting the regressions** — five planted during the build, each caught,
  each restored:
  1. `importPins` skipping the pre-import backup → 2 tests fail (`importExport.test.ts` snapshot-key
     assertion, `App.test.tsx` backup-key-exists assertion).
  2. `parseImportPayload` silently dropping invalid records instead of rejecting the file → 3 tests fail
     across all three test files (pure logic, component, App).
  3. Removing the duplicate-id check → 2 tests fail (pure logic, component).
  4. Skipping `setSelectedPinId(null)` on import → **the first version of the regression test did not
     catch this** (different-id case is structurally covered for free by `pins.find`). Rewrote the test
     to the same-id-different-data case; the regression then failed it as expected. Documented above as
     the thing least confident about, since it's exactly the kind of gap a first-pass reviewer could
     also miss.
- **Known gap:** the actual browser download mechanic (`Blob` → `createObjectURL` → anchor click →
  `revokeObjectURL`) is not exercised by jsdom's navigation machinery — clicking the anchor logs
  jsdom's own `Not implemented: navigation to another Document` to stderr in the test run. This is a
  jsdom limitation (it doesn't special-case the `download` attribute the way real browsers do), not a
  test failure — all 92 tests pass — and the actual download was verified in Chrome (see below), where
  the browser saves the file rather than navigating and the console stays clean.

## In-browser verification (Google Chrome)

Seeded 3 pins (Lisbon strong, Porto weak, one NYC failed) with multi-line, unicode, quote-bearing notes.
**Export**: clicked Export as JSON → `~/Downloads/restaurant-map-2026-08-04.json` appeared, contents
byte-identical to the seeded pins (diffed directly). **Import onto an empty store**: cleared
`localStorage`, reloaded, uploaded that same file → confirmation read *"Replace 0 saved leads with the 3
leads in "restaurant-map-2026-08-04.json"?"* (matches the roadmap's own example phrasing) → confirmed →
all 3 pins restored, `localStorage` byte-identical to the original seed, no backup key created (there
was nothing to back up). **Import over existing data**: seeded one pin, uploaded a different 2-pin file
→ confirmation read *"Replace 1 saved lead with the 2 leads…"* → confirmed → store now holds exactly the
2 new pins, a `restaurant-map.pins.v1.corrupt-<timestamp>` key held the original 1 pin exactly, and the
sidebar banner named that key. **Invalid file**: uploaded a file with a bad `strength` value → error
*"Import: the file contains an invalid pin"* shown immediately, no confirmation step offered, store
verified unchanged. **Cancel**: picked a valid file, clicked Cancel → store verified unchanged, no
backup key created. Console clean across every step. Fixture leads and the fixture download cleared
from that origin/folder afterward.
