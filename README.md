# agentic-starter

The **portable spine** of an agentic development workflow, extracted so any new project can start with a
proven build→review loop and grow domain-specific governance as it earns it. Copy it into a fresh repo,
fill a handful of placeholders, and you have: orient → build → adversarially review → ship, with a
reviewer whose read-only independence is enforced by a hook rather than merely asked for.

This is deliberately **thin**. It carries the *shape* that transfers between projects and none of the
domain law that doesn't. Adding governance you haven't earned yet is the exact drift this loop is built
to catch — so start here and grow.

---

## The six ideas this encodes

1. **Cold-context adversarial review.** The reviewer is a subagent that never saw the build chat, so it
   can't inherit the builder's rationalizations. It's handed the builder's *decision log* (intent) but
   forms its own view from the code.
2. **Prose is not mechanism.** Every "must / always / enforced" must trace to a hook, test, or CI job —
   otherwise it's hope. The one hook here (`enforce_agent_write_scope.py`) makes "the reviewer is
   read-only" literally true, down to Bash redirects and `sed -i`.
3. **Relay from the artifact, not the chat.** The reviewer writes its report to a file; the main thread
   relays *from that file*. A finding can't be silently downgraded between review and relay.
4. **Build is ungated; quality closes on code.** Nothing about approval or understanding blocks work.
   The review closes on findings-fixed + a log entry, full stop.
5. **Path-scoped governance.** Rules load only when you touch the paths they match, so token cost tracks
   what you're actually working on. `CLAUDE.md` stays thin because it's paid for every turn.
6. **The workflow keeps its own record.** `docs/agentic_workflow/` is the machinery's own log + lessons,
   scoped do-not-auto-load so it doesn't tax normal turns.

## What's in the box

```
CLAUDE.md.template          # thin project charter — rename to CLAUDE.md and fill the <<placeholders>>
.claude/
  settings.json             # wires the write-scope hook onto Write/Edit/Bash
  commands/
    session-start.md        # orient: reads log + memory + git + settings, runs a drift check, prints a fixed brief
    build.md                # build ONE unit; write real tests; write a decision log; hand off (ungated)
    review.md               # launch the cold reviewer; relay from its file; don't auto-fix
    ship.md                 # commit → push → PR
  agents/
    reviewer.md             # adversarial, read-only, one writable artifact (docs/reviews/<unit>.md)
  rules/
    00-process.md           # the always-on loop law: build ungated, reviewer independent, name the drift
  hooks/
    enforce_agent_write_scope.py   # makes the reviewer's read-only scope a mechanism
    shell_lex.py                   # quote-aware lexer the hook depends on
docs/
  progress_log.md           # running product log; /session-start reads the top
  build_notes/              # /build writes docs/build_notes/<unit>.md (the decision log)
  reviews/                  # the reviewer writes docs/reviews/<unit>.md (its report) — its ONLY writable path
  agentic_workflow/         # the workflow's own self-record (scoped, do-not-auto-load)
```

## Seed a new project

From the new project's root:

```bash
cp -R ~/agentic-starter/.claude .
cp -R ~/agentic-starter/docs .          # or merge into an existing docs/
cp ~/agentic-starter/CLAUDE.md.template ./CLAUDE.md
```

Then **fill the `<<placeholders>>`** — there are only a few, and they're the whole point:

- **`CLAUDE.md`** → project name, one-line "what winning means", structure, the `<<DONE-WHEN>>`
  acceptance bar, and your `<<TEST COMMAND>>` / `<<LINT COMMAND>>`.
- **`.claude/commands/build.md`** (Step 1) → the same `<<DONE-WHEN>>` bar, so builds are judged against
  the real criterion, not a proxy.
- **`.claude/agents/reviewer.md`** (Step 2, "Domain hazards") → your project's highest-priority
  structural laws, each cited to the rule that states it.

Confirm the hook is live: in a subagent named `reviewer`, a Write outside `docs/reviews/` should be
denied. If it isn't, check that `python3` is on PATH and `settings.json` was copied.

## Grow it as the project earns it

Don't front-load governance. Add it the first time you feel the lack:

- **Add a rule** (`.claude/rules/01-*.md`, ...) the first time you repeat the same correction to the
  agent. Keep each path-scoped so it loads only where relevant.
- **Add a hook** the first time a rule needs teeth — model it on `enforce_agent_write_scope.py`, and
  give it a **planted-violation test** (a rule with no self-proving test is prose, per `00-process.md`).
- **Add a reviewer** (a new `.claude/agents/*.md` + a row in the hook's `_ALLOWED_ARTIFACTS`) only when
  a genuinely different surface appears that the general reviewer can't cover well (e.g. a web front-end
  vs. a data pipeline).

## Deliberately left out (add per project, if ever)

- **Domain rules** (data/ML, web, infra, safety) — these were the bulk of the source project and none of
  it transfers. Write your own as `.claude/rules/01+`.
- **Domain enforcement hooks** (e.g. "block reads of the hidden test oracle") — powerful but specific;
  add when your project has an invariant worth a mechanism.
- **A comprehension / spaced-repetition track** — worth it only if *learning the craft* is an explicit
  goal of the project, not just shipping. It's a parallel track that never gates the loop; add it if you
  want it, leave it out otherwise.
