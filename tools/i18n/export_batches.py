# -*- coding: utf-8 -*-
"""Exporta las preguntas Sybex en lotes para traducir."""
import os, json, math
PROJ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 10

d = json.load(open(os.path.join(PROJ, "questions.json"), encoding="utf-8"))
sy = [q for q in d["questions"] if q["book"] == "sybex"]
os.makedirs(f"{HERE}/batches", exist_ok=True)

n = math.ceil(len(sy) / SIZE)
for b in range(n):
    chunk = sy[b*SIZE:(b+1)*SIZE]
    lines = []
    for q in chunk:
        lines.append(f"### {q['id']}  [{q['type']}]")
        lines.append(f"Q: {q['question']}")
        for o in q["original_options"]:
            lines.append(f"{o['label']}: {o['text']}")
        if q["type"] == "open" and q.get("correct_answer"):
            lines.append(f"FILL: {q['correct_answer']}")
        lines.append(f"X: {q['explanation']}")
        lines.append("")
    open(f"{HERE}/batches/b{b+1:02d}.txt", "w", encoding="utf-8").write("\n".join(lines))
print(f"{n} lotes de hasta {SIZE} preguntas -> {HERE}/batches/")
ids = [q["id"] for q in sy]
json.dump(ids, open(f"{HERE}/sybex_ids.json", "w"), indent=0)
print("ids guardados:", len(ids))
