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
-- `sets` may not exist yet in early environments; guard the alter so this stays idempotent.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'sets') then
    alter table public.sets add column if not exists playlist_id uuid references public.playlists(id);
  end if;
end $$;
