# CLAUDE.md — restaurant-map

> This is the project charter: the thin, always-loaded top of the governance tree. Keep it short —
> everything here is paid for on every turn. Push detail down into `.claude/rules/` (which load only for
> the paths they match) and into per-component docs.

## What this is
A personal, standalone, **local-first visiting tracker** that accompanies my restaurant-development
work. It maps every restaurant I've visited and talked to, color-codes each pin by **lead strength**
(strong / weak / failed), and holds my free-form notes on each visit. **Winning** = at a glance I can
see where my strong, weak, and failed leads sit on the map, and open any pin to read and update what
happened there.

## Structure
Local-first browser app: a React + TypeScript SPA (Vite) rendering a Leaflet map over OpenStreetMap
tiles. State persists to the browser's `localStorage` by default, or — once linked via a sidebar control
— to a git-tracked JSON file on disk (`data/pins.json`) through the File System Access API (Chromium
only); committing/pushing/pulling that file through your normal git workflow is the multi-device sync
mechanism (Unit 6). No backend, no external data API — the map tiles are the only network dependency,
and the app itself never talks to git; it only reads and writes bytes at a path you chose.

```
.
├── CLAUDE.md              # this file — project charter
├── .claude/rules/         # always-on rules, path-scoped: 00 process (the build/review law) + domain rules as earned
├── .claude/commands/      # the verbs: /session-start /build /review /ship
├── .claude/agents/        # the cold-context reviewer (add more write-scoped agents as needed)
├── .claude/hooks/         # enforcement — turns "read-only reviewer" into mechanism
├── docs/                  # roadmap.md (specs for planned units) · progress_log.md (running log) · build_notes/ · reviews/ · agentic_workflow/ (self-record)
└── src/                   # the app: Leaflet map, pin model + lead-strength colors, localStorage/git-file store
```

## Standing orders
1. **Comprehension/approval does not gate work.** Building is free; the review closes on the **code**.
   (`.claude/rules/00-process.md`.)
2. **Name the drift.** Call out any reach for sophistication before the simpler, higher-value step that
   meets the real acceptance bar exists. Over-engineering is a defect. For this project specifically: a
   backend, a database, a server, an accounts system, or any external places/geo API is drift — this is
   a single-user, local-first, standalone tool. Reading/writing a git-tracked file on disk via the
   browser's File System Access API (Unit 6) is **not** this drift: there is still no server the app
   talks to, no accounts, and no network surface beyond the map tiles — `git push`/`pull`, run manually
   by the user outside the app, is the sync mechanism, not the app itself.
3. **DONE-WHEN.** "Done" (product bar) = from a clean checkout, `npm ci && npm run dev` serves an
   app where I can: pin a restaurant on the map by name and location, mark its lead strength as
   strong / weak / failed and see the pin rendered in the matching color (**strong = green, weak =
   amber, failed = red**), attach and later edit free-form notes on that pin, and have every pin — its
   position, strength, and notes — persist across a full page reload via `localStorage`. Tests green,
   lint/types clean. Not a convenient proxy; a diagnostic that isn't this bar is a diagnostic only. Each
   `/build` unit is a slice of this bar and is judged against it.

## Commands
_(These scripts land with the first build unit, which scaffolds the Vite app.)_
- `npm test` — run the full test suite (Vitest). Referenced by `/session-start`'s drift check and by `/review`.
- `npm run lint && npm run typecheck` — ESLint plus `tsc --noEmit` type-check.

## Current status
Stack: React + Vite + TypeScript + Leaflet + OSM tiles, `localStorage` persistence (or a git-tracked
file via the File System Access API, once linked — Unit 6), Vitest + ESLint/`tsc`. **Units built: 6.**
Unit 1 "Map + colored pins" and Unit 2 "notes + editing per pin" — reviewed, fixed, merged. Unit 3 "See
it all, and keep it" — **built, reviewed, fixes landed**: (A) the map fits itself to every saved pin on
load instead of opening over a hardcoded NYC center; (B) a sidebar Backup control exports every pin to a
dated JSON file and imports one back as a confirmed whole-store replace, snapshotting the pre-import data
first. Every item on the DONE-WHEN checklist (#3) is met and "see it at a glance" now holds for leads
anywhere, including right after a restore (a confirmed import re-fits the map immediately, no reload
needed). Unit 4 "Delete a pin" — **built, reviewed, fixes landed**: a pin can be removed from its own
editor behind a two-step confirm, with an in-session Undo that survives ordinary reads/writes and is
superseded only by a newer delete or an import replace; delete and undo both act on a freshly re-read
store, never a stale in-memory copy. Unit 5 "Filter/search leads" — **built, reviewed, fixes landed**: a
sidebar control narrows the map to selected lead strengths and/or a case-insensitive text search over
name and notes, combining as AND; filtering is read-only over storage, the current selection, and the
add-pin flow, and never re-fits the map. A save made while a filter is active now resets the filter
rather than rendering invisibly, so the DONE-WHEN "see it rendered" bar holds even mid-filter. Unit 6
"Git-syncable storage" — **built, reviewed, fixes landed**: a sidebar **Sync via file** control links
storage to a real file on disk via the File System Access API; once linked, every add/edit/delete/undo/
import/export goes through that file (read fresh each time, never stale React state), pretty-printed so
concurrent git edits can auto-merge, with an **Unlink** control as the escape hatch back to `localStorage`.
An unreadable *already-linked* file is backed up aside and named-error'd like a corrupt `localStorage`
read; a file unreadable at *first adopt* (startup or Reconnect) is never adopted at all, so `localStorage`
stays the visible, writable backend rather than degrading to an empty, un-escapable dead end. One gap
honestly flagged rather than papered over: the create→link→reload→reconnect walkthrough against a real
native file picker couldn't be driven end-to-end by the available browser-automation tooling (it can't see
or type into the OS-native save/open dialog) — confirmed only that the picker genuinely opens and a
cancelled pick is handled cleanly; a real IndexedDB handle round-trip is otherwise proven by
`fileHandleRegistry.test.ts` and 201 total tests, just not by a human click.
**Next:** pick from `docs/roadmap.md`'s "Later" list, or scope Unit 7 (multi-view navigation) per the
2026-08-05 build order.
