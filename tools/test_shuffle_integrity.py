# -*- coding: utf-8 -*-
"""Test: tras barajar (y en cualquier idioma), la respuesta correcta que muestra
la aplicación sigue siendo exactamente la misma OPCIÓN LÓGICA del libro.

Ejecuta la app sobre todo el banco y comprueba, pregunta a pregunta:
  1. la etiqueta original que cita  == correct_answer de questions.json
  2. el texto mostrado como correcto == texto de esa opción en el idioma activo
  3. en modo ASORC, se muestran exactamente 3 opciones y solo 1 es correcta
  4. las opciones mostradas son un subconjunto de las originales
"""
import os, re, sys, json, subprocess, tempfile

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(PROJ, "asorc")
QJSON = os.path.join(PROJ, "questions.json")
L = r"[A-E](?![A-Za-z])"
RE_BLOCK = re.compile(r"\n=+\nPregunta ")
RE_ID = re.compile(r"\[([A-Z0-9-]+)\]")
RE_CORRECT = re.compile(rf"Respuesta correcta: ({L}(?:, {L})*)")
RE_BOOK = re.compile(rf"\(en el libro: opción ({L}(?:, {L})*)")
RE_OPT = re.compile(r"^  ([A-E])\. (.*)$", re.M)
RE_ARROW = re.compile(r"^     → (.*)$", re.M)


def run(mode_key, lang, nq):
    """mode_key: '2' (tipo test) u '8' (ASORC)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        prog = f.name
    os.unlink(prog)
    if mode_key == "8":
        stdin = "8\n0\n" + "A\n\n" * nq + "0\n"
    else:
        stdin = "2\n" + "A\n\n" * nq + "0\n"
    p = subprocess.run([APP, "--no-color", "--lang", lang,
                        "--questions", QJSON, "--progress", prog],
                       input=stdin, capture_output=True, text=True, timeout=600)
    if os.path.exists(prog):
        os.unlink(prog)
    return p.stdout


def check(out, lang, asorc, byid):
    errs, n = [], 0
    for b in RE_BLOCK.split(out)[1:]:
        m = RE_ID.search(b)
        if not m:
            continue
        qid = m.group(1)
        q = byid.get(qid)
        if q is None:
            errs.append(f"{qid}: id desconocido")
            continue
        mc, mb = RE_CORRECT.search(b), RE_BOOK.search(b)
        if not (mc and mb):
            continue
        n += 1
        shown_letters = [x.strip() for x in mc.group(1).split(",")]
        book_letters = sorted(x.strip() for x in mb.group(1).split(","))

        # --- 1. la etiqueta original citada es la del banco ---
        expected = sorted(q["correct_answer"]) if isinstance(q["correct_answer"], list) else None
        if expected is None:
            continue
        if asorc:
            if book_letters != [q["asorc"]["correct_label"]]:
                errs.append(f"{qid}: asorc cita {book_letters}, esperado "
                            f"{q['asorc']['correct_label']}")
            if len(shown_letters) != 1:
                errs.append(f"{qid}: ASORC con {len(shown_letters)} correctas")
        if book_letters != expected:
            errs.append(f"{qid}: cita {book_letters}, correct_answer {expected}")

        # --- 2. el texto mostrado como correcto es el de esa opción ---
        opts = q["original_options_es"] if (lang != "en" and q.get("original_options_es")) \
            else q["original_options"]
        bylabel = {o["label"]: o["text"] for o in opts}
        want = {bylabel[l] for l in book_letters if l in bylabel}
        got = set(RE_ARROW.findall(b))
        # el ajuste de línea puede partir textos largos: comparar por prefijo
        for g in got:
            if not any(w == g or w.startswith(g) or g.startswith(w[:40]) for w in want):
                errs.append(f"{qid}: texto correcto mostrado {g[:45]!r} no coincide")

        # --- 3/4. opciones mostradas ---
        # Solo la zona de opciones (antes del prompt): una línea de la explicación
        # puede empezar por "D. ..." tras el ajuste de línea y falsear el recuento.
        head = b.split("Tu respuesta", 1)[0]
        shown_opts = RE_OPT.findall(head)
        if asorc and len(shown_opts) != 3:
            errs.append(f"{qid}: ASORC muestra {len(shown_opts)} opciones")
        if not asorc and len(shown_opts) != len(q["original_options"]):
            errs.append(f"{qid}: muestra {len(shown_opts)} de "
                        f"{len(q['original_options'])} opciones")
        allowed = {o["text"] for o in opts}
        if asorc:
            allowed = {o["text"] for o in opts
                       if o["label"] in q["asorc"]["kept_option_labels"]}
        for _, txt in shown_opts:
            t = txt.strip()
            if not any(a == t or a.startswith(t) or t.startswith(a[:40]) for a in allowed):
                errs.append(f"{qid}: opción mostrada {t[:45]!r} no es del libro")
    return n, errs


def main():
    doc = json.load(open(QJSON, encoding="utf-8"))
    byid = {q["id"]: q for q in doc["questions"]}
    total_err = 0
    for lang in ("es", "en", "bi"):
        for mode, asorc, nq, name in (("2", False, 280, "tipo test"),
                                      ("8", True, 210, "ASORC")):
            out = run(mode, lang, nq)
            n, errs = check(out, lang, asorc, byid)
            total_err += len(errs)
            status = "OK" if not errs else f"{len(errs)} ERRORES"
            print(f"  lang={lang:2s} modo={name:10s} verificadas={n:4d}  {status}")
            for e in errs[:5]:
                print("      -", e)
    print()
    if total_err:
        print(f"FALLO: {total_err} discrepancias")
        sys.exit(1)
    print("TODO CORRECTO: la respuesta correcta se conserva tras barajar en los 3 idiomas")


if __name__ == "__main__":
    main()
