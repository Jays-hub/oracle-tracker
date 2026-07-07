# Process Rules — building and review are ungated (Highest Priority)

This is the always-on process law for the build→review loop. It governs every other rule.

## Building is never gated
- **Nothing blocks work.** The agent may explore, plan, and write code freely. There is no
  approval gate, no comprehension gate, no "the review can't start until X explains it." Set up and
  build.
- **Review is not gated either.** A unit's review closes on the **code**: findings relayed, greenlit
  fixes landed and re-passed, the closing `docs/progress_log.md` entry written. That's the whole exit.

## The reviewer is independent and read-only
- The `/review` reviewer runs **cold to the build chat** and is **read-only over the repo**, enforced by
  `.claude/hooks/enforce_agent_write_scope.py` — it can write only its one report artifact. It reviews
  build progress only; it never edits code. The builder applies fixes.
- **Relay from the artifact, not the chat.** The reviewer writes `docs/reviews/<unit>.md`; the main
  thread relays *from that file*, so a finding can't be silently downgraded between review and relay.

## Name the drift
- If a step reaches for sophistication before the simpler, higher-value step exists and meets the
  project's real acceptance bar, **say so** and redirect to the simplest thing that does the job.
  Over-engineering — including in this tooling itself — is a defect, not a virtue.

## Scope of "a unit"
- Any new module, feature, data transform, or decision-logic change is **a unit** and gets an
  adversarial `/review`. Mechanical edits already specified and understood (typos, formatting, a
  rename the user requested) do **not** trigger a review.

## Prose is not mechanism
- A control is real only if it is **auto-invoked** (a hook, a test, a CI job — not a thing to remember),
  **self-proving** (a planted-violation test fails when the guard is removed), and **recorded**. Any
  "must / always / enforced" that traces to none of these is hope, not a guarantee — flag it. When a
  rule here needs teeth, add a hook or a test; don't just assert it harder.
