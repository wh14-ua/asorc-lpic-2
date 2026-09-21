# -*- coding: utf-8 -*-
"""Arma el sitio estático que se publica en GitHub Pages.

La web se sirve desde la raíz del sitio, así que los datos tienen que quedar
junto a index.html: las rutas del frontend son relativas y no saben si detrás
hay un servidor Python o no hay nada.

    python3 tools/build_site.py [destino]      # por defecto _site/
"""
import os
import sys
import json
import shutil
import hashlib

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(PROJ, "web")
DATOS = ["questions.json", "explanations_simple.json"]
# config.js lleva credenciales del usuario: no se publica nunca.
EXCLUIR = {"config.js", "server.py", "__pycache__"}


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PROJ, "_site")
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(dest)

    copiados = []
    for raiz, dirs, files in os.walk(WEB):
        dirs[:] = [d for d in dirs if d not in EXCLUIR]
        for f in files:
            if f in EXCLUIR:
                continue
            src = os.path.join(raiz, f)
            rel = os.path.relpath(src, WEB)
            dst = os.path.join(dest, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            copiados.append(rel)

    for d in DATOS:
        src = os.path.join(PROJ, d)
        if not os.path.exists(src):
            sys.exit(f"falta {d}: sin él la web publicada no tiene banco")
        shutil.copy2(src, os.path.join(dest, d))
        copiados.append(d)

    # GitHub Pages no debe pasar esto por Jekyll.
    open(os.path.join(dest, ".nojekyll"), "w").close()

    h = hashlib.md5(open(os.path.join(PROJ, "questions.json"), "rb").read()).hexdigest()
    n = len(json.load(open(os.path.join(PROJ, "questions.json"), encoding="utf-8"))["questions"])
    print(f"{len(copiados)} archivos → {os.path.relpath(dest, PROJ)}/")
    print(f"  {n} preguntas · questions.json {h}")
    absolutas = []
    for rel in copiados:
        if not rel.endswith((".html", ".js", ".css")):
            continue
        txt = open(os.path.join(dest, rel), encoding="utf-8", errors="ignore").read()
        for marca in ('src="/', "src='/", 'href="/', "href='/", "fetch('/", 'fetch("/'):
            if marca in txt:
                absolutas.append(f"{rel}: {marca}")
    if absolutas:
        print("  AVISO · rutas absolutas (romperían bajo subdirectorio):")
        for a in absolutas:
            print("    " + a)
        sys.exit(1)
    print("  todas las rutas son relativas")


if __name__ == "__main__":
    main()
