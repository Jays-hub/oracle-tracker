# Agentic Workflow — current state

Dated snapshot of the workflow machinery: what exists, what's verified working, what's known-broken.
Newest first. Scope + access rule: `README.md`.

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
