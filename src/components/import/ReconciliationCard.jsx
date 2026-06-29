import { useState } from 'react'
import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, RADIUS } from './tokens'
import { ModalCard, PrimaryButton, SecondaryButton, wellStyle } from './pieces'

function defaultName() {
  const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Import – ${d}`
}

// One editable unresolved row. Prefills with the best variation attempted so the user
// refines from the closest hit rather than the raw pasted line.
function UnresolvedRow({ entry, onRetry }) {
  // Prefill from lastAttempt (the best variation tried), falling back to parsed values
  const [artist, setArtist] = useState(entry.lastAttempt?.artist ?? entry.artist)
  const [title, setTitle] = useState(entry.lastAttempt?.title ?? entry.title)
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
  const triedN = entry.triedVariations ?? 0

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
      {/* Original pasted line + retry hint */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary }}>
          {entry.originalText}
          {failed && <span style={{ color: C.amber }}>{'  · still not found'}</span>}
        </span>
        {triedN > 0 && !failed && (
          <span style={{ fontFamily: FONT, fontSize: 11, color: C.iconPrimary, whiteSpace: 'nowrap' }}>
            {`Tried ${triedN} variation${triedN !== 1 ? 's' : ''} — edit and retry`}
          </span>
        )}
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

// Amber warning card for a track where SoundNet matched via a variation and the returned
// duration differs from iTunes' duration for the original query by more than 15 seconds.
function VersionWarningRow({ w }) {
  return (
    <div
      style={{
        background: 'rgba(224,163,62,0.07)',
        border: `1px solid rgba(224,163,62,0.30)`,
        borderRadius: RADIUS.well,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: C.amber, fontSize: 13 }}>⚠</span>
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: C.amber }}>
          Matched a different version — verify this is correct
        </span>
      </div>
      <div style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary, lineHeight: 1.6 }}>
        <div>
          <span style={{ color: C.iconPrimary }}>Searched for: </span>
          <span style={{ color: C.textPrimary }}>{w.originalTitle ?? w.originalText}</span>
          {w.itunesDurationFmt && (
            <span style={{ color: C.iconPrimary }}>{`  (iTunes: ${w.itunesDurationFmt})`}</span>
          )}
        </div>
        <div>
          <span style={{ color: C.iconPrimary }}>SoundNet matched as: </span>
          <span style={{ color: C.textPrimary }}>
            {w.matchedQuery?.artist && w.matchedQuery?.title
              ? `${w.matchedQuery.artist} – ${w.matchedQuery.title}`
              : '—'}
          </span>
          {w.soundnetDurationFmt && (
            <span style={{ color: C.iconPrimary }}>{`  (${w.soundnetDurationFmt})`}</span>
          )}
        </div>
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
  const warnings = reconciliation?.warnings ?? []
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
        {warnings.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.amber }}>
            {`● ${warnings.length} song${warnings.length === 1 ? '' : 's'} matched a different version`}
          </span>
        )}
        {unresolved.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.amber }}>
            {`● ${unresolved.length} song${unresolved.length === 1 ? '' : 's'} couldn't be found`}
          </span>
        )}
      </div>

      {/* Version mismatch warnings — shown inline so the user can review before finishing */}
      {warnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {warnings.map((w, i) => (
            <VersionWarningRow key={w.originalText ?? i} w={w} />
          ))}
        </div>
      )}

      {/* Unresolved rows — prefilled with best variation attempted */}
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
