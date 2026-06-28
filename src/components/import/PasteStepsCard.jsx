import { useState } from 'react'
import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT } from './tokens'
import { ModalCard, PrimaryButton, SecondaryButton, wellStyle } from './pieces'

const STEPS = [
  'In Spotify, open a playlist. Click the first song, hold ⇧ Shift and click the last to select all.',
  'Copy with ⌘ C and paste below.',
  'Orion matches each song and maps it. We’ll flag anything we can’t find.',
]

// Paste-your-tracklist card (Figma node 753:4404). 3-step guide + textarea + Back / Map my music.
export default function PasteStepsCard() {
  const { goImportStep, runPaste } = usePlaylistStore()
  const [text, setText] = useState('')
  const [error, setError] = useState(null)

  function handleMap() {
    if (!text.trim()) {
      setError('Paste at least one song')
      return
    }
    runPaste(text)
  }

  return (
    <ModalCard width={570} style={{ gap: 24, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>
        <h1 style={{ fontFamily: FONT, fontSize: 32, fontWeight: 600, color: C.textPrimary, letterSpacing: '-1.6px', margin: 0 }}>
          Paste your tracklist
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
          <ol style={{ margin: 0, paddingLeft: 21, fontFamily: FONT, fontSize: 14, fontWeight: 400, color: C.textSecondary, lineHeight: 1.5 }}>
            {STEPS.map((s, i) => (
              <li key={i} style={{ marginBottom: i < STEPS.length - 1 ? 0 : undefined }}>{s}</li>
            ))}
          </ol>

          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
            placeholder="Artist – Title or Spotify link, one per line"
            style={{ ...wellStyle, height: 126 }}
          />

          {error && (
            <span style={{ fontFamily: FONT, fontSize: 12, color: C.accent1 }}>{error}</span>
          )}

          <div style={{ display: 'flex', gap: 15, width: '100%' }}>
            <SecondaryButton onClick={() => goImportStep('welcome')} style={{ flex: 1, padding: '0 30px' }}>
              Back
            </SecondaryButton>
            <PrimaryButton onClick={handleMap} style={{ flex: 1, padding: '0 30px' }}>
              Map my music
            </PrimaryButton>
          </div>
        </div>
      </div>
    </ModalCard>
  )
}
