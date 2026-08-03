# Build note — Unit 2: notes + editing per pin

## Why this, why now
Unit 1 answered *where* the leads are. It cannot answer *what happened there* — the pin held only a
name and a strength, and nothing about it could ever change after it was placed. That makes the app a
map of dots rather than a visiting tracker: a lead that goes from weak to strong, or a visit whose
outcome you want to remember, had no representation at all.

This is the right next unit because it is the remaining half of the product DONE-WHEN (`CLAUDE.md` #3:
"attach and later edit free-form notes on that pin", persisted across reload) and because it depends on
exactly what unit 1 built — the `Pin` model, the validating boundary, and the lossless store. Nothing
downstream (filtering by strength, searching notes) is worth anything until the notes exist.

## What it delivers (this unit's slice of the product DONE-WHEN)
- `Pin` gains `notes: string` — free-form, multi-line, per pin.
- Click any pin → the sidebar becomes an editor for that pin: **notes**, **name**, **lead strength**.
- Saving persists immediately to `localStorage`; the pin recolors on the map when the strength changes.
- The marker popup reads the notes back with the line breaks they were written with.
- Everything — position, name, strength, notes — survives a full reload.
- Placing a new pin opens its editor straight away, so notes can be written while the visit is fresh.

## Files
- `src/domain/pin.ts` — `Pin.notes`; `parsePin` accepts records with no `notes` key (reads `''`);
  `updatePin` (validated edit, identity + position immutable); `replacePin` (+ `PinNotFoundError`);
  `normalizeNotes`.
- `src/storage/pinStore.ts` — `serializePins` writes `notes`; comment recording why the key stays `v1`.
- `src/components/PinEditor.tsx` — **new**; the edit form, with the draft as local state.
- `src/components/MapView.tsx` — marker click selects; selected marker gets a ring; popup shows notes.
- `src/App.tsx` — `selectedPinId` state, `handleSelectPin`, `handleSaveEdits`; editor replaces the add
  form while a pin is selected.
- `src/index.css` — editor, selected-marker ring, popup notes (`white-space: pre-wrap`).
- Tests: `src/domain/pin.test.ts` (+12), `src/storage/pinStore.test.ts` (+6).

## Non-obvious design decisions (chose X over Y because Z)
1. **`notes` absent ⇒ `''`, and the storage key stays `restaurant-map.pins.v1`.** Every pin already
   saved by unit 1 lacks a `notes` key. Making it a hard requirement would send those records down
   `loadPins`'s corruption path — the user's real pins would vanish behind a "couldn't read saved pins"
   banner. Bumping the key to `.v2` would strand them just as thoroughly. So the read is
   backward-compatible and the first save upgrades the record in place. A `notes` field that is
   *present but not a string* is still a hard error: that's corruption, not an older record.
   **This is the highest-risk thing in the unit and it is verified in a real browser, not just in
   tests** (seeded a genuine unit-1 record into Chrome's `localStorage`, reloaded, it rendered).
2. **`parsePin` does not trim; `createPin`/`updatePin` do.** Normalization belongs on the way in, once.
   If parsing also trimmed, `save → load` would stop being the identity for any stored value with edge
   whitespace, quietly breaking unit 1's losslessness guarantee. Trimming at the write boundary means
   stored notes are already normal, so parsing can stay a pure validator.
3. **`updatePin` cannot change `id`, `lat`, or `lng`.** They're carried over from the original rather
   than read from the edit object. An edit that could rewrite the id would orphan the pin from its
   stored record; one that could rewrite the position would move a lead on the map as a side effect of
   typing a note. The result goes back through `parsePin`, so an edit can never produce a pin the store
   would later refuse to load.
4. **`replacePin` throws on an unknown id instead of no-op'ing.** The obvious one-liner
   (`pins.map(p => p.id === updated.id ? updated : p)`) silently returns the list unchanged if the id
   isn't there — `App` would then save that unchanged list and the editor would say "Saved." over an
   edit that never happened. A named `PinNotFoundError` makes that class of phantom save impossible.
5. **Save-then-commit, exactly as in unit 1's add path.** `handleSaveEdits` builds the next list,
   writes it, and only then calls `setPins`. On a throw it surfaces a banner and leaves state alone, so
   the UI can never show "Saved." for an edit that isn't in `localStorage`. Still no
   `useEffect([pins])` anywhere — the mount-time-overwrite data-loss path stays closed by construction.
6. **The editor is keyed by `pin.id` (`<PinEditor key={selectedPin.id} …>`).** The draft is local
   state seeded from the pin, so without the key, selecting pin B while holding unsaved text for pin A
   would show — and could save — A's text under B. The key forces a remount and a re-seed. Verified in
   the browser by switching selection between two pins.
7. **Selection is held as an id, not as a pin object.** `selectedPin` is derived from `pins` each
   render, so after a save the editor is always reading the pin that is actually in state (and
   therefore in storage). Holding a copy would have made a stale-object bug easy to write later.
8. **Sidebar editor, not an in-popup form.** A form inside a Leaflet popup fights the popup's own
   open/close and focus handling; the sidebar is plain React. The popup stays read-only (name,
   strength, notes) so the map alone still answers "what happened here" — the editor and the add form
   occupy the same sidebar slot, which also makes "armed to place" and "editing a pin" mutually
   exclusive states by construction rather than by a guard.
9. **The selected marker gets a ring, never a fill change.** The fill is the strength color and nothing
   else is allowed to touch it — a selection that recolored a pin would misrepresent the lead, which is
   the one hazard `leadStrength.ts` exists to prevent.
10. **Editing covers name and strength, not just notes.** A lead tracker whose strength is frozen at
    creation is broken by design — a weak lead becoming strong is the whole point, and there is no
    delete to work around it with. Name is one more line in the same form. Delete *is* out of scope
    (see below): "editing" a pin isn't removing it.

## Load-bearing assumptions
- **[load-bearing]** Existing stored pins have no `notes` key and must keep loading. Verified against a
  real unit-1 record in Chrome, not just a fixture.
- **[load-bearing]** "Editing per pin" means the pin's user-authored content (notes, name, strength).
  Deleting pins is a separate capability and is deferred.
- **[minor]** Notes are plain text. No markdown, no rich text — a `<textarea>` and `pre-wrap`.
- **[minor]** Explicit **Save changes**; no autosave/debounce. The hint under the buttons reads
  "Unsaved changes." / "Saved." so the state is never ambiguous.
- **[minor]** Selecting a different pin (or pressing Done) discards an unsaved draft without a
  confirmation prompt.

## Deliberately NOT built
- **Delete a pin.** Not "editing"; wants its own confirm-and-undo story.
- **Search/filter by strength or note text**, sorting, a list view of leads.
- **Unsaved-changes confirmation** when switching pins, and autosave.
- **Markdown/rich text, timestamps, per-visit note history.** A note is one free-form blob, as specified.
- **Drag-to-move a pin.** Position stays immutable through the edit path on purpose (decision 3).
- **Persisting the map view**, still deferred from unit 1.

## Verification I actually ran
- `npm run typecheck` → clean.
- `npm run lint` → clean, no warnings. (One real lint failure on the way: an unused destructured
  binding in the legacy-record test; rewritten to `delete` the key so the test also asserts the input
  genuinely has no `notes` key.)
- `npm test` → **32 passed** across 3 files (leadStrength 4, pin 16, pinStore 12); was 15 before.
- `npm run build` → succeeds, 81 modules transformed.

### Browser verification — RAN and PASSED (2026-08-03, Google Chrome, `localhost:5174`)
1. Seeded a genuine **unit-1 record** (`{id,name,lat,lng,strength}`, no `notes`) into `localStorage`,
   reloaded → pin rendered green, "1 lead on the map", **no error banner**. Migration works on real data.
2. Clicked the pin → editor opened; popup showed *"No notes yet — add them in the sidebar."*
3. Typed three lines of notes and switched strength to **Weak** → hint read "Unsaved changes.", and the
   map still showed the old green pin (nothing committed before Save).
4. **Save changes** → pin recolored **amber**, popup showed the notes, hint read "Saved.".
   `localStorage` held `"strength":"weak"` and the notes with `\n` intact.
5. **Full reload** → pin still amber; clicking it reopened the editor with name, strength and the
   multi-line notes re-seeded; popup computed `white-space: pre-wrap`.
6. Added a second pin ("Taqueria Norte") through the form → it auto-opened in the editor with an
   **empty** notes draft (pin 1's notes did not leak across — decision 6), then set it to **Failed**
   with its own notes and saved → markers read `rgb(232,163,61)` (amber) and `rgb(214,69,69)` (red).
7. **Full reload** → "2 leads on the map", both colors correct, both pins' notes intact; switching
   selection between them re-seeded the editor each time and exactly one selection ring was present.
8. **Console clean across three loads** — only Vite HMR + the React DevTools notice. No errors, no
   Leaflet/StrictMode warnings.

Test-data note: this left two pins ("Joe's Diner" weak, "Taqueria Norte" failed) in Chrome's
`localhost:5174` `localStorage`.

Automation note (not an app defect): partway through, Chrome's screenshot capture on that tab began
timing out and coordinate clicks stopped landing where the viewport said they should (the capture scale
and the viewport had diverged). DOM reads and event dispatch kept working, so steps 5–7 were driven by
dispatching real `mousedown`/`mouseup`/`click` events on the marker element — which still exercises the
full Leaflet → `eventHandlers.click` → `handleSelectPin` chain — and asserted against the live DOM and
`localStorage`. Marker clicking was also confirmed by ordinary mouse clicks earlier in the session
(steps 2 and 5).

## Spots to look first (least confident)
1. **The `notes`-absent branch in `parsePin`.** It is a deliberate hole in an otherwise strict
   validator: a record missing `notes` is accepted, a record with a bad `notes` is not. If that
   asymmetry is wrong, it's wrong in the one place that decides whether the user's existing pins load.
   Worth an adversarial read of what else could now slip through (e.g. a truncated write that happens
   to drop the field).
2. **Discarding an unsaved draft on selection change.** Clicking another pin — or `Done` — throws away
   whatever was typed, silently, and clicking a marker is easy to do by accident on a dense map. I
   judged a confirm dialog to be over-engineering for a single-user tool, but this is the decision most
   likely to be judged the wrong trade-off, and it is the one place where a user can lose typed work.
