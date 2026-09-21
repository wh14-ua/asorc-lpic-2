# -*- coding: utf-8 -*-
"""Une los fragmentos de tools/simple/*.json en explanations_simple.json.

Las explicaciones simplificadas viven APARTE de questions.json, que no se toca
nunca. Cada fragmento cubre un capítulo y tiene la misma forma:

    { "SYBEX-CH01-RQ01": { "idea": [...], "analogia": "...",
                           "otras": {"A": "..."}, "memorizar": "..." } }
"""
import os
import re
import sys
import json
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(PROJ, "explanations_simple.json")
QJSON = os.path.join(PROJ, "questions.json")


def main():
    qs = json.load(open(QJSON, encoding="utf-8"))
    qs = qs["questions"] if isinstance(qs, dict) else qs
    ids = {q["id"] for q in qs}

    merged, seen = {}, {}
    for path in sorted(glob.glob(os.path.join(HERE, "*.json"))):
        shard = json.load(open(path, encoding="utf-8"))
        for qid, rec in shard.items():
            if qid in seen:
                sys.exit(f"{qid} está en {seen[qid]} y en {os.path.basename(path)}")
            if qid not in ids:
                sys.exit(f"{qid} ({os.path.basename(path)}) no existe en questions.json")
            seen[qid] = os.path.basename(path)
            merged[qid] = rec

    # orden estable: el del banco, para que el archivo sea reproducible
    ordered = {q["id"]: merged[q["id"]] for q in qs if q["id"] in merged}
    doc = {
        "schema_version": 1,
        "nota": "Explicaciones reescritas en lenguaje llano. El texto original "
                "del libro sigue en questions.json y se muestra bajo "
                "«Ver explicación original».",
        "explicaciones": ordered,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(ordered)} / {len(ids)} explicaciones → {os.path.relpath(OUT, PROJ)}")
    faltan = len(ids) - len(ordered)
    if faltan:
        print(f"  faltan {faltan}")


if __name__ == "__main__":
    main()
