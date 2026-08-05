# restaurant-map

A personal, standalone, **local-first visiting tracker** that accompanies my restaurant-development
work. It maps every restaurant I've visited and talked to, color-codes each pin by **lead strength**,
and holds my free-form notes on each visit. At a glance I can see where my strong, weak, and failed
leads sit — and open any pin to read or update what happened there.

Single-user, runs entirely in the browser, my data never leaves my machine.

## Lead strength → pin color

Every pin carries exactly one lead strength, rendered as one color:

| Strength | Color | Meaning |
|----------|-------|---------|
| **Strong** | 🟢 Green  | A promising lead worth pursuing |
| **Weak**   | 🟡 Amber  | Talked, lukewarm — keep warm |
| **Failed** | 🔴 Red    | Dead lead — visited, no path forward |

## Stack

- **React + TypeScript** SPA, built with **Vite**
- **Leaflet** map over **OpenStreetMap** tiles — no API key, no billing
- **`localStorage`** for persistence — no backend, no database, no accounts
- **Vitest** for tests · **ESLint** + `tsc` for lint/type-check

The only network dependency is the map tiles. Everything else — pins, positions, strengths, notes —
lives in the browser.

## Running it

### Requirements

**Node `^20.19.0 || ^22.13.0 || >=24.0.0`.** That range is the intersection of our dependencies' own
`engines`; `jsdom@29` is the binding constraint, so Node 18, 21, and 22.0–22.12 are all excluded.
`.npmrc` sets `engine-strict=true`, so a wrong Node fails `npm ci` immediately with a clear message
instead of surfacing later as a confusing jsdom or Vitest failure.

```bash
npm ci           # installs the lockfile exactly; fails on a wrong Node
npm run dev      # dev server
npm test         # Vitest
npm run lint && npm run typecheck
```

`npm ci` rather than `npm install`: it installs `package-lock.json` verbatim and refuses to rewrite it,
which is what "from a clean checkout" in the [`CLAUDE.md`](./CLAUDE.md) acceptance bar actually means.
Use `npm install` only when deliberately adding or upgrading a dependency.

## Roadmap

Built so far: map + colored pins, notes + editing per pin, fit-to-pins on load, export/import JSON
backup, delete a pin with undo, and filter/search leads by strength or text. See
[`docs/roadmap.md`](./docs/roadmap.md) for unit specs and [`docs/progress_log.md`](./docs/progress_log.md)
for the running record of what's shipped and what's next.

The product's precise "done-when" acceptance bar lives in [`CLAUDE.md`](./CLAUDE.md) (standing order #3).

## How this repo is built

This project runs on a small **build → review → ship** loop, driven from `.claude/`:

- **`/session-start`** — orient: read the log, memory, and git state.
- **`/build <unit>`** — build one unit against the acceptance bar; write real tests; leave a decision log.
- **`/review <unit>`** — a cold-context, read-only adversarial reviewer audits the unit and writes its
  findings to `docs/reviews/<unit>.md`. Its read-only scope is enforced by a hook, not merely requested.
- **`/ship`** — commit, push, open a PR.

Governance is deliberately thin and grows only as the project earns it. See
[`CLAUDE.md`](./CLAUDE.md) for the charter and [`docs/progress_log.md`](./docs/progress_log.md) for the
running record.

## Layout

```
.
├── CLAUDE.md              # project charter — the always-loaded top of the governance tree
├── .claude/               # the workflow: rules · commands · the reviewer agent · enforcement hooks
├── docs/                  # progress_log.md · build_notes/ · reviews/ · agentic_workflow/ (self-record)
└── src/                   # the app (created by the first build unit)
```
