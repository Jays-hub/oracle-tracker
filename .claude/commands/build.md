---
description: Build one unit of work; the review closes on code, not on ceremony. Usage: /build <unit id or spec>
argument-hint: <unit id or short spec, e.g. a feature name, ticket, or phase id>
---

You are a senior engineer building **one** unit of work for the user. This work will be reviewed
afterward by a strict adversarial reviewer (`/review`), so hand off code that **survives that review by
preventing the defect by construction**, not by hoping it's absent.

**Unit to build:** `$ARGUMENTS`
(If that is empty, ask which unit before doing anything else.)

---

## Read the ground truth yourself — do not ask the user to paste anything

You are in the repo. Read what you need directly; never request pasted docs, diffs, or logs.

1. **The spec.** Wherever this project keeps the acceptance criteria for a unit of work — a roadmap
   section, an issue/ticket, a design doc. Read *what done means* before writing code.
2. **The governance that already binds you.** `CLAUDE.md` (the project charter) and the always-on rules
   in `.claude/rules/` (auto-loaded for the paths you touch). **Do not restate these as prompt inputs —
   obey them.**
3. **What already exists.** The current code under this unit's target dirs, `docs/progress_log.md`
   (newest first — where the last unit left off), and any upstream this unit depends on. Read before you
   build.

---

## Step 0 — Set up and orient (building is NOT gated — go ahead and build)

**There is no comprehension or approval gate in this loop.** Per `.claude/rules/00-process.md`, building
is never blocked and the review closes on the **code**. Do **not** present gates and stop. Set up, then
build.

**Working-state pre-check (first).** Run `git branch --show-current`. The one real risk is building
directly on a shared trunk. If the result is `main` or `master`, emit **exactly**:

> You're on `<current-branch>`, a shared trunk. Switch to a working branch or worktree first, e.g.:
> ```
> git switch -c <short-name>
> ```
> Reply when done and I'll continue.

and **stop and wait**. Otherwise — a named branch, or **empty output (detached HEAD, expected under
parallel-worktree tools)** — proceed without asking.

**Orient yourself, in your own words (not copied from the spec), then proceed to build:**

- **Why this, why now.** The problem this unit solves and the dependency that makes it the right *next*
  step rather than later.
- **Codebase impact.** The files/modules you'll create or touch, what they produce, and what they unlock
  downstream. Name the exact paths.

Carry these forward into the decision log (Step 3); they are the reviewer's briefing.

**Name the drift.** If this unit or your plan for it reaches for sophistication before the simpler,
higher-value step exists, say so and redirect to the simplest thing that does the job. Over-engineering
is a defect here, not a virtue.

---

## Step 1 — Surface load-bearing assumptions, then build

List the assumptions your build rests on (data shapes, interface contracts, what "done" covers). Mark
each **load-bearing** (would change your approach if wrong) or **minor**. Ask the user about any
load-bearing one you can't resolve by reading the repo; state the minor ones and continue.

Build with these defaults — honor any that `.claude/rules/` codifies, don't reinvent them:

- **"Done" is the project's real acceptance bar**, not a proxy. The product bar (from `CLAUDE.md`,
  standing order #3): from a clean checkout, `npm ci && npm run dev` serves an app where I can pin
  a restaurant by name + location, mark its lead strength (strong / weak / failed) and see the pin in
  the matching color (**strong = green, weak = amber, failed = red**), attach and edit free-form notes
  per pin, and have every pin — position, strength, notes — persist across a full reload via
  `localStorage`; tests green, lint/types clean. Each unit is a slice of that bar and is judged against
  it — not against a convenient proxy. A diagnostic that isn't the bar is a diagnostic only.
- **Correctness is structural, not hoped-for.** Prevent the defect by construction — validate at
  boundaries, assert invariants, fail loud with named errors rather than silent wrong answers.
- **Reproducibility:** deterministic where it matters (seed stochastic sources); no hardcoded absolute
  paths; runs repeatable from a clean checkout.
- **Build only this unit.** If something belongs to later work, note it and don't build it now. Small,
  pure functions; match the surrounding code's style; linter clean.

---

## Step 2 — Write tests that would actually catch bugs (not smoke tests)

Put them beside the existing suite. At minimum, and saying in one line what each protects against:

- A **correctness test** of the core logic against a known expected value (hand-computed where you can).
- A **reproducibility test** where relevant: same inputs/seed twice → identical results.
- **Boundary assertions** (shapes, types, contracts) at the important interfaces.
- One **edge case** (empty input, null/NaN present, boundary value, the failure path).

Then **run them yourself** — the project's test and lint commands — and iterate until green. Don't hand
the user code you haven't run.

---

## Step 3 — Write the decision log, self-review, then hand off

Run your own code against: **core-logic correctness / the acceptance bar / reproducibility /
boundaries+types / meaningful tests**, plus any domain-specific hazards `.claude/rules/` names. Confirm
*how* each is handled or flag it as a known gap — never claim "handled" when you only intended to.

**Write `docs/build_notes/$ARGUMENTS.md` before handing off.** It is the reviewer's briefing: your
why-this-why-now / codebase-impact from Step 0, every load-bearing assumption, every non-obvious design
decision (chose X over Y because Z), constraints discovered mid-build, deferred items, and the two spots
you're least confident about. An incomplete log means the reviewer audits code without context and finds
false positives where your choices were deliberate.

Hand back, clearly separated:

1. **The code** (paths listed).
2. **The tests** + the test/lint output you actually ran.
3. **Assumptions** (load-bearing marked).
4. **What you deliberately did NOT do** — scope boundaries and anything deferred.
5. **Self-review note** + the **1–2 spots you're least confident about**, so the reviewer looks there first.
6. **Decision log + progress entry:** `docs/build_notes/$ARGUMENTS.md` filled in, and a dated
   `docs/progress_log.md` entry (tagged `[built]`) naming the artifacts, the verified test count, and a
   pointer to the decision log. The unit is **not** marked done here — that happens when the review
   closes on the code.

Then tell the user:

> **This unit is ready for `/review $ARGUMENTS`. Do not self-review.**
