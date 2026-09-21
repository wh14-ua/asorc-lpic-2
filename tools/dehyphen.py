# -*- coding: utf-8 -*-
import os
"""Corpus-frequency de-hyphenation of line-break hyphens.

A hyphen followed by a space (artifact of our line joining) is resolved by
comparing how often the corpus contains the JOINED form vs the HYPHENATED
form as real single-line tokens.
"""
import re, collections

SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
W = r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]"

_PLAIN = None
_HYPH = None

def _build(files):
    global _PLAIN, _HYPH
    if _PLAIN is not None:
        return
    plain = collections.Counter()
    hyph = collections.Counter()
    for f in files:
        for line in open(f, encoding="utf-8", errors="replace"):
            for w in re.findall(rf"{W}{{2,}}", line):
                plain[w.lower()] += 1
            for w in re.findall(rf"{W}{{2,}}(?:-{W}{{2,}})+", line):
                hyph[w.lower()] += 1
    _PLAIN, _HYPH = plain, hyph

def fix_line_hyphens(text, files=None):
    if files is None:
        files = [f"{SP}/raw/book1_raw.txt", f"{SP}/raw/book2_raw.txt"]
    _build(files)
    def repl(m):
        a, b = m.group(1), m.group(2)
        joined = (a + b).lower()
        hy = (a + "-" + b).lower()
        nj = _PLAIN.get(joined, 0)
        nh = _HYPH.get(hy, 0)
        if nh > nj:
            return a + "-" + b
        if nj > 0:
            return a + b
        return a + "-" + b
    prev = None
    out = text
    while prev != out:
        prev = out
        out = re.sub(rf"\b({W}{{2,}})-\s+({W}{{2,}})\b", repl, out)
    return out
