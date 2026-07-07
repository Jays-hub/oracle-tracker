# Agentic Workflow — current state

Dated snapshot of the workflow machinery: what exists, what's verified working, what's known-broken.
Newest first. Scope + access rule: `README.md`.

---

## <<DATE>> — Seeded from the agentic-starter template

**What exists:** the portable core — three verbs (`/session-start`, `/build`, `/review`) + `/ship`, one
cold-context adversarial `reviewer` subagent, the `enforce_agent_write_scope` hook that makes the
reviewer's read-only scope a mechanism, the `00-process` rule, and this self-record folder.

**Verified working:** `<<record here once you've run the loop end-to-end on the first real unit and
confirmed the write-scope hook actually denies an out-of-scope reviewer write>>`.

**Not yet built / known gaps:**
- No domain rules yet (`.claude/rules/01+`) — the `<<DONE-WHEN>>` bar and structural laws are still
  placeholders in `CLAUDE.md` and `agents/reviewer.md`.
- The write-scope hook has no planted-violation test yet — until one exists, its "enforced" claim is
  itself unproven (see `00-process.md`, "Prose is not mechanism").
