# Delete a pin — decision log

## Why this, why now

`docs/roadmap.md`'s "Later" list has carried this since unit 2: *"Delete a pin (wants its own
confirm/undo story; deliberately excluded from unit 2's editing)."* Unlike unit 2's fields, a delete is
irreversible by nature — there's no "just edit it back" recovery — which is exactly why it was kept out
of that unit rather than added as a fourth editable field. With units 3A/3B done (fit-to-pins,
export/import) and nothing else queued, this was the next-highest-value item on the list: a lead you
misplaced, duplicated, or decided was never real currently has no way off the map except editing every
field into nonsense.

This item is a "Later" one-liner, not a fully specced roadmap section like 3A/3B — there was no "Done
when" block to build against. I wrote one from `CLAUDE.md`'s real acceptance bar (standing order #3)
plus the roadmap's one clue ("confirm/undo story"), rather than either skipping the ceremony or
inventing scope beyond what that clue implies. See "Scope decisions" below.

## Codebase impact

- **`src/domain/pin.ts`** — new `removePin(pins, id): Pin[]`, mirroring `replacePin`'s shape and
  fail-loud contract (throws `PinNotFoundError` on an unknown id rather than silently no-opping).
- **`src/domain/pin.test.ts`** — 5 new tests for `removePin` (correctness, no-mutation, determinism,
  empty-list edge case, the not-found guard).
- **`src/components/PinEditor.tsx`** — new `onDelete` prop; a "Delete lead" button that arms a
  confirmation (`confirmingDelete` local state) before calling it. Two-step, not one-click, matching how
  `ImportExport`'s Replace is already gated.
- **`src/components/PinEditor.test.tsx`** — 3 new tests (confirmation required, cancel leaves the pin
  alone, the armed confirmation resets on remount to a different pin).
- **`src/App.tsx`** — `deleteInfo` state (holds the just-deleted `Pin`, for Undo); `handleDeletePin`
  (re-reads storage, `removePin`, `savePins`, closes the editor, arms the Undo banner);
  `handleUndoDelete` (re-appends the held pin, with a duplicate-id guard — see below).
  `setDeleteInfo(null)` added everywhere the existing banners (`importInfo`) are already cleared on a
  new action (`handleMapClick`, `handleSelectPin`, `handleSaveEdits`, both branches of
  `handleImportReplace`), plus a new `role="status"` banner rendering "Deleted "X". Undo".
- **`src/App.test.tsx`** — 6 new tests: the delete flow end to end, cancel-leaves-it-alone, Undo restores
  byte-for-byte, the multi-tab re-read guard (same shape as the existing "a stale tab cannot delete
  pins" tests, applied to delete itself), the duplicate-id decline-to-undo path, and Undo clearing on a
  later unrelated action.
- **`src/index.css`** — delete button styles (armed / confirm / cancel) and `.banner__undo`.

No new files, no new dependencies, no storage schema change (`removePin` writes through the existing
`savePins`/`STORAGE_KEY`, same shape as every other write).

## Load-bearing assumptions

- **Delete only lives in the open `PinEditor`, not the map marker/popup.** Mirrors how editing already
  only happens there — one interaction surface for anything that touches a pin's data, not two. Would
  change the approach if wrong (would need popup-level UI + its own confirm state).
- **"Confirm/undo" means: (1) a two-step confirm before the write, and (2) an in-session, single-level
  Undo after it — not a persisted/multi-level undo history.** This is the one genuinely load-bearing
  interpretive call in this unit, since the roadmap line names both a confirm AND an undo without
  specifying what "undo" means. See "Scope decisions" for the reasoning; flagging here because a
  reviewer could reasonably read "undo story" as requiring more.
- **Order doesn't matter.** Undo re-appends the restored pin at the end of the list rather than its
  original index. Nothing else in the app (map, sidebar count, export) treats pin order as meaningful —
  `createPin` already just appends — so preserving original position would be effort spent on an
  invariant nothing reads.
- Minor: reused the exact multi-tab re-read discipline (`storedPinsForWrite()`) unit 2 established for
  add/edit, rather than re-deriving a new write path for delete.

## Scope decisions

**Chose an in-memory, single-delete Undo banner over reusing Section B's whole-store snapshot
mechanism (`backupBeforeImport`).** That mechanism exists to protect a *replace of everything* and
writes a full second copy of the store to a separate `localStorage` key. Reusing it for a single-pin
delete would be exactly the kind of reach-for-sophistication `CLAUDE.md`'s drift rule calls out: it adds
a new snapshot key, a prune policy, and — critically — no restore UI, since the only thing that reads an
import-backup key today is a human copying it out of devtools. An Undo banner that holds the one pin
just removed and re-adds it on click is ~30 lines, needs no new storage key, and actually works as a
button rather than as "the data technically still exists somewhere."

**Rejected: no undo at all, just a confirm.** Would have been simpler, but the roadmap explicitly named
delete as needing more than unit 2's edit-in-place recoverability, and "confirm" alone doesn't cover
"I clicked through the confirmation and still didn't mean it" — the scenario a destructive action's
safety net is actually for.

**Rejected: a snapshot-per-delete file (like the import backup).** Same objection as above, worse: it'd
accumulate a `localStorage` key per delete with no in-app way to browse or restore from one. The
whole-store Export/Import already covers "I need to recover something from further back than my last
action" — building a second, weaker version of that for single pins is duplicated machinery for a
worse result.

**Duplicate-id guard on Undo.** `loadPins` (`pinStore.ts`) treats two pins sharing an id as a corrupt
store — an existing, load-bearing invariant. Undo blindly re-appending the held pin could violate it if
an id has reappeared since the delete (concretely: another tab imports a backup file taken before this
delete, which still contains the old record under the same id). Declining the undo and surfacing an
error is the same "fail loud rather than silently write something wrong" discipline `loadPins` itself
already uses — not new ceremony, just applying the existing one at a new call site.

**Same button label ("Delete lead") for both the arm-click and the confirm-click.** The confirm step's
prose ("Delete "X"? You'll get a chance to undo right after.") is what actually communicates the state
change; the label being literal ("Delete lead" really is the action on both clicks) seemed clearer than
inventing a second verb. Flagged in "least confident" below — this is a genuine judgment call, not
something the roadmap or existing code settled.

## Constraints discovered mid-build

The CSS specificity trap unit 3B's review found and fixed (`.import-export button` at (0,1,1) beats a
single class selector at (0,1,0), regardless of source order) applies identically to `.pin-editor
button`. Applied the same `.pin-editor button.pin-editor__delete` / `…__delete-confirm` /
`…__cancel-delete` combinator pattern from the start rather than repeating that discovery.

## What I deliberately did NOT do

- Delete from the map marker or its popup — editor-only, see "load-bearing assumptions."
- Multi-level undo (undo of an undo, or undoing anything but the single most recent delete).
- Persisting the pending undo across a reload — if the page reloads before Undo is clicked, that delete
  is final, the same as any other unsaved-state loss in this app already is.
- Auto-dismissing the Undo banner after a timeout — it stays until superseded by another action,
  matching how every other banner in this app already behaves (no existing banner auto-dismisses).
- Bulk/multi-select delete.
- Deleting a pin that's mid-edit with unsaved draft changes is allowed without an extra "you also have
  unsaved edits" warning — the delete confirmation's own copy covers it well enough, and stacking two
  confirmations for one click felt like ceremony the roadmap didn't ask for.

## Self-review

- **Core-logic correctness:** `removePin` hand-checked against expected arrays (domain tests);
  `handleDeletePin`/`handleUndoDelete` exercised end-to-end through the real `App` + fake `localStorage`
  in `App.test.tsx`, not mocked.
- **Acceptance bar (`CLAUDE.md` #3):** unaffected — delete is additive to the existing bar, doesn't
  change how pins are placed/colored/noted/persisted. Verified the full existing suite still passes.
- **Reproducibility:** `removePin` has an explicit determinism test (same call twice → identical
  result); no stochastic sources touched.
- **Boundaries/types:** delete and undo both go through the same `storedPinsForWrite()` /
  `savePins()` boundary every other write uses; undo's duplicate-id check enforces the existing
  `loadPins` invariant rather than assuming it.
- **Meaningful tests, self-proven:** planted 5 regressions (removePin's not-found throw removed;
  delete's multi-tab re-read swapped for stale `pins` state; undo's duplicate-id guard removed; the
  `deleteInfo`-clears-on-other-actions call removed from `handleMapClick`; PinEditor's confirm gate
  bypassed) — each independently reverted and confirmed to fail exactly the test written to guard it,
  then restored. All five caught.

**Gate:** `npm run typecheck` clean · `npm run lint` clean · `npm test` **120 passed** (8 files; was
106) · `npm run build` succeeds.

## Least confident — look here first

1. **The "confirm/undo" scope call.** I read the roadmap's one-liner as "two-step confirm + in-session
   single-delete undo," explicitly rejecting a snapshot/backup-style undo as drift (see "Scope
   decisions"). This is the one place a reviewer might reasonably disagree with the interpretation
   itself rather than the implementation of it.
2. **Reusing the literal string "Delete lead" for both the arm button and the confirm button.**
   Verified in Chrome (below) — the pink confirm box with its own prose reads clearly as a state change
   even with the repeated label, so this held up. Noting it here anyway since it's still a judgment
   call a reviewer could weigh differently.

## In-browser verification (Google Chrome, dev server)

Seeded 2 NYC pins (Alpha Cafe/strong, Beta Grill/weak) directly into `localStorage`. Clicked Alpha's
marker, clicked **Delete lead** — confirmed it did NOT delete yet (armed a pink confirmation box:
`Delete "Alpha Cafe"? You'll get a chance to undo right after.` with **Delete lead** / **Cancel**).
Clicked **Delete lead** again: marker vanished, sidebar fell back to the Add-restaurant form, count
read "1 lead on the map", and a banner appeared: `Deleted "Alpha Cafe". Undo` (Leaflet's bound popup for
the removed marker faded out on its own, no lingering artifact). Clicked **Undo**: the green marker
reappeared, count returned to "2 leads", banner cleared. Read `localStorage` directly — the restored
record was byte-identical to the original (re-appended at the end of the array, as designed, not
reinserted at its original index). Clicked Beta Grill's marker afterward to confirm the app was still
fully interactive post-undo — opened correctly, weak/amber selection ring shown. Console clean
throughout (checked after each step, no errors or warnings).
