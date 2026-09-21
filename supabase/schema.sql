-- ASORC · progreso ÚNICO y COMPARTIDO, sin cuentas.
--
-- Decisión deliberada: no hay Auth, no hay usuarios ni columna de propietario. Cualquiera
-- que abra la web comparte el mismo progreso. Lo que se guarda aquí es
-- «he acertado 67 de 380 preguntas de LPIC-2», y el riesgo asumido es que
-- alguien que descubra la URL pueda leerlo o cambiarlo.
--
-- El navegador entra con el rol anon usando la publishable key. Las políticas
-- son públicas a propósito: using (true) / with check (true).
-- NUNCA uses aquí una sb_secret_ ni una service_role: saltan RLS y no pintan
-- nada en una web.
--
-- Pégalo entero en el editor SQL de Supabase. Es idempotente: se puede
-- ejecutar las veces que haga falta.

-- Fuera el esquema anterior, que llevaba columna de usuario y no tiene datos que salvar.
drop table if exists public.asorc_attempts cascade;
drop table if exists public.asorc_marks    cascade;
drop table if exists public.asorc_sessions cascade;
drop table if exists public.asorc_pending  cascade;

-- ------------------------------------------------- intentos (log de eventos)
-- El uid lo genera el cliente, así que sincronizar dos veces no duplica nada.
create table public.asorc_attempts (
  uid         text primary key,
  question_id text not null,
  result      text not null check (result in ('correct','wrong','blank','partial')),
  answer      text not null default '',
  answer_ms   integer not null default 0,
  review_ms   integer not null default 0,
  marked      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index asorc_attempts_q on public.asorc_attempts (question_id);

-- ------------------------------------------------------------------ marcas
-- Una fila por pregunta: la marca es global, como todo lo demás.
create table public.asorc_marks (
  question_id text primary key,
  marked      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- --------------------------------------------------------- rondas cerradas
create table public.asorc_sessions (
  uid        text primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------- ronda a medias: una sola, id = 'main'
create table public.asorc_pending (
  id         text primary key,
  payload    jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- RLS abierta al rol anon, a propósito.
-- =========================================================================
alter table public.asorc_attempts enable row level security;
alter table public.asorc_marks    enable row level security;
alter table public.asorc_sessions enable row level security;
alter table public.asorc_pending  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['asorc_attempts','asorc_marks','asorc_sessions','asorc_pending']
  loop
    execute format('drop policy if exists "acceso publico" on public.%I', t);
    execute format('create policy "acceso publico" on public.%I
                    as permissive for all to anon, authenticated
                    using (true) with check (true)', t);
  end loop;
end $$;

-- Comprobación rápida: debe devolver cuatro filas con rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename like 'asorc_%'
order by tablename;
