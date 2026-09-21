# -*- coding: utf-8 -*-
"""Contraste WCAG AA de la interfaz web.

Lee los colores reales de web/styles.css (no una copia) y comprueba cada
pareja de texto/fondo que la interfaz usa de verdad:

  texto normal  >= 4.5:1
  texto grande  >= 3.0:1   (>=24px, o >=18.66px en negrita)

Los tamaños indicados abajo son los mínimos que aplica el CSS, así que la
exigencia es la del caso peor.
"""
import os
import re
import sys

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(PROJ, "web", "styles.css")

AA_NORMAL = 4.5
AA_LARGE = 3.0


def load_vars(path):
    txt = open(path, encoding="utf-8").read()
    root = re.search(r":root\s*\{(.*?)\}", txt, re.S)
    if not root:
        sys.exit("no se encontró el bloque :root en styles.css")
    out = {}
    for name, val in re.findall(r"--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;", root.group(1)):
        out[name] = val
    return out


def rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(h):
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (f(c) for c in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


# (descripción, color de texto, color de fondo, ¿texto grande?)
PAIRS = [
    ("texto principal sobre el fondo",        "ink",     "bg",     False),
    ("texto principal sobre superficie",      "ink",     "surf",   False),
    ("texto principal sobre superficie 2",    "ink",     "surf-2", False),
    ("texto principal sobre superficie 3",    "ink",     "surf-3", False),
    ("texto secundario sobre el fondo",       "dim",     "bg",     False),
    ("texto secundario sobre superficie",     "dim",     "surf",   False),
    ("texto secundario sobre superficie 2",   "dim",     "surf-2", False),
    ("violeta como texto sobre el fondo",     "v-text",  "bg",     False),
    ("violeta como texto sobre superficie",   "v-text",  "surf",   False),
    ("verde de acierto sobre el fondo",       "ok",      "bg",     False),
    ("verde de acierto sobre su tarjeta",     "ok",      "ok-bg",  False),
    ("rojo de fallo sobre el fondo",          "bad",     "bg",     False),
    ("rojo de fallo sobre su tarjeta",        "bad",     "bad-bg", False),
    ("ámbar de aviso sobre el fondo",         "warn",    "bg",     False),
    ("ámbar de aviso sobre superficie",       "warn",    "surf",   False),
    ("texto sobre tarjeta de acierto",        "ink",     "ok-bg",  False),
    ("texto sobre tarjeta de fallo",          "ink",     "bad-bg", False),
    # texto grande / interactivo
    ("veredicto grande en verde",             "ok",      "bg",     True),
    ("veredicto grande en rojo",              "bad",     "bg",     True),
    ("barra de progreso sobre su carril",     "v",       "surf-2", True),
]

# Parejas con color fijo (no viene de una variable).
FIXED = [
    ("texto del botón principal", "#ffffff", "v-ink", False),
    ("letra sobre la tecla verde", "#ffffff", "ok", False),
    ("letra sobre la tecla roja", "#ffffff", "bad", False),
    ("letra sobre la tecla violeta", "#ffffff", "v", True),
    # Fondos translúcidos: aquí van ya mezclados, que es lo que se ve.
    ("ámbar de la etiqueta de resultado", "warn", "#f4e5ce", False),
    ("texto del botón de volver a la activa", "ink", "surf-2", False),
    # La banda «qué memorizar» lleva un degradado violeta; se comprueba su punto medio.
    ("texto de «qué memorizar»", "ink", "#faece2", False),
    ("rótulo de «qué memorizar»", "v-text", "#faece2", False),
    ("rótulo de la analogía sobre su fondo", "v-text", "#faeee6", False),
    ("código resaltado sobre su fondo", "ink", "#efece6", False),
    ("texto del botón principal sobre terracota", "#ffffff", "v-ink", False),
    ("acento como texto sobre tarjeta", "v-text", "surf", False),
    ("teal como texto sobre el papel", "teal", "bg", False),
]


def main():
    V = load_vars(CSS)
    missing = [n for _, a, b, _ in PAIRS for n in (a, b) if n not in V]
    if missing:
        sys.exit("faltan variables en styles.css: " + ", ".join(sorted(set(missing))))

    rows = [(d, V[a], V[b], big) for d, a, b, big in PAIRS]
    rows += [(d, a if a.startswith("#") else V[a],
              b if b.startswith("#") else V[b], big) for d, a, b, big in FIXED]

    fails = []
    print("Contraste WCAG AA (web/styles.css)\n")
    for desc, fg, bg, big in rows:
        r = ratio(fg, bg)
        need = AA_LARGE if big else AA_NORMAL
        ok = r >= need
        if not ok:
            fails.append((desc, r, need))
        tag = "grande" if big else "normal"
        print(f"  {'OK  ' if ok else 'FALLO'}  {r:5.2f}:1  (min {need}, {tag:7s})  {desc}")

    print()
    if fails:
        print(f"FALLAN {len(fails)} parejas:")
        for d, r, need in fails:
            print(f"  - {d}: {r:.2f}:1, hace falta {need}:1")
        sys.exit(1)
    print(f"Las {len(rows)} parejas cumplen WCAG AA.")


if __name__ == "__main__":
    main()
