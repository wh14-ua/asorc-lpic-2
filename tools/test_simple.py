# -*- coding: utf-8 -*-
"""Comprueba las explicaciones simplificadas de la web.

La regla que más importa: NO se inventa contenido. Todo término técnico que
aparece en la explicación reescrita (comando, ruta, archivo, sigla) tiene que
estar también en el material del libro de esa misma pregunta. Si no está, es
que me lo he inventado.

Además: cobertura, estructura, longitud y ausencia de lenguaje burocrático.
"""
import os
import re
import sys
import json

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QJSON = os.path.join(PROJ, "questions.json")
SJSON = os.path.join(PROJ, "explanations_simple.json")

FAILS = []
WARNS = []


def fail(qid, msg):
    FAILS.append(f"{qid}: {msg}")


def warn(qid, msg):
    WARNS.append(f"{qid}: {msg}")


# Lenguaje que el usuario pidió evitar, más los giros de la misma familia.
PROHIBIDO = [
    r"se procede a", r"se efect[uú]", r"se encuentra asociad", r"por tanto constituye",
    r"provoca la parada", r"el tratamiento de la pila", r"se lleva a cabo",
    r"cabe (?:destacar|señalar|mencionar)", r"es preciso señalar", r"a efectos de",
    r"mediante el cual", r"en el caso de que", r"con el fin de", r"no obstante",
    r"dicho[s]? (?:archivo|comando|módulo|servidor|fichero)", r"resulta ser",
    r"\bconstituye\b", r"\bpermite llevar a cabo\b", r"en lo que respecta",
    r"\b(?:el|la|los|las) mism[oa]s? (?:se|es|son|puede|permite|debe|sirve)\b",
    # voz de libro: el veredicto por letras no es una explicación
    r"la opci[oó]n [A-H] es (?:correcta|incorrecta)",
    r"las opciones [A-H].{0,20} son (?:correctas|incorrectas)",
]

# Un token "técnico": ruta, archivo con extensión, identificador con guion bajo
# o sigla en mayúsculas. Son los que no se pueden inventar.
TOKEN = re.compile(r"[A-Za-z0-9~][A-Za-z0-9_./~+-]*")


ARTEFACTOS = str.maketrans({"\u223c": "~", "\u2013": "-", "\u2014": "-", "\u2010": "-"})


def tecnicos(texto):
    out = set()
    for t in TOKEN.findall(texto.translate(ARTEFACTOS)):
        t = t.strip(".,;:()[]")
        if len(t) < 2:
            continue
        if "/" in t or "_" in t or re.search(r"\w\.\w", t):
            out.add(t)
        elif t.isupper() and t.isalpha():
            out.add(t)
    return out


def palabras(t):
    return len([w for w in re.split(r"\s+", t.strip()) if w])


def frases(t):
    return [f for f in re.split(r"(?<=[.!?])\s+", t.strip()) if f]


def main():
    qs = json.load(open(QJSON, encoding="utf-8"))
    qs = qs["questions"] if isinstance(qs, dict) else qs
    banco = {q["id"]: q for q in qs}

    if not os.path.exists(SJSON):
        sys.exit("falta explanations_simple.json (ejecuta tools/simple/merge.py)")
    simple = json.load(open(SJSON, encoding="utf-8"))["explicaciones"]

    print(f"[1] Cobertura: {len(simple)} de {len(banco)}")
    faltan = [i for i in banco if i not in simple]
    if faltan:
        print(f"  faltan {len(faltan)}: {', '.join(faltan[:6])}"
              + (" …" if len(faltan) > 6 else ""))

    print("\n[2] Estructura, longitud, estilo y fidelidad")
    for qid, rec in simple.items():
        q = banco[qid]

        # --- estructura ---
        idea = rec.get("idea") or []
        if not isinstance(idea, list) or not idea or not all(isinstance(x, str) and x.strip() for x in idea):
            fail(qid, "idea vacía o mal formada")
            continue
        memo = (rec.get("memorizar") or "").strip()
        if not memo:
            fail(qid, "sin línea de memorización")
        otras = rec.get("otras") or {}
        labels = {o["label"] for o in q["original_options"]}
        correctas = set(q["correct_answer"])
        for lab in otras:
            if lab not in labels:
                fail(qid, f"otras['{lab}'] no es una opción de esta pregunta")
            elif lab in correctas:
                fail(qid, f"otras['{lab}'] es una respuesta CORRECTA, no un distractor")
        if q["type"] == "open" and otras:
            fail(qid, "una pregunta abierta no tiene distractores")

        # --- longitud ---
        # La primera frase es la que se ve enorme arriba: tiene que ser corta.
        if palabras(idea[0]) > 13:
            fail(qid, f"la idea principal tiene {palabras(idea[0])} palabras (máx. 13): «{idea[0][:70]}…»")
        if len(frases(idea[0])) > 1:
            fail(qid, "la idea principal debe ser una sola frase")

        todas = frases(" ".join(idea))
        if len(todas) > 5:
            fail(qid, f"idea con {len(todas)} frases (máx. 5)")
        for f in todas:
            if palabras(f) > 24:
                fail(qid, f"frase de {palabras(f)} palabras: «{f[:60]}…»")
        if palabras(memo) > 14:
            fail(qid, f"«qué memorizar» de {palabras(memo)} palabras")
        ana = (rec.get("analogia") or "").strip()
        if ana and palabras(ana) > 32:
            fail(qid, f"analogía de {palabras(ana)} palabras")
        for lab, txt in otras.items():
            if palabras(txt) > 16:
                fail(qid, f"otras['{lab}'] de {palabras(txt)} palabras")
            if re.fullmatch(r"(?i)\s*(?:es\s+)?incorrect[ao]\.?\s*", txt):
                fail(qid, f"otras['{lab}'] no explica nada")

        # --- estilo ---
        texto = " ".join(idea + [ana, memo] + list(otras.values()))
        for pat in PROHIBIDO:
            m = re.search(pat, texto, re.I)
            if m:
                fail(qid, f"lenguaje de manual: «{m.group(0)}»")

        # --- fidelidad: nada técnico puede salir de la nada ---
        fuente = " ".join(str(q.get(k) or "") for k in (
            "question", "question_es", "explanation", "explanation_es", "source_answer"))
        for grupo in ("original_options", "original_options_es"):
            for o in (q.get(grupo) or []):
                fuente += " " + o["text"]
        libro = tecnicos(fuente)
        libro_low = {t.lower() for t in libro}
        for t in tecnicos(texto):
            tl = t.lower()
            if tl in libro_low:
                continue
            # Abreviar una ruta larga por su cola («udev.conf» por
            # «/etc/udev/udev.conf») no es inventarse nada. Las siglas sueltas
            # sí se exigen enteras: «LINUX» no vale porque exista «SYSLINUX».
            if ("/" in t or "." in t or "_" in t) and any(tl in x for x in libro_low):
                continue
            # Una sigla suelta vale si el libro la usa como palabra propia
            # («HOME» dentro de «$HOME/.procmailrc» sí; «LINUX» dentro de
            # «SYSLINUX» no, porque ahí no empieza palabra).
            if re.search(r"\b" + re.escape(t) + r"\b", fuente.translate(ARTEFACTOS)):
                continue
            # Componer una ruta con piezas que el libro sí usa («~/.ssh/known_hosts»
            # a partir de «.ssh» y «known_hosts») no es inventarse nada; lo que no
            # vale es meter un tramo que no aparece por ningún lado.
            if "/" in t:
                crudo = fuente.translate(ARTEFACTOS).lower()
                piezas = [x for x in t.replace("~", "").split("/") if x]
                if piezas and all(p.lower() in crudo for p in piezas):
                    continue
            fail(qid, f"término que no está en el libro: «{t}»")

    print(f"  {len(simple) - len({f.split(':')[0] for f in FAILS})} explicaciones sin problemas")
    print()
    if FAILS:
        print(f"FALLAN {len(FAILS)} comprobaciones:")
        for f in FAILS[:60]:
            print("  " + f)
        if len(FAILS) > 60:
            print(f"  … y {len(FAILS) - 60} más")
        sys.exit(1)
    if faltan:
        sys.exit(1)
    print("Todas las explicaciones son fieles, cortas y en lenguaje llano.")


if __name__ == "__main__":
    main()
