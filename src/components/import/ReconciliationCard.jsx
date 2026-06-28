import { useState } from 'react'
import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, RADIUS } from './tokens'
import { ModalCard, PrimaryButton, SecondaryButton, wellStyle } from './pieces'

function defaultName() {
  const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Import – ${d}`
}

// One editable unresolved row: shows the original pasted line, lets the user fix
// artist/title, and retry. On success the parent removes it (store moves it to mapped).
function UnresolvedRow({ entry, onRetry }) {
  const [artist, setArtist] = useState(entry.artist)
  const [title, setTitle] = useState(entry.title)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function retry() {
    if (!artist.trim() || !title.trim()) { setFailed(true); return }
    setBusy(true)
    setFailed(false)
    const ok = await onRetry(entry.originalText, artist.trim(), title.trim())
    if (!ok) { setFailed(true); setBusy(false) }
    // on success this row unmounts, so no state cleanup needed
  }

  const smallInput = { ...wellStyle, flex: 1, fontSize: 13, padding: '8px 10px' }

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS.well,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary }}>
        {entry.originalText}
        {failed && <span style={{ color: C.amber }}>{'  · still not found'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" style={smallInput} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={smallInput} />
        <button
          onClick={retry}
          disabled={busy}
          style={{
            height: 38,
            padding: '0 16px',
            borderRadius: RADIUS.pill,
            background: 'transparent',
            border: `1px solid ${C.accent1}`,
            color: C.accent1,
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 500,
            cursor: busy ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {busy ? '…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}

// Reconciliation summary (composed from toolkit song-row + match-card patterns).
export default function ReconciliationCard() {
  const { reconciliation, finishReconcile, goImportStep, retry } = usePlaylistStore()
  const [name, setName] = useState(defaultName)

  const mapped = reconciliation?.mapped ?? []
  const unresolved = reconciliation?.unresolved ?? []
  const canFinish = mapped.length > 0

  return (
    <ModalCard width={570} style={{ gap: 24, alignItems: 'stretch' }}>
      <h1 style={{ fontFamily: FONT, fontSize: 28, fontWeight: 600, color: C.textPrimary, letterSpacing: '-1px', margin: 0 }}>
        Your map is ready
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary }}>Playlist name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...wellStyle, height: 44 }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 14, color: C.green }}>
          {`● ${mapped.length} song${mapped.length === 1 ? '' : 's'} mapped`}
        </span>
        {unresolved.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.amber }}>
            {`● ${unresolved.length} song${unresolved.length === 1 ? '' : 's'} couldn’t be found`}
          </span>
        )}
      </div>

      {unresolved.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
          {unresolved.map((u) => (
            <UnresolvedRow key={u.originalText} entry={u} onRetry={retry} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 15 }}>
        <SecondaryButton onClick={() => goImportStep('steps')} style={{ flex: 1 }}>
          Back
        </SecondaryButton>
        <PrimaryButton
          onClick={() => finishReconcile(name.trim() || defaultName(), mapped.map((t) => t.id))}
          disabled={!canFinish}
          style={{ flex: 1 }}
        >
          Done
        </PrimaryButton>
      </div>
    </ModalCard>
  )
}
