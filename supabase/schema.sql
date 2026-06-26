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
