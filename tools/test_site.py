# -*- coding: utf-8 -*-
"""Prueba el ARTEFACTO que recibe GitHub Pages, no el código fuente.

Arma _site/ desde cero, lo sirve bajo un subdirectorio igual que Pages
(https://usuario.github.io/asorc-lpic-2/) y comprueba que el navegador
encontraría todo lo que pide la página.

    python3 tools/test_site.py
"""
import os
import re
import sys
import json
import shutil
import socket
import tempfile
import subprocess
import threading
import http.server
import functools
import urllib.request
import urllib.error

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUB = "asorc-lpic-2"          # el mismo subdirectorio que usa Pages
FALLOS = []


def check(nombre, cond, detalle=""):
    print(f"  {'OK  ' if cond else 'FALLO'}  {nombre}" + (f"  — {detalle}" if detalle and not cond else ""))
    if not cond:
        FALLOS.append(nombre)


def puerto_libre():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    raiz = tempfile.mkdtemp(prefix="asorc-pages-")
    dest = os.path.join(raiz, SUB)
    try:
        print("[1] Construcción del artefacto")
        out = subprocess.run([sys.executable, os.path.join(PROJ, "tools", "build_site.py"), dest],
                             capture_output=True, text=True, timeout=180)
        check("build_site.py termina bien", out.returncode == 0,
              (out.stdout + out.stderr).strip()[:400])
        if out.returncode != 0:
            return

        exigidos = ["index.html", "styles.css", "config.js", ".nojekyll",
                    "questions.json", "explanations_simple.json",
                    "js/app.js", "js/store.js", "js/dash.js", "js/cloud.js",
                    "js/logic.js", "js/game.js", "js/fx.js", "js/burst.js"]
        for f in exigidos:
            check(f"_site/{f}", os.path.exists(os.path.join(dest, f)))
        check("server.py NO viaja al sitio", not os.path.exists(os.path.join(dest, "server.py")))
        check("config.example.js tampoco", not os.path.exists(os.path.join(dest, "config.example.js")))

        print("\n[2] Servido bajo subdirectorio, como Pages")
        port = puerto_libre()
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=raiz)
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), h)
        srv.log_message = lambda *a, **k: None
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}/{SUB}/"

        def pide(ruta):
            try:
                with urllib.request.urlopen(base + ruta, timeout=20) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as e:
                return e.code, b""

        cod, html = pide("")
        check("la portada responde", cod == 200, str(cod))
        html = html.decode("utf-8", "replace")

        # Todo lo que la página referencia tiene que existir bajo el subdirectorio.
        refs = re.findall(r'(?:src|href)="(\./[^"]+|[^":/][^"]*)"', html)
        refs = [r for r in refs if not r.startswith(("http", "//", "data:", "#"))]
        rotos = []
        for r in refs:
            ruta = r[2:] if r.startswith("./") else r
            c, _ = pide(ruta)
            if c != 200:
                rotos.append(f"{r} → {c}")
        check(f"los {len(refs)} recursos de index.html cargan", not rotos, "; ".join(rotos))

        cod, q = pide("questions.json")
        check("questions.json se sirve", cod == 200, str(cod))
        banco = json.loads(q)["questions"]
        check("trae 380 preguntas", len(banco) == 380, str(len(banco)))
        temas = {x["topic"] for x in banco}
        check("trae 16 temas", len(temas) == 16, str(len(temas)))
        check("la suma por temas es el banco",
              sum(1 for x in banco if x["topic"] in temas) == len(banco))

        cod, e = pide("explanations_simple.json")
        check("explanations_simple.json se sirve", cod == 200, str(cod))
        check("trae las 380 explicaciones",
              len(json.loads(e)["explicaciones"]) == 380)

        cod, c = pide("config.js")
        check("config.js se sirve", cod == 200, str(cod))
        cfg = c.decode("utf-8", "replace")
        check("define ASORC_CONFIG", "ASORC_CONFIG" in cfg)
        check("con URL de Supabase", re.search(r"supabaseUrl:\s*'https://[a-z0-9]+\.supabase\.co'", cfg) is not None)
        check("con clave publishable/anon", re.search(r"supabaseAnonKey:\s*'(sb_publishable_|eyJ)", cfg) is not None)
        check("SIN clave secreta",
              re.search(r"sb_secret_[A-Za-z0-9_\-]{12,}", cfg) is None)

        check("config.js se carga antes que cloud.js y app.js",
              html.index("config.js") < html.index("cloud.js") < html.index("app.js"))

        print("\n[3] Nada que dependa de la raíz del dominio")
        malas = []
        for raiz_d, _, files in os.walk(dest):
            for f in files:
                if not f.endswith((".js", ".html", ".css")):
                    continue
                txt = open(os.path.join(raiz_d, f), encoding="utf-8", errors="ignore").read()
                for pat in (r'src="/', r"src='/", r'href="/', r"href='/",
                            r"fetch\('/", r'fetch\("/'):
                    if re.search(pat, txt):
                        malas.append(f"{f}: {pat}")
        check("ninguna ruta absoluta", not malas, "; ".join(malas))
        # /api/ solo puede aparecer construido sobre la base relativa.
        st = open(os.path.join(dest, "js", "store.js"), encoding="utf-8").read()
        check("el puente local usa ruta relativa",
              "url('api/state')" in st or "base + p" in st)

        srv.shutdown()
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    print()
    if FALLOS:
        print(f"FALLAN {len(FALLOS)}: " + ", ".join(FALLOS))
        sys.exit(1)
    print("El artefacto que recibe GitHub Pages está completo y se sirve entero.")


if __name__ == "__main__":
    main()
