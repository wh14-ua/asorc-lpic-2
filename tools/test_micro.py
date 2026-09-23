# -*- coding: utf-8 -*-
"""Comprueba las microtarjetas de repaso rápido (microcards.json).

Una pregunta = una tarjeta: pista corta → respuesta corta y, si ayudan, los
distractores con los que se confunde. La regla que más importa: NO se inventa
nada. Todo comando, ruta, archivo, directiva, número o sigla de la tarjeta
tiene que estar en el material de ESA pregunta: enunciado, opciones,
respuesta, explicación del libro o explicación en llano. Y ninguna palabra
puede venir de fuera del banco.

    python3 tools/test_micro.py                          # microcards.json entero
    python3 tools/test_micro.py tools/micro/b05-sybex-ch05.json   # un lote
"""
import os
import re
import sys
import json

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QJSON = os.path.join(PROJ, "questions.json")
SJSON = os.path.join(PROJ, "explanations_simple.json")
MJSON = os.path.join(PROJ, "microcards.json")

# Longitudes: pista de 5–8 palabras, respuesta de una línea, contraste de
# 3–4 líneas muy cortas. Las conceptuales pueden alargar la respuesta, pero
# poco: más vale una frase breve que una mala simplificación.
MAX_CUE_PAL = 8
MAX_ANSWER = 90          # caracteres; objetivo ≤ AVISO_ANSWER
AVISO_ANSWER = 55
MAX_CONTRASTE = 4
MAX_LINEA = 48           # cada línea de contraste y el mnemotécnico

ARTEFACTOS = str.maketrans({"∼": "~", "–": "-", "—": "-", "‐": "-",
                            "‑": "-", "−": "-"})
SEPARA = re.compile(r"[\s→↓←↑,;()«»\"“”‘’·=≠¿?¡!…\[\]{}|]+")
LETRA = r"A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ"

# Palabras corrientes que el banco también usa como opción de una sola
# palabra: no son comandos.
NO_COMANDO = {
    "none", "all", "both", "true", "false", "yes", "no", "never", "always", "nothing",
    "ninguno", "ninguna", "todos", "todas", "ambos", "ambas", "nada", "nunca", "siempre",
    "sí", "si", "verdadero", "falso", "a", "the", "and", "or", "of", "en", "de", "y", "o",
}

FALLOS, AVISOS = [], []


def fallo(qid, msg):
    FALLOS.append(f"{qid}: {msg}")


def aviso(qid, msg):
    AVISOS.append(f"{qid}: {msg}")


def sin_duplicados(pares):
    """json.load se queda en silencio con la última clave repetida; aquí no."""
    vistas = {}
    for k, v in pares:
        if k in vistas:
            raise ValueError(f"clave repetida: {k}")
        vistas[k] = v
    return vistas


def carga(path):
    return json.load(open(path, encoding="utf-8"), object_pairs_hook=sin_duplicados)


def tokens(texto):
    out = []
    for t in SEPARA.split(str(texto or "").translate(ARTEFACTOS)):
        t = t.strip(".:;'`")
        if t and re.search(f"[{LETRA}]", t):
            out.append(t)
    return out


def material(q, s):
    """Todo lo que la tarjeta puede usar de esa pregunta."""
    partes = [str(q.get(k) or "") for k in (
        "question", "question_es", "explanation", "explanation_es", "source_answer",
        "model_answer", "model_answer_es", "correct_answer_es")]
    if isinstance(q.get("correct_answer"), str):
        partes.append(q["correct_answer"])
    for g in ("original_options", "original_options_es"):
        partes += [o["text"] for o in q.get(g) or []]
    a = q.get("asorc") or {}
    partes += [str(a.get("question") or ""), str(a.get("question_es") or "")]
    if s:
        partes += list(s.get("idea") or [])
        partes += [str(s.get("analogia") or ""), str(s.get("memorizar") or "")]
        partes += list((s.get("otras") or {}).values())
    return " ".join(partes).translate(ARTEFACTOS)


def vocabulario(banco, simple):
    """Qué es un comando, qué es un nombre propio y qué palabras existen."""
    palabras, minusculas, capitalizadas, comandos = set(), set(), set(), set()
    for q in banco.values():
        texto = material(q, simple.get(q["id"]))
        for t in tokens(texto):
            palabras.add(t.lower())
            if t.islower():
                minusculas.add(t)
            elif re.fullmatch(r"[A-ZÁÉÍÓÚÑ][a-záéíóúüñ]+", t):
                capitalizadas.add(t)
        palabras.update(re.findall(r"[a-záéíóúüñ]+", texto.lower()))
        # Comandos: las opciones de una sola palabra en minúsculas (exportfs,
        # sysctl, required…). Es el vocabulario técnico del propio banco.
        for g in ("original_options", "original_options_es"):
            for o in q.get(g) or []:
                t = o["text"].strip().rstrip(".,;:")
                if re.fullmatch(r"[a-z][a-z0-9._+-]*", t) and len(t) > 1:
                    comandos.add(t)
    comandos -= NO_COMANDO
    # Nombre propio: aparece con mayúscula y nunca como palabra en minúsculas
    # (Samba, Debian, Postfix). Una palabra corriente a principio de frase no.
    propios = {t for t in capitalizadas if t.lower() not in minusculas}
    # Raíces: «listarlas» o «hablando» no están tal cual, pero «lista» y
    # «habla» sí. Un comando inventado no comparte raíz con nada.
    raices = {w[:n] for w in palabras for n in range(5, len(w) + 1)}
    return palabras | raices, comandos, propios


def es_tecnico(t, comandos, propios):
    if re.search(r"[/._<>$~@#=\\]", t) or re.search(r"\d", t) or t.startswith("-"):
        return True
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", t):          # ssh-keygen, update-rc
        return True
    if re.fullmatch(r"[A-Z][A-Z0-9]+s?", t):                   # siglas: NFS, PAM, DNS
        return True
    if re.search(r"[a-z][A-Z]", t):                            # ServerName, DocumentRoot
        return True
    return t.lower() in comandos or t in propios


def en_material(t, fuente):
    tl = t.lower()
    low = fuente.lower()
    borde = f"[{LETRA.lower()}]"
    if re.search(f"(?<!{borde})" + re.escape(tl) + f"(?!{borde})", low):
        return True
    # La cola de una ruta del libro («exports» por «/etc/exports») o una ruta
    # compuesta con piezas que el libro sí usa no es inventarse nada.
    if "/" in t:
        piezas = [p for p in tl.replace("~", "").split("/") if p]
        if piezas and all(p in low for p in piezas):
            return True
    return False


def revisa(qid, card, q, s, voc):
    palabras, comandos, propios = voc

    # --- estructura ---
    cue, answer = card.get("cue"), card.get("answer")
    contraste, mnemo = card.get("contrast", []), card.get("mnemo", "")
    extra = set(card) - {"cue", "answer", "contrast", "mnemo"}
    if extra:
        fallo(qid, f"campos desconocidos: {sorted(extra)}")
    if not isinstance(cue, str) or not cue.strip():
        return fallo(qid, "sin cue")
    if not isinstance(answer, str) or not answer.strip():
        return fallo(qid, "sin answer")
    if not isinstance(contraste, list) or not all(isinstance(x, str) and x.strip() for x in contraste):
        return fallo(qid, "contrast tiene que ser una lista de líneas")
    if mnemo is not None and not isinstance(mnemo, str):
        return fallo(qid, "mnemo tiene que ser texto")

    # --- longitud ---
    n = len(cue.split())
    if n > MAX_CUE_PAL:
        fallo(qid, f"la pista tiene {n} palabras (máx. {MAX_CUE_PAL}): «{cue}»")
    if len(answer) > MAX_ANSWER:
        fallo(qid, f"la respuesta tiene {len(answer)} caracteres (máx. {MAX_ANSWER}): «{answer}»")
    elif len(answer) > AVISO_ANSWER:
        aviso(qid, f"respuesta larga ({len(answer)}): «{answer}»")
    if len(contraste) > MAX_CONTRASTE:
        fallo(qid, f"{len(contraste)} líneas de contraste (máx. {MAX_CONTRASTE})")
    for ln in contraste + ([mnemo] if mnemo else []):
        if len(ln) > MAX_LINEA:
            fallo(qid, f"línea de {len(ln)} caracteres (máx. {MAX_LINEA}): «{ln}»")
    for ln in [cue, answer] + contraste + ([mnemo] if mnemo else []):
        if "\n" in ln:
            fallo(qid, "una línea no puede partirse en dos")

    # --- estilo ---
    todo = " ".join([cue, answer] + contraste + [mnemo or ""])
    # Las letras se barajan: citar «la opción C» sería mentira en pantalla.
    if re.search(r"\b(?:opci[oó]n|option|respuesta|answer)(?:es|s)?\s+[A-E]\b", todo):
        fallo(qid, "cita opciones por su letra, y las letras se barajan")
    for ln in contraste:
        if "→" not in ln:
            fallo(qid, f"el contraste va en formato «X → Y»: «{ln}»")
    # La pista no puede traer ya la respuesta: si todo lo que dice la
    # respuesta está en la pista, no queda nada que recordar. «Btrfs» en la
    # pista y «btrfs restore» en la respuesta sí vale: falta «restore».
    resp = {t.lower() for t in tokens(answer) if len(t) > 1}
    if resp and resp <= {t.lower() for t in tokens(cue)}:
        fallo(qid, f"la pista ya dice la respuesta: {sorted(resp)}")
    # La tarjeta tiene que ser de la respuesta correcta, no de un distractor.
    if q["type"] == "multiple_choice":
        corr = [o["text"].strip().rstrip(".,;:") for o in q["original_options"]
                if o["label"] in q["correct_answer"]]
        if len(corr) == 1 and len(corr[0].split()) == 1 and es_tecnico(corr[0], comandos, propios):
            if corr[0].lower() not in (cue + " " + answer).lower():
                fallo(qid, f"la correcta es «{corr[0]}» y no aparece ni en la pista ni en la respuesta")

    # --- fidelidad: nada técnico que no esté en ESTA pregunta ---
    fuente = material(q, s)
    for t in tokens(todo):
        if es_tecnico(t, comandos, propios):
            if not en_material(t, fuente):
                fallo(qid, f"«{t}» no aparece en el material de esta pregunta")
            continue
        tl = t.lower()
        piezas = re.findall(r"[a-záéíóúüñ]+", tl)
        if all(p in palabras or p[:max(5, len(p) - 4)] in palabras for p in piezas):
            continue
        # Palabra corriente que el banco no usa: si parece española (tilde, eñe)
        # o es muy corta, se admite; si no, es sospechosa de comando inventado.
        if re.search(r"[áéíóúüñ]", tl) or len(tl) <= 3:
            continue
        fallo(qid, f"«{t}» no sale de ningún sitio del banco")


def main():
    qs = json.load(open(QJSON, encoding="utf-8"))["questions"]
    banco = {q["id"]: q for q in qs}
    simple = json.load(open(SJSON, encoding="utf-8"))["explicaciones"]
    voc = vocabulario(banco, simple)

    lote = sys.argv[1] if len(sys.argv) > 1 else None
    path = lote or MJSON
    if not os.path.exists(path):
        sys.exit(f"falta {os.path.relpath(path, PROJ)} (genéralo con tools/micro/merge.py)")
    try:
        doc = carga(path)
    except ValueError as e:
        sys.exit(f"{os.path.relpath(path, PROJ)}: {e}")
    cards = doc.get("tarjetas", doc) if not lote else doc

    print(f"[1] Una pregunta, una tarjeta ({os.path.relpath(path, PROJ)})")
    desconocidas = [i for i in cards if i not in banco]
    for i in desconocidas:
        fallo(i, "no existe en questions.json")
    if not lote:
        faltan = [i for i in banco if i not in cards]
        print(f"  {len(cards)} tarjetas para {len(banco)} preguntas")
        if faltan:
            fallo("cobertura", f"faltan {len(faltan)}: {', '.join(faltan[:8])}")
        if doc.get("schema_version") != 1:
            fallo("microcards.json", "schema_version tiene que ser 1")

    print("\n[2] Estructura, longitud, estilo y fidelidad")
    for qid, card in cards.items():
        if qid in banco:
            revisa(qid, card, banco[qid], simple.get(qid), voc)
    malas = {f.split(":")[0] for f in FALLOS}
    print(f"  {len(cards) - len(malas & set(cards))} tarjetas sin problemas")
    if AVISOS:
        print(f"  {len(AVISOS)} respuestas largas (se admiten si la pregunta es conceptual)")

    print()
    if FALLOS:
        print(f"FALLAN {len(FALLOS)} comprobaciones:")
        for f in FALLOS[:80]:
            print("  " + f)
        if len(FALLOS) > 80:
            print(f"  … y {len(FALLOS) - 80} más")
        sys.exit(1)
    print("Todas las tarjetas son cortas, estables y salen del material de su pregunta.")


if __name__ == "__main__":
    main()
