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
tiles, with all state persisted to the browser's `localStorage`. No backend, no external data API — the
map tiles are the only network dependency.

```
.
├── CLAUDE.md              # this file — project charter
├── .claude/rules/         # always-on rules, path-scoped: 00 process (the build/review law) + domain rules as earned
├── .claude/commands/      # the verbs: /session-start /build /review /ship
├── .claude/agents/        # the cold-context reviewer (add more write-scoped agents as needed)
├── .claude/hooks/         # enforcement — turns "read-only reviewer" into mechanism
├── docs/                  # roadmap.md (specs for planned units) · progress_log.md (running log) · build_notes/ · reviews/ · agentic_workflow/ (self-record)
└── src/                   # the app: Leaflet map, pin model + lead-strength colors, localStorage store
```

## Standing orders
1. **Comprehension/approval does not gate work.** Building is free; the review closes on the **code**.
   (`.claude/rules/00-process.md`.)
2. **Name the drift.** Call out any reach for sophistication before the simpler, higher-value step that
   meets the real acceptance bar exists. Over-engineering is a defect. For this project specifically: a
   backend, a database, a server, an accounts system, or any external places/geo API is drift — this is
   a single-user, local-first, standalone tool.
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
Stack: React + Vite + TypeScript + Leaflet + OSM tiles, `localStorage` persistence, Vitest +
ESLint/`tsc`. **Units built: 6.** Unit 1 "Map + colored pins" and Unit 2 "notes + editing per pin" —
reviewed, fixed, merged. Unit 3 "See it all, and keep it" — **built, reviewed, fixes landed**: (A) the
map fits itself to every saved pin on load instead of opening over a hardcoded NYC center; (B) a
sidebar Backup control exports every pin to a dated JSON file and imports one back as a confirmed
whole-store replace, snapshotting the pre-import data first. Every item on the DONE-WHEN checklist (#3)
is met and "see it at a glance" now holds for leads anywhere, including right after a restore (a
confirmed import re-fits the map immediately, no reload needed). Unit 4 "Delete a pin" — **built,
reviewed, fixes landed**: a pin can be removed from its own editor behind a two-step confirm, with an
in-session Undo that survives ordinary reads/writes and is superseded only by a newer delete or an
import replace; delete and undo both act on a freshly re-read store, never a stale in-memory copy.
Unit 5 "Filter/search leads" — **built, reviewed, fixes landed**: a sidebar control narrows the map to
selected lead strengths and/or a case-insensitive text search over name and notes, combining as AND;
filtering is read-only over storage, the current selection, and the add-pin flow, and never re-fits the
map. A save made while a filter is active now resets the filter rather than rendering invisibly, so the
DONE-WHEN "see it rendered" bar holds even mid-filter. Unit 6A "Persist the map view across reloads" —
**built, reviewed, fixes landed**: the map now opens on the last pan/zoom instead of re-fitting to
every saved pin, with a sidebar "Show all leads" control as the escape hatch back to the fit-to-pins
view (the review's BLOCKER: a saved view winning unconditionally had no way back otherwise). The
saved view is wrapped past the antimeridian and only persists on a real drag/zoom gesture, not an
incidental window resize. Unit 6B "Git-syncable storage", Unit 7 "Multi-view navigation", and Unit 8
"Visual redesign" are scoped in `docs/roadmap.md`, not yet built. Two parked NITs — `pinIcon`
memoization and a `parsePin` empty-name validation gap — were closed 2026-08-06, reviewed and fixed
(`docs/reviews/uncommitted-2026-08-06-pinicon-parsepin.md`); the "Later" list is now empty.
**Next:** Unit 6B, 7, or 8 from `docs/roadmap.md`, or scope a new unit.
