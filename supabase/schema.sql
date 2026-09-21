-- ASORC · esquema mínimo para sincronizar entre dispositivos.
--
-- Idea: los INTENTOS son eventos con identificador generado en el cliente.
-- Sincronizar dos veces no duplica nada porque el uid ya existe. El progreso
-- y las estadísticas NO se guardan: se reconstruyen a partir de los intentos.
--
-- Ejecútalo en el editor SQL de Supabase.

-- ---------------------------------------------------------------- intentos
create table if not exists public.asorc_attempts (
  uid         uuid primary key,                       -- lo genera el cliente
  user_id     uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  result      text not null check (result in ('correct','wrong','blank','partial')),
  answer      text not null default '',
  answer_ms   integer not null default 0,
  review_ms   integer not null default 0,
  marked      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists asorc_attempts_user_q
  on public.asorc_attempts (user_id, question_id);

-- ------------------------------------------------------------------ marcas
create table if not exists public.asorc_marks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  marked      boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- --------------------------------------------------------- rondas cerradas
create table if not exists public.asorc_sessions (
  uid        text primary key,                        -- también del cliente
  user_id    uuid not null references auth.users(id) on delete cascade,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------- ronda a medias
create table if not exists public.asorc_pending (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb,
  updated_at timestamptz not null default now()
);

-- =========================================================================
-- RLS: cada usuario, y solo cada usuario, toca sus filas.
-- Nada de using (true): el sitio es público.
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
    execute format('drop policy if exists "solo lo mio select" on public.%I', t);
    execute format('drop policy if exists "solo lo mio insert" on public.%I', t);
    execute format('drop policy if exists "solo lo mio update" on public.%I', t);
    execute format('drop policy if exists "solo lo mio delete" on public.%I', t);

    execute format('create policy "solo lo mio select" on public.%I
                    for select using (auth.uid() = user_id)', t);
    execute format('create policy "solo lo mio insert" on public.%I
                    for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "solo lo mio update" on public.%I
                    for update using (auth.uid() = user_id)
                    with check (auth.uid() = user_id)', t);
    execute format('create policy "solo lo mio delete" on public.%I
                    for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
