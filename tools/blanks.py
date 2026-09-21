# -*- coding: utf-8 -*-
import os
"""Recover fill-in-the-blank gaps in Book 1 from word bounding boxes.

`pdftotext -layout` renders a blank as whitespace (collapsible) and drops it
entirely at end of line. Word x-coordinates recover both cases. pdftotext's
<line> elements are fragments, so words are regrouped into visual lines by y.
"""
import re, subprocess, os, json, statistics

SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
PROJ = os.environ.get("ASORC_PROJ", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF = os.environ.get("ASORC_PDF1", os.path.join(PROJ, "LPIC-2-Linux-inglés.pdf"))
CACHE = f"{SP}/raw/book1_words.json"

WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', re.S)

def unesc(s):
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
             .replace("&quot;", '"').replace("&apos;", "'"))

def _words(page):
    xml = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page),
                          "-bbox-layout", PDF, "-"],
                         capture_output=True, text=True).stdout
    return [(float(a), float(b), float(c), float(d), unesc(t))
            for a, b, c, d, t in WORD_RE.findall(xml)]

def page_lines(page, cache={}):
    """Group words into visual lines: [{'y','xmin','xmax','words':[(x0,x1,txt)]}]"""
    if page in cache:
        return cache[page]
    ws = _words(page)
    ws.sort(key=lambda w: (round(w[1], 1), w[0]))
    lines, cur, cury = [], [], None
    for x0, y0, x1, y1, t in ws:
        if cury is None or abs(y0 - cury) <= 3.0:
            cur.append((x0, x1, t)); cury = y0 if cury is None else cury
        else:
            lines.append(cur); cur = [(x0, x1, t)]; cury = y0
    if cur:
        lines.append(cur)
    out = []
    for L in lines:
        L.sort(key=lambda w: w[0])
        out.append({"xmin": L[0][0], "xmax": L[-1][1], "words": L})
    # recover y for each
    ys, i = [], 0
    ws2 = sorted(ws, key=lambda w: (round(w[1], 1), w[0]))
    cury, k = None, 0
    for o in out:
        o["y"] = None
    # simpler: recompute y from original tuples
    ymap = {}
    for x0, y0, x1, y1, t in ws:
        ymap[(x0, x1, t)] = y0
    for o in out:
        o["y"] = min(ymap.get(w, 0.0) for w in o["words"])
    out.sort(key=lambda o: o["y"])
    cache[page] = out
    return out

BLANK = "______"
NEWITEM_RE = re.compile(r"^(?:\d{1,2}\.|[A-E]\.)\s|^(?:\d{1,2}\.|[A-E]\.)$")

def detect(page, gap_intra=11.0, gap_eol=25.0):
    """Return [(plain, with_blanks, n_inserted)] per visual line."""
    lines = page_lines(page)
    if not lines:
        return []
    rm = max(l["xmax"] for l in lines)
    deltas = [lines[i+1]["y"] - lines[i]["y"] for i in range(len(lines)-1)]
    deltas = [d for d in deltas if d > 1]
    step = statistics.median(deltas) if deltas else 12.0
    res = []
    for i, l in enumerate(lines):
        ws = l["words"]
        plain = " ".join(w[2] for w in ws)
        parts, n = [ws[0][2]], 0
        for j in range(1, len(ws)):
            if ws[j][0] - ws[j-1][1] >= gap_intra:
                parts.append(BLANK); n += 1
            parts.append(ws[j][2])
        txt = " ".join(parts)
        nxt = lines[i+1] if i + 1 < len(lines) else None
        cont = False
        if nxt is not None:
            ntxt = " ".join(w[2] for w in nxt["words"])
            if not NEWITEM_RE.match(ntxt) and (nxt["y"] - l["y"]) <= step * 1.7:
                cont = True
        if cont and (rm - l["xmax"]) >= gap_eol:
            txt += " " + BLANK; n += 1
        res.append((plain, txt, n))
    return res
