#!/usr/bin/env python3
"""Planted-violation test for enforce_agent_write_scope.py.

Covers the two things the artifact-path regex has to get right at once:

  1. The reviewer CAN write its own report for real unit ids -- including ones
     with spaces and punctuation, like this project's own "Map + colored pins".
     The previous `[\\w.-]+` class denied exactly that, deadlocking the review
     after the reviewer had already done all of its work.
  2. Widening the class did NOT loosen the guard: no directory crossing, no
     traversal, no non-report file, and the Bash-level mutation checks still bite.

Per .claude/rules/00-process.md these are self-proving: revert the regex (or
delete the guard) and the relevant cases below fail.

Run: python3 .claude/hooks/test_write_scope.py
"""
import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "enforce_agent_write_scope.py")
REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def run(tool, tool_input, agent="reviewer"):
    payload = {"agent_type": agent, "tool_name": tool, "tool_input": tool_input, "cwd": REPO}
    p = subprocess.run([sys.executable, HOOK], input=json.dumps(payload),
                       capture_output=True, text=True)
    return "ALLOW" if not p.stdout.strip() else "DENY"


def write(path, agent="reviewer"):
    return run("Write", {"file_path": path, "content": "x"}, agent)


def bash(cmd, agent="reviewer"):
    return run("Bash", {"command": cmd}, agent)


CASES = [
    # --- the reviewer's own artifact: must be writable for REAL unit ids ---
    ("report, kebab id",            write("docs/reviews/map-colored-pins.md"),      "ALLOW"),
    ("report, spaces and +",        write("docs/reviews/Map + colored pins.md"),    "ALLOW"),
    ("report, colon and &",         write("docs/reviews/Unit 1: Map & pins.md"),    "ALLOW"),
    ("report, absolute path",       write(f"{REPO}/docs/reviews/unit-1.md"),        "ALLOW"),

    # --- widening must not have loosened anything ---
    ("no directory crossing",       write("docs/reviews/nested/report.md"),         "DENY"),
    ("no traversal out",            write("docs/reviews/../../src/App.md"),         "DENY"),
    ("must be .md",                 write("docs/reviews/report.txt"),               "DENY"),
    ("not the build notes dir",     write("docs/build_notes/unit-1.md"),            "DENY"),
    ("not source",                  write("src/App.tsx"),                           "DENY"),
    ("not the rules",               write(".claude/rules/00-process.md"),           "DENY"),

    # --- bash-level guards still live ---
    ("rm in tree denied",           bash("rm -rf src/"),                            "DENY"),
    ("redirect into tree denied",   bash("echo x > src/App.tsx"),                   "DENY"),
    ("git commit denied",           bash("git commit -am x"),                       "DENY"),
    ("read-only git allowed",       bash("git diff main...HEAD"),                   "ALLOW"),
    ("scratch copy out allowed",    bash("cp src/App.tsx /tmp/x.tsx"),              "ALLOW"),

    # --- scope: writes outside the tree, and the main thread, are not ours ---
    ("write outside repo",          write("/tmp/scratch.md"),                       "ALLOW"),
    ("main thread untouched",       write("src/App.tsx", agent=""),                 "ALLOW"),
]


def main():
    failures = [name for name, got, want in CASES if got != want]
    for name, got, want in CASES:
        print(f"  {'PASS' if got == want else 'FAIL'}  {name:28} got={got:5} want={want}")
    print()
    if failures:
        print(f"FAILED: {len(failures)} -> {failures}")
        sys.exit(1)
    print(f"All {len(CASES)} planted cases behaved correctly.")


if __name__ == "__main__":
    main()
