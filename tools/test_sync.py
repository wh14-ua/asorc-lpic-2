#!/usr/bin/env python3
"""Pruebas reales de la sincronización, de punta a punta.

Levanta PostgreSQL de verdad, le aplica `supabase/schema.sql`, pone delante un
PostgREST de verdad con el rol `anon` y una pasarela con forma de Supabase que
se puede desenchufar a mitad. Sobre eso corre `web/js/store.js` y
`web/js/cloud.js` sin tocarlos, con el cliente oficial de Supabase.

Comprueba lo que no se puede comprobar con un test de unidad: que una respuesta
llega sola, que sin red no se pierde, que al volver la red se envía sola, que
reenviar no duplica y que con la clave pública no se puede reescribir el
histórico.

Necesita: initdb (postgresql), docker, node y @supabase/supabase-js.
Si falta algo, se salta y lo dice. Nunca toca el Supabase real ni el progreso
real: todo vive en un directorio temporal que se borra al terminar.

    python3 tools/test_sync.py
"""
import base64
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGEN = "postgrest/postgrest:v12.2.3"
# Credenciales de usar y tirar para la base de datos que este script crea y
# borra en un directorio temporal. No abren nada: ni son un secreto ni tienen
# nada que ver con el proyecto de Supabase real.
SECRETO = "una-clave-de-pruebas-larga-que-no-vale-para-nada-0123456789"
USUARIO_API, CLAVE_API = "apiuser", "apipass"
CONTENEDOR = "asorc-test-postgrest-%d" % os.getpid()


def puerto_libre():
    """Puertos elegidos al vuelo: así dos pruebas a la vez no se estorban."""
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


PUERTO_PG, PUERTO_REST, PUERTO_PASARELA = puerto_libre(), puerto_libre(), puerto_libre()


def salta(motivo):
    print(f"[sync] se salta: {motivo}")
    sys.exit(0)


def binarios_pg():
    for base in ("/usr/lib/postgresql", "/usr/local/pgsql"):
        if not os.path.isdir(base):
            continue
        for v in sorted(os.listdir(base), reverse=True):
            b = os.path.join(base, v, "bin")
            if os.path.exists(os.path.join(b, "initdb")):
                return b
    if shutil.which("initdb"):
        return os.path.dirname(shutil.which("initdb"))
    return None


def jwt_anon():
    """Una anon key clásica: un JWT con role=anon. Es de pruebas y solo vale
    contra el PostgREST que levanta este script."""
    b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode()
    cabecera = b64({"alg": "HS256", "typ": "JWT"})
    cuerpo = b64({"role": "anon", "iss": "pruebas", "exp": int(time.time()) + 86400})
    firma = base64.urlsafe_b64encode(
        hmac.new(SECRETO.encode(), f"{cabecera}.{cuerpo}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{cabecera}.{cuerpo}.{firma}"


def espera(url, segundos=25):
    fin = time.time() + segundos
    while time.time() < fin:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.4)
    return False


def main():
    pg = binarios_pg()
    if not pg:
        salta("no hay PostgreSQL instalado (initdb)")
    if not shutil.which("docker"):
        salta("no hay docker")
    if subprocess.run(["docker", "info"], capture_output=True, timeout=40).returncode:
        salta("el demonio de docker no responde")
    if not shutil.which("node"):
        salta("no hay node")

    modulos = os.path.join(PROJ, "tools", "node_modules")
    if not os.path.isdir(os.path.join(modulos, "@supabase", "supabase-js")):
        salta("falta el cliente: cd tools && npm install @supabase/supabase-js")

    tmp = tempfile.mkdtemp(prefix="asorc-sync-")
    datos = os.path.join(tmp, "data")
    pasarela = None
    arrancado = False
    try:
        print("[sync] levantando PostgreSQL…")
        subprocess.run([os.path.join(pg, "initdb"), "-D", datos, "-U", "postgres",
                        "--auth=trust", "-E", "UTF8"], capture_output=True, check=True)
        r = subprocess.run([os.path.join(pg, "pg_ctl"), "-D", datos, "-l", os.path.join(tmp, "log"),
                            "-o", f"-k {tmp} -h 127.0.0.1 -p {PUERTO_PG}", "start"],
                           capture_output=True, text=True, timeout=60)
        if r.returncode:
            print("no arranca PostgreSQL:\n" + (r.stderr or r.stdout)[:800])
            sys.exit(1)
        arrancado = True

        psql = lambda *a: subprocess.run(
            ["psql", "-h", "127.0.0.1", "-p", str(PUERTO_PG), "-U", "postgres", "-q",
             "-v", "ON_ERROR_STOP=1"] + list(a),
            capture_output=True, text=True)

        r = psql("-d", "postgres", "-c", "create database e2e;", "-c", """
            do $$ begin
              if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
              if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
              if not exists (select 1 from pg_roles where rolname='apiuser') then create role apiuser login password 'apipass' noinherit; end if;
            end $$;
            grant anon to apiuser;""")
        if r.returncode:
            print(r.stderr[:500]); sys.exit(1)

        # --- el esquema, tal cual lo pegaría una persona en Supabase --------
        print("[sync] aplicando supabase/schema.sql…")
        r = psql("-d", "e2e", "-f", os.path.join(PROJ, "supabase", "schema.sql"))
        if r.returncode:
            print("FALLA schema.sql:\n" + r.stderr[:1500]); sys.exit(1)

        # Y otra vez, que tiene que ser idempotente.
        r = psql("-d", "e2e", "-f", os.path.join(PROJ, "supabase", "schema.sql"))
        if r.returncode:
            print("FALLA schema.sql al repetirlo:\n" + r.stderr[:1500]); sys.exit(1)
        print("[sync] schema.sql se puede ejecutar dos veces seguidas ✓")

        # --- PostgREST -----------------------------------------------------
        subprocess.run(["docker", "rm", "-f", CONTENEDOR], capture_output=True)
        subprocess.run([
            "docker", "run", "-d", "--name", CONTENEDOR, "--network", "host",
            "-e", f"PGRST_DB_URI=postgres://apiuser:apipass@127.0.0.1:{PUERTO_PG}/e2e",
            "-e", "PGRST_DB_SCHEMAS=public",
            "-e", "PGRST_DB_ANON_ROLE=anon",
            "-e", f"PGRST_SERVER_PORT={PUERTO_REST}",
            "-e", f"PGRST_JWT_SECRET={SECRETO}",
            IMAGEN], capture_output=True, check=True, timeout=120)
        if not espera(f"http://127.0.0.1:{PUERTO_REST}/"):
            print("PostgREST no arrancó"); sys.exit(1)

        # --- la pasarela con interruptor -----------------------------------
        pasarela = subprocess.Popen(
            ["node", os.path.join(PROJ, "tools", "sync_proxy.js"),
             str(PUERTO_PASARELA), str(PUERTO_REST)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not espera(f"http://127.0.0.1:{PUERTO_PASARELA}/rest/v1/"):
            print("la pasarela no arrancó"); sys.exit(1)

        # --- y ahora sí, las pruebas ---------------------------------------
        entorno = dict(os.environ, NODE_PATH=modulos)
        out = subprocess.run(
            ["node", os.path.join(PROJ, "tools", "sync_e2e.js"),
             os.path.join(PROJ, "web", "js"),
             f"http://127.0.0.1:{PUERTO_PASARELA}", jwt_anon()],
            env=entorno, timeout=300)
        sys.exit(out.returncode)
    finally:
        if pasarela:
            pasarela.terminate()
        subprocess.run(["docker", "rm", "-f", CONTENEDOR], capture_output=True)
        if arrancado:
            subprocess.run([os.path.join(pg, "pg_ctl"), "-D", datos, "stop", "-m", "immediate"],
                           capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
