# -*- coding: utf-8 -*-
"""Pruebas de la interfaz web de ASORC.

1. questions.json no se modifica nunca (md5 antes y después).
2. La respuesta correcta NUNCA cambia al barajar, en ningún idioma
   (se ejecuta la lógica real de web/app.js con node).
3. La API guarda en progress.json el mismo esquema que la app de terminal,
   y la app de terminal sigue leyéndolo sin perder datos.
4. Las métricas web van a web_stats.json y no contaminan progress.json.
"""
import os
import re
import sys
import json
import time
import shutil
import hashlib
import tempfile
import subprocess
import urllib.error
import urllib.request

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QJSON = os.path.join(PROJ, "questions.json")
APP = os.path.join(PROJ, "asorc")
SERVER = os.path.join(PROJ, "web", "server.py")

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'OK  ' if cond else 'FALLO'}  {name}" + (f"  — {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ------------------------------------------------------------ 2. barajado
NODE_TEST = r"""
const app = require(process.argv[2]);
const bank = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const ROUNDS = Number(process.argv[4] || 40);

let checked = 0;
const errs = [];
const push = (m) => { if (errs.length < 60) errs.push(m); };

for (const q of bank.questions) {
  if (!q.original_options || !q.original_options.length) continue;
  for (const asorc of [false, true]) {
    if (asorc && !(q.asorc && q.asorc.eligible)) continue;
    const expectOrig = (asorc ? [q.asorc.correct_label]
                              : (q.correct_answer || [])).slice().sort();

    for (let r = 0; r < ROUNDS; r++) {
      const v = app.buildView(q, asorc);
      checked++;

      // (a) las etiquetas ORIGINALES marcadas como correctas no cambian nunca
      const gotOrig = v.shown.filter(o => v.correctL.includes(o.L))
                             .map(o => o.label).sort();
      if (JSON.stringify(gotOrig) !== JSON.stringify(expectOrig)) {
        push(`${q.id} asorc=${asorc}: correctas ${gotOrig} != ${expectOrig}`); break;
      }
      // correctL y correctN apuntan a las mismas opciones
      const byN = v.shown.filter(o => v.correctN.includes(o.n)).map(o => o.label).sort();
      if (JSON.stringify(byN) !== JSON.stringify(expectOrig)) {
        push(`${q.id}: correctN y correctL no coinciden`); break;
      }

      // (b) el TEXTO de la correcta es el del banco, en ambos idiomas
      const esByLabel = {};
      (q.original_options_es || []).forEach(o => { esByLabel[o.label] = o.text; });
      for (const o of v.shown.filter(o => v.correctL.includes(o.L))) {
        const src = q.original_options.find(x => x.label === o.label);
        if (!src || src.text !== o.en) { push(`${q.id}: texto EN de la correcta no coincide`); break; }
        if (o.es !== (esByLabel[o.label] || src.text)) {
          push(`${q.id}: texto ES de la correcta no coincide`); break;
        }
      }

      // (c) las opciones mostradas son exactamente las esperadas
      const shownLabels = v.shown.map(o => o.label).sort();
      const wantLabels = (asorc ? q.asorc.kept_option_labels
                                : q.original_options.map(o => o.label)).slice().sort();
      if (JSON.stringify(shownLabels) !== JSON.stringify(wantLabels)) {
        push(`${q.id} asorc=${asorc}: mostradas ${shownLabels} != ${wantLabels}`); break;
      }

      // (d) letras A.. y números 1.. correlativos y sin repetir
      const Ls = v.shown.map(o => o.L).join('');
      if (Ls !== 'ABCDEFGH'.slice(0, v.shown.length)) {
        push(`${q.id}: letras en pantalla mal asignadas (${Ls})`); break;
      }
      if (v.shown.some((o, i) => o.n !== i + 1)) { push(`${q.id}: numeración rota`); break; }

      // (e) remapeo: con un mapeo CENTINELA (A->#1, B->#2...) no puede quedar
      //     ninguna referencia a una letra original sin convertir. Se usa un
      //     centinela porque las letras de pantalla ya son A/B/C y una
      //     comprobación directa sería ambigua.
      const sentinel = {}, sIdx = {};
      v.shown.forEach((o, i) => { sentinel[o.label] = `#${i + 1}`; sIdx[o.label] = i + 1; });
      for (const lang of ['es', 'en']) {
        const raw = lang === 'en' ? q.explanation : (q.explanation_es || q.explanation);
        if (!raw) continue;
        const mapped = app.remapExplanation(raw, sentinel, v.droppedText);
        for (const lbl of Object.keys(sentinel)) {
          const re = new RegExp(
            `(?:[Oo]pci[oó]n(?:es)?|[Oo]ption|[Aa]nswer|[Rr]espuesta)s?\\s+${lbl}(?![A-Za-z0-9])`);
          if (re.test(mapped)) {
            const at = mapped.search(re);
            push(`${q.id}/${lang}: sin remapear "${lbl}" -> …${mapped.slice(Math.max(0, at - 20), at + 40)}…`);
            break;
          }
        }
        // (f) con el mapeo REAL, si el libro razona sobre la opción correcta,
        //     esa referencia debe apuntar a la letra que se ve en pantalla.
        const real = app.remapExplanation(raw, v.origToShown, v.droppedText);
        for (const o of v.shown.filter(x => v.correctL.includes(x.L))) {
          const reSrc = new RegExp(
            `(?:[Oo]pci[oó]n(?:es)?|[Oo]ption|[Aa]nswer|[Rr]espuesta)s?\\s+${o.label}(?![A-Za-z0-9])`);
          if (!reSrc.test(raw)) continue;
          const reDst = new RegExp(
            `(?:[Oo]pci[oó]n(?:es)?|[Oo]ption|[Aa]nswer|[Rr]espuesta)s?\\s+${o.L}(?![A-Za-z0-9])`);
          if (!reDst.test(real)) {
            push(`${q.id}/${lang}: la correcta ${o.label} no aparece como ${o.L}`); break;
          }
        }
      }
      if (errs.length) break;
    }
    if (errs.length) break;
  }
  if (errs.length) break;
}
console.log(JSON.stringify({ checked, errs: errs.slice(0, 8), n: errs.length }));
"""


def test_shuffle_integrity():
    print("\n[2] La respuesta correcta no cambia al barajar (lógica real de app.js)")
    if not shutil.which("node"):
        check("node disponible", False, "instala node para ejecutar esta prueba")
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(NODE_TEST)
        script = f.name
    try:
        out = subprocess.run(
            ["node", script, os.path.join(PROJ, "web", "js", "logic.js"), QJSON, "40"],
            capture_output=True, text=True, timeout=600)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:300])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check(f"{res['checked']} barajados verificados sin discrepancias", res["n"] == 0,
              "; ".join(res["errs"]))
    finally:
        os.unlink(script)


GAME_TEST = r"""
const G = require(process.argv[2]);
const errs = [];
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

// XP: acierto 10 tarde lo que tarde, fallo y blanco 0
let r = G.newRun({ total: 10 });
eq(G.score(r, 'correct', 3000, 'T', 'q1').xp, 10, 'acierto rápido');
eq(G.score(r, 'correct', 180000, 'T', 'q2').xp, 10, 'acierto lento vale igual');
eq(G.score(r, 'wrong', 4000, 'T', 'q3').xp, 0, 'fallo');
eq(G.score(r, 'blank', 20000, 'T', 'q4').xp, 0, 'blanco');
eq(r.xp, 20, 'XP acumulado');
eq(r.ok, 2, 'aciertos'); eq(r.bad, 1, 'fallos'); eq(r.blank, 1, 'blancos');
eq(r.answered, 4, 'respondidas');
eq(r.failed, ['q3', 'q4'], 'ids fallados');
eq(r.answerMs, 3000 + 180000 + 4000 + 20000, 'el tiempo se sigue acumulando');

// El XP no puede depender del reloj de ninguna manera.
{
  const a = G.newRun({ total: 1 }), b = G.newRun({ total: 1 });
  eq(G.score(a, 'correct', 1200, 'T', 'f').xp,
     G.score(b, 'correct', 600000, 'T', 'l').xp, 'mismo XP en 1 s que en 10 min');
  eq(G.XP_SLOW, undefined, 'ya no existe el XP de acierto lento');
  eq(G.SLOW_RATIO, undefined, 'ya no existe el umbral de lentitud');
}

// El combo sube con aciertos seguidos y se rompe con cualquier no-acierto
r = G.newRun({ total: 30 });
for (let i = 0; i < 4; i++) G.score(r, 'correct', 2000, 'T', 'a' + i);
eq(r.combo, 4, 'combo tras 4');
let ms = G.score(r, 'correct', 2000, 'T', 'a4').milestones;
eq(r.combo, 5, 'combo 5');
eq(ms.length, 1, 'hito de combo 5');
eq(ms[0].kind, 'combo', 'tipo de hito');
G.score(r, 'wrong', 2000, 'T', 'x');
eq(r.combo, 0, 'el fallo rompe el combo');
eq(r.bestCombo, 5, 'mejor combo guardado');
G.score(r, 'partial', 2000, 'T', 'y');
eq(r.combo, 0, 'parcial también rompe');

// Un blanco es una decisión, no un fallo: puntúa 0, no suma a 'bad' y la racha
// se queda como estaba.
{
  const b = G.newRun({ total: 10 });
  for (let i = 0; i < 3; i++) G.score(b, 'correct', 1000, 'T', 'c' + i);
  const s = G.score(b, 'blank', 1000, 'T', 'bl');
  eq(s.xp, 0, 'el blanco no da XP');
  eq(b.combo, 3, 'el blanco no rompe la racha');
  eq(b.blank, 1, 'contabilizado como blanco');
  eq(b.bad, 0, 'no cuenta como fallo');
  eq(b.failed.includes('bl'), true, 'entra en repasar fallos');
  const m = G.score(b, 'correct', 1000, 'T', 'c4');
  eq(b.combo, 4, 'la racha sigue donde estaba');
  eq(m.milestones.length, 0, 'sin hito todavía');
  eq(G.score(b, 'correct', 1000, 'T', 'c5').milestones[0].value, 5, 'hito de 5 tras el blanco');
}

// Hito por número de preguntas terminadas
r = G.newRun({ total: 60 });
let hit25 = null;
for (let i = 1; i <= 25; i++) {
  const s = G.score(r, i % 3 === 0 ? 'wrong' : 'correct', 2000, 'T', 'q' + i);
  if (s.milestones.some(m => m.kind === 'count')) hit25 = i;
}
eq(hit25, 25, 'hito a las 25');

// Récords sobre el histórico de sesiones
const ses = [
  { respondidas: 10, correctas: 7, ms_respuesta: 100000, musica: 'sin' },
  { respondidas: 10, correctas: 9, ms_respuesta: 80000, musica: 'sin' },
];
const rec = G.records(ses);
eq(Math.round(rec.bestPct), 90, 'mejor precisión');
eq(Number(rec.bestSec.toFixed(1)), 8.0, 'mejor velocidad');

r = G.newRun({ total: 10 });
for (let i = 0; i < 10; i++) G.score(r, 'correct', 5000, 'T', 'z' + i);   // 100%, 5 s
const fm = G.finalMilestones(r, ses).map(m => m.kind).sort();
eq(fm, ['record-pct', 'record-speed'], 'récords detectados');

// Con muy pocas respuestas no se conceden récords
const tiny = G.newRun({ total: 2 });
G.score(tiny, 'correct', 1000, 'T', 'w1');
eq(G.finalMilestones(tiny, ses).length, 0, 'sin récord con 1 respuesta');

// La sesión que se guarda usa el esquema esperado
const rec2 = G.sessionRecord(r);
eq(Object.keys(rec2).sort(),
   ['blancos','correctas','falladas','marcadas','modo','ms_explicacion','ms_respuesta','musica','respondidas','ts'],
   'campos de la sesión');

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 8) }));
"""


def test_game():
    print("\n[5] Capa de juego: XP, combo, hitos y récords")
    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(GAME_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, os.path.join(PROJ, "web", "js", "game.js")],
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:300])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("reglas de XP, combo, hitos y récords", res["n"] == 0, "; ".join(res["errs"]))
    finally:
        os.unlink(script)


LOGIC_TEST = r"""
const L = require(process.argv[2]);
const errs = [];
const eq = (a, b, m) => { if (a !== b) errs.push(`${m}:\n   got  ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`); };

// Un punto dentro de una ruta o versión NO parte la frase.
{
  const t = 'Los servidores DNS se listan en /etc/resolv.conf mediante el ajuste nameserver, así que la opción C es correcta. Las opciones A y D son de tcp_wrappers.';
  const r = L.splitExplanation(t, ['C']);
  eq(r.key, 'Los servidores DNS se listan en /etc/resolv.conf mediante el ajuste nameserver, así que la opción C es correcta.', 'ruta con punto');
  eq(r.rest, 'Las opciones A y D son de tcp_wrappers.', 'cuerpo tras ruta con punto');
}
{
  const t = 'La opción B es correcta porque usa version 4.5 del protocolo. El archivo /etc/modules.conf es otra cosa.';
  const r = L.splitExplanation(t, ['B']);
  eq(r.key.startsWith('La opción B es correcta porque usa version 4.5'), true, 'versión con punto');
}

// La frase clave nunca se repite en el cuerpo.
{
  const t = 'El comando lsmod lista los módulos cargados, así que la opción A es correcta. La opción B es incorrecta.';
  const r = L.splitExplanation(t, ['A']);
  eq(r.rest.includes(r.key), false, 'sin duplicar la frase clave');
}

// Un veredicto pelado arrastra la frase siguiente, que es la que enseña algo.
{
  const t = 'Por tanto, la opción C es la respuesta correcta, porque no es cierta. El tamaño del PE se fija al añadir un PV a un VG. Las opciones A y B son ciertas.';
  const r = L.splitExplanation(t, ['C']);
  eq(r.key.includes('El tamaño del PE se fija'), true, 'veredicto + hecho');
  eq(r.rest, 'Las opciones A y B son ciertas.', 'cuerpo tras veredicto');
}

// El remapeo mantiene intactas las letras que no son referencias de opción.
{
  const t = "Option B's A record type is a host address record.";
  const out = L.remapExplanation(t, {A: 'C', B: 'A'}, {});
  eq(out, "Option A's A record type is a host address record.", 'registro A de DNS intacto');
}
// "la opción c" en minúscula es el flag -c, no la opción C.
{
  const t = 'La receta :0 c usa la opción c para copiar, así que la opción C es correcta.';
  const out = L.remapExplanation(t, {C: 'B'}, {});
  eq(out, 'La receta :0 c usa la opción c para copiar, así que la opción B es correcta.', 'flag en minúscula intacto');
}

// grade() aplica la misma regla que la app de terminal.
eq(L.grade(new Set(['A']), ['A']), 'correct', 'acierto simple');
eq(L.grade(new Set([]), ['A']), 'blank', 'en blanco');
eq(L.grade(new Set(['A']), ['A', 'B']), 'wrong', 'respuesta parcial cuenta como fallo');
eq(L.grade(new Set(['A', 'B']), ['B', 'A']), 'correct', 'orden indiferente');

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 6) }));
"""


def test_logic():
    print("\n[6] Lógica de texto: frases, remapeo y corrección")
    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(LOGIC_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, os.path.join(PROJ, "web", "js", "logic.js")],
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:300])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("cortes de frase, remapeo y corrección", res["n"] == 0, " | ".join(res["errs"]))
    finally:
        os.unlink(script)


# ------------------------------------------------------------ servidor
class Server:
    def __init__(self, tmp):
        self.tmp = tmp
        self.prog = os.path.join(tmp, "progress.json")
        self.stats = os.path.join(tmp, "web_stats.json")
        env = dict(os.environ, ASORC_PROGRESS=self.prog, ASORC_STATS=self.stats)
        self.log = open(os.path.join(tmp, "srv.log"), "w+")
        self.p = subprocess.Popen([sys.executable, SERVER, "--no-browser"],
                                  stdout=self.log, stderr=subprocess.STDOUT, env=env)
        self.base = None
        for _ in range(80):
            time.sleep(0.05)
            self.log.flush()
            with open(os.path.join(tmp, "srv.log")) as f:
                t = f.read()
            if "127.0.0.1:" in t:
                port = t.split("127.0.0.1:")[1].split("/")[0].strip()
                self.base = f"http://127.0.0.1:{port}"
                break
        if not self.base:
            raise RuntimeError("el servidor no arrancó")

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=10) as r:
            return r.status, json.loads(r.read().decode())

    def post(self, path, obj):
        req = urllib.request.Request(
            self.base + path, data=json.dumps(obj).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, None

    def close(self):
        self.p.terminate()
        try:
            self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.p.kill()
        self.log.close()


TERMINAL_KEYS = {"veces_vista", "aciertos", "fallos", "blancos", "parciales",
                 "ultima_respuesta", "ultimo_resultado"}


def test_api(srv):
    print("\n[3] API y esquema compartido con la app de terminal")
    st, body = srv.get("/api/state")
    check("GET /api/state responde", st == 200 and "progress" in body and "stats" in body)

    st, _ = srv.get("/api/questions")
    check("GET /api/questions responde", st == 200)

    upd = [
        {"id": "SYBEX-CH06-RQ05", "result": "correct", "answer": "C",
         "answerMs": 4200, "reviewMs": 9100, "marked": False},
        {"id": "SYBEX-CH01-RQ01", "result": "wrong", "answer": "B",
         "answerMs": 15000, "reviewMs": 30000, "marked": True},
        {"id": "ENI-CH01-Q01", "result": "blank", "answer": "",
         "answerMs": 20000, "reviewMs": 5000, "marked": False},
    ]
    session = {"ts": int(time.time()), "modo": "Sprint de 20", "musica": "sin",
               "respondidas": 3, "correctas": 1, "falladas": 1, "blancos": 1,
               "ms_respuesta": 39200, "ms_explicacion": 44100, "marcadas": 1}
    st, body = srv.post("/api/state", {"updates": upd, "marks": {}, "session": session})
    check("POST /api/state guarda", st == 200 and body and body.get("ok"))

    prog = json.load(open(srv.prog, encoding="utf-8"))
    e = prog["preguntas"]["SYBEX-CH06-RQ05"]
    check("progress.json usa el esquema de la terminal",
          set(e.keys()) == TERMINAL_KEYS, str(sorted(e.keys())))
    check("acierto contabilizado", e["aciertos"] == 1 and e["veces_vista"] == 1)
    check("fallo contabilizado",
          prog["preguntas"]["SYBEX-CH01-RQ01"]["fallos"] == 1)
    check("blanco contabilizado",
          prog["preguntas"]["ENI-CH01-Q01"]["blancos"] == 1)
    check("progress.json sin campos web",
          all(set(v.keys()) == TERMINAL_KEYS for v in prog["preguntas"].values()))

    stats = json.load(open(srv.stats, encoding="utf-8"))
    w = stats["preguntas"]["SYBEX-CH06-RQ05"]
    check("web_stats.json guarda los tiempos",
          w["ms_respuesta_total"] == 4200 and w["ms_explicacion_total"] == 9100)
    check("marcada registrada", stats["preguntas"]["SYBEX-CH01-RQ01"]["marcada"] is True)
    check("sesión registrada", len(stats["sesiones"]) == 1
          and stats["sesiones"][0]["musica"] == "sin")

    # acumulación en una segunda pasada
    srv.post("/api/state", {"updates": [dict(upd[0])], "marks": {}, "session": None})
    prog2 = json.load(open(srv.prog, encoding="utf-8"))
    check("los contadores acumulan",
          prog2["preguntas"]["SYBEX-CH06-RQ05"]["veces_vista"] == 2)

    # marcas independientes
    srv.post("/api/state", {"updates": [], "marks": {"SYBEX-CH01-RQ01": False}})
    stats2 = json.load(open(srv.stats, encoding="utf-8"))
    check("desmarcar funciona",
          stats2["preguntas"]["SYBEX-CH01-RQ01"]["marcada"] is False)

    # entradas basura no rompen el archivo
    srv.post("/api/state", {"updates": [{"id": 5, "result": "nope"},
                                        {"result": "correct"}], "marks": {}})
    prog3 = json.load(open(srv.prog, encoding="utf-8"))
    check("las entradas inválidas se ignoran",
          len(prog3["preguntas"]) == len(prog2["preguntas"]))


def test_terminal_reads(srv):
    print("\n[4] La app de terminal sigue leyendo ese progress.json")
    if not os.path.exists(APP):
        check("binario ./asorc presente", False, "compila con g++ -std=c++17 -O2 -o asorc main.cc")
        return
    before = json.load(open(srv.prog, encoding="utf-8"))
    out = subprocess.run([APP, "--no-color", "--progress", srv.prog,
                          "--questions", QJSON],
                         input="9\n\n0\n", capture_output=True, text=True, timeout=60)
    check("arranca sin error", out.returncode == 0, out.stderr[:200])
    check("no avisa de progreso ilegible", "ilegible" not in out.stdout)
    seen = sum(1 for v in before["preguntas"].values() if v["veces_vista"] > 0)
    check(f"muestra las {seen} vistas de la web",
          f"Vistas al menos una vez    : {seen}" in out.stdout,
          [l for l in out.stdout.splitlines() if "Vistas" in l])

    # y al guardar no rompe nada de lo que escribió la web
    subprocess.run([APP, "--no-color", "--progress", srv.prog, "--questions", QJSON],
                   input="2\nA\n\nq\n\n0\n", capture_output=True, text=True, timeout=60)
    after = json.load(open(srv.prog, encoding="utf-8"))
    kept = all(k in after["preguntas"] for k in before["preguntas"])
    check("conserva las preguntas que registró la web", kept)


HIGHLIGHT_TEST = r"""
const L = require(process.argv[2]);
const fs = require('fs');
const bank = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).questions;
const errs = [];
const eq = (a, b, m) => { if (a !== b) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

const vocab = L.buildVocab(bank);
const strip = (h) => h.replace(/<[^>]*>/g, '');
const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const marcas = (h) => (h.match(/<(?:code|span)\b/g) || []).length;

// 1 · El texto NUNCA cambia: ni una palabra de más ni de menos.
let rotos = 0, exceso = 0;
const textos = [];
for (const q of bank) {
  textos.push(q.question_es || q.question || '');
  for (const g of [q.original_options, q.original_options_es]) {
    for (const o of (g || [])) textos.push(o.text || '');
  }
}
for (const t of textos) {
  const h = L.highlightTechnicalText(t, { vocab });
  if (unesc(strip(h)) !== t) rotos++;
  if (marcas(h) > 4) exceso++;
}
eq(rotos, 0, 'el resaltado no altera el texto');
eq(exceso, 0, 'nunca más de 4 elementos marcados');

// 2 · Nada de HTML inyectado ni etiquetas rotas.
{
  const h = L.highlightTechnicalText('El elemento <VirtualHost> y <script>alert(1)</script>', { vocab });
  eq(/&lt;VirtualHost&gt;/.test(h), true, '<VirtualHost> escapado');
  eq(/<script/.test(h), false, 'no se cuela un <script>');
  eq(unesc(strip(h)), 'El elemento <VirtualHost> y <script>alert(1)</script>', 'texto intacto con HTML dentro');
}

// 3 · El resaltado NO puede delatar cuál es la correcta.
{
  let ok = [], mal = [];
  for (const q of bank) {
    if (q.type === 'open') continue;
    for (const o of (q.original_options_es || q.original_options || [])) {
      const t = o.text || '';
      const n = L.isTechnical(t) ? 1 : marcas(L.highlightTechnicalText(t, { vocab, max: 2 }));
      (q.correct_answer.includes(o.label) ? ok : mal).push(n);
    }
  }
  const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const dif = Math.abs(media(ok) - media(mal));
  eq(dif < 0.08, true, `las marcas delatan la correcta (diferencia ${dif.toFixed(3)})`);
}

// 4 · Los dos significados visuales, cada uno en lo suyo.
{
  const h = L.highlightTechnicalText('¿Cuáles de los siguientes comandos permiten crear un sistema de archivos ext2 en la partición /dev/sdd2? (Elija todas las que correspondan.)', { vocab });
  eq(/class="hl-warn">Elija todas</.test(h), true, 'la instrucción va subrayada');
  eq(/<code class="hl-code">\/dev\/sdd2<\/code>/.test(h), true, 'la ruta va en monoespaciada');
  eq(/class="hl-term">comandos</.test(h), true, 'el sustantivo por el que se pregunta va en negrita');
}

// 5 · Sin vocabulario sigue funcionando (por si el banco no cargó).
eq(typeof L.highlightTechnicalText('mount /dev/sda1', {}), 'string', 'funciona sin vocabulario');
eq(L.highlightTechnicalText('', { vocab }), '', 'cadena vacía');
eq(L.highlightTechnicalText(null, { vocab }), '', 'valor nulo');

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 6) }));
"""


def test_highlight():
    print("\n[8] Resaltado: fidelidad del texto, tope y neutralidad")
    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(HIGHLIGHT_TEST)
        script = f.name
    try:
        out = subprocess.run(
            ["node", script, os.path.join(PROJ, "web", "js", "logic.js"), QJSON],
            capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:300])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("el texto no se toca y el resaltado no da pistas",
              res["n"] == 0, "; ".join(res["errs"]))
    finally:
        os.unlink(script)


PANEL_TEST = r"""
const fs = require('fs');
const path = require('path');
const errs = [];
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

const web = process.argv[2];
const bank = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).questions;
global.window = global;
const S = require(path.join(web, 'store.js'));
const Dash = require(path.join(web, 'dash.js'));

// --- 1 · fusión: nunca se pierde lo más completo -------------------------
{
  const rico = { preguntas: { q1: { veces_vista: 5, aciertos: 4, fallos: 1, blancos: 0,
    parciales: 0, ultima_respuesta: 'C', ultimo_resultado: 'correct' } }, configuracion: {} };
  const pobre = { preguntas: { q1: { veces_vista: 0, aciertos: 0, fallos: 0, blancos: 0,
    parciales: 0, ultima_respuesta: '', ultimo_resultado: '' } }, configuracion: {} };
  eq(S.fusionaProgreso(rico, pobre).preguntas.q1.veces_vista, 5, 'lo vacío no pisa lo lleno');
  eq(S.fusionaProgreso(pobre, rico).preguntas.q1.veces_vista, 5, 'da igual el orden');
  eq(S.fusionaProgreso(pobre, rico).preguntas.q1.ultima_respuesta, 'C', 'la respuesta se conserva');
}
// --- 2 · sesiones: sincronizar dos veces no duplica ----------------------
{
  const a = { preguntas: {}, sesiones: [{ uid: 'x1', ts: 1, respondidas: 5 }] };
  const b = { preguntas: {}, sesiones: [{ uid: 'x1', ts: 1, respondidas: 5 },
                                        { uid: 'x2', ts: 2, respondidas: 3 }] };
  eq(S.fusionaStats(a, b).sesiones.length, 2, 'sesión repetida no se duplica');
  eq(S.fusionaStats(b, b).sesiones.length, 2, 'fusionar consigo mismo es idempotente');
}
// --- 3 · identificadores irrepetibles ------------------------------------
{
  const v = new Set();
  for (let i = 0; i < 5000; i++) v.add(S.uid());
  eq(v.size, 5000, 'los uid no chocan');
}

// --- 4 · temas: la suma tiene que ser el banco entero --------------------
const store = {
  _p: {}, _s: {},
  prog(id) { return this._p[id] || null; },
  stat(id) { return this._s[id] || null; },
  vista(id) { return !!this._p[id] && this._p[id].veces_vista > 0; },
  marcada(id) { return !!(this._s[id] && this._s[id].marcada); },
  ver(id, res) {
    const p = this._p[id] || (this._p[id] = { veces_vista: 0, aciertos: 0, fallos: 0, blancos: 0, parciales: 0 });
    p.veces_vista++;
    if (res === 'correct') p.aciertos++; else if (res === 'wrong') p.fallos++;
    else if (res === 'blank') p.blancos++; else p.parciales++;
  },
};
Dash.configurar({ bank, store });
{
  const t = Dash.temas();
  eq(t.length, 16, 'número de temas');
  eq(t.reduce((a, x) => a + x.qs.length, 0), bank.length, 'la suma por temas es el banco');
  const nombres = new Set(bank.map((q) => q.topic));
  eq(t.every((x) => nombres.has(x.nombre)), true, 'los temas salen del banco, no inventados');
}

// --- 5 · completado cuenta preguntas ÚNICAS ------------------------------
{
  const id = bank[0].id;
  for (let i = 0; i < 15; i++) store.ver(id, 'correct');      // la misma 15 veces
  const r = Dash.resumen(bank);
  eq(r.vistas, 1, 'repetir una pregunta no sube el completado');
  eq(r.completado, 1 / bank.length, 'completado = únicas / total');
  eq(r.aciertos, 15, 'los aciertos sí cuentan cada intento');
  eq(r.acierto, 1, 'acierto = aciertos / intentos con respuesta');
}
// --- 6 · el blanco no cuenta como intento de responder -------------------
{
  const id2 = bank[1].id;
  store.ver(id2, 'blank');
  const r = Dash.resumen(bank);
  eq(r.vistas, 2, 'el blanco sí cuenta como vista');
  eq(r.intentos, 15, 'pero no como intento');
  eq(r.blancos, 1, 'y se contabiliza aparte');
}

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 8) }));
"""


def test_panel():
    print("\n[9] Panel, métricas de progreso y fusión de datos")
    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(PANEL_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, os.path.join(PROJ, "web", "js"), QJSON],
                             capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:400])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("fusión sin pérdidas, sync idempotente y completado por únicas",
              res["n"] == 0, "; ".join(res["errs"]))
    finally:
        os.unlink(script)


def test_publicacion():
    print("\n[10] Publicación estática: rutas relativas y datos privados fuera")
    d = tempfile.mkdtemp(prefix="asorc-site-")
    try:
        out = subprocess.run([sys.executable, os.path.join(PROJ, "tools", "build_site.py"), d],
                             capture_output=True, text=True, timeout=120)
        check("el sitio se arma sin rutas absolutas", out.returncode == 0,
              (out.stdout + out.stderr).strip()[:300])
        for f in ("index.html", "questions.json", "explanations_simple.json", ".nojekyll"):
            check(f"el sitio incluye {f}", os.path.exists(os.path.join(d, f)))
        check("config.js NO se publica", not os.path.exists(os.path.join(d, "config.js")))
        check("server.py NO se publica", not os.path.exists(os.path.join(d, "server.py")))

        gi = os.path.join(PROJ, ".gitignore")
        txt = open(gi, encoding="utf-8").read() if os.path.exists(gi) else ""
        for pat in ("progress.json", "web_stats.json", "web/config.js", ".env"):
            check(f".gitignore excluye {pat}", pat in txt)

        cfg = os.path.join(PROJ, "web", "config.js")
        check("no hay un config.js con credenciales en el repositorio", not os.path.exists(cfg))
        ej = open(os.path.join(PROJ, "web", "config.example.js"), encoding="utf-8").read()
        check("el ejemplo no trae una clave real",
              "TU-CLAVE" in ej and "service_role" not in ej.split("NUNCA")[0])
    finally:
        shutil.rmtree(d, ignore_errors=True)


def test_feed():
    """El feed reutiliza la lógica de siempre, pero los elementos de una
    pregunta ya no llevan id: hay muchas tarjetas vivas a la vez. Aquí se
    comprueba que ese cambio de presentación está bien cosido."""
    print("\n[7] Feed continuo: plantilla, alcance de elementos y scroll")
    html = open(os.path.join(PROJ, "web", "index.html"), encoding="utf-8").read()
    app = open(os.path.join(PROJ, "web", "js", "app.js"), encoding="utf-8").read()
    css = open(os.path.join(PROJ, "web", "styles.css"), encoding="utf-8").read()

    m = re.search(r'<template id="card-tpl">(.*?)</template>', html, re.S)
    check("existe la plantilla de tarjeta", bool(m))
    if not m:
        return
    tpl = m.group(1)
    fuera = html[:m.start(1)] + html[m.end(1):]   # el id del propio <template> cuenta

    # Dentro de la plantilla no puede haber id: se duplicarían en cada pregunta.
    check("la plantilla no usa id", not re.search(r'\sid="', tpl),
          str(re.findall(r'\sid="([^"]+)"', tpl)))

    tpl_els = set(re.findall(r'data-el="([^"]+)"', tpl))
    ids = set(re.findall(r'\sid="([^"]+)"', fuera))

    mc = re.search(r'const CARD_EL = new Set\(\[(.*?)\]\);', app, re.S)
    check("app.js declara CARD_EL", bool(mc))
    if not mc:
        return
    card_el = set(re.findall(r"'([^']+)'", mc.group(1)))

    check("cada nombre de CARD_EL está en la plantilla", card_el <= tpl_els,
          "faltan: " + ", ".join(sorted(card_el - tpl_els)))

    # Cada $('x') de app.js tiene que resolver: o es de tarjeta, o es un id real.
    usados = set(re.findall(r"\$\('([^']+)'\)", app))
    huerfanos = sorted(u for u in usados if u not in card_el and u not in ids)
    check("todo $('...') de app.js resuelve", not huerfanos,
          "sin destino: " + ", ".join(huerfanos))

    # Y al revés: un data-el de la plantilla que app.js busque con $ pero no
    # esté en CARD_EL acabaría mirando en document y devolviendo null.
    mal = sorted(u for u in usados if u in tpl_els and u not in card_el)
    check("ningún elemento de tarjeta se busca como global", not mal,
          ", ".join(mal))

    for ident in ("feed", "card-tpl", "to-active"):
        check(f"index.html tiene #{ident}", ident in ids)

    check("la barra superior sigue anclada", "position: sticky" in
          css.split(".hud {")[1].split("}")[0])
    # El scroll lo calcula la aplicación: el anclaje del navegador lo desbarata
    # cuando una tarjeta de arriba se pliega.
    check("el feed desactiva el anclaje automático",
          "overflow-anchor: none" in css.split(".feed {")[1].split("}")[0])
    # Una tarjeta cerrada debe quedarse quieta o el cálculo del scroll se hace
    # sobre una altura que todavía está cambiando.
    check("las tarjetas completadas no animan su tamaño",
          re.search(r'\.card\.is-done,[^{]*\{[^}]*transition:\s*none', css, re.S) is not None)
    check("ya no queda nada de la pantalla única", ".arena" not in css and "arena" not in app)

    # Nunca se borra una pregunta del feed.
    check("el feed solo se vacía al empezar una ronda",
          app.count("$('feed').innerHTML = ''") == 1 and "removeChild" not in app)



def main():
    print("[1] questions.json intacto")
    before = md5(QJSON)

    test_shuffle_integrity()
    test_game()
    test_logic()
    test_feed()
    test_highlight()
    test_panel()
    test_publicacion()

    tmp = tempfile.mkdtemp(prefix="asorc-web-test-")
    srv = None
    try:
        srv = Server(tmp)
        test_api(srv)
        test_terminal_reads(srv)
    finally:
        if srv:
            srv.close()
        shutil.rmtree(tmp, ignore_errors=True)

    after = md5(QJSON)
    check("questions.json no se ha modificado", before == after,
          f"{before} -> {after}")

    print()
    if FAILS:
        print(f"FALLAN {len(FAILS)} comprobaciones: " + ", ".join(FAILS))
        sys.exit(1)
    print("Todas las comprobaciones pasan.")


if __name__ == "__main__":
    main()
