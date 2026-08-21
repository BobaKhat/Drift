// Read-only diagnostic probe for SoundNet (track-analysis.p.rapidapi.com).
// Standalone script — does not touch src/lib/soundnet.js, pipeline.js, or any cascade/import code.
//
// Usage: node scripts/soundnet-probe.js
//
// Mirrors the exact request shape src/lib/soundnet.js sends (same host, path, param names,
// and auth headers) but fires each hardcoded pair exactly once, serialized, with no
// cascade/variation logic — pure ground truth for what SoundNet returns.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load the same .env files Vite would, without pulling in a dotenv dependency
// the project doesn't have. Node 20.6+/22 ships process.loadEnvFile natively.
for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(join(__dirname, '..', envFile))
  } catch {
    // file may not exist — fine, keep trying the next one
  }
}

const RAPIDAPI_HOST = 'track-analysis.p.rapidapi.com'
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || process.env.VITE_RAPIDAPI_KEY

if (!RAPIDAPI_KEY) {
  console.error('No RapidAPI key found (checked RAPIDAPI_KEY and VITE_RAPIDAPI_KEY env vars).')
  process.exit(1)
}

// Probe's own per-request timeout. The app's real SOUNDNET_TIMEOUT_MS (src/lib/soundnet.js)
// is 10000ms, but the previous probe run showed misses regularly taking ~47s to resolve —
// well past that. 60000ms here is so slow misses have room to actually resolve instead of
// getting cut off, which is what we want to observe for this investigation.
const PROBE_TIMEOUT_MS = 60000

// Hardcoded, unmodified — no cascade, no comma-splitting, no lowercasing beyond what's
// explicitly written into a given case below (e.g. the lowercase variant IS the test).
const GROUPS = {
  A: [
    { label: 'control, unmodified', artist: 'Owl Vision', title: 'BL00D' },
    { label: 'lowercased', artist: 'owl vision', title: 'bl00d' },
    { label: '"- Original Mix" suffix', artist: 'Owl Vision', title: 'BL00D - Original Mix' },
    { label: '"(feat. Nobody)" suffix', artist: 'Owl Vision', title: 'BL00D (feat. Nobody)' },
    { label: 'second artist appended', artist: 'Owl Vision, Some Artist', title: 'BL00D' },
    { label: 'artist empty, combined into title', artist: '', title: 'Owl Vision BL00D' },
  ],
  B: [
    { label: 'diacritic, unmodified', artist: 'Tiësto', title: 'Adagio For Strings' },
    { label: 'diacritic stripped', artist: 'Tiesto', title: 'Adagio For Strings' },
    { label: 'diacritic, unmodified', artist: 'Rebūke', title: 'Along Came Polly' },
    { label: 'diacritic stripped', artist: 'Rebuke', title: 'Along Came Polly' },
  ],
  C: [
    { label: 'non-EDM catalog check', artist: 'The Weeknd', title: 'Blinding Lights' },
    { label: 'non-EDM catalog check', artist: 'Taylor Swift', title: 'Anti-Hero' },
    { label: 'non-EDM catalog check', artist: 'Kendrick Lamar', title: 'HUMBLE.' },
    { label: 'non-EDM catalog check', artist: 'Fleetwood Mac', title: 'Dreams' },
  ],
}

const DELAY_MS = 1500

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractRateLimitHeaders(headers) {
  const out = {}
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().startsWith('x-ratelimit-') || key.toLowerCase() === 'retry-after') {
      out[key] = value
    }
  }
  return out
}

function hasErrorKey(rawBody) {
  if (!rawBody) return null
  try {
    const parsed = JSON.parse(rawBody)
    return Object.prototype.hasOwnProperty.call(parsed, 'error')
  } catch {
    return 'unparseable'
  }
}

async function probeOne(group, pair) {
  const params = new URLSearchParams({ artist: pair.artist, song: pair.title })
  const queryString = params.toString()
  const requestUrl = `https://${RAPIDAPI_HOST}/pktx/analysis?${queryString}`

  console.log(`\n[probe] [${group}] ${pair.label} — artist="${pair.artist}" title="${pair.title}"`)
  console.log(`[probe] query string: ${queryString}`)
  console.log(`[probe] request URL:  ${requestUrl}`)

  const result = {
    group,
    label: pair.label,
    artist: pair.artist,
    title: pair.title,
    queryString,
    requestUrl,
    timestamp: new Date().toISOString(),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const res = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
      },
      signal: controller.signal,
    })

    const headers = Object.fromEntries(res.headers.entries())
    const rateLimitHeaders = extractRateLimitHeaders(res.headers)
    const rawBody = await res.text()
    const elapsedMs = Date.now() - startedAt

    result.status = res.status
    result.statusText = res.statusText
    result.elapsedMs = elapsedMs
    result.headers = headers
    result.rateLimitHeaders = rateLimitHeaders
    result.rawBody = rawBody
    result.hasErrorKey = hasErrorKey(rawBody)

    console.log(`[probe] status: ${res.status} ${res.statusText} (${elapsedMs}ms)`)
    console.log(`[probe] headers:`, JSON.stringify(headers, null, 2))
    if (Object.keys(rateLimitHeaders).length > 0) {
      console.log(`[probe] rate-limit / retry-after headers:`, JSON.stringify(rateLimitHeaders, null, 2))
    } else {
      console.log(`[probe] no x-ratelimit-* or retry-after headers present`)
    }
    console.log(`[probe] raw body: ${rawBody}`)
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    result.elapsedMs = elapsedMs
    result.error = err.name === 'AbortError' ? `timed out after ${PROBE_TIMEOUT_MS}ms` : `fetch failed: ${err.message}`
    result.hasErrorKey = null
    console.log(`[probe] request failed after ${elapsedMs}ms: ${result.error}`)
  } finally {
    clearTimeout(timer)
  }

  return result
}

async function main() {
  const newResults = []

  for (const group of Object.keys(GROUPS)) {
    const pairs = GROUPS[group]
    for (let i = 0; i < pairs.length; i++) {
      if (newResults.length > 0) await sleep(DELAY_MS)
      const result = await probeOne(group, pairs[i])
      newResults.push(result)
    }
  }

  const outputPath = join(__dirname, 'probe-output.json')
  let existing = []
  try {
    existing = JSON.parse(await readFile(outputPath, 'utf-8'))
    if (!Array.isArray(existing)) existing = []
  } catch {
    // no prior file — fine, start fresh
  }
  const combined = [...existing, ...newResults]
  await writeFile(outputPath, JSON.stringify(combined, null, 2))
  console.log(`\n[probe] appended ${newResults.length} results to ${outputPath} (${combined.length} total)`)

  for (const group of Object.keys(GROUPS)) {
    console.log(`\n[probe] summary — group ${group}:`)
    const rows = newResults
      .filter((r) => r.group === group)
      .map((r) => ({
        query: r.queryString,
        elapsedMs: r.elapsedMs,
        result: r.status == null ? `ERROR: ${r.error}` : r.hasErrorKey === false ? 'hit' : 'miss',
      }))
    console.table(rows)
  }
}

main()
