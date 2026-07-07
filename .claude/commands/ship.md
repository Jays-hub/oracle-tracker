---
description: Commit current work, push it, and open a PR
---

Look at the current git state (`git status`, `git diff --stat`) and understand what changed.

1. If HEAD is detached (e.g. a worktree) or on a generic/default branch, create a new branch with a
   short, descriptive kebab-case name based on the actual work done: `git checkout -b <name>`.
2. Stage and commit everything relevant, with a clear commit message reflecting what was actually done —
   not a generic placeholder.
3. Push it: `git push -u origin <branch>`.
4. Open a pull request: `gh pr create --fill` (fall back to an explicit `--title`/`--body` if `--fill`
   produces a poor summary).
5. Report back the PR URL.

If there's nothing to commit, say so and stop — don't create an empty branch or PR.
