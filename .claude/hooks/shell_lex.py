"""Quote-aware shell-command lexing shared by the PreToolUse hooks.

Not a shell parser -- just enough structure to make deny decisions honestly:
strip unquoted #-comments, split on unquoted separators (; & | and newlines), and
mask quoted spans so pattern scans never fire on string contents. Hooks that
import this fail deny-leaning on anything the lexer can't see through.
"""
SEPARATOR = "\x00"


def normalize(command: str) -> str:
    """Strip unquoted #-comments; replace unquoted ; & | and newlines with \x00.

    Quote-aware so a ; inside `python -c "...; ..."` does not split the segment and
    a # inside quotes is not treated as a comment. Inside double quotes a backslash
    escapes the next character; inside single quotes nothing does (bash semantics).
    """
    out = []
    quote = None
    i, n = 0, len(command)
    while i < n:
        ch = command[i]
        if quote:
            if quote == '"' and ch == "\\" and i + 1 < n:
                out.append(ch)
                out.append(command[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            out.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            out.append(ch)
            out.append(command[i + 1])
            i += 2
            continue
        if ch in ("'", '"'):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "#" and (not out or out[-1] in " \t\n;&|(" + SEPARATOR):
            while i < n and command[i] != "\n":
                i += 1
            continue
        if ch in ";&|\n":
            out.append(SEPARATOR)
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def split_segments(command: str) -> list:
    """Split a raw command into its unquoted-separator segments, comments stripped."""
    return [seg for seg in normalize(command).split(SEPARATOR) if seg.strip()]


def mask_quotes(text: str) -> str:
    """Same-length copy with quoted spans (quotes included) and escaped characters
    blanked to spaces, so syntax scans (e.g. for redirects) can't fire on string
    contents while positions still line up with the raw text."""
    out = list(text)
    quote = None
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if quote:
            if quote == '"' and ch == "\\" and i + 1 < n:
                out[i] = " "
                out[i + 1] = " "
                i += 2
                continue
            if ch == quote:
                quote = None
            out[i] = " "
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            out[i] = " "
            out[i + 1] = " "
            i += 2
            continue
        if ch in ("'", '"'):
            quote = ch
            out[i] = " "
            i += 1
            continue
        i += 1
    return "".join(out)
