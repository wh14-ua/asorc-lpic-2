# -*- coding: utf-8 -*-
import os
"""Targeted repair of fill-in-the-blank stems whose gap sits at end of line.

Only applied to questions the book itself marks '(Fill in ...)'. The blank
position comes from word bounding boxes, not from guesswork.
"""
import re, sys, statistics
SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blanks as B

MARKER = re.compile(r"^(?:\d{1,2}\.|[A-E]\.)$")

def question_text_with_blanks(page, qnum, gap_intra=11.0, gap_eol=40.0):
    """Rebuild question `qnum` stem from bbox lines of `page`, marking blanks."""
    lines = B.page_lines(page)
    rm = max(l["xmax"] for l in lines)
    ds = [lines[i+1]["y"] - lines[i]["y"] for i in range(len(lines)-1)]
    ds = [d for d in ds if d > 1]
    step = statistics.median(ds) if ds else 12.0
    start = None
    for i, l in enumerate(lines):
        w0 = l["words"][0][2]
        if w0 == f"{qnum}.":
            start = i
            break
    if start is None:
        return None
    out = []
    for i in range(start, len(lines)):
        l = lines[i]
        ws = l["words"]
        txt = " ".join(w[2] for w in ws)
        if i > start and (MARKER.match(ws[0][2]) or re.match(r"^[A-E]\.$", ws[0][2])):
            break
        parts, first = [], True
        for j, w in enumerate(ws):
            if j > 0:
                gap = ws[j][0] - ws[j-1][1]
                skip = (j == 1 and MARKER.match(ws[0][2]))
                if gap >= gap_intra and not skip:
                    parts.append("______")
            parts.append(w[2])
        line_txt = " ".join(parts)
        nxt = lines[i+1] if i + 1 < len(lines) else None
        cont = (nxt is not None
                and not MARKER.match(nxt["words"][0][2])
                and (nxt["y"] - l["y"]) <= step * 1.7)
        if cont and (rm - l["xmax"]) >= gap_eol:
            line_txt += " ______"
        out.append(line_txt)
        if not cont:
            break
    t = " ".join(out)
    t = re.sub(rf"^{qnum}\.\s*", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s+([.,;:])", r"\1", t)
    return t
