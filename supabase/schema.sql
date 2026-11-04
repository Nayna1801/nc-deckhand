-- Ejecuta este script entero en Supabase > SQL Editor (una sola vez).
-- Pensado para COMPARTIR proyecto con otras apps: todas las tablas llevan prefijo tcg_
-- y solo se referencia auth.users (los usuarios son compartidos entre apps; los datos no).
-- Cada usuario solo puede ver y modificar SUS filas (Row Level Security).

create table if not exists public.tcg_collection (
  user_id   uuid not null references auth.users (id) on delete cascade,
  card_id   text not null,
  quantity  integer not null check (quantity >= 0 and quantity <= 999),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- v2: versiones Foil / Promo y estado de conservación (idempotente: se puede re-ejecutar).
-- "quantity" son las copias Normal; el bulk (4ª copia en adelante) se calcula en la app.
alter table public.tcg_collection add column if not exists qty_foil  integer not null default 0 check (qty_foil  between 0 and 999);
alter table public.tcg_collection add column if not exists qty_promo integer not null default 0 check (qty_promo between 0 and 999);
alter table public.tcg_collection add column if not exists condition text not null default 'mint' check (condition in ('mint', 'played', 'damaged'));

create table if not exists public.tcg_decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 64),
  legend_ids text[] not null default '{}',
  main       jsonb not null default '{}'::jsonb,
  side       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists tcg_decks_user_idx on public.tcg_decks (user_id, updated_at desc);

alter table public.tcg_collection enable row level security;
alter table public.tcg_decks      enable row level security;

drop policy if exists "tcg_collection: owner full access" on public.tcg_collection;
create policy "tcg_collection: owner full access" on public.tcg_collection
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tcg_decks: owner full access" on public.tcg_decks;
create policy "tcg_decks: owner full access" on public.tcg_decks
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
