import { scoreCompatibility, WIRE_COLORS } from '../lib/compatibility'
import { camelotColor } from '../lib/camelot'
import { C, FONT, RADIUS } from './import/tokens'

// The compatibility card (Decision Log #31, Figma node 880:4853). Appears in a fixed bottom-right
// corner when the user clicks a wire on the map, and is dismissed by clicking elsewhere (handled by
// the map's pane-click). Only one is ever mounted. It reads the same scoreCompatibility() the wires
// do, so the verdict always matches the wire's color.
//
// Layout mirrors the Figma card: a color-dotted tier verdict, then a three-column strip
// (BPM · Key · Relation) split by faint vertical dividers. The key labels are the one place Camelot
// hue colors are used outside the Deck View (Decision Log #32 exception); everything else is gray.

// The card's title is a descriptor of the transition, not a pass/fail verdict — it informs rather
// than judges (a weak match is a "Distinct Key Change," not a failure). The color dot alone carries
// the tier (green / amber / softened coral).
const VERDICT_TITLE = {
  strong: 'Smooth Harmonic Blend',
  mild: 'Noticeable Key Shift',
  weak: 'Distinct Key Change',
}
const RELATION_LABEL = { same: 'Same', adjacent: 'Adjacent', parallel: 'Parallel', distant: 'Distant', unknown: 'Key unknown' }

// Faint vertical divider between columns (Figma Line 30) — a 39px hairline, brightest at its middle.
function Divider() {
  return (
    <div style={{
      width: 1, height: 39, flexShrink: 0,
      background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0) 100%)',
    }} />
  )
}

const labelStyle = { fontFamily: FONT, fontSize: 12, fontWeight: 500, color: C.textSecondary, whiteSpace: 'nowrap' }
const valueStyle = { fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }

function Column({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{children}</span>
    </div>
  )
}

export default function CompatibilityCard({ sourceTrack, targetTrack }) {
  const { tier, bpmDelta, keyRelationship, sourceKey, targetKey } = scoreCompatibility(sourceTrack, targetTrack)
  const color = WIRE_COLORS[tier]
  const known = keyRelationship !== 'unknown'
  const bpmText = bpmDelta == null ? '—' : `${bpmDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(bpmDelta))}`

  return (
    <div
      onClick={(e) => e.stopPropagation()} // clicks on the card never dismiss it
      style={{
        position: 'absolute', right: 20, bottom: 20, width: 235, zIndex: 7,
        display: 'flex', flexDirection: 'column', gap: 15,
        padding: '15px 20px', borderRadius: RADIUS.well,
        background: C.card,
        boxShadow: '4px 4px 2.5px 0px rgba(0,0,0,1), inset 1px 1.5px 3px 0px #373737',
        fontFamily: FONT,
      }}
    >
      {/* Descriptor title — color dot carries the tier, the words inform (no "Strong/Mild/Weak Match"). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
          {VERDICT_TITLE[tier]}
        </span>
      </div>

      {/* BPM · Key · Relation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Column label="BPM">{bpmText}</Column>
        <Divider />
        <Column label="Key">
          {known ? (
            <>
              <span style={{ color: camelotColor(sourceKey) }}>{sourceKey}</span>
              <span style={{ color: '#fff' }}>{' → '}</span>
              <span style={{ color: camelotColor(targetKey) }}>{targetKey}</span>
            </>
          ) : (
            <span style={{ color: C.textSecondary }}>
              {sourceKey ?? '—'} → {targetKey ?? '—'}
            </span>
          )}
        </Column>
        <Divider />
        <Column label="Relation">{RELATION_LABEL[keyRelationship]}</Column>
      </div>
    </div>
  )
}
