# Roadmap — planned units

Where a unit's acceptance criteria live *before* it is built. `/build <unit>` reads its section here as
the spec; `/review <unit>` judges against it. Decision logs (written after) go in `docs/build_notes/`,
the running record of what happened in `docs/progress_log.md`.

Units 1–2 are done; see the progress log.

---

## Unit 3 — "See it all, and keep it"

Two sections. Both close gaps that unit 2's review or use exposed, and neither adds a backend, an
account, or a network call — the store is still `localStorage`, the app is still standalone.

### Section A — Fit the map to the pins

**Problem.** `MapView` hardcodes `center={[40.7128, -74.006]} zoom={12}` (NYC) and never fits to the
data. For leads anywhere else, every load opens on an empty patch of Manhattan and the pins exist but
are invisible until you pan to them. `CLAUDE.md`'s "Winning" sentence is *at a glance I can see where my
strong, weak, and failed leads sit* — today that only holds if your leads happen to be in New York.
Flagged as a MINOR in `docs/reviews/Unit 2 - notes + editing per pin.md`.

**Done when.** From a clean checkout with pins saved outside NYC, loading the app shows **every** pin in
the viewport without panning or zooming:
- On mount with ≥ 2 pins: fit the view to their bounding box, with enough padding that edge pins aren't
  under the sidebar or clipped at the edges.
- With exactly 1 pin: center on it at a readable zoom (a bounding box of one point has no extent).
- With 0 pins: keep today's default view — there is nothing to fit.
- **Fit on mount only.** It must not re-fit on every save, or adding a pin would yank the map out from
  under you mid-edit. Panning and zooming after load stick until the next reload.

**Not in this section.** Persisting the map view across reloads (deferred since unit 1 — decide it
separately; it partly conflicts with fit-on-mount and needs its own answer about which wins).

### Section B — Export / import JSON

**Problem.** `localStorage` is one browser profile on one machine, with no way to get the data out. A
new laptop, a different browser, or "clear browsing data" loses every visit note, and notes are prose
that cannot be reconstructed. The corrupt-store backup added in unit 2 protects against bad *data*; it
does nothing about any of this. This is the section that makes the tracker safe to actually rely on.

**Done when.** From a clean checkout:
- **Export:** one control in the sidebar downloads every pin as a JSON file — position, name, strength
  and notes, byte-for-byte what round-trips back in. Filename carries the date
  (e.g. `restaurant-map-2026-08-03.json`). Purely local: `Blob` + `URL.createObjectURL`, no upload.
- **Import:** pick a file (`<input type="file">` + `FileReader`), and the pins in it become the pins on
  the map and in `localStorage`.
- **Round-trip is lossless and verified by test:** export → wipe the store → import the same file →
  the store is byte-identical to before, notes and line breaks intact.
- **Import validates at the boundary like everything else.** Every record goes through `parsePin`; any
  invalid record, a duplicate id, or a non-array payload rejects the **whole file** with a named error
  and leaves the current store untouched. Never a partial import — half your leads is worse than a
  clear failure.
- **Import cannot destroy data silently.** Before replacing the store, snapshot the current one aside
  (same mechanism as `backupCorruptStore`) and tell the user where it went. Since import is a *replace*
  (see below), this snapshot is the only undo — treat a failed snapshot as a hard abort, exactly as the
  corrupt-store backup does.
- Legacy files load: a JSON array of unit-1 records with no `notes` key imports with empty notes, on the
  same terms as `loadPins`.

**Settled 2026-08-04: import REPLACES the whole store.** Not merge-by-id, not additive. One import
control, behind an explicit confirmation naming the counts ("replace 12 saved leads with the 9 in this
file?"), with the pre-import snapshot as the undo.

Why replace, given the code as it stands:
1. **`Pin` has no timestamp.** With no `updatedAt`, "newest wins" — the only conflict rule a user would
   find intuitive — is not implementable. What remains is "file wins" or "store wins", which is replace
   applied one pin at a time, and it's the *worse* version: on a conflicting pin one side's notes vanish
   **inside** a lead you have no reason to open. Replace loses data visibly and predictably; per-pin
   merge loses prose invisibly. The payload here is free-form prose — a wrong strength shows up as a
   wrong color, but three paragraphs silently reverting to an older draft does not.
2. **Ids are `crypto.randomUUID`.** A matching id therefore means genuinely the same pin, so merge-by-id
   is at least coherent — but the same physical restaurant pinned on two machines gets two *different*
   ids, so merge unions them into overlapping duplicate pins. Merge doesn't deliver what people want
   from sync; it delivers duplicates.
3. **There was no delete yet.** Those duplicates would have been permanent until a later unit shipped
   one. *(Now does: Unit 4, below — this was true when the decision above was made, not any more.)*

Rejected alternative — **additive-only** ("import ids not already present, never touch existing"): needs
no conflict rule and is ~5 lines more than replace, but it is wrong for the case that motivates this
section. Restoring a backup into a non-empty store would silently ignore the file's version of every pin
you already have — precisely the notes you were trying to recover.

**If two-machine use turns out to be real, that's a sync unit, not a section of this one**, and its
honest prerequisite is `updatedAt` on `Pin` (making "newest wins" implementable) — delete now exists
(Unit 4, below), so duplicates from a merge would at least be fixable, but merge-by-id is still rejected
outright until there's a conflict rule to drive it.

**Not in this section.** Cloud sync, automatic/scheduled backups, CSV or any other format, a merge or
conflict-resolution UI, sharing. Merge-by-id and additive import are rejected outright above, not
deferred — building either later means first adding `updatedAt`.

---

## Unit 4 — Delete a pin

**Problem.** A lead placed by mistake, duplicated, or no longer real has no way off the map except
editing every field into nonsense. Parked in "Later" since unit 2 — *"wants its own confirm/undo story;
deliberately excluded from unit 2's editing"* — because a delete is irreversible by nature, unlike an
edit.

**Done when.** From a clean checkout:
- A pin can be removed from the map and `localStorage` from its own open editor — the same interaction
  surface editing already uses, not a separate control on the map marker/popup.
- **The delete is confirmed, not one-click.** A first click arms a confirmation naming the pin; only an
  explicit second click actually removes it.
- **The delete is recoverable in-session.** Immediately after a confirmed delete, an Undo control
  restores the exact removed pin — id, position, strength, and notes, byte-for-byte — not a persisted or
  multi-level history, just the single most recent delete. It stays available through ordinary
  reads/writes (selecting a pin, adding one, editing one) and is only superseded by something that
  actually invalidates it: a newer delete, or a whole-store import replace. It does not need to survive
  a page reload.
- **Delete and undo obey the same write discipline as every other write.** Both re-read the store
  immediately before writing, acting on the pin actually in storage rather than a possibly-stale
  in-memory copy, so a stale tab cannot silently clobber — or resurrect an outdated version of — a pin
  another tab touched since this one loaded.
- **Undo refuses to write over a reused id.** `loadPins` treats two pins sharing an id as a corrupt
  store; if the deleted id has reappeared since the delete (e.g. another tab imported a backup
  containing it), undo declines rather than writing a duplicate.
- A delete attempted on a pin another tab already removed fails loud with a named error and resyncs this
  tab's view, rather than leaving a marker on screen for a pin that no longer exists anywhere.

**Not in this unit.** Bulk/multi-select delete, deleting from the map marker/popup directly, a persisted
or multi-level undo history, undo surviving a page reload.

Reviewed 2026-08-04: `docs/reviews/Delete a pin.md`. Findings F1–F6 landed; closed and mergeable.

---

## Unit 5 — Filter / search leads

**Problem.** As the number of pins grows, the map's "at a glance" promise (`CLAUDE.md`'s Winning
sentence) degrades: there is no way to ask "just my strong leads" or find a pin by something written in
its notes short of panning around reading every popup. Parked in "Later" since unit 2's review.

**Done when.** From a clean checkout, with pins of mixed strength and notes saved:
- A sidebar control lets the user narrow which strengths are shown (strong / weak / failed,
  independently toggleable) and enter a text query.
- **Search matches case-insensitively against both the pin's name and its notes.** A restaurant is
  findable by what happened there, not only by what it's called.
- Strength selection and the text query combine as AND, not OR: a pin must satisfy both to be visible.
- **Filtering only changes which pins render as markers.** It never re-fits or otherwise moves the map —
  Section A's "fit on mount only" rule is untouched, since a filter is a view of the same store, not a
  new mount.
- The sidebar names what's filtered ("Showing N of M leads") and offers a one-click way to clear back to
  showing everything, including from a zero-match state.
- Filtering never touches `localStorage`, pin data, the current selection, or the add-pin flow — it is
  read-only and cannot lose or corrupt anything, unlike every other unit so far. Clearing the filters
  always restores the full set exactly as stored.

**Not in this unit.** A dedicated list view of leads (a second, larger surface — a filterable map is the
smaller, higher-value slice; a list view is a legitimate future unit but is not required to make the map
itself filterable). Sorting. Saved/named filters. Fuzzy or ranked search. Filtering by position
(map-region search) — text and strength only.

---

## Later — not scheduled

- **Persist the map view** across reloads (see Section A's exclusion).
- `parsePin` accepts `name: ''` while `updatePin` refuses to save it, so such a pin can be loaded but
  not edited until it is renamed (NIT from unit 2's review).
- Memoize `pinIcon` per `(strength, selected)` — every marker's DOM is rebuilt on every render. Harmless
  at this scale (NIT from unit 2's review).
