#!/usr/bin/env python3
"""Planted-violation test for require_build_note.py.

Per .claude/rules/00-process.md, a control is real only if it is self-proving:
these cases must FAIL if the guard is removed. Each scenario builds a throwaway
git repo, runs the hook against it, and asserts block/allow.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "require_build_note.py")


def sh(cwd, *args):
    subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=False)


def make_repo(with_code, with_note, commit_code=False, readme_only=False):
    d = tempfile.mkdtemp(prefix="bnhook-")
    sh(d, "git", "init", "-q", "-b", "main")
    sh(d, "git", "config", "user.email", "t@t.t")
    sh(d, "git", "config", "user.name", "t")
    os.makedirs(os.path.join(d, "docs/build_notes"), exist_ok=True)
    os.makedirs(os.path.join(d, "src"), exist_ok=True)
    open(os.path.join(d, "docs/build_notes/README.md"), "w").write("placeholder\n")
    open(os.path.join(d, "seed.txt"), "w").write("seed\n")
    sh(d, "git", "add", "-A")
    sh(d, "git", "commit", "-qm", "seed")

    if with_code:
        open(os.path.join(d, "src/App.tsx"), "w").write("export const x = 1\n")
        if commit_code:
            sh(d, "git", "checkout", "-qb", "feature")
            sh(d, "git", "add", "-A")
            sh(d, "git", "commit", "-qm", "unit work")
    if with_note and not readme_only:
        open(os.path.join(d, "docs/build_notes/map-colored-pins.md"), "w").write("# note\n")
    return d


def run(repo, session=None, stop_active=False):
    payload = {
        "session_id": session or str(uuid.uuid4()),
        "cwd": repo,
        "hook_event_name": "Stop",
        "stop_hook_active": stop_active,
    }
    p = subprocess.run([sys.executable, HOOK], input=json.dumps(payload),
                       capture_output=True, text=True)
    if not p.stdout.strip():
        return "ALLOW", ""
    d = json.loads(p.stdout)
    return ("BLOCK" if d.get("decision") == "block" else "ALLOW"), d.get("reason", "")


def main():
    failures = []
    cases = []

    # 1. The core violation: code churn, no build note.
    r = make_repo(with_code=True, with_note=False)
    cases.append(("code changed + no note", run(r)[0], "BLOCK", r))

    # 2. Step 3 honored -> silent.
    r = make_repo(with_code=True, with_note=True)
    cases.append(("code changed + note exists", run(r)[0], "ALLOW", r))

    # 3. No code churn -> not a build turn.
    r = make_repo(with_code=False, with_note=False)
    cases.append(("no code change", run(r)[0], "ALLOW", r))

    # 4. README.md alone must not count as a note.
    r = make_repo(with_code=True, with_note=True, readme_only=True)
    cases.append(("only README in notes dir", run(r)[0], "BLOCK", r))

    # 5. Committed-but-unmerged work still owes a note.
    r = make_repo(with_code=True, with_note=False, commit_code=True)
    cases.append(("committed, unmerged, no note", run(r)[0], "BLOCK", r))

    # 6. Loop guard: must never block when already continuing because of us.
    r = make_repo(with_code=True, with_note=False)
    cases.append(("stop_hook_active set", run(r, stop_active=True)[0], "ALLOW", r))

    # 7. Once per session: same session_id must not fire twice.
    r = make_repo(with_code=True, with_note=False)
    sid = "session-once-" + uuid.uuid4().hex
    first = run(r, session=sid)[0]
    second = run(r, session=sid)[0]
    cases.append(("same session, 1st fire", first, "BLOCK", r))
    cases.append(("same session, 2nd fire", second, "ALLOW", r))

    # 8. Non-git dir -> never block.
    d = tempfile.mkdtemp(prefix="bnhook-nogit-")
    cases.append(("not a git repo", run(d)[0], "ALLOW", d))

    for name, got, want, path in cases:
        ok = got == want
        if not ok:
            failures.append(name)
        print(f"  {'PASS' if ok else 'FAIL'}  {name:32} got={got:5} want={want}")
        shutil.rmtree(path, ignore_errors=True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} -> {failures}")
        sys.exit(1)
    print(f"All {len(cases)} planted cases behaved correctly.")


if __name__ == "__main__":
    main()
