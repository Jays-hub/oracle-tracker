#!/usr/bin/env python3
"""Stop hook -- require a build note when a unit's code changed.

Turns `/build` Step 3 ("write docs/build_notes/<unit>.md before handing off")
from an instruction the agent must REMEMBER at the end of a long task into a
check that fires at the moment of handoff.

Rule: if tracked code under a source dir changed and no build note exists, the
agent may not end its turn silently -- it must either write the note or state
that the unit is still in progress. Both outcomes leave a durable trace, so a
later session can tell "in flight" from "abandoned". That distinction is the
whole point; absent artifacts currently mean both and neither.

Deliberately NOT a hard gate:
  * It fires at most ONCE per session (marker file keyed on session_id), so a
    long build costs one extra turn, not a nag on every turn.
  * `stop_hook_active` short-circuits, so it can never trap the agent in a loop.
  * Writing the note OR saying "still building" both satisfy it. It enforces
    that the state is RECORDED, not that the unit is finished.

Repo root comes from `git rev-parse --show-toplevel` against the payload cwd,
not from this file's location, so it stays correct under the parallel worktrees
`/build`'s pre-check explicitly blesses.
"""
import json
import os
import subprocess
import sys

# Source dirs whose churn implies "a unit is being built".
_CODE_DIRS = ("src",)
_NOTES_DIR = "docs/build_notes"
# Files in the notes dir that don't count as a build note.
_NOT_A_NOTE = {"README.md"}


def _git(repo, *args):
    try:
        out = subprocess.run(
            ("git", "-C", repo) + args,
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout if out.returncode == 0 else ""


def _repo_root(cwd):
    root = _git(cwd, "rev-parse", "--show-toplevel").strip()
    return root or None


def _changed_code(repo):
    """Source files that are uncommitted, or committed but not yet on main."""
    changed = set()

    porcelain = _git(repo, "status", "--porcelain", "--", *_CODE_DIRS)
    for line in porcelain.splitlines():
        path = line[3:].strip().strip('"')
        if path:
            changed.add(path.split(" -> ")[-1])

    # Committed-but-unmerged work counts too: the note is still owed.
    base = "main" if _git(repo, "rev-parse", "--verify", "main").strip() else ""
    if base:
        diff = _git(repo, "diff", "--name-only", f"{base}...HEAD", "--", *_CODE_DIRS)
        changed.update(p for p in diff.splitlines() if p.strip())

    return sorted(changed)


def _existing_notes(repo):
    notes_dir = os.path.join(repo, _NOTES_DIR)
    try:
        entries = os.listdir(notes_dir)
    except OSError:
        return []
    return sorted(
        f for f in entries if f.endswith(".md") and f not in _NOT_A_NOTE
    )


def _marker_path(session_id):
    tmp = os.environ.get("TMPDIR", "/tmp")
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_") or "nosession"
    return os.path.join(tmp, f"claude-build-note-{safe}.marker")


def _already_fired(session_id):
    return os.path.exists(_marker_path(session_id))


def _mark_fired(session_id):
    try:
        with open(_marker_path(session_id), "w") as fh:
            fh.write("1")
    except OSError:
        pass  # can't persist the marker -> worst case it fires again; still safe


def _reason(changed):
    shown = ", ".join(changed[:6])
    more = f" (+{len(changed) - 6} more)" if len(changed) > 6 else ""
    return (
        f"Code changed under {'/, '.join(_CODE_DIRS)}/ ({shown}{more}) but "
        f"{_NOTES_DIR}/ has no build note.\n\n"
        "Per /build Step 3 this unit's handoff is incomplete. Do ONE of:\n"
        f"  1. Write {_NOTES_DIR}/<unit>.md (why-this-why-now, load-bearing "
        "assumptions, decisions taken, deferred items, your 2 least-confident "
        "spots) and add the dated [built] entry to docs/progress_log.md; or\n"
        "  2. If this unit is still in progress, say so explicitly to the user "
        "in your reply, naming what remains.\n\n"
        "Either is fine -- what is not fine is ending the turn with no durable "
        "record, because a later session cannot then tell in-flight work from "
        "abandoned work. This check fires once per session."
    )


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # unreadable payload -> never block

    if payload.get("stop_hook_active"):
        sys.exit(0)  # already continuing because of us; never loop

    session_id = str(payload.get("session_id", ""))
    if _already_fired(session_id):
        sys.exit(0)

    repo = _repo_root(payload.get("cwd") or os.getcwd())
    if not repo:
        sys.exit(0)  # not a git repo -> nothing to reason about

    if _existing_notes(repo):
        sys.exit(0)  # a note exists; Step 3 is being honored

    changed = _changed_code(repo)
    if not changed:
        sys.exit(0)  # no code churn -> not a build turn

    _mark_fired(session_id)
    print(json.dumps({"decision": "block", "reason": _reason(changed)}))
    sys.exit(0)


if __name__ == "__main__":
    main()
