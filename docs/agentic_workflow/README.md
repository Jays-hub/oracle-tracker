# Agentic Workflow — self-record (scoped, do-not-auto-load)

This folder documents the **agentic workflow itself** — the `.claude/` machinery (`rules/`, `commands/`,
`agents/`, `hooks/`) and the economics of running this project with an agent. It is the workflow's own
progress log + backlog, the same pattern `docs/progress_log.md` uses for *product* work.

## Access rule (read this first)

> **Open this folder ONLY when the task concerns the agentic workflow** — i.e. editing `.claude/rules/**`,
> `.claude/commands/**`, `.claude/agents/**`, `.claude/hooks/**`, or the token/process efficiency of how
> the agent works. **Do not read it during ordinary product builds or bug fixes.** Those are governed by
> `CLAUDE.md` + `.claude/rules/` + `docs/progress_log.md` and never need this folder.

Why scoped: this folder exists to *reduce* per-turn token load, not add to it. It is reference, not
context — kept out of `CLAUDE.md` and out of `.claude/rules/` (which auto-load) on purpose. Loading it
every turn would re-create the overhead it documents.

## Contents
- [`current_state.md`](current_state.md) — dated snapshot of what the workflow is and what's verified
  working vs. broken. Newest first.
- [`lessons.md`](lessons.md) — dated log of mistakes made while operating the workflow, each with a
  guideline to prevent recurrence.

## Maintenance convention
- **When you change the workflow, update this folder in the same pass** — add a dated entry to
  `current_state.md`. A workflow change with no record here is drift.
- **Product changes do not touch this folder.** A new feature belongs in `docs/progress_log.md`.
- Keep entries terse. This folder polices its own bloat.
