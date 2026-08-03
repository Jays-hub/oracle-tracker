#!/usr/bin/env python3
"""PreToolUse hook -- enforce_agent_write_scope.

Turns a subagent's "read-only over the codebase / Write granted only for one
artifact path" prose into MECHANISM. Without this hook, "the reviewer is read-only"
is hope; with it, the reviewer literally cannot write anywhere but its one artifact
-- not with Write/Edit, and not with a Bash redirect, `sed -i`, or a mutating git
command either. This is the single most load-bearing piece of the template: it is
what lets you trust an adversarial reviewer's independence.

The harness includes `agent_type` in hook input for subagent tool calls. For each
write-scoped agent listed in _ALLOWED_ARTIFACTS this hook denies:

  * Write / Edit / MultiEdit / NotebookEdit targeting any path INSIDE the repo tree
    that is not the agent's one allowed artifact. Writes outside the tree (the
    session scratchpad, /tmp) stay allowed -- the guarantee protects the tree.
  * Bash segments that would mutate the tree: a segment led by a file mutator
    (rm, mv, mkdir, touch, tee, ...; cp/rsync/install judged by destination so a
    read-only scratch copy OUT of the repo stays legal), sed/perl in-place editing,
    a redirect into a repo path outside the agent's artifact, or a mutating git
    subcommand (commit, checkout, stash, apply, ...).

Main-thread calls and unscoped agents pass through untouched. The failure mode is
deny-leaning: a blocked reviewer reports instead of writing, which is exactly its
job. This guards against the agent's own drift, not a determined adversary (no
text-level filter can).

TO ADAPT PER PROJECT: add one entry to _ALLOWED_ARTIFACTS per write-scoped agent,
mapping its `agent_type` (the `name:` in .claude/agents/<name>.md) to a regex of the
repo-relative path(s) it may write. Keep the pattern tight -- the whole point is that
it can write its own report and nothing else.
"""
import json
import os
import re
import shlex
import sys

import shell_lex

_REPO_ROOT = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
)

# The one artifact each write-scoped agent's own definition grants it (repo-relative).
# Add a row here for every read-only subagent you create.
#
# `[^/]+` (not `[\w.-]+`) on purpose: the unit id flows in from `/review <unit>`
# unsanitized, and real unit ids contain spaces and punctuation -- this project's
# own first unit is "Map + colored pins". A stricter class denies the reviewer the
# ONE write it is granted, which deadlocks the review after it has done all the
# work. Still one file, still directly under docs/reviews/, since `[^/]+` cannot
# cross a directory boundary and the path is realpath'd before it is matched.
_ALLOWED_ARTIFACTS = {
    "reviewer": (re.compile(r"docs/reviews/[^/]+\.md"),),
}

_WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}

# Wrappers that may precede the real command in a segment.
_WRAPPERS = {"env", "sudo", "nohup", "time", "command", "builtin", "xargs"}
_ENV_ASSIGNMENT = re.compile(r"[\w.]+=.*")

# Every non-flag argument must resolve outside the repo tree.
_MUTATORS_ALL_ARGS = {
    "rm", "rmdir", "mv", "mkdir", "touch", "truncate", "ln", "chmod", "chown",
    "dd", "shred", "unlink", "patch", "tee",
}
# Only the destination (last non-flag argument) must resolve outside the repo tree:
# copying a repo file OUT to scratch is a read of the tree, not a write to it.
_MUTATORS_DEST_ARG = {"cp", "rsync", "install"}

_GIT_MUTATORS = {
    "commit", "push", "pull", "fetch", "merge", "rebase", "reset", "checkout",
    "switch", "restore", "clean", "apply", "stash", "cherry-pick", "revert",
    "rm", "mv", "am", "tag", "branch", "gc", "prune", "reflog", "filter-branch",
    "update-ref", "config", "remote", "submodule",
}
_GIT_READONLY_BRANCH = re.compile(r"^-(?:a|r|l|v|vv|-all|-list|-remotes|-verbose)$")

# On masked text so quoted `>` never fires; `>{1,2}(?!&)` skips fd dups like 2>&1.
_REDIRECT = re.compile(r"\d*>{1,2}(?!&)")
_INPLACE_FLAG = re.compile(r"^-\w*i|^--in-place")


def _resolve(path_str: str, cwd: str) -> str:
    p = os.path.expanduser(path_str)
    if not os.path.isabs(p):
        p = os.path.join(cwd, p)
    return os.path.realpath(p)


def _inside_repo(resolved: str) -> bool:
    return resolved == _REPO_ROOT or resolved.startswith(_REPO_ROOT + os.sep)


def _is_allowed_artifact(resolved: str, patterns) -> bool:
    if not _inside_repo(resolved):
        return True  # outside the tree is not ours to guard
    rel = os.path.relpath(resolved, _REPO_ROOT).replace(os.sep, "/")
    return any(pattern.fullmatch(rel) for pattern in patterns)


def _deny_file_tool(agent, tool_name, tool_input, cwd, patterns):
    target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not target:
        return None
    resolved = _resolve(target, cwd)
    if _is_allowed_artifact(resolved, patterns):
        return None
    return (
        f"{tool_name} to {target} denied: the {agent} subagent is read-only over "
        f"this repo except its own artifact "
        f"({', '.join(p.pattern for p in patterns)}). Report the change you wanted "
        f"to make as a finding instead; the builder applies fixes."
    )


def _segment_tokens(segment: str):
    try:
        return shlex.split(segment)
    except ValueError:
        return None  # unbalanced/unparseable -> caller decides, deny-leaning


def _real_command(tokens):
    """Skip env assignments, wrappers, and wrapper flags to find the real command."""
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if _ENV_ASSIGNMENT.fullmatch(tok) or tok.startswith("-"):
            i += 1
            continue
        name = os.path.basename(tok)
        if name in _WRAPPERS:
            i += 1
            continue
        return name, tokens[i + 1:]
    return "", []


def _args_outside_repo(args, cwd, dest_only=False):
    paths = [tok for tok in args if not tok.startswith("-")]
    if dest_only:
        paths = paths[-1:]
    if not paths:
        return False  # no textual targets (e.g. xargs-fed) -> deny-leaning
    return all(not _inside_repo(_resolve(tok, cwd)) for tok in paths)


def _deny_bash_segment(segment: str, cwd: str, patterns):
    masked = shell_lex.mask_quotes(segment)

    for match in _REDIRECT.finditer(masked):
        rest = segment[match.end():].lstrip()
        if not rest:
            continue
        target_tokens = _segment_tokens(rest)
        if target_tokens is None:
            return "a redirect this hook can't parse"
        if not target_tokens:
            continue
        resolved = _resolve(target_tokens[0], cwd)
        if not _is_allowed_artifact(resolved, patterns):
            return f"a redirect into the repo tree ({target_tokens[0]})"

    tokens = _segment_tokens(segment)
    if tokens is None:
        # Only deny unparseable segments when they look like they lead with a mutator.
        lead = masked.lstrip(" \t(").split()
        name = os.path.basename(lead[0]) if lead else ""
        if name in _MUTATORS_ALL_ARGS or name in _MUTATORS_DEST_ARG or name == "git":
            return f"an unparseable segment leading with `{name}`"
        return None
    if not tokens:
        return None

    cmd, args = _real_command(tokens)

    if cmd in _MUTATORS_ALL_ARGS and not _args_outside_repo(args, cwd):
        return f"`{cmd}` touching the repo tree"
    if cmd in _MUTATORS_DEST_ARG and not _args_outside_repo(args, cwd, dest_only=True):
        return f"`{cmd}` with a destination in the repo tree"
    if cmd in ("sed", "perl") and any(_INPLACE_FLAG.match(tok) for tok in args):
        return f"in-place `{cmd}` editing"
    if cmd == "git":
        sub_args = [tok for tok in args if not tok.startswith("-")]
        sub = sub_args[0] if sub_args else ""
        if sub == "worktree" and (len(sub_args) < 2 or sub_args[1] != "list"):
            return "a mutating `git worktree` operation"
        if sub == "branch":
            trailing = args[args.index("branch") + 1:] if "branch" in args else []
            if any(not _GIT_READONLY_BRANCH.match(tok) for tok in trailing):
                return "a mutating `git branch` operation"
        elif sub in _GIT_MUTATORS:
            return f"a mutating `git {sub}`"
    return None


def _denial_reason(payload):
    agent = payload.get("agent_type", "")
    patterns = _ALLOWED_ARTIFACTS.get(agent)
    if not patterns:
        return None
    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}
    cwd = payload.get("cwd") or _REPO_ROOT

    if tool_name in _WRITE_TOOLS:
        return _deny_file_tool(agent, tool_name, tool_input, cwd, patterns)

    if tool_name == "Bash":
        command = tool_input.get("command", "")
        for segment in shell_lex.split_segments(command):
            what = _deny_bash_segment(segment, cwd, patterns)
            if what:
                return (
                    f"Bash command denied for the {agent} subagent: it contains "
                    f"{what}. This agent is read-only over the repo tree "
                    f"(.claude/hooks/enforce_agent_write_scope.py); its one writable "
                    f"artifact is {', '.join(p.pattern for p in patterns)}. Work in "
                    f"the scratchpad or /tmp for scratch copies, and report intended "
                    f"code changes as findings instead of making them."
                )
    return None


def main() -> None:
    payload = json.load(sys.stdin)
    reason = _denial_reason(payload)
    if reason:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
