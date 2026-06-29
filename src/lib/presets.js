// Axis preset definitions + feature-value accessor shared between ExploreByPanel and DriftMap.

export const PRESET_KEYS = ['vibe', 'dancefloor', 'texture', 'vocal']

export const PRESETS = {
  vibe: {
    label: 'Vibe',
    yFeature: 'energy',           yLow: 'Chill',       yHigh: 'Intense',
    xFeature: 'mood',             xLow: 'Dark',        xHigh: 'Bright',
  },
  dancefloor: {
    label: 'Dancefloor',
    yFeature: 'bpm',              yLow: 'Slow',        yHigh: 'Fast',
    xFeature: 'danceability',     xLow: 'Mellow',      xHigh: 'Groovy',
  },
  texture: {
    label: 'Texture',
    yFeature: 'acousticness',     yLow: 'Electronic',  yHigh: 'Acoustic',
    xFeature: 'energy',           xLow: 'Chill',       xHigh: 'Intense',
  },
  vocal: {
    label: 'Vocal',
    yFeature: 'instrumentalness', yLow: 'Vocal',       yHigh: 'Instrumental',
    xFeature: 'speechiness',      xLow: 'Melodic',     xHigh: 'Spoken',
  },
}

export const ALL_FEATURES = [
  { key: 'energy',           label: 'Energy' },
  { key: 'mood',             label: 'Mood' },
  { key: 'danceability',     label: 'Danceability' },
  { key: 'bpm',             label: 'BPM' },
  { key: 'acousticness',     label: 'Acousticness' },
  { key: 'instrumentalness', label: 'Instrumentalness' },
  { key: 'speechiness',      label: 'Speechiness' },
  { key: 'liveness',         label: 'Liveness' },
]

// Semantic pole labels for every mappable feature (Decision Log §"Semantic vocabulary").
export const FEATURE_POLES = {
  energy:           { low: 'Chill',       high: 'Intense'      },
  mood:             { low: 'Dark',        high: 'Bright'       },
  bpm:              { low: 'Slow',        high: 'Fast'         },
  danceability:     { low: 'Mellow',      high: 'Groovy'       },
  acousticness:     { low: 'Electronic',  high: 'Acoustic'     },
  instrumentalness: { low: 'Vocal',       high: 'Instrumental' },
  speechiness:      { low: 'Melodic',     high: 'Spoken'       },
  liveness:         { low: 'Recorded',    high: 'Live'         },
}

// BPM is stored as a raw value (60–180 typical range). Normalize it to the same 0–100
// scale the other features use so the density-equalization and jitter math works uniformly.
export function getFeatureValue(track, feature) {
  if (feature === 'bpm') {
    const raw = track.bpm ?? 120
    return Math.max(0, Math.min(100, ((raw - 60) / 120) * 100))
  }
  return Math.max(0, Math.min(100, track[feature] ?? 50))
}

// Resolve to a concrete preset config from activePreset key + optional custom feature keys.
export function resolvePreset(activePreset, customXFeature, customYFeature) {
  if (activePreset === 'custom') {
    const xP = FEATURE_POLES[customXFeature] ?? { low: customXFeature, high: customXFeature }
    const yP = FEATURE_POLES[customYFeature] ?? { low: customYFeature, high: customYFeature }
    return {
      label: 'Custom',
      xFeature: customXFeature, xLow: xP.low, xHigh: xP.high,
      yFeature: customYFeature, yLow: yP.low, yHigh: yP.high,
    }
  }
  return PRESETS[activePreset] ?? PRESETS.vibe
}
