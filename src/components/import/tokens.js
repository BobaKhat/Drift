// Design tokens lifted from the Figma "Component toolkit" + import frames.
// Shared across all import-flow and panel UI so the bento/gadget aesthetic stays
// consistent. DM Sans is the single typeface across the whole app (map HUD included).

export const C = {
  panel: '#0F0F0F',        // Containers/Panels — modal & panel backgrounds
  card: '#141416',         // Containers/Cards,Tiles,Buttons — buttons, wells, tiles
  bg2: '#141415',          // Background/2 — map surface
  border: '#222224',       // Containers/Border
  textPrimary: '#FFFFFF',  // Text/Primary
  textSecondary: '#848484',// Text/Secondary
  iconPrimary: '#808080',  // Icons/Primary
  accent1: '#F27F37',      // accent/1 — orange (CTA, progress, active state)
  accent2: '#4B6AE5',      // accent/2 — blue (secondary emphasis)
  // Reconciliation status — approximating Wire Compatibility/Strong + Mild
  green: '#5FB87A',
  amber: '#E0A33E',
  red: '#E5564B',
}

// Orphan / disconnected treatment on the MAP (Decision Log #35, #36). At rest orphans are muted and
// quiet — a dark-gray dashed border + dark-gray wires (ORPHAN_INACTIVE) so they recede. On group
// hover they light up in warm coral (ORPHAN_CORAL), distinct from the head's orange and the
// green/amber/red compatibility wires. (The panel's Disconnected section uses accent-2 blue, per
// Figma — that's separate from this map treatment.)
export const ORPHAN_CORAL = '#FF7A5C'
export const ORPHAN_INACTIVE = '#363636'

// Tinted fill behind the orange-outlined primary buttons (from Figma).
// Also the "active / selected" background across the app — the app-wide active-state design system
// mirrors the Flow toggle ON knob: accent-orange icon/label fill + a 1.5px accent-orange ring + this
// dark tinted background. Inactive/default states stay gray with no ring.
export const ACCENT1_FILL = 'rgba(20,20,22,0.2)'

// "Selected" shader (Figma node 913-12) — the unified active/selected treatment across the icon
// rail, the Explore By rows, and the Flow toggle. Decoded from the source SVG: a translucent DARK
// glass fill (#141416 @ 20%, i.e. ACCENT1_FILL) over a 4px backdrop blur so the chip reads as frosted
// dark glass, a thin accent-orange ring, and a solid-black drop shadow (dx/dy 4, blur 5). No gloss or
// sheen — the disc is flat glass. Only the ring and the glyph/label are orange; each surface paints
// its own glyph/label accent-orange.
export const SELECTED = {
  fill: ACCENT1_FILL,                     // #141416 @ 20% — translucent dark glass
  border: '#F27F37',                      // accent/1 ring
  blur: 'blur(4px)',                      // GLASS radius 4 — frosts whatever is behind the fill
  drop: '4px 4px 5px 0px #000000',        // dx/dy 4, blur 5, solid black
  // Glass sheen. The raw SVG export is flat, which reads as dull on our near-black rail (the 20% dark
  // fill has no lighter backdrop to frost). These two layers re-create the frosted-glass shine in CSS:
  // `sheen` is a soft top-edge highlight layered OVER the fill (`background: SELECTED.sheen, .fill`);
  // `rim` adds a 1px top light line + a gentle bottom inner shade (append to the element's boxShadow).
  sheen: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 42%)',
  rim: 'inset 0 1px 1.5px 0 rgba(255,255,255,0.22), inset 0 -7px 11px -7px rgba(0,0,0,0.55)',
}

export const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"

// Effect styles (Figma): raised modules vs recessed wells.
// Extrusion = drop shadow + inner highlight; used on cards/tiles/buttons.
export const EXTRUSION = '4px 4px 5px 0px #000000, inset 1px 1.5px 3px 0px #373737'
// Inset = recessed surface; used on textareas, search bars, slider wells.
export const INSET = 'inset 2px 2px 2px 0px #000000, inset -1px -1px 3px 0px #373737'
// Panel/modal lip — just the inner highlight, no drop shadow.
export const PANEL_LIP = 'inset 1px 1.5px 3px 0px #373737'
// Soft drop used on floating cards over the map.
export const CARD_DROP = '4px 4px 2.5px 0px rgba(0,0,0,1)'

export const RADIUS = {
  card: 20,
  well: 10,
  pill: 100,
}
