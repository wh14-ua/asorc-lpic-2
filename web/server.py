#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Servidor local de ASORC Web.

Sirve la interfaz y hace de puente con los archivos del proyecto:

  questions.json   solo lectura, nunca se escribe
  progress.json    compartido con la app de terminal (mismo esquema)
  web_stats.json   métricas propias de la web (tiempos, marcadas, sesiones)

Las métricas web van aparte porque la app de terminal reescribe progress.json
desde su propio modelo y descartaría cualquier campo que no conozca.
"""
import os
import sys
import json
import time
import errno
import socket
import threading
import webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
# Rutas sobreescribibles por entorno (las usan las pruebas para no tocar
# los archivos reales del usuario).
QUESTIONS = os.environ.get("ASORC_QUESTIONS") or os.path.join(PROJ, "questions.json")
PROGRESS = os.environ.get("ASORC_PROGRESS") or os.path.join(PROJ, "progress.json")
STATS = os.environ.get("ASORC_STATS") or os.path.join(PROJ, "web_stats.json")
# Explicaciones reescritas en lenguaje llano. Viven aparte: questions.json no
# se toca. Si el archivo no está, la web enseña el texto del libro y ya.
SIMPLE = os.environ.get("ASORC_SIMPLE") or os.path.join(PROJ, "explanations_simple.json")

_lock = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

RESULTS = ("correct", "wrong", "blank", "partial")


# --------------------------------------------------------------- persistencia
def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            txt = f.read().strip()
        return json.loads(txt) if txt else default
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, OSError) as e:
        print(f"  aviso: no se pudo leer {os.path.basename(path)} ({e})",
              file=sys.stderr)
        return default


def write_json_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def empty_progress():
    return {"schema_version": 1, "app": "test-ASORC",
            "preguntas": {}, "configuracion": {"idioma": "es"}}


def empty_stats():
    return {"schema_version": 1, "app": "asorc-web",
            "preguntas": {}, "sesiones": []}


# ------------------------------------------------------------------ mezclado
def merge_progress(prog, updates):
    """Aplica resultados usando EXACTAMENTE el esquema de la app de terminal."""
    qs = prog.setdefault("preguntas", {})
    for u in updates:
        qid = u.get("id")
        res = u.get("result")
        if not isinstance(qid, str) or res not in RESULTS:
            continue
        e = qs.setdefault(qid, {"veces_vista": 0, "aciertos": 0, "fallos": 0,
                                "blancos": 0, "parciales": 0,
                                "ultima_respuesta": "", "ultimo_resultado": ""})
        e["veces_vista"] = int(e.get("veces_vista", 0)) + 1
        key = {"correct": "aciertos", "wrong": "fallos",
               "blank": "blancos", "partial": "parciales"}[res]
        e[key] = int(e.get(key, 0)) + 1
        e["ultima_respuesta"] = str(u.get("answer", ""))[:200]
        e["ultimo_resultado"] = res
    return prog


def merge_stats(stats, updates, session):
    """Métricas propias de la web: tiempos, marcadas y registro de sesiones."""
    qs = stats.setdefault("preguntas", {})
    for u in updates:
        qid = u.get("id")
        if not isinstance(qid, str):
            continue
        e = qs.setdefault(qid, {"respuestas": 0, "ms_respuesta_total": 0,
                                "ms_explicacion_total": 0, "marcada": False})
        e["respuestas"] = int(e.get("respuestas", 0)) + 1
        e["ms_respuesta_total"] = int(e.get("ms_respuesta_total", 0)) + \
            max(0, int(u.get("answerMs", 0) or 0))
        e["ms_explicacion_total"] = int(e.get("ms_explicacion_total", 0)) + \
            max(0, int(u.get("reviewMs", 0) or 0))
        if "marked" in u:
            e["marcada"] = bool(u["marked"])
        e["ultimo_resultado"] = u.get("result", e.get("ultimo_resultado", ""))
        e["ultima_vez"] = int(time.time())
    if session:
        ses = stats.setdefault("sesiones", [])
        ses.append(session)
        del ses[:-200]           # conservar solo las 200 últimas
    return stats


def set_marks(stats, marks):
    qs = stats.setdefault("preguntas", {})
    for qid, val in marks.items():
        if not isinstance(qid, str):
            continue
        e = qs.setdefault(qid, {"respuestas": 0, "ms_respuesta_total": 0,
                                "ms_explicacion_total": 0, "marcada": False})
        e["marcada"] = bool(val)
    return stats


# ------------------------------------------------------------------- handler
class Handler(BaseHTTPRequestHandler):
    server_version = "asorc-web"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):       # silencio, salvo errores
        if not str(args[1] if len(args) > 1 else "").startswith(("2", "3")):
            sys.stderr.write("  %s\n" % (fmt % args))

    # -- utilidades de respuesta --
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _file(self, path):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            return self._send(404, b"No encontrado")
        ext = os.path.splitext(path)[1].lower()
        self._send(200, body, MIME.get(ext, "application/octet-stream"))

    # -- rutas --
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            return self._file(os.path.join(HERE, "index.html"))
        # Los mismos archivos que publica GitHub Pages, en la misma ruta
        # relativa, para que el frontend no tenga que saber dónde está.
        if path == "/questions.json":
            return self._file(QUESTIONS)
        if path == "/explanations_simple.json":
            if not os.path.exists(SIMPLE):
                return self._json(200, {"explicaciones": {}})
            return self._file(SIMPLE)
        if path == "/api/questions":
            return self._file(QUESTIONS)
        if path == "/api/simple":
            if not os.path.exists(SIMPLE):
                return self._json(200, {"explicaciones": {}})
            return self._file(SIMPLE)
        if path == "/api/state":
            with _lock:
                return self._json(200, {
                    "progress": read_json(PROGRESS, empty_progress()),
                    "stats": read_json(STATS, empty_stats()),
                })
        # estáticos: solo dentro de web/, sin salir por ../
        name = os.path.normpath(path.lstrip("/"))
        if name.startswith("..") or os.path.isabs(name):
            return self._send(403, b"Prohibido")
        full = os.path.join(HERE, name)
        if os.path.isfile(full):
            return self._file(full)
        return self._send(404, b"No encontrado")

    do_HEAD = do_GET

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/state":
            return self._send(404, b"No encontrado")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, b"Longitud invalida")
        if n <= 0 or n > 4 * 1024 * 1024:
            return self._send(400, b"Cuerpo invalido")
        try:
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._send(400, b"JSON invalido")

        updates = payload.get("updates") or []
        marks = payload.get("marks") or {}
        session = payload.get("session")
        if not isinstance(updates, list):
            return self._send(400, b"updates invalido")

        with _lock:
            prog = read_json(PROGRESS, empty_progress())
            stats = read_json(STATS, empty_stats())
            # progress.json solo recibe campos que la app de terminal entiende
            merge_progress(prog, updates)
            merge_stats(stats, updates, session if isinstance(session, dict) else None)
            if isinstance(marks, dict):
                set_marks(stats, marks)
            write_json_atomic(PROGRESS, prog)
            write_json_atomic(STATS, stats)
            return self._json(200, {"ok": True,
                                    "progress": prog, "stats": stats})


# ---------------------------------------------------------------------- main
def free_port(preferred=8731):
    for port in [preferred] + list(range(preferred + 1, preferred + 40)):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
            return port
        except OSError as e:
            if e.errno not in (errno.EADDRINUSE, errno.EACCES):
                raise
        finally:
            s.close()
    raise SystemExit("No hay puertos libres entre 8731 y 8770")


def main():
    if not os.path.exists(QUESTIONS):
        raise SystemExit(f"Falta {QUESTIONS}. Ejecuta tools/extract.sh primero.")
    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    n = len(read_json(QUESTIONS, {"questions": []}).get("questions", []))
    print(f"ASORC Web  ·  {n} preguntas  ·  {url}", flush=True)
    print("Ctrl+C para parar.", flush=True)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nHasta la próxima.", flush=True)
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
