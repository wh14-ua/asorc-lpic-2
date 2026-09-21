# -*- coding: utf-8 -*-
import os
"""Parse Book 1 (Sybex LPIC-2 Study Guide 2nd ed) questions + answers."""
import re, json, sys, os

SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
OFFSET = 56

CHAPTERS = [
 (1,  "Starting a System",                        89,  92),
 (2,  "Maintaining the System",                  145, 148),
 (3,  "Mastering the Kernel",                    191, 194),
 (4,  "Managing the Filesystem",                 251, 254),
 (5,  "Administering Advanced Storage Devices",  323, 326),
 (6,  "Navigating Network Services",             366, 369),
 (7,  "Organizing Email Services",               422, 426),
 (8,  "Directing DNS",                           503, 506),
 (9,  "Offering Web Services",                   549, 552),
 (10, "Sharing Files",                           633, 636),
 (11, "Managing Network Clients",                671, 674),
 (12, "Setting Up System Security",              707, 710),
]
ASSESS_Q = (45, 50)
APPENDIX = (712, 745)

def load_pages():
    txt = open(f"{SP}/raw/book1_layout_paged.txt", encoding="utf-8").read()
    parts = re.split(r"<<<PDFPAGE (\d+)>>>\n", txt)[1:]
    return {int(parts[i]): parts[i+1] for i in range(0, len(parts), 2)}

PAGES = load_pages()

# ---------- header / footer scrubbing ----------
HDR_PATTERNS = [
    r"^\s*[ivxlcdm]+\s+Assessment Test\s*$",            # roman + title
    r"^\s*Assessment Test\s+[ivxlcdm]+\s*$",
    r"^\s*Answers to Assessment Test\s*$",
    r"^\s*[ivxlcdm]+\s+Answers to Assessment Test\s*$",
    r"^\s*Answers to Assessment Test\s+[ivxlcdm]+\s*$",
    r"^\s*Review Questions\s+\d+\s*$",
    r"^\s*\d+\s+Chapter\s+\d+\s*[■•]\s*.+$",             # 34  Chapter 1 ■ Starting a System
    r"^\s*Chapter\s+\d+\s*[■•]\s*.+\s+\d+\s*$",
    r"^\s*\d+\s+Appendix\s*[■•]\s*Answers to Review Questions\s*$",
    r"^\s*Appendix\s*[■•]\s*Answers to Review Questions\s+\d+\s*$",
    r"^\s*Chapter\s+\d+:\s+.+\s{3,}\d+\s*$",             # running hdr w/ page no
    r"^\s*\d+\s*$",
    r"^\s*The LPI \d+\s*(Part)?\s*$",      # páginas divisorias de parte
    r"^\s*Exam\s*$",
    r"^\s*[IVX]+\s*$",
]
HDR_RE = [re.compile(p) for p in HDR_PATTERNS]

def scrub(page_text):
    out = []
    for line in page_text.split("\n"):
        if any(r.match(line) for r in HDR_RE):
            continue
        out.append(line)
    return out

def page_lines(a, b):
    """Return list of (pdf_page, line) with headers scrubbed."""
    res = []
    for p in range(a, b+1):
        if p not in PAGES:
            continue
        for line in scrub(PAGES[p]):
            res.append((p, line))
    return res

# ---------- question parsing ----------
Q_RE   = re.compile(r"^(\s*)(\d{1,2})\.\s+(\S.*)$")
OPT_RE = re.compile(r"^\s*([A-E])\.\s{1,}(\S.*)$")

def parse_questions(lines, expected_start=1):
    """lines: list of (page, text). Returns list of dicts."""
    items = []
    cur = None
    expect = expected_start
    for page, line in lines:
        if not line.strip():
            if cur is not None:
                cur["_blank"] = True
            continue
        mo = OPT_RE.match(line)
        mq = Q_RE.match(line)
        # A question number line: must match the next expected number
        if mq and int(mq.group(2)) == expect and not mo:
            if cur: items.append(cur)
            cur = {"num": expect, "page": page, "qlines": [mq.group(3).strip()],
                   "opts": [], "_mode": "q", "_blank": False}
            expect += 1
            continue
        if cur is None:
            continue
        if mo:
            cur["opts"].append([mo.group(1), mo.group(2).strip()])
            cur["_mode"] = "o"
            cur["_blank"] = False
            continue
        s = line.strip()
        if cur["_mode"] == "q":
            cur["qlines"].append(s)
        else:
            if cur["opts"]:
                cur["opts"][-1][1] += " " + s
        cur["_blank"] = False
    if cur: items.append(cur)
    return items

def join_q(qlines):
    t = " ".join(qlines)
    t = re.sub(r"\s+", " ", t).strip()
    return t

# ---------- answer parsing ----------
A_RE = re.compile(r"^(\s*)(\d{1,2})\.\s+(\S.*)$")

def parse_answers(lines, expected_start=1, stop_at_chapter_heading=False):
    items = []
    cur = None
    expect = expected_start
    for page, line in lines:
        if not line.strip():
            continue
        m = A_RE.match(line)
        if m and int(m.group(2)) == expect:
            if cur: items.append(cur)
            cur = {"num": expect, "page": page, "lines": [m.group(3).strip()]}
            expect += 1
            continue
        if cur is None:
            continue
        cur["lines"].append(line.strip())
    if cur: items.append(cur)
    for it in items:
        it["text"] = re.sub(r"\s+", " ", " ".join(it["lines"])).strip()
    return items

def split_answer(text):
    """Split 'A, C. explanation...' or 'modules. explanation' into (answer, explanation)."""
    m = re.match(r"^((?:[A-E])(?:\s*,\s*[A-E])*(?:\s+and\s+[A-E])?)\.\s+(.*)$", text)
    if m:
        letters = re.findall(r"[A-E]", m.group(1))
        return letters, m.group(2).strip()
    return None, text.strip()
