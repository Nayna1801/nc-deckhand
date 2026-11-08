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

-- v3: copias por arte alternativo o promo con diseño propio, como {"clave del arte": copias}.
-- Las cartas base (Beta, Retail…) siguen contando en quantity/qty_foil/qty_promo; aquí solo los diseños distintos.
alter table public.tcg_collection add column if not exists arts jsonb not null default '{}'::jsonb;
alter table public.tcg_collection drop constraint if exists tcg_collection_arts_shape;
alter table public.tcg_collection add constraint tcg_collection_arts_shape check (jsonb_typeof(arts) = 'object' and pg_column_size(arts) < 4000);

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

-- Lista de deseos manual: cartas que el usuario quiere conseguir, estén o no en un mazo.
-- quantity = copias que quiere conseguir.
create table if not exists public.tcg_wishlist (
  user_id    uuid not null references auth.users (id) on delete cascade,
  card_id    text not null,
  quantity   integer not null default 1 check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- v4: álbum de cartas (Colección > Álbum): una fila por usuario con el álbum entero (páginas, bolsillos y cartas colocadas)
-- para que se vea igual en todos sus dispositivos. La app sigue funcionando sin esta tabla (guarda el álbum en el navegador).
create table if not exists public.tcg_album (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.tcg_album drop constraint if exists tcg_album_shape;
alter table public.tcg_album add constraint tcg_album_shape check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 400000);

-- Validación también en el servidor (el navegador se puede saltar llamando a la API directamente).
alter table public.tcg_collection drop constraint if exists tcg_collection_card_id_len;
alter table public.tcg_collection add constraint tcg_collection_card_id_len check (char_length(card_id) between 1 and 100);
alter table public.tcg_wishlist   drop constraint if exists tcg_wishlist_card_id_len;
alter table public.tcg_wishlist   add constraint tcg_wishlist_card_id_len check (char_length(card_id) between 1 and 100);
alter table public.tcg_decks      drop constraint if exists tcg_decks_shape;
alter table public.tcg_decks      add constraint tcg_decks_shape check (
  jsonb_typeof(main) = 'object' and jsonb_typeof(side) = 'object'
  and cardinality(legend_ids) <= 3
  and pg_column_size(main) < 20000 and pg_column_size(side) < 20000
);

alter table public.tcg_collection enable row level security;
alter table public.tcg_decks      enable row level security;
alter table public.tcg_wishlist   enable row level security;
alter table public.tcg_album      enable row level security;

drop policy if exists "tcg_wishlist: owner full access" on public.tcg_wishlist;
create policy "tcg_wishlist: owner full access" on public.tcg_wishlist
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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

drop policy if exists "tcg_album: owner full access" on public.tcg_album;
create policy "tcg_album: owner full access" on public.tcg_album
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
