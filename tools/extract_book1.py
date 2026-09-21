# -*- coding: utf-8 -*-
import os
import re, json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parse_book1 as P
from dehyphen import fix_line_hyphens

SP = os.environ.get("ASORC_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_work"))
BOOK = "LPIC-2 Linux Professional Institute Certification Study Guide (Exams 201/202), 2nd Ed. - Bresnahan & Blum (Sybex)"
BOOKID = "sybex_lpic2"

def mark_blanks(raw_lines):
    """Convert wide intra-line gaps (fill-in-the-blank) into ______ before whitespace collapse."""
    out = []
    for ln in raw_lines:
        s = ln.strip()
        s = re.sub(r"(?<=\S)\s{4,}(?=\S)", " ______ ", s)
        # trailing gap at end of a line that continues => blank at line end
        out.append(s)
    return out

def build_question(q, chap_no, chap_title, section):
    qtext = " ".join(mark_blanks(q["qlines"]))
    qtext = re.sub(r"\s+", " ", qtext).strip()
    qtext = fix_line_hyphens(qtext)
    opts = []
    for letter, body in q["opts"]:
        # Sin conversión hueco<-espacios en las opciones: verificado por coordenadas
        # que ninguna opción del libro contiene un hueco real (los espacios anchos que
        # produce `pdftotext -layout` son solo alineación de columnas).
        b = re.sub(r"\s+", " ", body).strip()
        b = fix_line_hyphens(b)
        opts.append({"label": letter, "text": b})
    return {"num": q["num"], "page_pdf": q["page"], "page_book": q["page"] - P.OFFSET,
            "chapter_no": chap_no, "chapter": chap_title, "section": section,
            "question": qtext, "original_options": opts}

def collect():
    out = []
    # ---- Assessment Test ----
    qs = P.parse_questions(P.page_lines(*P.ASSESS_Q))
    ans = {a["num"]: a for a in P.parse_answers(P.page_lines(51, 56))}
    assert len(qs) == 30, len(qs)
    assert len(ans) == 30, len(ans)
    for q in qs:
        d = build_question(q, 0, "Assessment Test", "assessment_test")
        a = ans[q["num"]]
        letters, expl = P.split_answer(a["text"])
        d["_letters"] = letters
        d["_answer_raw"] = fix_line_hyphens(a["text"])
        d["_expl"] = fix_line_hyphens(expl)
        d["_ans_page_pdf"] = a["page"]
        out.append(d)
    # ---- Chapter review questions ----
    L2 = P.page_lines(712, 745)
    heads = [i for i, (p, l) in enumerate(L2)
             if re.match(r"^Chapter \d+: \S", l.strip())]
    bounds = []
    for k, i in enumerate(heads):
        j = heads[k+1] if k+1 < len(heads) else len(L2)
        bounds.append((i+1, j))
    assert len(bounds) == 12, len(bounds)
    for idx, (num, title, a, b) in enumerate(P.CHAPTERS):
        qs = P.parse_questions(P.page_lines(a, b))
        assert len(qs) == 20, (num, len(qs))
        s, e = bounds[idx]
        alist = P.parse_answers(L2[s:e])
        amap = {x["num"]: x for x in alist}
        assert len(amap) == 20, (num, len(amap), sorted(amap))
        for q in qs:
            d = build_question(q, num, title, "review_questions")
            aa = amap[q["num"]]
            letters, expl = P.split_answer(aa["text"])
            d["_letters"] = letters
            d["_answer_raw"] = fix_line_hyphens(aa["text"])
            d["_expl"] = fix_line_hyphens(expl)
            d["_ans_page_pdf"] = aa["page"]
            out.append(d)
    return out

if __name__ == "__main__":
    os.makedirs(SP, exist_ok=True)
    items = collect()
    print("TOTAL book1 items:", len(items))
    noans = [i for i in items if not i["_letters"] and i["original_options"]]
    print("MCQ without parsed letters:", len(noans))
    for i in noans[:10]:
        print("  ch", i["chapter_no"], "q", i["num"], "->", i["_answer_raw"][:90])
    openq = [i for i in items if not i["original_options"]]
    print("Open (no options):", len(openq), [(i['chapter_no'], i['num']) for i in openq])
    json.dump(items, open(f"{SP}/book1_items.json", "w"), ensure_ascii=False, indent=1)
