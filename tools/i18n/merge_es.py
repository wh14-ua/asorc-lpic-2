# -*- coding: utf-8 -*-
"""Añade los campos paralelos *_es a questions.json.

No modifica ni elimina ningún texto original en inglés: solo agrega campos.
Aborta si cambia el número de preguntas, los IDs, las opciones o las
respuestas correctas.
"""
import os, re, json, glob, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
QJSON = os.path.join(PROJ, "questions.json")
# Instantánea previa a la traducción: es la referencia INDEPENDIENTE contra la
# que se valida que nada del original se pierde ni cambia. La produce una
# extracción limpia (tools/extract.sh), no este script.
BASELINE = os.path.join(HERE, "questions_en_only.backup.json")

# "(Elija todas las que correspondan.)" y variantes: contradicen el formato
# ASORC de respuesta única, así que se retiran solo del enunciado ASORC.
CHOOSE_ALL_ES = re.compile(
    r"\s*\((?:Elija|Elige|Seleccione)\s+(?:todas\s+las\s+que\s+correspondan|"
    r"dos|tres|las\s+dos\s+mejores\s+respuestas)\.?\)\s*", re.I)


def asorc_stem_es(q):
    return re.sub(r"\s+", " ", CHOOSE_ALL_ES.sub(" ", q)).strip()


def load_translations():
    tr = {}
    for f in sorted(glob.glob(os.path.join(HERE, "es", "b*.json"))):
        for it in json.load(open(f, encoding="utf-8")):
            if it["id"] in tr:
                sys.exit(f"ERROR: id duplicado en las traducciones: {it['id']}")
            tr[it["id"]] = it
    return tr


def main():
    doc = json.load(open(QJSON, encoding="utf-8"))
    fresh = not any("question_es" in q for q in doc["questions"])
    if fresh:
        # Extracción recién hecha: se refresca la línea base.
        json.dump(doc, open(BASELINE, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print("línea base actualizada:", BASELINE)
    if not os.path.exists(BASELINE):
        sys.exit(f"ERROR: falta la línea base {BASELINE}; regenera con tools/extract.sh")
    original = json.load(open(BASELINE, encoding="utf-8"))
    if any("question_es" in q for q in original["questions"]):
        sys.exit("ERROR: la línea base ya contiene traducciones; no sirve como referencia")
    tr = load_translations()
    qs = doc["questions"]

    sybex = [q for q in qs if q["book"] == "sybex"]
    missing = [q["id"] for q in sybex if q["id"] not in tr]
    if missing:
        sys.exit(f"ERROR: faltan {len(missing)} traducciones: {missing[:10]}")
    extra = [i for i in tr if i not in {q["id"] for q in sybex}]
    if extra:
        sys.exit(f"ERROR: traducciones sin pregunta: {extra[:10]}")

    for q in qs:
        if q["book"] != "sybex":
            # El libro ENI ya está en español: los campos _es replican el original.
            q["question_es"] = q["question"]
            q["original_options_es"] = []
            q["explanation_es"] = q["explanation"]
            if q.get("model_answer"):
                q["model_answer_es"] = q["model_answer"]
            q["translated"] = False
            q["asorc"]["question_es"] = q["asorc"].get("question", q["question"])
            continue

        t = tr[q["id"]]
        q["question_es"] = t["q"].strip()

        # Opciones: mismas etiquetas, mismo orden; "=" conserva el texto inglés.
        opts_es = []
        for o in q["original_options"]:
            lbl = o["label"]
            if lbl not in t["o"]:
                sys.exit(f"ERROR: {q['id']} falta la opción {lbl} en la traducción")
            v = t["o"][lbl]
            opts_es.append({"label": lbl, "text": o["text"] if v == "=" else v.strip()})
        if len(opts_es) != len(q["original_options"]):
            sys.exit(f"ERROR: {q['id']} distinto número de opciones")
        q["original_options_es"] = opts_es

        q["explanation_es"] = t["e"].strip()
        if q["type"] == "open":
            q["model_answer_es"] = t["e"].strip()
            if t.get("fill"):
                q["correct_answer_es"] = t["fill"].strip()
        q["translated"] = True
        q["asorc"]["question_es"] = asorc_stem_es(q["question_es"])

    # ------------------------- validación -------------------------
    o_qs = original["questions"]
    errs = []
    if len(qs) != len(o_qs) != 380:
        errs.append(f"nº de preguntas cambió: {len(o_qs)} -> {len(qs)}")
    if len(qs) != 380:
        errs.append(f"se esperaban 380 preguntas, hay {len(qs)}")
    ids_base = [q["id"] for q in o_qs]
    ids_now = [q["id"] for q in qs]
    for i in set(ids_base) - set(ids_now):
        errs.append(f"la pregunta {i} de la línea base ha desaparecido")
    for i in set(ids_now) - set(ids_base):
        errs.append(f"la pregunta {i} no está en la línea base")
    for a, b in zip(o_qs, qs):
        if a["id"] != b["id"]:
            errs.append(f"id cambió: {a['id']} -> {b['id']}")
            continue
        for f in ("question", "explanation", "source_answer", "type", "book",
                  "chapter", "topic", "page"):
            if a.get(f) != b.get(f):
                errs.append(f"{a['id']}: el campo original '{f}' fue modificado")
        if a.get("correct_answer") != b.get("correct_answer"):
            errs.append(f"{a['id']}: correct_answer fue modificado")
        if len(a["original_options"]) != len(b["original_options"]):
            errs.append(f"{a['id']}: cambió el nº de opciones originales")
        for oa, ob in zip(a["original_options"], b["original_options"]):
            if oa["label"] != ob["label"] or oa["text"] != ob["text"]:
                errs.append(f"{a['id']}: opción original {oa['label']} modificada")
        if a["asorc"].get("correct_label") != b["asorc"].get("correct_label"):
            errs.append(f"{a['id']}: asorc.correct_label modificado")
        if a["asorc"].get("kept_option_labels") != b["asorc"].get("kept_option_labels"):
            errs.append(f"{a['id']}: asorc.kept_option_labels modificado")
        # paralelismo es/en
        if len(b.get("original_options_es", [])) not in (0, len(b["original_options"])):
            errs.append(f"{a['id']}: original_options_es no es paralelo")
        for oe, oo in zip(b.get("original_options_es", []), b["original_options"]):
            if oe["label"] != oo["label"]:
                errs.append(f"{a['id']}: etiquetas _es desalineadas")
        if b["book"] == "sybex":
            if not b.get("question_es"):
                errs.append(f"{a['id']}: sin question_es")
            if not b.get("explanation_es"):
                errs.append(f"{a['id']}: sin explanation_es")
            if len(b["original_options_es"]) != len(b["original_options"]):
                errs.append(f"{a['id']}: nº de opciones _es != original")

    if errs:
        print("VALIDACIÓN FALLIDA:")
        for e in errs[:30]:
            print("  -", e)
        sys.exit(1)

    doc["counts"]["translated_es"] = sum(1 for q in qs if q.get("translated"))
    doc["languages"] = {
        "original": {"sybex": "en", "eni": "es"},
        "parallel_fields": ["question_es", "original_options_es", "explanation_es",
                            "model_answer_es", "correct_answer_es",
                            "asorc.question_es"],
        "note": ("Los campos _es son una traducción al español añadida; los campos "
                 "originales en inglés no se modifican. Comandos, rutas, nombres de "
                 "archivo, parámetros, protocolos y paquetes se conservan literales."),
    }
    json.dump(doc, open(QJSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("OK:", QJSON)
    print("  preguntas:", len(qs))
    print("  con traducción _es:", doc["counts"]["translated_es"])
    print("  opciones traducidas:",
          sum(len(q.get("original_options_es", [])) for q in qs if q.get("translated")))


if __name__ == "__main__":
    main()
