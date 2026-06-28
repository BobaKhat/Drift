// Pre-baked demo library — ~20 recognizable songs across EDM / pop / indie / hip-hop.
// Audio features are hand-authored (plausible, spread across the energy×mood quadrants so
// the map looks alive); album art URLs are real iTunes artwork (600x600). NO SoundNet calls —
// these load instantly via ensureDemoLibrary() in src/lib/playlists.js.
//
// Feature scales match the Drift schema: energy/mood/danceability/acousticness/
// instrumentalness/speechiness/liveness are 0–100, bpm is raw, loudness is dB, duration is sec.

export const DEMO_TRACKS = [
  // —— EDM ——————————————————————————————————————————————
  { name: 'Levels', artist: 'Avicii', bpm: 126, energy: 88, mood: 82, danceability: 78, acousticness: 4, instrumentalness: 42, speechiness: 5, loudness: -5.2, liveness: 9, key: 'C#m', camelot: '12A', duration: 199, popularity: 90, art: 'Music211/v4/67/38/43/67384338-9ed7-fc68-5927-93f1fcf4705d/11UMGIM36900.rgb.jpg' },
  { name: 'Summer', artist: 'Calvin Harris', bpm: 128, energy: 80, mood: 76, danceability: 75, acousticness: 7, instrumentalness: 10, speechiness: 4, loudness: -4.8, liveness: 11, key: 'B', camelot: '1B', duration: 222, popularity: 85, art: 'Music211/v4/da/50/cc/da50cc80-3515-a38d-369b-0d700ffd249d/886444820448.jpg' },
  { name: 'Get Lucky', artist: 'Daft Punk', bpm: 116, energy: 72, mood: 86, danceability: 81, acousticness: 12, instrumentalness: 14, speechiness: 4, loudness: -6.1, liveness: 8, key: 'F#m', camelot: '11A', duration: 248, popularity: 88, art: 'Music115/v4/e8/43/5f/e8435ffa-b6b9-b171-40ab-4ff3959ab661/886443919266.jpg' },
  { name: "Don't You Worry Child", artist: 'Swedish House Mafia', bpm: 129, energy: 84, mood: 70, danceability: 70, acousticness: 6, instrumentalness: 8, speechiness: 5, loudness: -4.5, liveness: 14, key: 'F#m', camelot: '11A', duration: 212, popularity: 83, art: 'Music124/v4/6a/30/7d/6a307d9d-2d13-999a-3b9c-03221087f845/15UMGIM27846.rgb.jpg' },
  { name: 'Firestone', artist: 'Kygo', bpm: 114, energy: 64, mood: 60, danceability: 68, acousticness: 22, instrumentalness: 12, speechiness: 4, loudness: -6.8, liveness: 10, key: 'C#m', camelot: '12A', duration: 271, popularity: 80, art: 'Music116/v4/b5/69/ad/b569ad82-3ac0-54a8-bafc-baf349491541/0617465690853.jpg' },

  // —— Pop ——————————————————————————————————————————————
  { name: 'Blinding Lights', artist: 'The Weeknd', bpm: 171, energy: 80, mood: 72, danceability: 73, acousticness: 5, instrumentalness: 0, speechiness: 6, loudness: -5.9, liveness: 9, key: 'Fm', camelot: '4A', duration: 200, popularity: 96, art: 'Music125/v4/a6/6e/bf/a66ebf79-5008-8948-b352-a790fc87446b/19UM1IM04638.rgb.jpg' },
  { name: 'Levitating', artist: 'Dua Lipa', bpm: 103, energy: 76, mood: 88, danceability: 88, acousticness: 1, instrumentalness: 0, speechiness: 6, loudness: -3.8, liveness: 7, key: 'Bm', camelot: '10A', duration: 203, popularity: 92, art: 'Music116/v4/6c/11/d6/6c11d681-aa3a-d59e-4c2e-f77e181026ab/190295092665.jpg' },
  { name: 'As It Was', artist: 'Harry Styles', bpm: 174, energy: 70, mood: 66, danceability: 67, acousticness: 34, instrumentalness: 1, speechiness: 6, loudness: -5.3, liveness: 31, key: 'F#', camelot: '2B', duration: 167, popularity: 94, art: 'Music126/v4/2a/19/fb/2a19fb85-2f70-9e44-f2a9-82abe679b88e/886449990061.jpg' },
  { name: 'bad guy', artist: 'Billie Eilish', bpm: 135, energy: 43, mood: 56, danceability: 70, acousticness: 33, instrumentalness: 13, speechiness: 14, loudness: -10.9, liveness: 10, key: 'Gm', camelot: '6A', duration: 194, popularity: 91, art: 'Music115/v4/1a/37/d1/1a37d1b1-8508-54f2-f541-bf4e437dda76/19UMGIM05028.rgb.jpg' },
  { name: 'Billie Jean', artist: 'Michael Jackson', bpm: 117, energy: 62, mood: 60, danceability: 92, acousticness: 16, instrumentalness: 3, speechiness: 4, loudness: -7.0, liveness: 5, key: 'F#m', camelot: '11A', duration: 294, popularity: 89, art: 'Music115/v4/32/4f/fd/324ffda2-9e51-8f6a-0c2d-c6fd2b41ac55/074643811224.jpg' },

  // —— Indie ————————————————————————————————————————————
  { name: 'The Less I Know the Better', artist: 'Tame Impala', bpm: 117, energy: 55, mood: 50, danceability: 64, acousticness: 12, instrumentalness: 18, speechiness: 4, loudness: -6.5, liveness: 12, key: 'B', camelot: '1B', duration: 216, popularity: 87, art: 'Music221/v4/a0/9a/2c/a09a2ca3-a5a6-814b-0af7-640dc0aef0aa/091012682261.jpg' },
  { name: 'Do I Wanna Know?', artist: 'Arctic Monkeys', bpm: 85, energy: 52, mood: 30, danceability: 55, acousticness: 18, instrumentalness: 2, speechiness: 4, loudness: -7.4, liveness: 22, key: 'Gm', camelot: '6A', duration: 272, popularity: 86, art: 'Music211/v4/69/9c/b5/699cb5d6-115c-ff73-9d26-e57ea4350d72/887828031795.png' },
  { name: 'Skinny Love', artist: 'Bon Iver', bpm: 75, energy: 30, mood: 25, danceability: 35, acousticness: 85, instrumentalness: 6, speechiness: 4, loudness: -9.6, liveness: 13, key: 'C', camelot: '8B', duration: 240, popularity: 78, art: 'Music114/v4/21/2f/ea/212fea18-5fdc-ba4d-5dd7-1b07aaa88b67/656605211565.tif' },
  { name: 'Heat Waves', artist: 'Glass Animals', bpm: 81, energy: 53, mood: 45, danceability: 60, acousticness: 44, instrumentalness: 1, speechiness: 5, loudness: -7.0, liveness: 10, key: 'Bm', camelot: '10A', duration: 239, popularity: 93, art: 'Music115/v4/da/8b/77/da8b7731-6f4f-eacf-5e74-8b23389eefa1/20UMGIM03371.rgb.jpg' },
  { name: 'Electric Feel', artist: 'MGMT', bpm: 103, energy: 60, mood: 65, danceability: 75, acousticness: 9, instrumentalness: 22, speechiness: 5, loudness: -6.9, liveness: 9, key: 'Am', camelot: '8A', duration: 229, popularity: 82, art: 'Music112/v4/66/d8/08/66d808c0-24c9-9223-5692-7e4759ab207d/196871101424.jpg' },

  // —— Hip-hop ——————————————————————————————————————————
  { name: 'HUMBLE.', artist: 'Kendrick Lamar', bpm: 150, energy: 62, mood: 40, danceability: 90, acousticness: 4, instrumentalness: 0, speechiness: 35, loudness: -6.6, liveness: 10, key: 'F#m', camelot: '11A', duration: 177, popularity: 90, art: 'Music112/v4/ab/16/ef/ab16efe9-e7f1-66ec-021c-5592a23f0f9e/17UMGIM88793.rgb.jpg' },
  { name: "God's Plan", artist: 'Drake', bpm: 77, energy: 55, mood: 35, danceability: 75, acousticness: 6, instrumentalness: 0, speechiness: 12, loudness: -9.2, liveness: 55, key: 'G#m', camelot: '1A', duration: 199, popularity: 91, art: 'Music115/v4/bb/6d/8f/bb6d8f67-6d04-10b5-dd62-eb5809ac54fc/00602567879152.rgb.jpg' },
  { name: 'SICKO MODE', artist: 'Travis Scott', bpm: 155, energy: 58, mood: 38, danceability: 80, acousticness: 1, instrumentalness: 0, speechiness: 22, loudness: -3.7, liveness: 12, key: 'Cm', camelot: '5A', duration: 312, popularity: 89, art: 'Music125/v4/e7/49/8f/e7498f65-df8f-bead-d6e3-2a8d4d642a79/886447235317.jpg' },
  { name: 'Stronger', artist: 'Kanye West', bpm: 104, energy: 78, mood: 55, danceability: 78, acousticness: 3, instrumentalness: 0, speechiness: 13, loudness: -5.0, liveness: 38, key: 'D#m', camelot: '2A', duration: 312, popularity: 87, art: 'Music128/v4/39/25/2d/39252d65-2d50-b991-0962-f7a98a761271/00602517483507.rgb.jpg' },
  { name: 'EARFQUAKE', artist: 'Tyler, The Creator', bpm: 80, energy: 50, mood: 60, danceability: 70, acousticness: 26, instrumentalness: 0, speechiness: 10, loudness: -8.1, liveness: 24, key: 'F', camelot: '7B', duration: 190, popularity: 85, art: 'Music211/v4/6a/79/64/6a7964d9-276c-9064-336d-255e4e6d6cba/artwork.jpg' },
]

const ART_BASE = 'https://is1-ssl.mzstatic.com/image/thumb/'

// Expand the stored art path into a full 600x600 iTunes URL and shape each demo entry
// into a row that matches the Supabase `tracks` schema (so it upserts/plots like a real track).
export function demoTrackRows() {
  return DEMO_TRACKS.map(({ art, ...t }) => ({
    ...t,
    album: null,
    album_art_url: `${ART_BASE}${art}/600x600bb.jpg`,
    source: 'demo',
    status: 'analyzed',
    missing_features: null,
  }))
}
