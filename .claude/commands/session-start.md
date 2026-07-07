---
description: Orient to the current session — reads the progress log, memory, and git state, then returns a fixed brief.
---

Read the following sources directly (do not ask the user to paste anything):

1. `docs/progress_log.md` — the three most recent dated entries (newest first). If the project uses a
   different running log (CHANGELOG, a tracker), read that instead.
2. The project memory index (`MEMORY.md` if this project has one) and any memory file it points to that
   looks relevant to the current branch.
3. Run `git branch --show-current` and `git status --short`.
4. Read the active model + effort from settings (`~/.claude/settings.json`).
5. **Drift self-check.** Run the project's test command (see the `<<TEST COMMAND>>` in `CLAUDE.md`, e.g.
   `make test`) for the real, current pass/fail count. Extract every test-count claim ("NNN tests",
   "NNN pass", "N fail") mentioned in the log entries you read and in `CLAUDE.md`'s status section. If
   the real count disagrees with a quoted one, that's drift — note it. If everything agrees (or nothing
   quotes a count), there's nothing to flag. (Skip this step only if the project has no test command yet.)

Then return **exactly** this brief — no preamble, no trailing commentary. Append the final `Drift:` line
**only** when step 5 found a real mismatch (omit it entirely otherwise — don't pad a clean run with
"Drift: none"):

```
Branch:      <current branch name>
Open unit:   <work unit actively in progress, e.g. a feature/ticket id, or "none">
Last log:    <date + one-line summary of the newest progress_log.md entry>
Next step:   <the single most concrete pending action named in the log or memory>
Uncommitted: <count of modified + untracked files from git status, e.g. "4 files", or "clean">
Memory:      <any memory item directly relevant to the current branch or unit; else "none">
Model:       <model value from settings.json>
Effort:      <effort value from settings.json>
Ready:       Yes — /build <unit> to proceed, or ask a question.
Drift:       <only if step 5 found one — e.g. "CLAUDE.md says 164 pass; the suite shows 181">
```

No narrative. No offers to help further. Just the brief.
