# -*- coding: utf-8 -*-
"""Une los lotes de tools/micro/*.json en microcards.json.

Las microtarjetas viven APARTE de questions.json, que no se toca nunca. Hay
una por pregunta y la misma pregunta tiene siempre la misma: por eso se
escriben aquí, una vez, y no se generan en el navegador.

    python3 tools/micro/merge.py
    python3 tools/test_micro.py          # y después, comprobarlas

Cada lote tiene la forma
    { "SYBEX-AT-21": { "cue": "…", "answer": "…",
                       "contrast": ["X → Y", …], "mnemo": "…" } }
"""
import os
import sys
import json
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(PROJ, "microcards.json")
QJSON = os.path.join(PROJ, "questions.json")


def sin_duplicados(pares):
    vistas = {}
    for k, v in pares:
        if k in vistas:
            raise ValueError(f"clave repetida: {k}")
        vistas[k] = v
    return vistas


def limpia(card):
    """Mismo orden de campos siempre y nada vacío: archivo reproducible."""
    out = {"cue": card["cue"].strip(), "answer": card["answer"].strip()}
    contraste = [x.strip() for x in card.get("contrast") or [] if x.strip()]
    if contraste:
        out["contrast"] = contraste
    if (card.get("mnemo") or "").strip():
        out["mnemo"] = card["mnemo"].strip()
    return out


def main():
    qs = json.load(open(QJSON, encoding="utf-8"))["questions"]
    ids = {q["id"] for q in qs}

    merged, seen = {}, {}
    for path in sorted(glob.glob(os.path.join(HERE, "b*.json"))):
        try:
            lote = json.load(open(path, encoding="utf-8"), object_pairs_hook=sin_duplicados)
        except ValueError as e:
            sys.exit(f"{os.path.basename(path)}: {e}")
        for qid, card in lote.items():
            if qid in seen:
                sys.exit(f"{qid} está en {seen[qid]} y en {os.path.basename(path)}")
            if qid not in ids:
                sys.exit(f"{qid} ({os.path.basename(path)}) no existe en questions.json")
            seen[qid] = os.path.basename(path)
            merged[qid] = limpia(card)

    # orden estable: el del banco
    ordered = {q["id"]: merged[q["id"]] for q in qs if q["id"] in merged}
    doc = {
        "schema_version": 1,
        "nota": "Microtarjetas de repaso rápido: pista corta → respuesta corta, una por "
                "pregunta. Salen solo del material de cada pregunta; questions.json no se toca.",
        "tarjetas": ordered,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(ordered)} / {len(ids)} tarjetas → {os.path.relpath(OUT, PROJ)}")
    if len(ordered) < len(ids):
        print(f"  faltan {len(ids) - len(ordered)}")


if __name__ == "__main__":
    main()
