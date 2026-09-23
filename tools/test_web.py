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
   ['blancos','correctas','falladas','marcadas','mejor_racha','modo','ms_explicacion','ms_respuesta',
    'musica','respondidas','ts','xp'],
   'campos de la sesión');
eq([rec2.xp, rec2.mejor_racha], [r.xp, r.bestCombo], 'con el XP y la mejor racha de la ronda');

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
        # config.js SÍ se publica: solo lleva la URL y la clave publishable,
        # que son públicas por diseño. Lo que no puede llevar es un secreto.
        cfg_site = os.path.join(d, "config.js")
        check("config.js SÍ se publica", os.path.exists(cfg_site))
        txt_cfg = open(cfg_site, encoding="utf-8").read() if os.path.exists(cfg_site) else ""
        check("y define ASORC_CONFIG", "ASORC_CONFIG" in txt_cfg)
        check("sin clave secreta dentro",
              re.search(r"sb_secret_[A-Za-z0-9_\-]{12,}", txt_cfg) is None)
        check("server.py NO se publica", not os.path.exists(os.path.join(d, "server.py")))

        gi = os.path.join(PROJ, ".gitignore")
        txt = open(gi, encoding="utf-8").read() if os.path.exists(gi) else ""
        for pat in ("progress.json", "web_stats.json", ".env", "*.pdf"):
            check(f".gitignore excluye {pat}", pat in txt)

        ej = open(os.path.join(PROJ, "web", "config.example.js"), encoding="utf-8").read()
        check("el ejemplo no trae una clave real", "TU-CLAVE" in ej)
    finally:
        shutil.rmtree(d, ignore_errors=True)


NUBE_TEST = r"""
const fs = require('fs');
const path = require('path');
const errs = [];
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) errs.push(m); };

const web = process.argv[2];

// Un navegador de mentira: localStorage y nada más.
const almacen = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k), _m: m }; };
let ACTIVO = { ls: almacen() };
Object.defineProperty(global, 'localStorage', { configurable: true, get() { return ACTIVO.ls; } });
global.window = global;

function carga() {
  for (const f of ['store.js', 'cloud.js']) delete require.cache[require.resolve(path.join(web, f))];
  const S = require(path.join(web, 'store.js'));
  const C = require(path.join(web, 'cloud.js'));
  return { S, store: S.Store, cloud: C };
}
function nuevo() { ACTIVO = { ls: almacen() }; return carga(); }
const resp = (st, id, res) => st.registrar({ id, result: res, answer: 'x', answerMs: 900, reviewMs: 100, marked: false });

// --- 1 · la cola: encolar, persistir, quitar -----------------------------
(async () => {
const a = nuevo();
await a.store.init({ base: './', ns: 'asorc.v2' });

eq(a.store.outbox.clave, 'asorc.v2.syncQueue', 'la cola vive donde dice la especificación');
resp(a.store, 'Q1', 'correct');
resp(a.store, 'Q2', 'wrong');
eq(a.store.outbox.tamano(), 2, 'dos respuestas, dos eventos');
const ev = a.store.outbox.lista()[0];
ok(ev.id && ev.tipo === 'intento' && ev.creado > 0, 'cada evento tiene id, tipo y fecha');
ok(ev.payload.event_id && ev.payload.question_id === 'Q1', 'y lo necesario para reconstruirlo');
ok(a.store.outbox.lista()[0].id !== a.store.outbox.lista()[1].id, 'los ids no se repiten');

// Está en localStorage de verdad, no solo en memoria.
const crudo = JSON.parse(ACTIVO.ls.getItem('asorc.v2.syncQueue'));
eq(crudo.length, 2, 'la cola está escrita en localStorage');

// Quitar solo quita lo confirmado.
a.store.outbox.quitar([ev.id]);
eq(a.store.outbox.tamano(), 1, 'se quita lo confirmado y lo demás espera');

// --- 2 · estados: solo el último importa ---------------------------------
const b = nuevo();
await b.store.init({ base: './', ns: 'asorc.v2' });
b.store.marcar('Q1', true);
b.store.marcar('Q1', false);
b.store.marcar('Q2', true);
eq(b.store.outbox.lista().filter((e) => e.tipo === 'marca').length, 2,
   'marcar y desmarcar la misma pregunta deja un solo evento');
eq(b.store.outbox.lista().find((e) => e.payload.question_id === 'Q1').payload.marked, false,
   'y es el último');
for (let i = 0; i < 5; i++) b.store.guardarSesion({ uid: 's', i });
eq(b.store.outbox.lista().filter((e) => e.tipo === 'pendiente').length, 1,
   'la ronda a medias no se acumula: solo la última');
// Los hechos, en cambio, se acumulan todos.
resp(b.store, 'Q9', 'correct'); resp(b.store, 'Q9', 'correct');
eq(b.store.outbox.lista().filter((e) => e.tipo === 'intento').length, 2,
   'responder dos veces la misma pregunta son dos hechos, no uno');

// --- 3 · sobrevive a cerrar el navegador ---------------------------------
const guardado = ACTIVO.ls;
const c = carga();                       // módulos nuevos, mismo localStorage
await c.store.init({ base: './', ns: 'asorc.v2' });
eq(c.store.outbox.tamano(), b.store.outbox.tamano(), 'al reabrir la cola sigue entera');

// --- 4 · el histórico de fuera se mide contra la nube, no contra una cuenta
const d = nuevo();
await d.store.init({ base: './', ns: 'asorc.v2' });
d.store.importar({ preguntas: {
  Q1: { veces_vista: 3, aciertos: 2, fallos: 1, blancos: 0, parciales: 0,
        ultima_respuesta: 'x', ultimo_resultado: 'correct' },
  Q5: { veces_vista: 1, aciertos: 1, fallos: 0, blancos: 0, parciales: 0,
        ultima_respuesta: '', ultimo_resultado: 'correct' },
}, configuracion: {} }, null);

// La nube no sabe nada: hay que subirlo entero.
const vacio = { progress: { preguntas: {} }, stats: { preguntas: {} } };
let filas = d.cloud._diferencia(d.store, vacio);
eq(filas.length, 4, 'si la nube está vacía se suben los cuatro intentos');
eq(filas.map((f) => f.event_id).sort(),
   ['local:Q1:correct:1', 'local:Q1:correct:2', 'local:Q1:wrong:1', 'local:Q5:correct:1'],
   'con identificador reproducible');

// La nube ya lo tiene todo: no se sube nada. Aquí estaba el fallo de contar
// dos veces lo mismo, y por eso la diferencia se mide contra la nube.
const lleno = { progress: { preguntas: {
  Q1: { aciertos: 2, fallos: 1, blancos: 0, parciales: 0 },
  Q5: { aciertos: 1, fallos: 0, blancos: 0, parciales: 0 },
} }, stats: { preguntas: {} } };
eq(d.cloud._diferencia(d.store, lleno).length, 0, 'si la nube ya lo tiene, no se sube nada');

// Y si la nube va por detrás, solo la diferencia.
const medio = { progress: { preguntas: {
  Q1: { aciertos: 1, fallos: 1, blancos: 0, parciales: 0 },
} }, stats: { preguntas: {} } };
filas = d.cloud._diferencia(d.store, medio);
eq(filas.map((f) => f.event_id).sort(), ['local:Q1:correct:2', 'local:Q5:correct:1'],
   'solo lo que falta, y sin chocar con lo que ya hay');

// --- 5 · desmarcar viaja: gana el reloj ----------------------------------
const S = d.S;
const viejo = { preguntas: { Q1: { marcada: true, marcada_ts: 1790000000000 } }, sesiones: [] };
const nuevoE = { preguntas: { Q1: { marcada: false, marcada_ts: 1790000009999 } }, sesiones: [] };
eq(S.fusionaStats(viejo, nuevoE).preguntas.Q1.marcada, false, 'desmarcar después gana');
eq(S.fusionaStats(nuevoE, viejo).preguntas.Q1.marcada, false, 'da igual el orden de la fusión');
// Una fecha en milisegundos no cabe en 32 bits: si alguien vuelve a poner
// «| 0» aquí, esto lo caza.
eq(S.fusionaStats(viejo, nuevoE).preguntas.Q1.marcada_ts, 1790000009999, 'la fecha no se trunca');
const sinReloj = { preguntas: { Q1: { marcada: true } }, sesiones: [] };
eq(S.fusionaStats(sinReloj, { preguntas: { Q1: {} }, sesiones: [] }).preguntas.Q1.marcada, true,
   'con datos viejos sin reloj, marcar sigue mandando');

// --- 6 · sin nube no se rompe nada ---------------------------------------
const e = nuevo();
await e.store.init({ base: './', ns: 'asorc.v2' });
resp(e.store, 'Q1', 'correct');
const r = await e.cloud.flush();          // sin configurar: no hay cliente
ok(!r.ok, 'sin nube, enviar no puede salir bien');
eq(e.store.outbox.tamano(), 1, 'pero la respuesta no se pierde');
eq(e.store.progress.preguntas.Q1.aciertos, 1, 'y el progreso local está intacto');

// --- 7 · la regla: no bajar mientras quede algo por subir ----------------
const f = nuevo();
await f.store.init({ base: './', ns: 'asorc.v2' });
resp(f.store, 'Q1', 'correct');
let bajadas = 0;
f.cloud.store = f.store;
f.cloud.sb = {};                          // hay «cliente», pero todo falla
f.cloud.estado = 'sincronizado';
f.cloud.sembrar = async () => ({ ok: true, filas: 0 });
f.cloud._flush = async () => ({ ok: false, motivo: 'la red' });
f.cloud.traer = async () => { bajadas++; return null; };
const s2 = await f.cloud.sincronizar(f.store);
ok(!s2.ok, 'si la subida falla, sincronizar falla');
eq(bajadas, 0, 'y no se baja nada: fusionar ahora dejaría cuentas cortas');

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 10) }));
})();
"""


def test_nube():
    """Sincronización: sin cuentas, en segundo plano y sin perder nada.

    Lo de fondo (Supabase de verdad, PostgREST de verdad, RLS de verdad) está
    en tools/test_sync.py, que necesita docker. Aquí va lo que se puede
    comprobar siempre: la cola, la fusión y que no ha vuelto la autenticación.
    """
    print("\n[11] Nube sin cuentas: cola, fusión y sincronización automática")
    cloud = open(os.path.join(PROJ, "web", "js", "cloud.js"), encoding="utf-8").read()
    store = open(os.path.join(PROJ, "web", "js", "store.js"), encoding="utf-8").read()
    html = open(os.path.join(PROJ, "web", "index.html"), encoding="utf-8").read()
    app = open(os.path.join(PROJ, "web", "js", "app.js"), encoding="utf-8").read()
    sql = open(os.path.join(PROJ, "supabase", "schema.sql"), encoding="utf-8").read()

    # --- nada de autenticación, ni en el código ni en la interfaz ---
    prohibido = ["signInWithOtp", "signInWith", "signOut", "auth.uid()",
                 "magiclink", "magic link", "emailRedirectTo", "user_id"]
    for p_ in prohibido:
        check(f"cloud.js no usa «{p_}»", p_ not in cloud)
    check("cloud.js no guarda sesión de auth", "persistSession: false" in cloud)
    check("ni detecta sesiones en la URL", "detectSessionInUrl: false" in cloud)
    for p_ in ('type="email"', "cloud-email", "ENVIAR ENLACE", "CERRAR SESIÓN"):
        check(f"la interfaz no tiene «{p_}»", p_ not in html)
    check("app.js no llama a entrar/salir",
          "CL.entrar" not in app and "CL.salir" not in app)

    # --- el indicador cabe en un botón y sabe decir lo que pasa ---
    for estado in ("sincronizado", "sincronizando", "sin conexión", "pendientes", "solo local"):
        check(f"el indicador sabe decir «{estado}»", estado in app)

    # --- responder no espera a la red (§2, §11) ---
    m = re.search(r"function advance\(\)\s*\{(.*?)\n\}", app, re.S)
    check("existe advance()", bool(m))
    if m:
        cuerpo = re.sub(r"//.*", "", m.group(1))       # sin comentarios: dicen «await»
        check("advance() no hace await de la nube", "await" not in cuerpo)
        # El orden importa: registrar (local) → pintar → red.
        pos = {k: cuerpo.find(k) for k in
               ("registraActual()", "completeCard()", "nextQuestion()", "flushNube()")}
        check("advance() guarda en local antes de pintar",
              0 <= pos["registraActual()"] < pos["completeCard()"], str(pos))
        check("y manda a la nube después de pintar",
              pos["nextQuestion()"] < pos["flushNube()"], str(pos))
    mr = re.search(r"function registraActual\(\)\s*\{(.*?)\n\}", app, re.S)
    check("registrar es escribir en local, sin esperar a la red",
          bool(mr) and "ST.registrar(" in mr.group(1)
          and "await" not in re.sub(r"//.*", "", mr.group(1)))
    # Corregida pero sin SIGUIENTE: salir, Esc o cerrar la pestaña la dan por
    # pasada, o al reanudar se volvería a preguntar y se sumaría dos veces.
    for donde, patron in (("salir()", r"function salir\(\)\s*\{(.*?)\n\}"),
                          ("cerrar la pestaña", r"'beforeunload', \(\) => \{(.*?)\n  \}\);"),
                          ("Esc", r"k === 'Escape'\) \{(.*?)\}")):
        mm = re.search(patron, app, re.S)
        check(f"{donde} registra la corregida antes de guardar",
              bool(mm) and "registraActual()" in mm.group(1))
    check("marcar para repasar también se envía solo",
          re.search(r"ST\.marcar\(.*\);\s*\n\s*flushNube\(\);", app) is not None)
    check("cerrar una ronda también",
          re.search(r"cerrarRonda\(.*\);\s*\n\s*flushNube\(\);", app) is not None)
    principal = app[app.index("(async function main()"):]
    check("el panel no espera a Supabase para pintarse",
          principal.index("renderHome();") < principal.index("CL.init(ST)"))

    # --- reintentos con espera creciente y vuelta de la red ---
    check("hay reintentos con espera creciente",
          "ESPERAS" in cloud and cloud.count("_programar") >= 2)
    check("y se reintenta al volver la conexión", "'online'" in cloud)
    check("y al volver a mirar la pestaña", "visibilitychange" in cloud)
    check("el botón de sincronizar ya es solo un reintento",
          "reintento a mano" in app or "reintento" in app)

    # --- se pagina al bajar: PostgREST sirve mil filas por petición ---
    check("al bajar se pagina", ".range(" in cloud and "PAGINA" in cloud)

    # --- esquema: perfil único, sin usuarios, RLS y permisos mínimos ---
    # user_id solo puede aparecer para quitarlo, o en un comentario que cuenta
    # por qué se quita. En ninguna tabla, en ninguna política.
    check("el esquema no tiene user_id",
          all(l.lstrip().startswith("--") or "drop column if exists user_id" in l
              for l in sql.splitlines() if "user_id" in l))
    for t in ("asorc_attempts", "asorc_marks", "asorc_sessions", "asorc_pending", "asorc_card_events"):
        check(f"crea {t}", f"create table if not exists public.{t}" in sql)
    check("el histórico se identifica por evento", "event_id    text        primary key" in sql)
    check("con la comprobación de resultado", "asorc_attempts_result_ck" in sql)
    check("las marcas, por pregunta dentro del perfil",
          "primary key (profile_id, question_id)" in sql)
    check("la ronda a medias es una sola fila", "'main'" in sql)
    check("todo cuelga de un perfil fijo", sql.count("profile_id = 'default'") >= 8)
    check("RLS activada en las cinco", sql.count("enable row level security") == 5)
    check("y nunca desactivada", "disable row level security" not in sql)
    check("políticas explícitas para anon", sql.count("to anon") >= 10)
    check("el histórico no se puede modificar ni borrar",
          "grant select, insert         on public.asorc_attempts to anon;" in sql)
    check("se parte de cero antes de conceder", sql.count("revoke all on") == 5)
    check("ninguna tabla concede delete", "delete" not in
          "\n".join(l for l in sql.splitlines() if l.startswith("grant")))
    check("es idempotente: nada de drop table", "drop table" not in sql)
    check("y se puede repetir", sql.count("if not exists") >= 8)
    check("el esquema no usa service_role", "service_role" in sql and "NUNCA" in sql)

    # --- la clave que viaja al navegador sigue siendo la pública ---
    cfg = open(os.path.join(PROJ, "web", "config.js"), encoding="utf-8").read()
    check("config.js usa la publishable",
          re.search(r"supabaseAnonKey:\s*'(sb_publishable_|eyJ)", cfg) is not None)
    check("config.js sin clave secreta",
          re.search(r"sb_secret_[A-Za-z0-9_\-]{12,}", cfg) is None)
    check("cloud.js rechaza una clave secreta",
          "sb_secret_" in cloud and "publishable" in cloud)

    # --- idempotencia: identificador propio en cada evento ---
    check("cada intento lleva su identificador", "u.uid = u.uid || uid()" in store)
    check("el histórico de fuera sube con identificador reproducible",
          "`local:${id}:${res}:${i}`" in cloud)
    check("y al subir no se pisa lo que ya está", "ignoreDuplicates: true" in cloud)
    # Lo que no puede volver: medir el histórico contra una cuenta guardada
    # aquí, que se desincroniza y acaba contando dos veces lo mismo.
    check("la diferencia se mide contra la nube, no contra una cuenta local",
          "_diferencia(store, remoto)" in cloud and "semilla" not in store)
    check("y se baja antes de calcularla",
          cloud.index("const remoto = await this.traer()") <
          cloud.index("this._diferencia(store, remoto)"))

    # --- y ahora la lógica, ejecutada de verdad ---
    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(NUBE_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, os.path.join(PROJ, "web", "js")],
                             capture_output=True, text=True, timeout=120)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:400])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("cola, diferencia y fusión se comportan", res["n"] == 0, "; ".join(res["errs"]))
    finally:
        os.unlink(script)


NOTA_TEST = r"""
const A = require(process.argv[2]);
const G = require(process.argv[3]);
const L = require(process.argv[4]);
const bank = JSON.parse(require('fs').readFileSync(process.argv[5], 'utf8')).questions;
const errs = [];
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) errs.push(m); };

// Azar reproducible: si algo falla, falla siempre igual.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 1 · el fallo resta 1/(k−1) con las opciones que se VEN ---------------
eq(A.delta('correct', 'single', 3), 1, 'acierto +1');
eq(A.delta('wrong', 'single', 3), -0.5, '3 opciones: fallo −0,50');
eq(A.delta('wrong', 'single', 4), -1 / 3, '4 opciones: fallo −1/3');
eq(A.delta('wrong', 'single', 5), -0.25, '5 opciones: fallo −0,25');
eq(A.delta('blank', 'single', 3), 0, 'blanco 0');
eq(A.signed(A.delta('wrong', 'single', 4)), '−0,33', 'se ve −0,33');

// --- 2 · 1 correcta + (k−1) fallos = 0 EXACTO, en cualquier orden ---------
for (const k of [3, 4, 5]) {
  for (let pos = 0; pos < k; pos++) {           // el acierto en cada posición
    const st = A.newState();
    for (let i = 0; i < k; i++) {
      A.record(st, { id: 'q' + i, result: i === pos ? 'correct' : 'wrong', kind: 'single', k });
    }
    eq(st.points, 0, `${k} opciones: 1 correcta + ${k - 1} fallos (acierto en ${pos + 1}º)`);
    eq(A.num(st.points), '0,00', `${k} opciones: se pinta 0,00 y no −0,00`);
    eq(st.log[k - 1].after, 0, `${k} opciones: el acumulado de la última es 0`);
  }
}
// Sin rejilla, 1 − 1/3 − 1/3 − 1/3 da 5,5e−17: la prueba lo distingue.
ok(1 - 1 / 3 - 1 / 3 - 1 / 3 !== 0, 'la aritmética de coma flotante sola no basta');

// --- 3 · al azar, la media converge a 0 -----------------------------------
{
  const r = rng(20260923);
  const N = 200000;
  for (const k of [3, 4, 5]) {
    const st = A.newState();
    for (let i = 0; i < N; i++) {
      const res = Math.floor(r() * k) === 0 ? 'correct' : 'wrong';
      A.record(st, { id: 'x', result: res, kind: 'single', k });
    }
    const media = st.points / N;
    ok(Math.abs(media) < 0.01, `${k} opciones al azar: media ${media.toFixed(4)} no se acerca a 0`);
  }
  // Mezcla de 3, 4 y 5 opciones en la misma ronda: cada una con su k.
  const st = A.newState();
  for (let i = 0; i < N; i++) {
    const k = 3 + Math.floor(r() * 3);
    A.record(st, { id: 'x', result: Math.floor(r() * k) === 0 ? 'correct' : 'wrong', kind: 'single', k });
  }
  ok(Math.abs(st.points / N) < 0.01, `k mezcladas: media ${(st.points / N).toFixed(4)}`);
  // Y si se aplicara el −0,5 del simulacro a todo, el azar NO sería neutro.
  let fijo = 0;
  for (let i = 0; i < N; i++) {
    const k = 3 + Math.floor(r() * 3);
    fijo += Math.floor(r() * k) === 0 ? 1 : -0.5;
  }
  ok(fijo / N < -0.05, `una penalización fija de −0,5 sesga el azar (${(fijo / N).toFixed(3)})`);
}

// --- 4 · sobre el banco real: k sale de las opciones mostradas ------------
{
  const r = rng(7);
  const st = A.newState();
  let n = 0, malK = 0;
  for (const q of bank) {
    if (q.type !== 'multiple_choice') continue;
    for (const asorc of [false, true]) {
      if (asorc && !(q.asorc && q.asorc.eligible)) continue;
      const v = L.buildView(q, asorc);
      const rule = A.ruleOf(v);
      const want = asorc ? 3 : q.original_options.length;
      if (rule.kind !== 'single' || rule.k !== want || rule.k !== v.shown.length) malK++;
      for (let i = 0; i < 60; i++) {
        const o = v.shown[Math.floor(r() * v.shown.length)];
        const res = L.grade(new Set([o.L]), v.correctL);
        A.record(st, Object.assign({ id: q.id, result: res }, rule));
        n++;
      }
    }
  }
  eq(malK, 0, 'la k de cada pregunta es la de las opciones que se ven (3 en ASORC)');
  ok(Math.abs(st.points / n) < 0.01, `banco real al azar: media ${(st.points / n).toFixed(4)}`);
  const asorcV = L.buildView(bank.find((q) => q.asorc && q.asorc.eligible && q.original_options.length === 5), true);
  eq(A.delta('wrong', A.ruleOf(asorcV).kind, A.ruleOf(asorcV).k), -0.5,
     'una de 5 opciones mostrada como ASORC resta −0,50, no −0,25');
}

// --- 5 · varias respuestas y abiertas: sin −1/(k−1), registradas aparte ---
{
  const multi = bank.find((q) => q.type === 'multiple_response');
  const v = L.buildView(multi, false);
  const rule = A.ruleOf(v);
  eq(rule.kind, 'multi', 'las de varias respuestas usan su propia regla');
  eq(A.delta('wrong', rule.kind, rule.k), 0, 'fallar una de varias no resta');
  eq(A.delta('correct', rule.kind, rule.k), 1, 'acertar el conjunto exacto suma 1');
  const open = bank.find((q) => q.type === 'open');
  const ro = A.ruleOf(L.buildView(open, false));
  eq(ro.kind, 'open', 'las abiertas, autocalificadas');
  eq([A.delta('correct', 'open', 0), A.delta('partial', 'open', 0), A.delta('wrong', 'open', 0)],
     [1, 0, 0], 'abierta: +1 si «bien», 0 si no');

  const st = A.newState();
  A.record(st, { id: 'm1', result: 'correct', kind: 'multi', k: 5 });
  A.record(st, { id: 'm2', result: 'wrong', kind: 'multi', k: 5 });
  A.record(st, { id: 's1', result: 'wrong', kind: 'single', k: 4 });
  A.record(st, { id: 'o1', result: 'partial', kind: 'open', k: 0 });
  const t = A.tally(st);
  eq([t.multi.n, t.multi.ok, t.multi.bad], [2, 1, 1], 'las de varias se cuentan aparte');
  eq([t.ok, t.bad, t.blank, t.answered], [1, 3, 0, 4], '✓ ✗ ○ de la ronda (a medias cuenta como ✗)');
  eq(t.byK, { 4: 1 }, 'solo resta el fallo de una respuesta');
  eq(A.num(t.points), '0,67', 'total 1 − 1/3');
}

// --- 6 · salir y reanudar: queda exactamente igual -------------------------
{
  const st = A.newState();
  const seq = [['correct', 4], ['wrong', 4], ['blank', 3], ['wrong', 3], ['correct', 5], ['wrong', 5]];
  seq.forEach(([res, k], i) => A.record(st, { id: 'q' + i, result: res, kind: 'single', k,
                                              picked: ['A'], order: ['C', 'A', 'B'] }));
  const guardado = JSON.parse(JSON.stringify(A.serialize(st)));
  const vuelta = A.restore(guardado);
  eq(vuelta, st, 'lo restaurado es idéntico a lo guardado');
  eq(vuelta.log.map((e) => [e.delta, e.after]), st.log.map((e) => [e.delta, e.after]),
     'cada pregunta conserva su delta y su acumulado');
  // y se puede seguir sumando sin arrastrar error: 1 + 3 fallos con k=4
  const s2 = A.restore(JSON.parse(JSON.stringify(A.serialize(A.newState()))));
  A.record(s2, { id: 'a', result: 'correct', kind: 'single', k: 4 });
  const s3 = A.restore(JSON.parse(JSON.stringify(A.serialize(s2))));
  for (let i = 0; i < 3; i++) A.record(s3, { id: 'b' + i, result: 'wrong', kind: 'single', k: 4 });
  eq(s3.points, 0, 'tras varias idas y vueltas sigue siendo 0 exacto');
  eq(A.restore(null), A.newState(), 'sin nada guardado, ronda en cero');
  eq(A.restore({ log: [null, 5, { id: 7 }] }).log.length, 0, 'lo que no es una entrada se ignora');
  const viejo = A.restore({ log: [{ id: 'z', result: 'wrong', kind: 'single', k: 3 }] });
  eq([viejo.log[0].delta, viejo.points], [-0.5, -0.5], 'sin delta guardado, se recalcula con su k');
}

// Rehacer una vista ya vista: mismas opciones en el mismo orden y con las
// mismas letras, que es lo que permite pintar el historial al reanudar.
{
  const q = bank.find((x) => x.type === 'multiple_choice' && x.original_options.length === 5);
  const v1 = L.buildView(q, false);
  const order = v1.shown.map((o) => o.label);
  const v2 = L.buildView(q, false, order);
  eq(v2.shown.map((o) => o.label + o.L), v1.shown.map((o) => o.label + o.L), 'la vista se rehace igual');
  eq(v2.correctL, v1.correctL, 'y la correcta sigue en la misma letra');
  const v3 = L.buildView(q, false, ['A', 'A', 'B', 'C', 'Z']);
  eq(v3.shown.map((o) => o.label).sort(), q.original_options.map((o) => o.label).sort(),
     'un orden que no cuadra se ignora y se baraja');
}

// --- 7 · el XP no se entera de la nota, ni la nota del XP ------------------
{
  const resultados = ['correct', 'wrong', 'correct', 'blank', 'wrong', 'correct'];
  const xpCon = (k) => {
    const run = G.newRun({ total: resultados.length });
    run.academic = A.newState();
    resultados.forEach((res, i) => {
      G.score(run, res, 1000, 'T', 'q' + i);
      A.record(run.academic, { id: 'q' + i, result: res, kind: 'single', k });
    });
    return run;
  };
  const r3 = xpCon(3), r5 = xpCon(5);
  eq(r3.xp, r5.xp, 'mismo XP con 3 que con 5 opciones');
  eq(r3.xp, 30, 'XP = 10 por acierto, sin tocar la nota');
  ok(r3.academic.points !== r5.academic.points, 'la nota sí depende de k');
  eq(A.num(r3.academic.points), '2,00', '3 aciertos − 2 × 0,50');
  eq(A.num(r5.academic.points), '2,50', '3 aciertos − 2 × 0,25');

  const run = G.newRun({ total: 3 });
  run.academic = A.newState();
  A.record(run.academic, { id: 'a', result: 'wrong', kind: 'single', k: 3 });
  const antes = JSON.stringify(run.academic);
  G.score(run, 'correct', 500, 'T', 'b');
  G.score(run, 'wrong', 500, 'T', 'c');
  eq(JSON.stringify(run.academic), antes, 'puntuar XP no toca la nota');
  const xp = run.xp;
  A.record(run.academic, { id: 'd', result: 'correct', kind: 'single', k: 3 });
  eq(run.xp, xp, 'anotar la nota no toca el XP');
}

// --- 8 · formato: coma, signo y sin «−0,00» --------------------------------
eq([A.signed(1), A.signed(-1 / 3), A.signed(-0.5), A.signed(-0.25), A.signed(0)],
   ['+1,00', '−0,33', '−0,50', '−0,25', '0,00'], 'deltas');
eq([A.num(6 + 2 / 3), A.num(-1.5), A.num(-1e-17), A.num(8.25)], ['6,67', '−1,50', '0,00', '8,25'], 'totales');
eq(A.pct(6.67 / 12), '55,6%', 'rendimiento neto');
eq([A.sign(1), A.sign(-0.25), A.sign(0), A.sign(-1e-17)], ['pos', 'neg', 'zero', 'zero'], 'signo para el color');
eq([A.nota10(9, 20), A.nota10(-3, 20), A.nota10(5, 0)], [4.5, 0, 0], 'nota sobre 10: max(0, puntos/total·10)');

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 10) }));
"""


def test_nota():
    print("\n[12] Nota académica: fallo −1/(k−1), azar neutro y aparte del XP")
    js = os.path.join(PROJ, "web", "js")
    app = open(os.path.join(js, "app.js"), encoding="utf-8").read()
    game = open(os.path.join(js, "game.js"), encoding="utf-8").read()
    acad = open(os.path.join(js, "academic.js"), encoding="utf-8").read()
    html = open(os.path.join(PROJ, "web", "index.html"), encoding="utf-8").read()

    # --- separadas de verdad: ninguna de las dos capas lee la otra ---
    codigo = lambda t: re.sub(r"/\*.*?\*/|//[^\n]*", "", t, flags=re.S)   # sin comentarios
    check("game.js no sabe nada de la nota",
          not re.search(r"academic|Academic", codigo(game)))
    check("academic.js no sabe nada de XP ni de rachas",
          not re.search(r"\bxp\b|combo|XP_OK", codigo(acad)))

    # --- conectada donde toca ---
    check("index.html carga academic.js antes que app.js",
          "js/academic.js" in html and html.index("js/academic.js") < html.index("js/app.js"))
    for ident in ("nota-ok", "nota-bad", "nota-blank", "nota-pts", "nota-of", "nota-net"):
        check(f"el HUD tiene #{ident}", f'id="{ident}"' in html)
    for ident in ("dn-ok", "dn-bad", "dn-blank", "dn-pts", "dn-total", "dn-10"):
        check(f"el resultado final tiene #{ident}", f'id="{ident}"' in html)
    for f in ("enterLearn", "gradeOpen"):
        m = re.search(r"function " + f + r"\([^)]*\)\s*\{(.*?)\n\}", app, re.S)
        check(f"{f}() anota la nota junto al XP", bool(m) and "anotaNota()" in m.group(1))
    m = re.search(r"function serializaRun\(r\)\s*\{(.*?)\n\}", app, re.S)
    check("la sesión pendiente guarda la nota", bool(m) and "academic" in m.group(1))
    m = re.search(r"function deserializaRun\(o\)\s*\{(.*?)\n\}", app, re.S)
    check("y al reanudar se restaura", bool(m) and "A.restore(" in m.group(1))
    check("cada tarjeta conserva resultado, delta y acumulado",
          all(k in app for k in ("dataset.result", "dataset.scoreDelta", "dataset.scoreAfter")))

    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(NOTA_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, os.path.join(js, "academic.js"),
                              os.path.join(js, "game.js"), os.path.join(js, "logic.js"), QJSON],
                             capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:400])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("exacta, neutra ante el azar, persistente e independiente del XP",
              res["n"] == 0, " | ".join(res["errs"]))
    finally:
        os.unlink(script)


MICRO_TEST = r"""
const fs = require('fs');
const path = require('path');
const web = process.argv[2];
const bank = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).questions;
const micro = JSON.parse(fs.readFileSync(process.argv[4], 'utf8')).tarjetas;
const errs = [];
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) errs.push(m); };

// Un navegador de mentira: localStorage y nada más.
const almacen = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k) }; };
let LS = almacen();
Object.defineProperty(global, 'localStorage', { configurable: true, get() { return LS; } });
global.window = global;
const carga = () => {
  for (const f of ['micro.js', 'store.js', 'cloud.js']) delete require.cache[require.resolve(path.join(web, f))];
  const M = require(path.join(web, 'micro.js'));
  const S = require(path.join(web, 'store.js'));
  const C = require(path.join(web, 'cloud.js'));
  return { M, store: S.Store, cloud: C };
};
const { MIN, DIA } = require(path.join(web, 'micro.js'));
const T0 = Date.parse('2026-09-23T10:00:00');
const ev = (id, kind, at, n) => ({ event_id: `${id}:${kind}:${n || at}`, question_id: id, kind, at });

(async () => {
const { M } = carga();
const porId = new Map(bank.map((q) => [q.id, q]));
const temaDe = (id) => porId.get(id).topic;

// --- 1 · una pregunta, una tarjeta: repetir la actualiza, no la duplica ---
{
  const mazo = {};
  for (let i = 0; i < 5; i++) M.aplica(mazo, ev('Q1', 'fallo', T0 + i * MIN));
  M.aplica(mazo, ev('Q1', 'marca', T0 + 6 * MIN));
  M.aplica(mazo, ev('Q1', 'sabia', T0 + 7 * MIN));
  eq(Object.keys(mazo), ['Q1'], 'fallar 5 veces, marcar y repasar la misma pregunta: una tarjeta');
  eq([mazo.Q1.fallos, mazo.Q1.vista, mazo.Q1.sabia], [5, 1, 1], 'y sus estadísticas se actualizan');
  eq(mazo.Q1.por, 'fallo', 'recuerda por qué entró');
}

// --- 2 · la misma pregunta conserva la misma pista -------------------------
{
  const ids = Object.keys(micro);
  eq(ids.length, bank.length, 'hay contenido para todas las preguntas');
  eq(new Set(ids).size, ids.length, 'sin ids repetidos');
  const id = ids[0];
  const mazo = {};
  M.aplica(mazo, ev(id, 'fallo', T0));
  M.conContenido(mazo[id], micro[id]);
  const pista = mazo[id].cue;
  M.aplica(mazo, ev(id, 'fallo', T0 + DIA));
  M.aplica(mazo, ev(id, 'nosabia', T0 + DIA + MIN));
  eq(M.conContenido(mazo[id], micro[id]), false, 'volver a fallarla no cambia su tarjeta');
  eq(mazo[id].cue, pista, 'la pista es la misma');
  eq(mazo[id].cue, micro[id].cue, 'y es la de microcards.json');
}

// --- 3 · cuándo vuelve: no la sabía pronto, dudé después, la sabía mucho menos
{
  const mazo = {};
  M.aplica(mazo, ev('A', 'nosabia', T0));
  M.aplica(mazo, ev('B', 'dude', T0));
  M.aplica(mazo, ev('C', 'sabia', T0));
  ok(mazo.A.proxima - T0 <= 15 * MIN, 'NO LA SABÍA vuelve pronto (minutos)');
  eq(mazo.B.proxima - T0, DIA, 'DUDÉ vuelve mañana');
  ok(mazo.C.proxima - T0 >= 3 * DIA, 'LA SABÍA tarda días en volver');
  ok(mazo.A.proxima < mazo.B.proxima && mazo.B.proxima < mazo.C.proxima, 'y en ese orden');
  const huecos = [];
  let at = T0;
  for (let i = 0; i < 5; i++) { M.aplica(mazo, ev('D', 'sabia', at, i)); huecos.push(mazo.D.proxima - at); at = mazo.D.proxima; }
  ok(huecos.every((h, i) => i === 0 || h > huecos[i - 1]), 'cada vez que la sabes, tarda más en volver');
  M.aplica(mazo, ev('D', 'fallo', at + MIN));
  eq(mazo.D.nivel, 0, 'fallarla en una ronda la devuelve al principio');
  ok(mazo.D.proxima <= at + MIN, 'y toca ya');
}

// --- 4 · modos: por tema, falladas hoy, marcadas, 10 y 20 rápidas ---------
{
  const mazo = {};
  const ids = bank.slice(0, 40).map((q) => q.id);
  ids.forEach((id, i) => M.aplica(mazo, ev(id, i % 3 ? 'fallo' : 'marca', T0 - (i % 2 ? 2 * DIA : 0) + i)));
  const o = (x) => Object.assign({ now: T0 + DIA / 4, temaDe, vale: (id) => !!micro[id] }, x);
  const tema = temaDe(ids[0]);
  const deTema = M.elige(mazo, 'tema', o({ tema }));
  ok(deTema.length > 0 && deTema.every((id) => temaDe(id) === tema), 'por tema: solo las de ese tema');
  eq(deTema.length, ids.filter((id) => temaDe(id) === tema).length, 'y todas las de ese tema');
  const hoy = M.elige(mazo, 'hoy', o({}));
  ok(hoy.every((id) => M.mismoDia(mazo[id].ultimoFallo, T0)), 'falladas hoy: solo las de hoy');
  ok(hoy.length > 0 && hoy.length < ids.length, 'y no las de otro día');
  const marcadas = new Set(ids.filter((_, i) => i % 5 === 0));
  eq(M.elige(mazo, 'marcadas', o({ marcada: (id) => marcadas.has(id) })).sort(), [...marcadas].sort(),
     'solo marcadas');
  eq(M.elige(mazo, 'rapidas', o({ n: 10 })).length, 10, '10 rápidas son 10');
  eq(M.elige(mazo, 'rapidas', o({ n: 20 })).length, 20, '20 rápidas son 20');
  eq(new Set(M.elige(mazo, 'todas', o({}))).size, ids.length, 'todas, sin repetir ninguna');
  // lo que toca va delante de lo que no toca
  M.aplica(mazo, ev(ids[1], 'sabia', T0 + 1));
  const orden = M.elige(mazo, 'todas', o({}));
  eq(orden[orden.length - 1], ids[1], 'la que acabas de saber va al final de la cola');
}

// --- 5 · mismos eventos, mismo mazo, lleguen como lleguen ----------------
{
  const evs = [];
  ['X', 'Y', 'Z'].forEach((id, j) => ['fallo', 'nosabia', 'dude', 'sabia', 'fallo', 'sabia']
    .forEach((k, i) => evs.push(ev(id, k, T0 + (i * 7 + j) * MIN))));
  const a = M.reconstruye(evs);
  const b = M.reconstruye(evs.slice().reverse());
  const c = M.reconstruye(evs.slice().sort(() => 0.5 - Math.random()));
  eq(a, b, 'da igual el orden de llegada');
  eq(a, c, 'también desordenados');
  const local = {}; evs.forEach((e) => M.aplica(local, e));
  eq(local, a, 'aplicar de uno en uno = reconstruir de golpe');
}

// --- 6 · fusionar nunca pierde lo más completo -----------------------------
{
  const rico = M.reconstruye([ev('Q', 'fallo', T0), ev('Q', 'sabia', T0 + MIN), ev('Q', 'sabia', T0 + DIA)]);
  const pobre = M.reconstruye([ev('Q', 'fallo', T0)]);
  eq(M.fusiona(pobre, rico).Q.vista, 2, 'lo pobre no pisa lo rico');
  eq(M.fusiona(rico, pobre).Q.vista, 2, 'da igual el orden');
  const sembrado = {};
  M.siembra(sembrado, [{ id: 'Q', fallos: 9, ultimoFallo: T0 - DIA }], T0 - 2 * DIA);
  const f = M.fusiona(sembrado, rico).Q;
  eq(f.vista, 2, 'los fallos del historial no ganan a los repasos de verdad');
  eq(f.previos, 9, 'pero no se pierden');
  eq(Object.keys(M.fusiona({ A: pobre.Q }, { B: rico.Q })).sort(), ['A', 'B'], 'se unen las de los dos lados');
  eq(M.fusiona(rico, rico), rico, 'fusionar consigo mismo no cambia nada');
  eq(M.siembra(sembrado, [{ id: 'Q', fallos: 1 }], T0), 0, 'sembrar lo que ya está no duplica');
}

// --- 7 · la misma tanda no se atasca en una tarjeta ------------------------
{
  const cola = ['a', 'b', 'c', 'd', 'e'], veces = {};
  ok(M.reencola(cola, 0, 'a', veces), 'NO LA SABÍA la vuelve a poner en la tanda');
  eq(cola.indexOf('a', 1), 4, 'unas tarjetas después');
  M.reencola(cola, 4, 'a', veces);
  eq(M.reencola(cola, 8, 'a', veces), false, 'como mucho dos veces');
}

// --- 8 · tras recargar, el mazo sigue igual -------------------------------
{
  LS = almacen();
  let { store, M: M2 } = carga();
  await store.init({ base: './', ns: 'asorc.v2' });
  const id = bank[5].id;
  for (const k of ['fallo', 'nosabia', 'dude', 'sabia']) {
    const e = { question_id: id, kind: k, at: Date.now() };
    M2.aplica(store.cards, e);
    M2.conContenido(store.cards[id], micro[id]);
    store.tarjetaEvento(e);
  }
  const antes = JSON.stringify(store.cards);
  const cola = store.outbox.lista().filter((e) => e.tipo === 'tarjeta');
  eq(cola.length, 4, 'cada evento va a la cola de la nube');
  ok(cola.every((e) => e.payload.event_id && e.payload.question_id === id && e.payload.event_at),
     'con identificador, pregunta y fecha');
  eq(new Set(cola.map((e) => e.payload.event_id)).size, 4, 'identificadores que no se repiten');
  ({ store } = carga());                       // recargar: módulos nuevos, mismo localStorage
  await store.init({ base: './', ns: 'asorc.v2' });
  eq(JSON.stringify(store.cards), antes, 'al recargar, el mazo está igual');
  eq(store.cards[id].cue, micro[id].cue, 'con su pista');
  eq(store.exportar().cards[id].vista, 3, 'exportar se lleva el mazo');
}

// --- 9 · la nube: con la tabla nueva viaja; sin ella, lo demás sigue igual --
function falsoSupabase(sinTarjetas) {
  const tablas = { asorc_attempts: [], asorc_marks: [], asorc_sessions: [], asorc_pending: [],
                   asorc_card_events: [] };
  if (sinTarjetas) delete tablas.asorc_card_events;
  // Lo que contesta PostgREST 12 de verdad (lo comprueba test_sync.py): al
  // insertar, 404 con el cuerpo vacío; al leer, 404 con 42P01.
  const falta = (t) => ({ code: '42P01', message: `relation "public.${t}" does not exist` });
  const clave = { asorc_attempts: 'event_id', asorc_sessions: 'uid', asorc_card_events: 'event_id', asorc_pending: 'id' };
  return {
    tablas,
    from(t) {
      const q = {
        async upsert(filas) {
          if (!(t in tablas)) return { error: {}, status: 404 };
          filas.forEach((f) => {
            const k = clave[t];
            if (k && tablas[t].some((x) => x[k] === f[k])) return;
            tablas[t].push(Object.assign({}, f));
          });
          return { error: null };
        },
        select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
        async range() {
          return t in tablas ? { data: tablas[t].slice(), error: null, status: 200 }
                             : { data: null, error: falta(t), status: 404 };
        },
        async maybeSingle() { return { data: (tablas[t] || [])[0] || null, error: null }; },
      };
      return q;
    },
  };
}
async function navegador(sb) {
  LS = almacen();
  const n = carga();
  await n.store.init({ base: './', ns: 'asorc.v2' });
  n.cloud.store = n.store; n.cloud.sb = sb; n.cloud.estado = 'sincronizado'; n.cloud.sinTarjetas = null;
  return n;
}
const id9 = bank[7].id;
const responde = (n) => {
  n.store.registrar({ id: id9, result: 'wrong', answer: 'A', answerMs: 900, reviewMs: 100, marked: false });
  // Como la web: nunca dos eventos en el mismo milisegundo (repaso.js).
  const t0 = Date.now();
  for (const [i, k] of ['fallo', 'sabia'].entries()) {
    const e = { question_id: id9, kind: k, at: t0 + i };
    n.M.aplica(n.store.cards, e);
    n.store.tarjetaEvento(e);
  }
};
{
  // Sin la tabla nueva (falta volver a ejecutar schema.sql)
  const sb = falsoSupabase(true);
  const a = await navegador(sb);
  responde(a);
  const r = await a.cloud.flush();
  ok(r.ok, 'sin la tabla del repaso, enviar lo demás sale bien');
  eq(sb.tablas.asorc_attempts.length, 1, 'la respuesta llega igual');
  ok(!!a.cloud.sinTarjetas, 'y se sabe que falta la tabla');
  ok(a.cloud.estado !== 'error', 'sin dar la nube por rota');
  eq(a.store.outbox.lista().filter((e) => e.tipo === 'tarjeta').length, 2, 'los eventos del repaso esperan en la cola');
  eq(a.cloud.pendientes(), 0, 'y no cuentan como pendientes que no se van a poder mandar');
  const s = await a.cloud.sincronizar(a.store);
  ok(s.ok, 'bajar lo de otros dispositivos no se bloquea por ellos');
  eq(a.store.cards[id9].vista, 1, 'y el mazo local sigue intacto');
}
{
  // Con la tabla: viaja, no duplica y llega a otro navegador
  const sb = falsoSupabase(false);
  const a = await navegador(sb);
  responde(a);
  await a.cloud.flush();
  eq(a.store.outbox.tamano(), 0, 'con la tabla, la cola se vacía');
  eq(sb.tablas.asorc_card_events.length, 2, 'y los eventos del repaso llegan');
  const reenvio = sb.tablas.asorc_card_events.map((f) => ({ id: 'x' + f.event_id, tipo: 'tarjeta', payload: f }));
  a.store.outbox.anadir('tarjeta', Object.assign({}, reenvio[0].payload));
  await a.cloud.flush();
  eq(sb.tablas.asorc_card_events.length, 2, 'reenviar el mismo evento no duplica');
  const b = await navegador(sb);
  const r = await b.cloud.sincronizar(b.store);
  ok(r.ok, 'otro navegador sincroniza');
  ok(!!b.store.cards[id9], 'y recibe la tarjeta');
  eq([b.store.cards[id9].fallos, b.store.cards[id9].sabia], [1, 1], 'con sus estadísticas');
  eq(b.store.cards[id9].proxima, a.store.cards[id9].proxima, 'y el mismo «cuándo vuelve»');
}

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 10) }));
})().catch((e) => { console.log(JSON.stringify({ n: 1, errs: [String(e && e.stack || e)] })); });
"""


def test_micro():
    print("\n[13] Repaso rápido: una tarjeta por pregunta, estable, por tema y tras recargar")
    js = os.path.join(PROJ, "web", "js")
    html = open(os.path.join(PROJ, "web", "index.html"), encoding="utf-8").read()
    app = open(os.path.join(js, "app.js"), encoding="utf-8").read()
    sql = open(os.path.join(PROJ, "supabase", "schema.sql"), encoding="utf-8").read()
    mjson = os.path.join(PROJ, "microcards.json")

    for s in ("js/micro.js", "js/repaso.js"):
        check(f"index.html carga {s}", s in html)
    check("micro.js va antes que store.js y cloud.js",
          html.index("js/micro.js") < html.index("js/store.js") < html.index("js/cloud.js"))
    for ident in ("rq-home", "micro", "rq-cue", "rq-answer", "rq-show", "rq-grade", "rq-contrast"):
        check(f"index.html tiene #{ident}", f'id="{ident}"' in html)
    check("los tres botones de recuperación activa",
          all(f'data-g="{g}"' in html for g in ("sabia", "dude", "nosabia")))
    check("fallar, dejar en blanco o marcar mete la tarjeta en el repaso",
          app.count("alRepaso(") >= 4 and "alRepaso('marca')" in app)
    check("y lo dice discretamente", "Añadida a repaso rápido" in app)
    check("el esquema crea la tabla del repaso",
          "create table if not exists public.asorc_card_events" in sql)
    check("y es de solo añadir", "grant select, insert         on public.asorc_card_events to anon;" in sql)

    if not os.path.exists(mjson):
        check("microcards.json existe", False, "genéralo con tools/micro/merge.py")
        return
    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(MICRO_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, js, QJSON, mjson],
                             capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:400])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("sin duplicados, estable, programada, por modos, tras recargar y en la nube",
              res["n"] == 0, " | ".join(res["errs"]))
    finally:
        os.unlink(script)


HIST_TEST = r"""
const fs = require('fs');
const path = require('path');
const web = process.argv[2];
const bank = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).questions;
const errs = [];
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) errs.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) errs.push(m); };

const almacen = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
  removeItem: (k) => m.delete(k) }; };
let LS = almacen();
Object.defineProperty(global, 'localStorage', { configurable: true, get() { return LS; } });
global.window = global;
const carga = () => {
  for (const f of ['micro.js', 'store.js', 'cloud.js']) delete require.cache[require.resolve(path.join(web, f))];
  require(path.join(web, 'micro.js'));
  const S = require(path.join(web, 'store.js'));
  return { store: S.Store, S, cloud: require(path.join(web, 'cloud.js')) };
};
const A = require(path.join(web, 'academic.js'));
const G = require(path.join(web, 'game.js'));
const H = require(path.join(web, 'historial.js'));
const porId = new Map(bank.map((q) => [q.id, q]));
const temaDe = (id) => (porId.get(id) || {}).topic || '';

(async () => {
const asorc = bank.filter((q) => q.asorc && q.asorc.eligible);
const [q1, q2, q3] = asorc;

// --- 1 · lo que se guarda por pregunta: lo justo, sin copiar el banco ------
const run = G.newRun({ total: 5, asorc: true });
run.academic = A.newState();
A.record(run.academic, { id: q1.id, result: 'correct', kind: 'single', k: 3, picked: [q1.asorc.correct_label], ms: 4200 });
const malaQ2 = q2.asorc.kept_option_labels.find((l) => l !== q2.asorc.correct_label);
A.record(run.academic, { id: q2.id, result: 'wrong', kind: 'single', k: 3, picked: [malaQ2], ms: 9000 });
A.record(run.academic, { id: q3.id, result: 'blank', kind: 'single', k: 3, picked: [], ms: 20000 });
const d = H.detalle(run, temaDe, 5);
eq(Object.keys(d.attempts[0]).sort(),
   ['answer', 'answerMs', 'question_id', 'result', 'scoreAfter', 'scoreDelta', 'topic'],
   'cada intento lleva exactamente esos siete campos');
eq(d.attempts.map((a) => a.question_id), [q1.id, q2.id, q3.id], 'en el orden en que se contestaron');
eq(d.attempts.map((a) => a.answer), [q1.asorc.correct_label, malaQ2, ''], 'y la respuesta que elegiste');
eq(d.attempts.map((a) => a.scoreDelta), [1, -0.5, 0], 'con lo que sumó o restó cada una');
eq(d.attempts.map((a) => a.scoreAfter), [1, 0.5, 0.5], 'y el acumulado tras ella');
eq(d.attempts.map((a) => a.answerMs), [4200, 9000, 20000], 'y su tiempo de respuesta');
eq(d.attempts[0].topic, q1.topic, 'y su tema');
eq([d.asorc, d.total, d.puntos], [true, 5, 0.5], 'y de la ronda: formato, tamaño y puntos');
const texto = JSON.stringify(d);
ok(!texto.includes((q2.question_es || q2.question).slice(0, 25)), 'el enunciado no se copia');
ok(!(q2.original_options || []).some((o) => o.text.length > 12 && texto.includes(o.text)),
   'ni el texto de las opciones');

// --- 2 · las sesiones de antes siguen ahí, sin detalle inventado ----------
const vieja = { ts: 1700000000, modo: 'Sprint de 20', respondidas: 20, correctas: 11, falladas: 6, blancos: 3 };
eq(H.tieneDetalle(vieja), false, 'una sesión vieja no tiene detalle');
eq(H.intentos(vieja), [], 'y no se le inventan intentos');
eq(H.clave(vieja), '1700000000|Sprint de 20|20', 'se identifica igual que al fundirla');
eq(H.clave({ uid: 'u-1', ts: 3 }), 'u-1', 'las nuevas, por su uid');

// --- 3 · filtros: todas, falladas, acertadas, en blanco -------------------
const at = (id, result, topic, extra) => Object.assign({ question_id: id, result, answer: '',
  scoreDelta: 0, scoreAfter: 0, answerMs: 1000, topic }, extra || {});
const s = { uid: 's1', ts: 200, modo: 'DNS + Correo electrónico', attempts: [
  at('Q1', 'correct', 'DNS'), at('Q2', 'wrong', 'Correo electrónico'), at('Q3', 'blank', 'DNS'),
  at('Q4', 'partial', 'DNS'), at('Q5', 'correct', 'Correo electrónico'), at('Q6', 'wrong', 'DNS') ] };
const todas = H.intentos(s);
eq(H.cuenta(todas), { todas: 6, falladas: 3, acertadas: 2, blanco: 1 }, 'cuenta de cada filtro');
eq(H.filtra(todas, 'falladas').map((a) => a.question_id), ['Q2', 'Q4', 'Q6'],
   'falladas: las incorrectas y las «a medias»');
eq(H.filtra(todas, 'acertadas').map((a) => a.question_id), ['Q1', 'Q5'], 'acertadas');
eq(H.filtra(todas, 'blanco').map((a) => a.question_id), ['Q3'], 'en blanco');

// --- 4 · desde el historial de un tema, solo lo de ese tema --------------
eq(H.intentos(s, { tema: 'DNS' }).map((a) => a.question_id), ['Q1', 'Q3', 'Q4', 'Q6'],
   'una sesión mixta abierta desde un tema enseña solo ese tema');
const sesiones = [
  vieja,
  { ts: 50, modo: 'DNS', respondidas: 5 },                                   // vieja, de ese tema
  { ts: 60, modo: 'DNS + Servidor web', respondidas: 5 },                    // vieja, mezcla con él
  { ts: 70, modo: 'Servidor web', respondidas: 5 },                          // vieja, de otro tema
  s,                                                                        // nueva, con DNS
  { uid: 's2', ts: 1800000000, modo: 'Sprint de 20', attempts: [at('Q9', 'correct', 'Servidor web')] },
];
eq(H.deTema(sesiones, 'DNS').map((x) => x.modo), ['DNS + Correo electrónico', 'DNS + Servidor web', 'DNS'],
   'historial del tema: las nuevas con preguntas suyas y las viejas lanzadas para él, las más recientes primero');
eq(H.ordenadas(sesiones)[0].uid, 's2', 'el historial general, de la más reciente a la más antigua');

// --- 5 · repasar las falladas y repetir el test ---------------------------
eq(H.paraRepasar(todas), ['Q2', 'Q4', 'Q6'], 'REPASAR ESTAS FALLADAS: solo las falladas');
eq(H.paraRepasar(H.intentos(s, { tema: 'DNS' })), ['Q4', 'Q6'], 'y desde un tema, solo las suyas');
eq(H.paraRepetir(todas), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'], 'REPETIR TEST: las mismas y en el mismo orden');
eq(H.paraRepetir([at('Q1', 'wrong'), at('Q1', 'correct')]), ['Q1'], 'sin repetir ninguna');

// --- 6 · lo que llega roto de la nube no rompe nada -----------------------
const rota = { uid: 'r', ts: 1, modo: 'X', attempts: [null, 5, { result: 'wrong' }, at('Q1', 'wrong', 'DNS')] };
eq(H.intentos(rota).length, 1, 'se ignora lo que no tiene forma de intento');
eq(H.deTema([rota], 'DNS').length, 1, 'y el filtro por tema no revienta');

// --- 7 · se guarda con la ronda y sobrevive a recargar --------------------
LS = almacen();
let { store } = carga();
await store.init({ base: './', ns: 'asorc.v2' });
const registro = Object.assign(G.sessionRecord(run), d);
await store.cerrarRonda(registro);
const uid = store.stats.sesiones[0].uid;
({ store } = carga());
await store.init({ base: './', ns: 'asorc.v2' });
const vuelta = store.stats.sesiones.find((x) => x.uid === uid);
eq(vuelta && vuelta.attempts, d.attempts, 'tras recargar, la sesión conserva sus intentos');
const { S } = carga();
eq(S.fusionaStats(store.stats, store.stats).sesiones.length, 1, 'fundirla consigo misma no la duplica');
eq(S.fusionaStats({ sesiones: [vieja] }, store.stats).sesiones.length, 2, 'y convive con las viejas');

// --- 8 · y viaja por asorc_sessions a otro navegador ----------------------
const tabla = [];
const sb = { from() { const q = {
  async upsert(filas) { filas.forEach((f) => { if (!tabla.some((x) => x.uid === f.uid)) tabla.push(f); }); return { error: null }; },
  select() { return q; }, eq() { return q; }, order() { return q; },
  async range() { return { data: tabla.slice(), error: null, status: 200 }; },
  async maybeSingle() { return { data: null, error: null }; } }; return q; } };
const vacia = () => ({ from() { const q = { async upsert() { return { error: null }; },
  select() { return q; }, eq() { return q; }, order() { return q; },
  async range() { return { data: [], error: null }; }, async maybeSingle() { return { data: null, error: null }; } };
  return q; } });
const a1 = carga();
LS = almacen();
await a1.store.init({ base: './', ns: 'asorc.v2' });
a1.cloud.store = a1.store; a1.cloud.estado = 'sincronizado'; a1.cloud.sinTarjetas = null;
a1.cloud.sb = { from(t) { return t === 'asorc_sessions' ? sb.from() : vacia().from(); } };
await a1.store.cerrarRonda(Object.assign(G.sessionRecord(run), H.detalle(run, temaDe, 5)));
await a1.cloud.flush();
eq(tabla.length, 1, 'la ronda llega a asorc_sessions');
eq(tabla[0].payload.attempts, d.attempts, 'con sus intentos dentro del payload');
LS = almacen();
const b1 = carga();
await b1.store.init({ base: './', ns: 'asorc.v2' });
b1.cloud.store = b1.store; b1.cloud.estado = 'sincronizado'; b1.cloud.sinTarjetas = null;
b1.cloud.sb = { from(t) { return t === 'asorc_sessions' ? sb.from() : vacia().from(); } };
const r = await b1.cloud.sincronizar(b1.store);
ok(r.ok, 'otro navegador sincroniza');
eq(b1.store.stats.sesiones.length, 1, 'y recibe la ronda');
eq(b1.store.stats.sesiones[0].attempts, d.attempts, 'con el mismo detalle, pregunta a pregunta');

// --- 9 · historial global: todas las rondas juntas, la más reciente primero --
{
  const ronda = (uid, ts, modo, extra) => Object.assign({ uid, ts, modo, respondidas: 2, correctas: 1,
    falladas: 1, blancos: 0, ms_respuesta: 20000, ms_explicacion: 10000, total: 2, puntos: 0.75,
    attempts: [at('Q1', 'correct', 'DNS'), at('Q2', 'wrong', 'Correo electrónico')] }, extra || {});
  const mezcla = [
    ronda('tema', 1790000100, 'Compartición de archivos'),
    ronda('sprint', 1790000500, 'Sprint de 20'),
    ronda('asorc', 1790000300, 'Solo ASORC', { asorc: true }),
    ronda('mezcla', 1790000900, 'DNS + Correo electrónico'),
    ronda('fallos', 1790000700, 'Repaso de fallos'),
    ronda('repetir', 1790001100, 'Repetir: Sprint de 20'),
    ronda('falladas', 1790000800, 'Falladas de «Solo ASORC»'),
    { ts: 1789999000, modo: 'Sprint de 50', respondidas: 50, correctas: 30, falladas: 15, blancos: 5,
      ms_respuesta: 500000, ms_explicacion: 300000 },              // vieja, sin detalle
  ];
  const barajadas = mezcla.slice().sort(() => 0.5 - Math.random());
  const g = H.global(barajadas);
  eq(g.length, mezcla.length, 'el historial global tiene todas las rondas, sin filtrar por tipo');
  eq(g.map((x) => x.modo), ['Repetir: Sprint de 20', 'DNS + Correo electrónico', 'Falladas de «Solo ASORC»',
    'Repaso de fallos', 'Sprint de 20', 'Solo ASORC', 'Compartición de archivos', 'Sprint de 50'],
    'temas, sprint, ASORC, mezclas, repasos y repeticiones juntos, de la más reciente a la más antigua');
  ok(g.every((x, i) => i === 0 || g[i - 1].ts >= x.ts), 'en orden cronológico inverso');
  eq(H.tieneDetalle(g[g.length - 1]), false, 'y la vieja sin detalle, en su sitio por fecha');
  eq(H.INICIALES, 10, 'se ven primero las 10 últimas');
  eq(H.global([null, 7, mezcla[0]]).length, 1, 'lo que no es una ronda no entra');
}

// --- 10 · lo que enseña cada entrada ---------------------------------------
{
  const r = H.resumen({ uid: 'x', ts: 1790000000, modo: 'Compartición de archivos', respondidas: 15,
    correctas: 10, falladas: 5, blancos: 0, ms_respuesta: 252000, ms_explicacion: 60000, total: 15,
    puntos: 8.75, xp: 100, mejor_racha: 4,
    attempts: Array.from({ length: 15 }, (_, i) => at('Q' + i, i < 10 ? 'correct' : 'wrong', 'Compartición de archivos')) });
  eq([r.modo, r.preguntas, r.ok, r.bad, r.blank, r.puntos], ['Compartición de archivos', 15, 10, 5, 0, 8.75],
     'modo, preguntas, ✓ ✗ ○ y puntos');
  eq(A.num(r.nota10), '5,83', 'nota sobre 10: 8,75 / 15 → 5,83');
  // La nota es la puntuación académica, no el porcentaje de aciertos.
  eq(r.nota10, A.nota10(8.75, 15), 'la nota es la de academic.js, la misma del resultado final');
  ok(Math.abs(r.nota10 - (10 / 15) * 10) > 0.5, 'y no el porcentaje de aciertos (10 de 15 serían 6,67)');
  const original = A.nota10;
  let llamadas = 0;
  A.nota10 = (p, t) => { llamadas++; return original(p, t); };
  H.resumen({ ts: 1, modo: 'X', total: 15, puntos: 8.75, attempts: [at('Q1', 'correct', 'DNS')] });
  A.nota10 = original;
  eq(llamadas, 1, 'la calcula Academic.nota10, no una copia de la fórmula');
  const sinPuntos = H.resumen({ ts: 1, modo: 'X', respondidas: 2, correctas: 1, falladas: 1, blancos: 0,
    total: 2, attempts: [at('Q1', 'correct', 'DNS', { scoreAfter: 1 }), at('Q2', 'wrong', 'DNS', { scoreAfter: 0.5 })] });
  eq([sinPuntos.puntos, A.num(sinPuntos.nota10)], [0.5, '2,50'],
     'sin «puntos» guardados, el acumulado tras la última pregunta');
  eq(H.resumen({ ts: 1, modo: 'X', total: 10, puntos: -3, attempts: [at('Q1', 'wrong', 'DNS')] }).nota10, 0,
     'con puntos negativos la nota es 0, no negativa');
  eq([r.duracionMs, Math.round(r.segPregunta * 10) / 10, r.xp, r.mejorRacha], [312000, 16.8, 100, 4],
     'duración, s/pregunta, XP y mejor racha');
  const v = H.resumen({ ts: 1789999000, modo: 'Sprint de 50', respondidas: 50, correctas: 30, falladas: 15,
    blancos: 5, ms_respuesta: 500000, ms_explicacion: 300000 });
  eq([v.detalle, v.preguntas, v.puntos, v.nota10, v.xp, v.mejorRacha], [false, 50, null, null, null, null],
     'una vieja no recibe puntos ni XP inventados');
  eq(v.duracionMs, 800000, 'pero sí enseña lo que guardaba');
}

// --- 11 · desde un tema, la nota es la de SUS preguntas -------------------
{
  const tercio = A.delta('wrong', 'single', 4);            // −1/3, tal cual lo guarda academic.js
  const cuarto = A.delta('wrong', 'single', 5);            // −1/4
  const mixta = { uid: 'mx', ts: 1790002000, modo: 'DNS + Correo electrónico', respondidas: 8,
    correctas: 3, falladas: 4, blancos: 1, total: 8, attempts: [
      at('Q1', 'correct', 'DNS', { scoreDelta: 1 }),
      at('Q2', 'wrong', 'Correo electrónico', { scoreDelta: cuarto }),
      at('Q3', 'wrong', 'DNS', { scoreDelta: tercio }),
      at('Q4', 'correct', 'Correo electrónico', { scoreDelta: 1 }),
      at('Q5', 'wrong', 'DNS', { scoreDelta: tercio }),
      at('Q6', 'blank', 'DNS', { scoreDelta: 0 }),
      at('Q7', 'wrong', 'DNS', { scoreDelta: tercio }),
      at('Q8', 'correct', 'DNS', { scoreDelta: 1 }) ] };
  mixta.puntos = mixta.attempts.reduce((p, a) => A.snap(p + a.scoreDelta), 0);
  const dns = H.notaDeTema(mixta, 'DNS');
  eq([dns.preguntas, dns.puntos], [6, 1],
     'DNS: sus 6 preguntas y la suma de sus scoreDelta (1 − ⅓ − ⅓ + 0 − ⅓ + 1 = 1)');
  eq(A.num(dns.nota10), '1,67', 'nota del tema: 1 / 6 → 1,67');
  const correo = H.notaDeTema(mixta, 'Correo electrónico');
  eq([correo.preguntas, correo.puntos, A.num(correo.nota10)], [2, 0.75, '3,75'],
     'Correo: −¼ + 1 = 0,75 sobre 2 → 3,75');
  const ronda = H.resumen(mixta);
  eq([ronda.puntos, ronda.preguntas, A.num(ronda.nota10)], [1.75, 8, '2,19'],
     'y la ronda completa, la suya: 1,75 / 8 → 2,19');
  ok(dns.nota10 !== ronda.nota10 && correo.nota10 !== ronda.nota10, 'la nota del tema no es la global');
  eq(A.snap(dns.puntos + correo.puntos), mixta.puntos, 'los puntos de los temas suman los de la ronda');
  eq(H.cuenta(H.intentos(mixta, { tema: 'DNS' })), { todas: 6, falladas: 3, acertadas: 2, blanco: 1 },
     'y su ✓ ✗ ○ es también solo el del tema');
  const original = A.nota10;
  let llamadas = 0;
  A.nota10 = (p, t) => { llamadas++; return original(p, t); };
  H.notaDeTema(mixta, 'DNS');
  A.nota10 = original;
  eq(llamadas, 1, 'la calcula Academic.nota10, igual que la global');
  const exacta = { uid: 'ex', ts: 1, attempts: [at('Q1', 'correct', 'X', { scoreDelta: 1 }),
    at('Q2', 'wrong', 'X', { scoreDelta: tercio }), at('Q3', 'wrong', 'X', { scoreDelta: tercio }),
    at('Q4', 'wrong', 'X', { scoreDelta: tercio })] };
  eq(H.notaDeTema(exacta, 'X').puntos, 0, 'sobre la rejilla de academic.js: 1 − ⅓ − ⅓ − ⅓ = 0 exacto');
  eq(H.notaDeTema({ uid: 'n', ts: 1, attempts: [at('Q1', 'wrong', 'X', { scoreDelta: -0.5 })] }, 'X').nota10, 0,
     'negativa, 0 como la global');
  eq(H.notaDeTema(mixta, 'Servidor web'), null, 'un tema sin preguntas en la ronda no tiene nota');
  eq(H.notaDeTema(vieja, 'DNS'), null, 'ni una ronda vieja: no se inventa');
  eq([dns.provisional, correo.provisional], [false, false], 'ronda completa: la nota del tema es definitiva');

  // Ronda incompleta (Esc en la 3 de 8): PROVISIONAL, solo sobre las realizadas.
  const incompleta = { uid: 'inc', ts: 1790003000, modo: 'DNS', respondidas: 3, correctas: 1, falladas: 2,
    blancos: 0, total: 8, puntos: 0.5, attempts: [
      at('Q1', 'wrong', 'DNS', { scoreDelta: -0.25 }), at('Q2', 'wrong', 'DNS', { scoreDelta: -0.25 }),
      at('Q3', 'correct', 'DNS', { scoreDelta: 1 })] };
  const prov = H.notaDeTema(incompleta, 'DNS');
  eq([prov.provisional, prov.preguntas, prov.puntos, A.num(prov.nota10)], [true, 3, 0.5, '1,67'],
     'incompleta: NOTA PROVISIONAL 1,67 sobre las 3 preguntas realizadas');
  ok(prov.provisional, 'aunque sea de un solo tema: por la etiqueta no se reconstruyen las que faltaban');
  eq(A.num(H.resumen(incompleta).nota10), '0,63', 'la de la ronda completa sigue sobre las 8 planificadas');
  const mezclaInc = { uid: 'mi', ts: 1790004000, modo: 'DNS + Correo electrónico', total: 10, puntos: 1.5,
    attempts: [at('Q1', 'correct', 'DNS', { scoreDelta: 1 }), at('Q2', 'wrong', 'Correo electrónico', { scoreDelta: -0.25 }),
      at('Q3', 'wrong', 'DNS', { scoreDelta: -0.25 }), at('Q4', 'correct', 'Correo electrónico', { scoreDelta: 1 }),
      at('Q5', 'blank', 'DNS', { scoreDelta: 0 })] };
  const pd = H.notaDeTema(mezclaInc, 'DNS'), pc = H.notaDeTema(mezclaInc, 'Correo electrónico');
  eq([pd.provisional, pd.preguntas, pd.puntos, pc.provisional, pc.preguntas, pc.puntos],
     [true, 3, 0.75, true, 2, 0.75], 'mezcla incompleta: cada tema, provisional y sobre lo suyo realizado');
  eq([H.incompleta(mixta), H.incompleta(incompleta), H.incompleta(vieja),
      H.incompleta({ uid: 'x', ts: 1, attempts: [at('Q1', 'correct', 'DNS')] })], [false, true, false, false],
     'incompleta: solo si tenía más preguntas de las contestadas');
}

// --- 12 · HISTORIAL DE ESTA PREGUNTA: los contadores de siempre -----------
{
  const p = { veces_vista: 8, aciertos: 3, fallos: 4, blancos: 1, parciales: 0 };
  const h = H.historico(p, null);
  eq([h.intentos, h.aciertos, h.fallos, h.blancos, h.parciales, h.respondidas], [8, 3, 4, 1, 0, 7],
     'intentos = aciertos + fallos + blancos + parciales; respondidas, sin los blancos');
  eq(Math.round(h.acierto * 100), 43, 'acierto histórico = aciertos ÷ respondidas: 3/7 → 43%, el blanco no cuenta');
  const tras = H.historico(p, 'wrong');
  eq([tras.intentos, tras.fallos, tras.respondidas], [9, 5, 8], 'justo tras responder ya cuenta el intento actual');
  eq([H.historico(p, 'blank').intentos, H.historico(p, 'blank').respondidas], [9, 7],
     'un blanco suma intento, no respondida');
  eq(H.historico(p, 'correct').aciertos, 4, 'un acierto, a los aciertos');
  const medias = H.historico({ aciertos: 1, fallos: 0, blancos: 0, parciales: 2 }, null);
  eq([medias.parciales, medias.intentos, medias.respondidas, Math.round(medias.acierto * 100)], [2, 3, 3, 33],
     'a medias: intento y respondida, pero no acierto');
  eq(H.historico(null, null), { aciertos: 0, fallos: 0, blancos: 0, parciales: 0, intentos: 0, respondidas: 0,
     acierto: null }, 'sin intentos, sin porcentaje');
  eq(H.historico(null, 'correct').acierto, 1, 'la primera vez, con la respuesta de ahora');
  eq(H.historico({ blancos: 2 }, null).acierto, null, 'solo blancos: sin porcentaje, no un 0%');
  // El mismo acierto que el panel (dash.js) para esa pregunta.
  const D = require(path.join(web, 'dash.js'));
  D.configurar({ store: { prog: () => p, marcada: () => false } });
  eq(D.resumen([{ id: 'Q' }]).acierto, h.acierto, 'el mismo porcentaje que el panel');
  // Contar el intento actual antes de registrarlo da lo mismo que después.
  LS = almacen();
  ({ store } = carga());
  await store.init({ base: './', ns: 'asorc.v2' });
  const id = q1.id;
  for (const res of ['correct', 'wrong', 'blank', 'wrong', 'partial']) {
    const antes = H.historico(store.prog(id), res);
    store.registrar({ id, result: res, answer: '', answerMs: 1000, reviewMs: 0, marked: false });
    eq(H.historico(store.prog(id), null), antes, `${res}: al registrarlo, los contadores quedan igual que se enseñaron`);
  }
  eq(H.historico(store.prog(id), null).intentos, store.prog(id).veces_vista, 'y los intentos son las veces vista');
}

console.log(JSON.stringify({ n: errs.length, errs: errs.slice(0, 10) }));
})().catch((e) => { console.log(JSON.stringify({ n: 1, errs: [String(e && e.stack || e)] })); });
"""


def test_historial():
    print("\n[14] Historial de tests: cada ronda, pregunta a pregunta, sin tabla nueva")
    js = os.path.join(PROJ, "web", "js")
    html = open(os.path.join(PROJ, "web", "index.html"), encoding="utf-8").read()
    app = open(os.path.join(js, "app.js"), encoding="utf-8").read()
    sql = open(os.path.join(PROJ, "supabase", "schema.sql"), encoding="utf-8").read()

    check("index.html carga historial.js antes que app.js",
          "js/historial.js" in html and html.index("js/historial.js") < html.index("js/app.js"))
    for ident in ("hist-rows", "hist-more", "hist", "hs-list", "hs-filtros", "hs-repasar",
                  "hs-repetir", "hs-old", "hs-back"):
        check(f"index.html tiene #{ident}", f'id="{ident}"' in html)
    check("las sesiones viejas lo dicen tal cual",
          "Esta sesión es anterior al historial detallado de preguntas." in html)
    # El historial global es la vista principal: debajo de REPASO RÁPIDO y
    # antes de TEMAS, con las 10 últimas y el resto a un botón.
    posiciones = [html.find('id="rq-home"'), html.find('id="hist-home"'), html.find("<h2>Temas</h2>")]
    check("el historial global va debajo de REPASO RÁPIDO y antes de TEMAS",
          -1 not in posiciones and posiciones == sorted(posiciones), str(posiciones))
    hist = open(os.path.join(js, "historial.js"), encoding="utf-8").read()
    check("y enseña el resto con VER TODO EL HISTORIAL", "VER TODO EL HISTORIAL" in hist
          and "VER TODO EL HISTORIAL" in html)
    check("sin otra fuente de datos: ST.stats.sesiones",
          "global(ctx.store.stats.sesiones)" in hist)
    # La nota, protagonista y de academic.js: NOTA x / 10 y PUNTOS x / N en la
    # lista y en grande en la cabecera; las viejas, sin nota inventada.
    check("la nota sale de academic.js, sin una copia de la fórmula",
          "Academic.nota10(" in hist and not re.search(r"/\s*\w+\s*\)\s*\*\s*10\b", hist))
    check("NOTA / 10 y PUNTOS / N en cada ronda nueva",
          all(t in hist for t in ("'NOTA'", "'/ 10'", "'PUNTOS'")))
    check("y en grande en la cabecera del detalle", 'id="hs-grade"' in html)
    check("las rondas viejas, sin nota inventada", "'sin nota académica'" in hist)
    # Desde un tema: primero la nota de SUS preguntas y, discreta, la de la
    # ronda completa.
    m = re.search(r"function pintaSesion\(\)\s*\{(.*?)\n  \}", hist, re.S)
    check("desde un tema, la nota del tema primero y «Ronda completa» debajo",
          bool(m) and "notaDeTema(s, tema)" in m.group(1) and "Ronda completa: " in m.group(1)
          and m.group(1).index("notaDeTema(s, tema)") < m.group(1).index("Ronda completa: "))
    # Ronda incompleta: la del tema es PROVISIONAL, dice sobre cuántas
    # preguntas realizadas va y no lleva el color de aprobado/suspenso.
    mn = re.search(r"function nota\(r, pre\)\s*\{(.*?)\n  \}", hist, re.S)
    mf = re.search(r"function fila\(s, tema\)\s*\{(.*?)\n  \}", hist, re.S)
    check("ronda incompleta: NOTA PROVISIONAL · N preguntas realizadas, sin color de aprobado",
          bool(mn) and bool(mf) and "'NOTA PROVISIONAL'" in mn.group(1) and "realizadas(r.preguntas)" in mn.group(1)
          and "else box.dataset.aprobado" in mn.group(1)
          and "'NOTA PROVISIONAL'" in mf.group(1) and "realizadas(t.preguntas)" in mf.group(1))
    # HISTORIAL DE ESTA PREGUNTA, de los contadores de siempre, en el test y
    # en el historial, sin fuente nueva.
    tpl = html[html.find('data-el="learn"'):html.find('data-el="nudge"')]
    check("la tarjeta tiene su bloque de historial de la pregunta, tras la explicación",
          'data-el="q-hist"' in tpl and tpl.find('data-el="insight-src"') < tpl.find('data-el="q-hist"')
          < tpl.find('data-el="micro-note"'))
    ce = re.search(r"const CARD_EL = new Set\(\[(.*?)\]\);", app, re.S)
    check("y se busca dentro de la tarjeta activa", bool(ce) and "'q-hist'" in ce.group(1))
    mp = re.search(r"function pintaHistorico\(\)\s*\{(.*?)\n\}", app, re.S)
    check("en el test: ST.prog más el intento actual, que aún no está registrado",
          bool(mp) and "Historial.historico(ST.prog(" in mp.group(1) and "S.q.done ? null : S.q.result" in mp.group(1))
    for fn in ("renderLearn", "gradeOpen"):
        mf = re.search(r"function " + fn + r"\([^)]*\)\s*\{(.*?)\n\}", app, re.S)
        check(f"{fn} lo pinta", bool(mf) and "pintaHistorico()" in mf.group(1)
              and (fn != "gradeOpen" or mf.group(1).index("pintaHistorico()") < mf.group(1).index("advance()")))
    check("en el historial: EN ESTA RONDA frente a HISTORIAL DE ESTA PREGUNTA",
          "'EN ESTA RONDA'" in hist and "'HISTORIAL DE ESTA PREGUNTA'" in hist
          and "historico(ctx.store.prog(q.id), null)" in hist)
    me = re.search(r"function explicacion\([^)]*\)\s*\{(.*?)\n  \}", hist, re.S)
    check("y lo enseña cualquier pregunta al desplegarla",
          bool(me) and "estadisticas(q, a)" in me.group(1))
    check("sin fuente nueva: nada de localStorage ni tablas en historial.js",
          "localStorage" not in hist and ".from(" not in hist)
    m = re.search(r"async function finishRun\(\)\s*\{(.*?)\n\}", app, re.S)
    check("al cerrar la ronda se guarda su detalle", bool(m) and "Historial.detalle(" in m.group(1)
          and "cerrarRonda(registro)" in m.group(1))
    # Ni tabla ni columna nueva: asorc_sessions sigue igual y el detalle va
    # dentro de su payload, que ya era JSONB.
    ms = re.search(r"create table if not exists public\.asorc_sessions \((.*?)\);", sql, re.S)
    columnas = re.findall(r"^\s*(\w+)\s", ms.group(1), re.M) if ms else []
    anadidas = re.findall(r"alter table public\.asorc_sessions\s+add column if not exists (\w+)", sql)
    check("sin tabla ni columna nueva: el detalle va en el payload JSONB de asorc_sessions",
          sql.count("create table if not exists") == 5
          and columnas == ["uid", "profile_id", "payload", "created_at"]
          and "jsonb" in ms.group(1) and set(anadidas) <= {"profile_id", "payload", "created_at"},
          f"{columnas} {anadidas}")

    if not shutil.which("node"):
        check("node disponible", False)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(HIST_TEST)
        script = f.name
    try:
        out = subprocess.run(["node", script, js, QJSON], capture_output=True, text=True, timeout=180)
        if out.returncode != 0:
            check("ejecución node", False, out.stderr.strip()[:400])
            return
        res = json.loads(out.stdout.strip().splitlines()[-1])
        check("intentos justos, viejas sin inventar, filtros, tema, repasar/repetir, nube, "
              "nota por tema e historial de cada pregunta",
              res["n"] == 0, " | ".join(res["errs"]))
    finally:
        os.unlink(script)


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
    test_nota()
    test_micro()
    test_historial()
    test_highlight()
    test_panel()
    test_publicacion()
    test_nube()

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
