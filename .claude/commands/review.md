---
description: Run an adversarial, read-only review of a finished unit via the cold-context reviewer subagent. Usage: /review <unit id>
argument-hint: <unit id, or 'uncommitted' for current changes>
---

Launch the **`reviewer`** subagent (read-only over the codebase, write-scoped only to `docs/reviews/**`)
to adversarially review the unit: **`$ARGUMENTS`**. If that is empty, default to reviewing the
uncommitted/most-recent changes and say so.

Why a subagent and not this thread: the review must run **cold to the build chat** — it never saw the
builder's own narration, rationalizations, or in-thread back-and-forth, which is what "review in a
separate chat" was actually protecting against. It is **deliberately handed the builder's decision log**
(below) so it can tell an intentional tradeoff from a mistake — cold to the conversation, not blind to
the documented reasoning. Do not pre-summarize or pre-judge the code for the reviewer beyond that; let it
form its own view from the repo.

Before launching, gather two things:

1. **Diff base:** run `git log --oneline -5` and `git status --short`. Include the result so the
   reviewer knows what changed (e.g. "unit landed in commit X" or "changes are uncommitted in these paths").
2. **Decision log:** read `docs/build_notes/$ARGUMENTS.md` if it exists. If it does, include its full
   contents in the reviewer prompt under a `## Builder's Decision Log` header. If it doesn't exist, note
   that to the reviewer — the absence of a decision log means it must infer intent from code alone and
   should flag unconfirmed assumptions more aggressively.

Prompt to give the subagent:
> Adversarially review unit **$ARGUMENTS** of this repo. Acceptance criteria = that unit's spec (its
> roadmap section / ticket / design doc) with the project's real "done when" as the bar. Obey your full
> reviewer protocol: ground yourself, **run the test and lint commands and the unit's own acceptance
> check yourself**, hunt the correctness / silent-wrong-answer / split / reproducibility / boundary list
> plus any domain hazards `.claude/rules/` names, and end with the structured findings + honest sign-off.
> Here is the diff base: {git output}. Before reviewing code, read the builder's decision log below — use
> it to distinguish deliberate choices from mistakes, and critique the reasoning where it's weak.
> **Before you return control, write your full findings block + sign-off, verbatim, to
> `docs/reviews/$ARGUMENTS.md`** (create it; this is the one path you may use your Write tool on —
> nothing else). This is the durable record the user reads directly; it is not relayed only through the
> builder's thread.
>
> ## Builder's Decision Log
> {contents of docs/build_notes/$ARGUMENTS.md, or "No decision log exists — infer intent from code and
> flag unconfirmed assumptions aggressively."}

When the subagent returns, confirm `docs/reviews/$ARGUMENTS.md` exists, print its path and its `shasum` —
that file, not this chat, is the authoritative report. Then **Read that file and relay from the file
itself, never from the subagent's in-chat return message**, reproducing its structure verbatim (the
findings block, the verdict, the test/lint result, the top-3 fixes, the single biggest risk) so the user
doesn't have to leave the conversation to read it. Do not soften or re-grade it. Sourcing the relay from
the artifact makes a relay-vs-file mismatch impossible by construction.

Then, **do not auto-fix.** Present the findings and ask the user how they want to proceed. When they
greenlight fixes, hand them back to a build pass (apply the reviewer's concrete fixes), re-run the suite,
and record the outcome in `docs/progress_log.md`. Fixing is ordinary build work; it is **not** gated by
anything before the keystrokes.

## The review closes on code merit

This review closes on the **code**: findings relayed, greenlit fixes landed and re-passed, the closing
`docs/progress_log.md` entry written. It is **not** gated by the user's understanding or by any ceremony.
Once fixes are in and the log entry is written, the unit is done and mergeable.
