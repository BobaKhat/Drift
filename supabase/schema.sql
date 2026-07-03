-- Run this in your Supabase SQL editor to create the tracks table.
-- RLS is disabled for dev; enable and add policies before going public.

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
  missing_features  text[]
);

alter table public.tracks disable row level security;

-- Playlists: one active on the map at a time. user_id is "demo" until auth lands.
create table if not exists public.playlists (
  id          uuid          default gen_random_uuid() primary key,
  name        text,
  created_at  timestamptz   default now(),
  user_id     text          default 'demo'
);

alter table public.playlists disable row level security;

-- Join table linking tracks into playlists (a track can live in many playlists).
create table if not exists public.playlist_tracks (
  id           uuid   default gen_random_uuid() primary key,
  playlist_id  uuid   references public.playlists(id) on delete cascade,
  track_id     uuid   references public.tracks(id)    on delete cascade
);

alter table public.playlist_tracks disable row level security;

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

alter table public.sets disable row level security;

-- `sets` may have existed before this migration added its columns; guard the alter so
-- older environments pick up playlist_id without erroring on a fresh create above.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'sets') then
    alter table public.sets add column if not exists playlist_id uuid references public.playlists(id);
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

alter table public.set_tracks disable row level security;

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

alter table public.set_connections disable row level security;
