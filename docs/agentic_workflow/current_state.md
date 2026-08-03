# Agentic Workflow — current state

Dated snapshot of the workflow machinery: what exists, what's verified working, what's known-broken.
Newest first. Scope + access rule: `README.md`.

---

## 2026-08-03 — Write-scope artifact path fixed; both hooks now have planted-violation tests

**What changed:**
- **`enforce_agent_write_scope.py` — artifact regex `[\w.-]+` → `[^/]+`.** The old class denied the
  reviewer its own report whenever the unit id contained a space or punctuation. Unit 1 is named
  **"Map + colored pins"**, so `/review "Map + colored pins"` would have had the reviewer do the entire
  review and then be denied the one write it is granted, failing `review.md`'s "confirm the file exists"
  check. Latent deadlock on the project's first real unit; found by running the hook, not by reading it.
- **New `require_build_note.py` (`Stop` hook).** Turns `/build` Step 3 from an instruction the agent has
  to remember at the end of a long task into a check at the moment of handoff: if code under `src/`
  changed and `docs/build_notes/` holds no note, the turn cannot end silently — the agent must write the
  note or say the unit is still in progress. Satisfied by *either*, because in-flight work is normal and
  a control that nags it is worse than none. Fires at most once per session, short-circuits on
  `stop_hook_active`, and resolves the repo via `git rev-parse --show-toplevel` so it is correct under
  the detached-HEAD worktrees `/build` blesses.
- **New `test_write_scope.py` (17 cases) and `test_require_build_note.py` (9 cases).**

**Verified working:** both suites pass (26/26) and are self-proving — reverting the regex fails the
"report, spaces and +" case; removing the Stop guard fails its four BLOCK cases. The write-scope tests
also pin the guard against loosening: no directory crossing, no traversal, no non-`.md` target, and the
Bash-level mutation checks (`rm`, redirect, `git commit`) still bite.

**Known gaps (unchanged or newly named):**
- **The write-scope hook is bypassable by any interpreter.** Verified: `python3 -c`, `node -e`, `awk`
  with a quoted redirect, `ed`, `>|` (the `|` splits the segment before the `>` is read), `npm run build`
  (writes `dist/` in-tree), and `git -C . <mutator>` (the flag's argument is parsed as the subcommand).
  It is a drift guard against a careless agent, not a boundary — the docstring's "single most load-bearing
  piece" framing overstates it.
- **It fails open.** `_denial_reason` returns None when `agent_type` is absent or unmatched, so a renamed
  or missing key silently disables the whole thing with no canary. Unverified whether the harness sends
  that key at all.
- `require_build_note.py` checks that *some* build note exists, not one matching the current unit — a
  deliberate trade, since keying on a unit id is unreliable under detached-HEAD worktrees.
- Unit ids still flow unsanitized from `$ARGUMENTS` into artifact paths; the hook now tolerates that
  rather than the commands slugifying it.
- Neither `00-process.md`'s review-closure sequence nor the acceptance bar duplicated across `CLAUDE.md`,
  `build.md`, and `reviewer.md` has any mechanism behind it yet.

---

## 2026-08-03 — Seeded from the agentic-starter template

**What exists:** the portable core — three verbs (`/session-start`, `/build`, `/review`) + `/ship`, one
cold-context adversarial `reviewer` subagent, the `enforce_agent_write_scope` hook that makes the
reviewer's read-only scope a mechanism, the `00-process` rule, and this self-record folder.

**Verified working:** not yet — pending the first end-to-end loop run on unit 1, which must also confirm
the write-scope hook actually denies an out-of-scope reviewer write.

**Not yet built / known gaps:**
- The DONE-WHEN bar and the project's structural laws are now stated inline (`CLAUDE.md` #3;
  `agents/reviewer.md` "Domain hazards") but not yet graduated into formal `.claude/rules/01+` files —
  do that the first time a hazard needs to be cited twice or given a hook.
- The write-scope hook has no planted-violation test yet — until one exists, its "enforced" claim is
  itself unproven (see `00-process.md`, "Prose is not mechanism").
