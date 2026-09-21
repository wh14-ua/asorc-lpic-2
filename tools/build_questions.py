# -*- coding: utf-8 -*-
import os
"""Build questions.json (single source of truth) from both books."""
import re, json, sys, difflib
SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_book1 as P1
import parse_book2 as B2
from dehyphen import fix_line_hyphens
from asorc import pick_asorc, asorc_stem
from fix_blanks import question_text_with_blanks

ROMAN = {1:"i",2:"ii",3:"iii",4:"iv",5:"v",6:"vi",7:"vii",8:"viii",9:"ix"}
def to_roman(n):
    vals=[(1000,"m"),(900,"cm"),(500,"d"),(400,"cd"),(100,"c"),(90,"xc"),
          (50,"l"),(40,"xl"),(10,"x"),(9,"ix"),(5,"v"),(4,"iv"),(1,"i")]
    out=""
    for v,sym in vals:
        while n>=v: out+=sym; n-=v
    return out

PROJ = os.environ.get("ASORC_PROJ", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(PROJ, "questions.json")

BOOK1 = {"id": "sybex",
         "title": "LPIC-2: Linux Professional Institute Certification Study Guide "
                  "(Exam 201 and Exam 202), 2nd Edition",
         "authors": "Christine Bresnahan, Richard Blum",
         "publisher": "Sybex", "language": "en",
         "file": "LPIC-2-Linux-inglés.pdf"}
BOOK2 = {"id": "eni",
         "title": "Preparación para la certificación LPIC-2 (exámenes LPI 201 y LPI 202), 2ª edición",
         "authors": "Sébastien Bobillier",
         "publisher": "Ediciones ENI", "language": "es",
         "file": "lpic-2-linux.pdf"}

# canonical cross-book topic taxonomy (classification only; no content invented)
TOPIC_B1 = {
    0:  "Evaluación general (Assessment Test)",
    1:  "Arranque del sistema",
    2:  "Mantenimiento del sistema",
    3:  "Kernel y compilación",
    4:  "Sistemas de archivos",
    5:  "Almacenamiento avanzado (RAID/LVM)",
    6:  "Servicios de red",
    7:  "Correo electrónico",
    8:  "DNS",
    9:  "Servidor web",
    10: "Compartición de archivos",
    11: "Clientes de red y autenticación",
    12: "Seguridad del sistema",
}
B2_CHAPTERS = [
    (1,  "Administración del almacenamiento",              "Almacenamiento y sistemas de archivos"),
    (2,  "Arranque del sistema",                           "Arranque del sistema"),
    (3,  "Administración de la red local",                 "Servicios de red"),
    (4,  "Autentificación de usuarios",                    "Clientes de red y autenticación"),
    (5,  "Compartición de archivos",                       "Compartición de archivos"),
    (6,  "Resolución de nombres DNS",                      "DNS"),
    (7,  "Servidor web Apache",                            "Servidor web"),
    (8,  "Correo electrónico",                             "Correo electrónico"),
    (9,  "Protección de redes",                            "Seguridad de red"),
    (10, "Asegurar las comunicaciones",                    "Seguridad de las comunicaciones"),
    (11, "Compilación de aplicaciones y del kernel Linux", "Kernel y compilación"),
]

def norm_ws(s):
    return re.sub(r"\s+", " ", s or "").strip()

# ---------------------------------------------------------------- book 1
def build_book1():
    import extract_book1 as E1
    items = E1.collect()
    out = []
    for it in items:
        letters = it["_letters"] or []
        opts = it["original_options"]
        if not opts:
            qtype = "open"
        elif len(letters) > 1:
            qtype = "multiple_response"
        else:
            qtype = "multiple_choice"
        if it["chapter_no"] == 0:
            chap = "Assessment Test"
            qid = f"SYBEX-AT-{it['num']:02d}"
        else:
            chap = f"Chapter {it['chapter_no']}: {it['chapter']}"
            qid = f"SYBEX-CH{it['chapter_no']:02d}-RQ{it['num']:02d}"
        if it["chapter_no"] == 0:
            page_label = to_roman(it["page_pdf"] - 2)   # front matter uses roman numerals
        else:
            page_label = str(it["page_book"])
        # repair fill-in-the-blank stems whose gap sits at end of a line
        qtext = it["question"]
        if re.search(r"\(Fill in", qtext, re.I) and "______" not in qtext:
            rebuilt = question_text_with_blanks(it["page_pdf"], it["num"])
            if rebuilt and "______" in rebuilt:
                qtext = fix_line_hyphens(rebuilt)
        rec = {
            "id": qid,
            "book": BOOK1["id"],
            "book_title": BOOK1["title"],
            "page": page_label,
            "page_pdf": it["page_pdf"],
            "chapter": chap,
            "chapter_no": it["chapter_no"],
            "topic": TOPIC_B1[it["chapter_no"]],
            "section": it["section"],
            "type": qtype,
            "question": qtext,
            "original_options": opts,
            "correct_answer": letters if opts else None,
            "explanation": it["_expl"],
            "source_answer": it["_answer_raw"],
            "source_answer_page_pdf": it["_ans_page_pdf"],
            "language": "en",
        }
        if qtype == "open":
            # fill-in-the-blank: the book's answer starts with the literal solution
            m = re.match(r"^(.{1,60}?)\.\s+(?=[A-Z])", it["_answer_raw"])
            rec["correct_answer"] = norm_ws(m.group(1)) if m else None
            rec["model_answer"] = it["_answer_raw"]
        # ---- ASORC ----
        if qtype == "multiple_choice":
            r = pick_asorc(opts, letters, it["_expl"])
            kept, cl = r
            rec["asorc"] = {
                "eligible": True,
                "kept_option_labels": kept,
                "correct_label": cl,
                "question": asorc_stem(qtext),
                "reduced_from": len(opts),
            }
        elif qtype == "multiple_response":
            rec["asorc"] = {"eligible": False,
                            "reason": "multiple_response",
                            "detail": f"{len(letters)} respuestas correctas en el original; "
                                      f"no se puede reducir a una sola sin falsear la pregunta."}
        else:
            rec["asorc"] = {"eligible": False, "reason": "open"}
        out.append(rec)
    return out

# ---------------------------------------------------------------- book 2
def build_book2():
    secs = B2.find_sections()
    assert len(secs) == 11, len(secs)
    out = []
    for k, (qi, ai, ei) in enumerate(secs):
        cno, ctitle, topic = B2_CHAPTERS[k]
        qs = B2.parse_numbered(B2.LINES[qi+1:ai])
        ans = {a["num"]: a for a in B2.parse_numbered(B2.LINES[ai+1:ei])}
        assert len(qs) == 10, (cno, len(qs))
        assert len(ans) == 10, (cno, len(ans))
        for q in qs:
            a = ans[q["num"]]
            qtext = fix_line_hyphens(norm_ws(" ".join(q["paras"])))
            model = fix_line_hyphens(norm_ws(" ".join(a["paras"][1:])))
            echo = norm_ws(a["paras"][0])
            out.append({
                "id": f"ENI-CH{cno:02d}-Q{q['num']:02d}",
                "book": BOOK2["id"],
                "book_title": BOOK2["title"],
                "page": str(q["page"]),
                "page_pdf": q["page"],
                "chapter": f"Capítulo {cno}: {ctitle}",
                "chapter_no": cno,
                "topic": topic,
                "section": "preguntas_respuestas",
                "type": "open",
                "question": qtext,
                "original_options": [],
                "correct_answer": model,
                "explanation": model,
                "source_answer": model,
                "source_answer_page_pdf": a["page"],
                "model_answer": model,
                "question_echo_in_answers": echo,
                "language": "es",
                "asorc": {"eligible": False, "reason": "open"},
            })
    return out

if __name__ == "__main__":
    b1, b2 = build_book1(), build_book2()
    qs = b1 + b2
    doc = {
        "schema_version": 1,
        "generated_from": [BOOK1, BOOK2],
        "counts": {
            "total": len(qs),
            "by_book": {"sybex": len(b1), "eni": len(b2)},
            "by_type": {t: sum(1 for q in qs if q["type"] == t)
                        for t in ("multiple_choice", "multiple_response", "open")},
            "asorc_eligible": sum(1 for q in qs if q["asorc"]["eligible"]),
        },
        "asorc_rules": {
            "closed_options_shown": 3,
            "single_correct_answer": True,
            "scoring": {"correct": 1.0, "incorrect": -0.5, "blank": 0.0},
            "note": ("Las preguntas con varias respuestas correctas se conservan como "
                     "multiple_response en su formato original y quedan fuera del modo "
                     "ASORC de 3 opciones. Nunca se altera la respuesta correcta."),
        },
        "questions": qs,
    }
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote", OUT)
    print(json.dumps(doc["counts"], ensure_ascii=False, indent=1))
