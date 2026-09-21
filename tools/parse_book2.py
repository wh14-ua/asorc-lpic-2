# -*- coding: utf-8 -*-
import os
"""Parse Book 2 (ENI - Preparación LPIC-2, Bobillier) open Q/A sections."""
import re, sys
SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))

def load():
    txt = open(f"{SP}/raw/book2_layout_paged.txt", encoding="utf-8").read()
    lines = txt.split("\n")
    out, page = [], 0
    for l in lines:
        m = re.match(r"<<<PDFPAGE (\d+)>>>$", l)
        if m:
            page = int(m.group(1)); continue
        out.append((page, l))
    return out

LINES = load()

def find_sections():
    """Return [(start_q_idx, start_a_idx, end_idx)] for each chapter."""
    qi = [i for i, (p, l) in enumerate(LINES) if l.strip() == "1. Preguntas"]
    ai = [i for i, (p, l) in enumerate(LINES) if l.strip() == "2. Respuestas"]
    ti = [i for i, (p, l) in enumerate(LINES) if l.strip() == "Trabajos prácticos"]
    secs = []
    for k, q in enumerate(qi):
        a = next(x for x in ai if x > q)
        e = next((x for x in ti if x > a), len(LINES))
        secs.append((q, a, e))
    return secs

NUM_RE = re.compile(r"^\s*(\d{1,2})\s+(\S.*)$")

def parse_numbered(span, expect_max=10, answers=False):
    """Parse ' N text' blocks. For answers, each block = repeated question + answer para."""
    items, cur, expect = [], None, 1
    for page, line in span:
        s = line.strip()
        if not s:
            if cur is not None:
                cur["paras"].append("")
            continue
        m = NUM_RE.match(line)
        if m and int(m.group(1)) == expect and expect <= expect_max:
            if cur: items.append(cur)
            cur = {"num": expect, "page": page, "paras": [m.group(2).strip()]}
            expect += 1
            continue
        if cur is None:
            continue
        if cur["paras"] and cur["paras"][-1] == "":
            cur["paras"].append(s)
        else:
            cur["paras"][-1] = (cur["paras"][-1] + " " + s).strip() if cur["paras"] else s
    if cur: items.append(cur)
    for it in items:
        it["paras"] = [re.sub(r"\s+", " ", p).strip() for p in it["paras"] if p.strip()]
    return items
