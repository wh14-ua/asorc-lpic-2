# -*- coding: utf-8 -*-
"""Vuelca el material de un lote para redactar sus microtarjetas.

Una microtarjeta solo puede salir de lo que hay aquí: enunciado, opciones,
respuesta correcta, explicación del libro y explicación en llano. Nada más.

    python3 tools/micro/material.py                  # lista los lotes
    python3 tools/micro/material.py b08-sybex-ch08   # material de un lote

Los lotes son los mismos que los de tools/simple/: un capítulo por archivo.
"""
import os
import sys
import json
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
SIMPLE_DIR = os.path.join(PROJ, "tools", "simple")


def lotes():
    """{nombre de lote: [ids]} tomado de tools/simple/*.json."""
    out = {}
    for path in sorted(glob.glob(os.path.join(SIMPLE_DIR, "b*.json"))):
        nombre = os.path.splitext(os.path.basename(path))[0]
        out[nombre] = list(json.load(open(path, encoding="utf-8")).keys())
    return out


def material(q, s):
    tipo = q["type"]
    lineas = [f"### {q['id']}  [{tipo}]  tema: {q['topic']}"]
    lineas.append("P: " + (q.get("question_es") or q.get("question") or "").strip())
    if q.get("question_es") and q.get("question") and q["question"] != q["question_es"]:
        lineas.append("P(en): " + q["question"].strip())
    if tipo != "open":
        correctas = set(q.get("correct_answer") or [])
        en = {o["label"]: o["text"] for o in q.get("original_options") or []}
        for o in q.get("original_options_es") or q.get("original_options") or []:
            marca = "*" if o["label"] in correctas else " "
            extra = f"   (en: {en[o['label']]})" if en.get(o["label"]) not in (None, o["text"]) else ""
            lineas.append(f"  {marca}{o['label']}. {o['text']}{extra}")
    else:
        resp = q.get("correct_answer_es") or q.get("correct_answer")
        if isinstance(resp, str) and resp.strip():
            lineas.append("RESPUESTA: " + resp.strip())
        modelo = q.get("model_answer_es") or q.get("model_answer") or q.get("source_answer")
        if modelo and str(modelo).strip() not in (str(resp).strip(), (q.get("explanation_es") or "").strip()):
            lineas.append("MODELO: " + str(modelo).strip())
    libro = (q.get("explanation_es") or q.get("explanation") or "").strip()
    ya = q.get("correct_answer_es") or q.get("correct_answer") if tipo == "open" else None
    if libro and libro != str(ya or "").strip():
        lineas.append("LIBRO: " + libro)
    if s:
        lineas.append("LLANO idea: " + " ".join(s.get("idea") or []))
        if s.get("otras"):
            lineas.append("LLANO otras: " + " | ".join(f"{k}: {v}" for k, v in s["otras"].items()))
        if s.get("memorizar"):
            lineas.append("LLANO memorizar: " + s["memorizar"])
    return "\n".join(lineas)


def main():
    todos = lotes()
    if len(sys.argv) < 2:
        for nombre, ids in todos.items():
            print(f"{nombre:22s} {len(ids):3d} preguntas")
        return
    nombre = sys.argv[1]
    if nombre not in todos:
        sys.exit(f"no existe el lote {nombre}; mira la lista sin argumentos")
    qs = json.load(open(os.path.join(PROJ, "questions.json"), encoding="utf-8"))["questions"]
    banco = {q["id"]: q for q in qs}
    simple = json.load(open(os.path.join(PROJ, "explanations_simple.json"),
                            encoding="utf-8"))["explicaciones"]
    for qid in todos[nombre]:
        print(material(banco[qid], simple.get(qid)))
        print()


if __name__ == "__main__":
    main()
