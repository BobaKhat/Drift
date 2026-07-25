-- Run this in your Supabase SQL editor to create the tracks table.
--
-- RLS: enabled on every table below, table-level (no per-row auth checks — Supabase Auth
-- isn't wired up yet, so there's no user identity for Postgres to check against). The goal
-- right now is stopping the anon key from wiping the database, not multi-tenant isolation —
-- that lands once real auth exists and rows can be scoped to auth.uid(). Until then:
--   tracks, playlists, playlist_tracks  — SELECT + INSERT only (shared cache/library data,
--                                          written by anyone's import, never edited in place).
--   sets, set_tracks, set_connections   — SELECT + INSERT + UPDATE (set builder edits saved
--                                          sets client-side, already scoped by user_id there).
--   No table grants DELETE to anon/authenticated — permanently wiping rows is a service-role-
--   only action (Supabase dashboard / migrations), never something the app itself should do.

create table if not exists public.tracks (
  id                uuid          default gen_random_uuid() primary key,
  name              text,
  artist            text,
  album             text,
  album_art_url     text,
  bpm               float,
  energy            float,
  mood              float,
  danceability      float,
  acousticness      float,
  instrumentalness  float,
  speechiness       float,
  loudness          float,
  liveness          float,
  key               text,
  camelot           text,
  duration          float,
  popularity        float,
  source            text          default 'soundnet',
  analyzed_at       timestamptz,
  status            text          default 'analyzed',
  missing_features  text[],
  preview_url       text
);

alter table public.tracks enable row level security;

drop policy if exists "tracks_select_all" on public.tracks;
create policy "tracks_select_all" on public.tracks
  for select
  to anon, authenticated
  using (true);

drop policy if exists "tracks_insert_all" on public.tracks;
create policy "tracks_insert_all" on public.tracks
  for insert
  to anon, authenticated
  with check (true);

-- `tracks` may predate this column; guarded add so older environments pick up the 30-second
-- preview URL (iTunes/Deezer) cached for Deck View playback (Slice 13, Decision #76).
alter table public.tracks add column if not exists preview_url text;

-- Playlists: one active on the map at a time. user_id is "demo" until auth lands.
create table if not exists public.playlists (
  id          uuid          default gen_random_uuid() primary key,
  name        text,
  created_at  timestamptz   default now(),
  user_id     text          default 'demo'
);

alter table public.playlists enable row level security;

drop policy if exists "playlists_select_all" on public.playlists;
create policy "playlists_select_all" on public.playlists
  for select
  to anon, authenticated
  using (true);

drop policy if exists "playlists_insert_all" on public.playlists;
create policy "playlists_insert_all" on public.playlists
  for insert
  to anon, authenticated
  with check (true);

-- Join table linking tracks into playlists (a track can live in many playlists).
create table if not exists public.playlist_tracks (
  id           uuid   default gen_random_uuid() primary key,
  playlist_id  uuid   references public.playlists(id) on delete cascade,
  track_id     uuid   references public.tracks(id)    on delete cascade
);

alter table public.playlist_tracks enable row level security;

drop policy if exists "playlist_tracks_select_all" on public.playlist_tracks;
create policy "playlist_tracks_select_all" on public.playlist_tracks
  for select
  to anon, authenticated
  using (true);

drop policy if exists "playlist_tracks_insert_all" on public.playlist_tracks;
create policy "playlist_tracks_insert_all" on public.playlist_tracks
  for insert
  to anon, authenticated
  with check (true);

-- Sets belong to a parent playlist (set builder only operates on the active playlist).
-- A set is one head song + a sequential chain (Decision Log #33). Persisted on
-- "Save & Complete" (Decision Log #57, #89 — sets are the core value, must survive sessions).
create table if not exists public.sets (
  id           uuid          default gen_random_uuid() primary key,
  playlist_id  uuid          references public.playlists(id) on delete cascade,
  name         text,
  created_at   timestamptz   default now(),
  updated_at   timestamptz   default now(),
  user_id      text          default 'demo'
);

alter table public.sets enable row level security;

drop policy if exists "sets_select_all" on public.sets;
create policy "sets_select_all" on public.sets
  for select
  to anon, authenticated
  using (true);

drop policy if exists "sets_insert_all" on public.sets;
create policy "sets_insert_all" on public.sets
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "sets_update_all" on public.sets;
create policy "sets_update_all" on public.sets
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- `sets` may have existed before this migration added its columns; guard the alter so
-- older environments pick up playlist_id without erroring on a fresh create above.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'sets') then
    alter table public.sets add column if not exists playlist_id uuid
      references public.playlists(id) on delete cascade;
  end if;
end $$;

-- Chain membership: one row per song in a set. `position` is the 1-based order (1 = head).
-- is_connected / group_id support orphan tracking (Slice 9); Slice 8 writes is_connected=true,
-- group_id=null for every row.
create table if not exists public.set_tracks (
  id            uuid    default gen_random_uuid() primary key,
  set_id        uuid    references public.sets(id)   on delete cascade,
  track_id      uuid    references public.tracks(id) on delete cascade,
  position      int,
  is_connected  boolean default true,
  group_id      text
);

alter table public.set_tracks enable row level security;

drop policy if exists "set_tracks_select_all" on public.set_tracks;
create policy "set_tracks_select_all" on public.set_tracks
  for select
  to anon, authenticated
  using (true);

drop policy if exists "set_tracks_insert_all" on public.set_tracks;
create policy "set_tracks_insert_all" on public.set_tracks
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "set_tracks_update_all" on public.set_tracks;
create policy "set_tracks_update_all" on public.set_tracks
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- Wires: one row per socket-to-socket connection between consecutive chain songs.
-- Slice 8 stores real bpm_delta but placeholder compatibility (tier 'strong') — real
-- scoring lands in Slice 11.
create table if not exists public.set_connections (
  id                 uuid   default gen_random_uuid() primary key,
  set_id             uuid   references public.sets(id)   on delete cascade,
  source_track_id    uuid   references public.tracks(id) on delete cascade,
  target_track_id    uuid   references public.tracks(id) on delete cascade,
  bpm_delta          float,
  key_relationship   text,
  compatibility_tier text   default 'strong'
);

alter table public.set_connections enable row level security;

drop policy if exists "set_connections_select_all" on public.set_connections;
create policy "set_connections_select_all" on public.set_connections
  for select
  to anon, authenticated
  using (true);

drop policy if exists "set_connections_insert_all" on public.set_connections;
create policy "set_connections_insert_all" on public.set_connections
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "set_connections_update_all" on public.set_connections;
create policy "set_connections_update_all" on public.set_connections
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Foreign-key reconciliation. Run last; safe to re-run.
--
-- Every `create table if not exists` above is a NO-OP on a database where the
-- table already exists — and that includes its foreign keys. So when an
-- `on delete cascade` is added to a create statement after the fact, it never
-- reaches an existing database, and re-running this file will not fix it. The
-- create statements above therefore describe a FRESH database only; they are
-- not a description of a live one.
--
-- This is not hypothetical. Probed against the live DB on 2026-07-14:
-- playlist_tracks predates the cascades declared on its playlist_id/track_id,
-- and both were still NO ACTION — so deleting any playlist failed with
-- `playlist_tracks_playlist_id_fkey`, and deleting any track failed with
-- `playlist_tracks_track_id_fkey`. Every other FK had cascaded correctly.
--
-- The block below is the part that actually converges an existing database on
-- the intent above: for each FK it adds a missing constraint, repairs one whose
-- ON DELETE isn't CASCADE, and leaves a correct one untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  fk      record;
  cname   text;
  cdel    "char";
begin
  for fk in
    select * from (values
      ('playlist_tracks', 'playlist_id',     'playlists'),
      ('playlist_tracks', 'track_id',        'tracks'),
      ('sets',            'playlist_id',     'playlists'),
      ('set_tracks',      'set_id',          'sets'),
      ('set_tracks',      'track_id',        'tracks'),
      ('set_connections', 'set_id',          'sets'),
      ('set_connections', 'source_track_id', 'tracks'),
      ('set_connections', 'target_track_id', 'tracks')
    ) as t(child, col, parent)
  loop
    -- Find the FK currently guarding child.col, if any, and how it behaves on delete.
    -- confdeltype: 'c' = cascade, 'a' = no action, 'r' = restrict, 'n' = set null.
    select c.conname, c.confdeltype
      into cname, cdel
      from pg_constraint c
      join pg_class     ch on ch.oid = c.conrelid
      join pg_namespace n  on n.oid  = ch.relnamespace
      join pg_attribute a  on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and n.nspname = 'public'
       and ch.relname = fk.child
       and a.attname  = fk.col
       and array_length(c.conkey, 1) = 1;

    if cname is not null and cdel = 'c' then
      null;  -- already correct
    else
      if cname is not null then
        execute format('alter table public.%I drop constraint %I', fk.child, cname);
      end if;
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete cascade',
        fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent);
      raise notice 'reconciled %.% -> %.id (on delete cascade)', fk.child, fk.col, fk.parent;
    end if;

    cname := null;  -- select-into leaves the previous value when no row matches
    cdel  := null;
  end loop;
end $$;
