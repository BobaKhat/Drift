import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { audioEngine } from '../lib/audioEngine'
import { resolvePreview } from '../lib/preview'
import { usePlaylistStore } from './usePlaylistStore'

// React layer over the shared audio engine (Slice 13). Lives inside PlaylistProvider so it can read
// the set `chain` (auto-advance) and `deckTrackId` (switch-and-play / stop-on-close). Exposes the
// coarse playback state + a `toggle` for the Deck play button; the disc reads currentTime straight
// off the engine via rAF. Slice 14 can read `engine.analyser` from here too.

const AudioCtx = createContext(null)

export function AudioProvider({ children }) {
  const { deckTrackId, openDeck, chain, activeTracks } = usePlaylistStore()
  const [snap, setSnap] = useState(() => audioEngine.getSnapshot())

  useEffect(() => audioEngine.subscribe(setSnap), [])

  // Latest chain/tracks for the ended/error callbacks, which capture no reactive scope.
  const chainRef = useRef(chain)
  useEffect(() => { chainRef.current = chain }, [chain])
  const tracksRef = useRef(activeTracks)
  useEffect(() => { tracksRef.current = activeTracks }, [activeTracks])

  const trackById = useCallback((id) => tracksRef.current.find((t) => t.id === id) ?? null, [])

  // Auto-advance: when a preview ends, play the next song in the set chain and open its deck so the
  // disc follows. Not in a chain (or last in it) → just stop (Slice 13 auto-advance).
  useEffect(() => {
    audioEngine.setOnEnded(async (endedId) => {
      const c = chainRef.current
      const i = c.indexOf(endedId)
      if (i !== -1 && i < c.length - 1) {
        const next = trackById(c[i + 1])
        if (next) {
          const url = await resolvePreview(next)
          if (url) { audioEngine.play(next.id, url); openDeck(next.id); return }
        }
      }
      audioEngine.stop()
    })
    return () => audioEngine.setOnEnded(null)
  }, [openDeck, trackById])

  // Expired-token resilience: Deezer preview URLs carry ~1-day tokens, so a cached one can 404. On a
  // load error, re-resolve the URL once (force, bypassing caches) and retry before giving up.
  const retriedRef = useRef(new Set())
  useEffect(() => {
    audioEngine.setOnError(async (id) => {
      if (!id || retriedRef.current.has(id)) return
      retriedRef.current.add(id)
      const track = trackById(id)
      if (!track) return
      const url = await resolvePreview(track, { force: true })
      if (url) audioEngine.play(id, url)
    })
    return () => audioEngine.setOnError(null)
  }, [trackById])

  // Switch-and-play (chosen over Decision #69's paused-open): opening a DIFFERENT song while a preview
  // is playing switches playback to it. Opening while paused/stopped leaves it paused. Closing the
  // deck (deckTrackId → null) stops playback — the disc is the only transport, so nothing else drives it.
  useEffect(() => {
    if (!deckTrackId) { audioEngine.stop(); return }
    if (audioEngine.getSnapshot().playing && deckTrackId !== audioEngine.currentTrackId) {
      const track = trackById(deckTrackId)
      if (track) {
        ;(async () => {
          const url = await resolvePreview(track)
          if (url) audioEngine.play(deckTrackId, url)
          else audioEngine.stop()
        })()
      }
    }
  }, [deckTrackId, trackById])

  // Deck play button: same track → pause/resume; a different (or fresh) track → resolve + play.
  const toggle = useCallback(async (track) => {
    if (!track) return
    const s = audioEngine.getSnapshot()
    if (s.trackId === track.id) {
      if (s.playing) audioEngine.pause()
      else audioEngine.resume()
      return
    }
    const url = await resolvePreview(track)
    if (url) audioEngine.play(track.id, url)
  }, [])

  const value = {
    currentTrackId: snap.trackId,
    isPlaying: snap.playing,
    duration: snap.duration,
    toggle,
    engine: audioEngine, // getCurrentTime for the disc rAF loop; analyser for Slice 14
  }
  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>
}

export function useAudio() {
  const ctx = useContext(AudioCtx)
  if (!ctx) throw new Error('useAudio must be used within AudioProvider')
  return ctx
}
