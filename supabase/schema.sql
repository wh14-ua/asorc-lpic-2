-- =========================================================================
-- ASORC · sincronización del progreso de LPIC-2.  Un solo perfil, sin cuentas.
-- =========================================================================
--
-- Pégalo ENTERO en el editor SQL de Supabase (SQL Editor → New query → Run).
-- Es idempotente: puedes ejecutarlo las veces que quieras. No borra tablas ni
-- datos; si encuentra el esquema anterior (el que llevaba user_id), lo migra.
--
-- MODELO
--   No hay Auth, ni correo, ni usuarios. Hay UN progreso, el del perfil fijo
--   'default', y lo comparten todos los navegadores que abran la web. El
--   navegador entra con el rol anon usando la publishable key.
--
--   El histórico vive como REGISTRO DE EVENTOS en asorc_attempts: cada intento
--   lleva un event_id generado en el cliente, así que reenviarlo no duplica
--   nada. Los contadores del panel se derivan sumando esos eventos, nunca se
--   guardan sumados. Lo que no es un evento (la marca de repaso, la ronda a
--   medias) se resuelve por marca de tiempo: gana el cambio más reciente.
--   El repaso rápido también son eventos (asorc_card_events): fallar, marcar,
--   «la sabía», «dudé», «no la sabía». El mazo se rehace aplicándolos en orden.
--
-- RIESGO ASUMIDO
--   Sin autenticación y con la publishable key a la vista, cualquiera que
--   descubra la URL puede leer o cambiar este progreso. Es una decisión
--   deliberada: lo que hay aquí es «he acertado 67 de 380 preguntas».
--   Aun así los permisos son los mínimos que la web necesita:
--     · el histórico es de solo añadir (anon no puede modificarlo ni borrarlo);
--     · ninguna tabla concede DELETE;
--     · las políticas están atadas al perfil fijo 'default'.
--
--   NUNCA pongas en la web una sb_secret_, una service_role ni la contraseña
--   de la base de datos: saltan RLS. Aquí solo entra la publishable key.
-- =========================================================================


-- =========================================================================
-- 1 · TABLAS (con la forma definitiva; si ya existen, no se tocan aquí)
-- =========================================================================

-- Histórico. Un intento = una fila = un evento irrepetible.
create table if not exists public.asorc_attempts (
  event_id    text        primary key,
  profile_id  text        not null default 'default',
  question_id text        not null,
  result      text        not null,
  answer      text        not null default '',
  answer_ms   integer     not null default 0,
  review_ms   integer     not null default 0,
  marked      boolean     not null default false,
  answered_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Marcas de repaso. Estado, no evento: se resuelve por updated_at.
create table if not exists public.asorc_marks (
  profile_id  text        not null default 'default',
  question_id text        not null,
  marked      boolean     not null default true,
  updated_at  timestamptz not null default now(),
  primary key (profile_id, question_id)
);

-- Rondas terminadas. También eventos: el uid lo pone el cliente.
create table if not exists public.asorc_sessions (
  uid        text        primary key,
  profile_id text        not null default 'default',
  payload    jsonb       not null,
  created_at timestamptz not null default now()
);

-- Repaso rápido. Cada cosa que le pasa a una microtarjeta es un evento
-- irrepetible; el mazo se reconstruye aplicándolos en orden de event_at.
create table if not exists public.asorc_card_events (
  event_id    text        primary key,
  profile_id  text        not null default 'default',
  question_id text        not null,
  kind        text        not null,
  event_at    timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint asorc_card_events_kind_ck
    check (kind in ('fallo', 'marca', 'sabia', 'dude', 'nosabia'))
);

-- Ronda a medias. Una sola fila en todo el proyecto: id = 'main'.
create table if not exists public.asorc_pending (
  id         text        primary key,
  profile_id text        not null default 'default',
  payload    jsonb,
  updated_at timestamptz not null default now()
);


-- =========================================================================
-- 2 · MIGRACIÓN desde el esquema anterior (el que tenía user_id)
--     Cada paso comprueba antes de actuar, así que repetirlo no hace nada.
-- =========================================================================

-- 2.1 · attempts: el uid pasa a llamarse event_id.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'asorc_attempts'
                and column_name = 'uid')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'asorc_attempts'
                and column_name = 'event_id') then
    alter table public.asorc_attempts rename column uid to event_id;
  end if;
end $$;

-- 2.2 · las claves de evento eran uuid; ahora son texto, que es lo que el
--       navegador sabe generar sin depender de nada.
do $$
declare r record;
begin
  for r in select * from (values
      ('asorc_attempts', 'event_id'),
      ('asorc_sessions', 'uid'),
      ('asorc_marks',    'question_id'),
      ('asorc_pending',  'id')
    ) as t(tabla, col)
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.tabla
                  and column_name = r.col and data_type <> 'text') then
      execute format('alter table public.%I alter column %I type text using %I::text',
                     r.tabla, r.col, r.col);
    end if;
  end loop;
end $$;

-- 2.3 · columnas que falten, y fuera la del usuario.
alter table public.asorc_attempts add column if not exists profile_id  text        not null default 'default';
alter table public.asorc_attempts add column if not exists question_id text        not null default '';
alter table public.asorc_attempts add column if not exists result      text        not null default 'correct';
alter table public.asorc_attempts add column if not exists answer      text        not null default '';
alter table public.asorc_attempts add column if not exists answer_ms   integer     not null default 0;
alter table public.asorc_attempts add column if not exists review_ms   integer     not null default 0;
alter table public.asorc_attempts add column if not exists marked      boolean     not null default false;
alter table public.asorc_attempts add column if not exists answered_at timestamptz not null default now();
alter table public.asorc_attempts add column if not exists created_at  timestamptz not null default now();
alter table public.asorc_attempts drop column if exists user_id;

alter table public.asorc_marks    add column if not exists profile_id  text        not null default 'default';
alter table public.asorc_marks    add column if not exists marked      boolean     not null default true;
alter table public.asorc_marks    add column if not exists updated_at  timestamptz not null default now();
alter table public.asorc_marks    drop column if exists user_id;

alter table public.asorc_sessions add column if not exists profile_id  text        not null default 'default';
alter table public.asorc_sessions add column if not exists payload     jsonb;
alter table public.asorc_sessions add column if not exists created_at  timestamptz not null default now();
alter table public.asorc_sessions drop column if exists user_id;

alter table public.asorc_pending  add column if not exists id          text        not null default 'main';
alter table public.asorc_pending  add column if not exists profile_id  text        not null default 'default';
alter table public.asorc_pending  add column if not exists payload     jsonb;
alter table public.asorc_pending  add column if not exists updated_at  timestamptz not null default now();
alter table public.asorc_pending  drop column if exists user_id;

-- 2.4 · al quitar el usuario pueden quedar filas repetidas. Se conserva la
--       más reciente, que es la que el navegador habría acabado usando.
delete from public.asorc_marks a
 using public.asorc_marks b
 where a.profile_id = b.profile_id and a.question_id = b.question_id
   and (a.updated_at, a.ctid) < (b.updated_at, b.ctid);

delete from public.asorc_pending a
 using public.asorc_pending b
 where a.id = b.id
   and (a.updated_at, a.ctid) < (b.updated_at, b.ctid);

-- 2.5 · la clave primaria, si la que hay no es la que toca.
do $$
declare
  r      record;
  nombre text;
  actual text;
begin
  for r in select * from (values
      ('asorc_attempts', 'event_id'),
      ('asorc_marks',    'profile_id,question_id'),
      ('asorc_sessions', 'uid'),
      ('asorc_pending',  'id')
    ) as t(tabla, cols)
  loop
    select c.conname,
           (select string_agg(a.attname, ',' order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
      into nombre, actual
      from pg_constraint c
     where c.conrelid = ('public.' || r.tabla)::regclass and c.contype = 'p';

    if nombre is not null and actual is distinct from r.cols then
      execute format('alter table public.%I drop constraint %I', r.tabla, nombre);
      nombre := null;
    end if;
    if nombre is null then
      execute format('alter table public.%I add primary key (%s)', r.tabla, r.cols);
    end if;
  end loop;
end $$;

-- 2.6 · un intento solo puede acabar de cuatro maneras.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asorc_attempts_result_ck') then
    alter table public.asorc_attempts
      add constraint asorc_attempts_result_ck
      check (result in ('correct', 'wrong', 'blank', 'partial'));
  end if;
end $$;


-- =========================================================================
-- 3 · ÍNDICES
--     El panel pregunta siempre lo mismo: todos los intentos de este perfil,
--     en orden, para reconstruir los contadores.
-- =========================================================================
create index if not exists asorc_attempts_perfil_pregunta
  on public.asorc_attempts (profile_id, question_id);
create index if not exists asorc_attempts_cuando
  on public.asorc_attempts (profile_id, answered_at);
create index if not exists asorc_sessions_perfil
  on public.asorc_sessions (profile_id, created_at);
create index if not exists asorc_card_events_cuando
  on public.asorc_card_events (profile_id, event_at);


-- =========================================================================
-- 4 · CONVERGENCIA
--     Dos navegadores pueden tocar la misma marca. Gana el cambio más
--     reciente, y el que llega tarde se descarta en la base de datos, no en
--     el cliente: así da igual quién sincronice primero.
-- =========================================================================
create or replace function public.asorc_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;                      -- llega más viejo que lo guardado: se ignora
  end if;
  return new;
end $$;

drop trigger if exists asorc_marks_lww on public.asorc_marks;
create trigger asorc_marks_lww before update on public.asorc_marks
  for each row execute function public.asorc_lww();

drop trigger if exists asorc_pending_lww on public.asorc_pending;
create trigger asorc_pending_lww before update on public.asorc_pending
  for each row execute function public.asorc_lww();


-- =========================================================================
-- 5 · RLS
--     Activada en las cinco tablas. Nada de desactivarla como atajo.
-- =========================================================================
alter table public.asorc_attempts    enable row level security;
alter table public.asorc_marks       enable row level security;
alter table public.asorc_sessions    enable row level security;
alter table public.asorc_pending     enable row level security;
alter table public.asorc_card_events enable row level security;

-- Fuera cualquier política anterior (las del esquema con auth.uid() bloquearían
-- todo). Se quitan todas y se vuelven a crear las de abajo, que son las únicas.
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename like 'asorc\_%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---- histórico: leer y añadir. Ni modificar ni borrar. -------------------
create policy "attempts leer"   on public.asorc_attempts
  for select to anon using (profile_id = 'default');
create policy "attempts añadir" on public.asorc_attempts
  for insert to anon with check (profile_id = 'default');

-- ---- marcas: estado, se sobrescriben ------------------------------------
create policy "marks leer"      on public.asorc_marks
  for select to anon using (profile_id = 'default');
create policy "marks añadir"    on public.asorc_marks
  for insert to anon with check (profile_id = 'default');
create policy "marks cambiar"   on public.asorc_marks
  for update to anon using (profile_id = 'default') with check (profile_id = 'default');

-- ---- rondas cerradas: leer y añadir -------------------------------------
create policy "sessions leer"   on public.asorc_sessions
  for select to anon using (profile_id = 'default');
create policy "sessions añadir" on public.asorc_sessions
  for insert to anon with check (profile_id = 'default');

-- ---- repaso rápido: como el histórico, leer y añadir ---------------------
create policy "cards leer"      on public.asorc_card_events
  for select to anon using (profile_id = 'default');
create policy "cards añadir"    on public.asorc_card_events
  for insert to anon with check (profile_id = 'default');

-- ---- ronda a medias: una fila que se pisa a sí misma --------------------
create policy "pending leer"    on public.asorc_pending
  for select to anon using (profile_id = 'default' and id = 'main');
create policy "pending añadir"  on public.asorc_pending
  for insert to anon with check (profile_id = 'default' and id = 'main');
create policy "pending cambiar" on public.asorc_pending
  for update to anon using (profile_id = 'default' and id = 'main')
                  with check (profile_id = 'default' and id = 'main');


-- =========================================================================
-- 6 · PERMISOS
--     RLS filtra filas, pero el GRANT decide qué verbos existen siquiera.
--     Se parte de cero y se concede solo lo que la web usa de verdad.
-- =========================================================================
grant usage on schema public to anon;

revoke all on public.asorc_attempts    from anon, authenticated, public;
revoke all on public.asorc_marks       from anon, authenticated, public;
revoke all on public.asorc_sessions    from anon, authenticated, public;
revoke all on public.asorc_pending     from anon, authenticated, public;
revoke all on public.asorc_card_events from anon, authenticated, public;

grant select, insert         on public.asorc_attempts to anon;
grant select, insert, update on public.asorc_marks    to anon;
grant select, insert         on public.asorc_sessions to anon;
grant select, insert, update on public.asorc_pending  to anon;
grant select, insert         on public.asorc_card_events to anon;


-- =========================================================================
-- 7 · COMPROBACIÓN
--     Debe salir: cinco tablas con rowsecurity = true y trece políticas.
-- =========================================================================
select t.tablename,
       t.rowsecurity                                    as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = t.tablename) as politicas,
       (select string_agg(privilege_type, ', ' order by privilege_type)
          from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = t.tablename
           and g.grantee = 'anon')                      as permisos_anon
  from pg_tables t
 where t.schemaname = 'public' and t.tablename like 'asorc\_%'
 order by t.tablename;
