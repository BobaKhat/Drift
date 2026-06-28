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

// Tinted fill behind the orange-outlined primary buttons (from Figma).
export const ACCENT1_FILL = 'rgba(20,20,22,0.2)'

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
