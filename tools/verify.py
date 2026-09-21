# -*- coding: utf-8 -*-
import os
"""Verification phase: independently re-count expected questions per section
straight from the PDFs, then compare with what was extracted."""
import re, json, sys, collections
SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_book1 as P1
import parse_book2 as B2

PROJ = os.environ.get("ASORC_PROJ", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QJSON = os.path.join(PROJ, "questions.json")

def expected_book1():
    """Independent count: highest sequential item number physically present."""
    rows = []
    # assessment test
    L = P1.page_lines(*P1.ASSESS_Q)
    nums = seq_numbers(L)
    rows.append(("sybex", 0, "Assessment Test", "assessment_test",
                 f"pdf {P1.ASSESS_Q[0]}-{P1.ASSESS_Q[1]}", nums))
    for num, title, a, b in P1.CHAPTERS:
        L = P1.page_lines(a, b)
        rows.append(("sybex", num, f"Chapter {num}: {title}", "review_questions",
                     f"pdf {a}-{b}", seq_numbers(L)))
    return rows

def seq_numbers(lines):
    """Longest run 1,2,3,... of item numbers appearing at line start."""
    seen, expect = [], 1
    for page, line in lines:
        m = re.match(r"^\s*(\d{1,2})\.\s+\S", line)
        if m and int(m.group(1)) == expect and not re.match(r"^\s*[A-E]\.\s", line):
            seen.append(expect); expect += 1
    return seen

def expected_book1_answers():
    """Count answers per chapter in the appendix, independently."""
    L = P1.page_lines(712, 745)
    heads = [i for i, (p, l) in enumerate(L) if re.match(r"^Chapter \d+: \S", l.strip())]
    res = {}
    for k, i in enumerate(heads):
        j = heads[k+1] if k+1 < len(heads) else len(L)
        title = L[i][1].strip()
        cn = int(re.match(r"^Chapter (\d+):", title).group(1))
        res[cn] = len(seq_numbers(L[i+1:j]))
    L2 = P1.page_lines(51, 56)
    res[0] = len(seq_numbers(L2))
    return res

def expected_book2():
    rows = []
    secs = B2.find_sections()
    names = ["Administración del almacenamiento","Arranque del sistema",
             "Administración de la red local","Autentificación de usuarios",
             "Compartición de archivos","Resolución de nombres DNS",
             "Servidor web Apache","Correo electrónico","Protección de redes",
             "Asegurar las comunicaciones","Compilación de aplicaciones y del kernel Linux"]
    for k, (qi, ai, ei) in enumerate(secs):
        qs = B2.parse_numbered(B2.LINES[qi+1:ai])
        ans = B2.parse_numbered(B2.LINES[ai+1:ei])
        rows.append(("eni", k+1, f"Capítulo {k+1}: {names[k]}", "preguntas_respuestas",
                     f"pdf {B2.LINES[qi][0]}", [q["num"] for q in qs], [a["num"] for a in ans]))
    return rows
