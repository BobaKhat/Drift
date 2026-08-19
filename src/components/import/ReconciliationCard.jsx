import { useState } from 'react'
import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, RADIUS } from './tokens'
import { ModalCard, PrimaryButton, SecondaryButton, wellStyle } from './pieces'

function defaultName() {
  const d = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Import – ${d}`
}

// Cap manual retries so a persistently-missing track lands on a clear terminal state instead
// of letting the user spin the SoundNet lookup forever. Editing artist/title resets the cap.
const MAX_RETRIES = 2

// One editable unresolved row. Prefills with the ORIGINAL artist/title (not the last
// variation SoundNet tried) so the user edits from what they actually pasted; the list of
// variations already attempted is available as hover detail on the row.
function UnresolvedRow({ entry, onRetry }) {
  // Prefill from the original parsed artist/title.
  const [artist, setArtist] = useState(entry.artist)
  const [title, setTitle] = useState(entry.title)

  // Hover detail: the exact queries the cascade already tried, so a manual edit doesn't
  // repeat one. Native title tooltip — undefined when there's nothing to show.
  const variations = entry.variations ?? []
  const triedTooltip = variations.length
    ? `Already tried:\n${variations.map((v) => `${v.artist} – ${v.title}`).join('\n')}`
    : undefined
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const exhausted = attempts >= MAX_RETRIES

  async function retry() {
    if (!artist.trim() || !title.trim()) { setFailed(true); return }
    setBusy(true)
    setFailed(false)
    // onRetry now applies the same miss-detection + a 6s SoundNet timeout as the import path,
    // so it always settles. Guard anyway: a thrown promise must never leave the row spinning.
    let ok = false
    try {
      ok = await onRetry(entry.originalText, artist.trim(), title.trim())
    } catch (err) {
      console.error('[drift] retry failed:', err)
    }
    if (!ok) { setFailed(true); setAttempts((a) => a + 1); setBusy(false) }
    // on success this row unmounts, so no state cleanup needed
  }

  // Any edit re-arms the row: clear the failed/terminal state and reset the retry cap so a
  // corrected artist/title can be resubmitted. The edited values are what retry() sends.
  const onEdit = (setter) => (e) => {
    setter(e.target.value)
    setFailed(false)
    setAttempts(0)
  }

  const smallInput = { ...wellStyle, flex: 1, fontSize: 13, padding: '8px 10px' }
  // triedVariations now counts distinct queries including the original, so only advertise
  // when a real variation beyond the original actually ran (> 1).
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
      {/* Original pasted line + retry hint (hover shows the variations already tried) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span title={triedTooltip} style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary, cursor: triedTooltip ? 'help' : 'default' }}>
          {entry.originalText}
          {exhausted
            ? <span style={{ color: C.amber }}>{'  · not found in SoundNet — edit artist/title and resubmit'}</span>
            : failed && <span style={{ color: C.amber }}>{'  · still not found'}</span>}
        </span>
        {!failed && !exhausted && (
          entry.kind === 'url'
            ? <span style={{ fontFamily: FONT, fontSize: 11, color: C.iconPrimary, whiteSpace: 'nowrap' }}>
                {"Couldn't resolve link — add artist & title and retry"}
              </span>
            : triedN > 1 && (
                <span style={{ fontFamily: FONT, fontSize: 11, color: C.iconPrimary, whiteSpace: 'nowrap' }}>
                  {`Tried ${triedN} variations — edit and retry`}
                </span>
              )
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={artist} onChange={onEdit(setArtist)} placeholder="Artist" style={smallInput} />
        <input value={title} onChange={onEdit(setTitle)} placeholder="Title" style={smallInput} />
        <button
          onClick={retry}
          disabled={busy || exhausted}
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
            opacity: exhausted ? 0.45 : 1,
            cursor: busy ? 'wait' : exhausted ? 'not-allowed' : 'pointer',
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

  // Split the unresolved summary so a transient link-resolution failure reads differently
  // from a genuine SoundNet miss (they used to collapse into one "couldn't be found" line).
  const unresolvedUrl = unresolved.filter((u) => u.kind === 'url')
  const unresolvedData = unresolved.filter((u) => u.kind !== 'url')

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
        {unresolvedUrl.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.amber }}>
            {`● ${unresolvedUrl.length} link${unresolvedUrl.length === 1 ? '' : 's'} couldn't be resolved — try again`}
          </span>
        )}
        {unresolvedData.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 14, color: C.amber }}>
            {`● ${unresolvedData.length} song${unresolvedData.length === 1 ? '' : 's'} — no audio data available`}
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

      {/* Unresolved rows — prefilled with the original artist/title, variations on hover */}
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
