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
// `fill` is the dark glass for EVERY selected surface, including ones whose Figma export tints the fill
// with the accent (the Explore By dot, node 748-2483, is drawn orange @ 20% there). Deliberate: the
// accent belongs to the ring and the glyph/label, and a neutral fill is what lets one shader cover the
// rail, the rows, the Flow knob and the search icon without each reading as a different material.
export const SELECTED = {
  fill: ACCENT1_FILL,                     // #141416 @ 20% — translucent dark glass
  border: '#F27F37',                      // accent/1 ring
  blur: 'blur(2px)',                      // GLASS radius 2 — matches the stack badge's frost
  drop: '4px 4px 5px 0px #000000',        // dx/dy 4, blur 5, solid black — same hard drop as the badge
  // Flat glass, to match the Slice-14 stack badge (StackBadge): NO gloss. `sheen` and `rim` are kept as
  // transparent no-ops so every consumer that composes `sheen, fill` / `drop, rim` still emits valid CSS
  // but now renders exactly like the badge — flat frosted fill + accent ring + hard black drop, nothing
  // else. (They used to carry a top-highlight sheen + beveled rim; removed on request for the flat look.)
  sheen: 'linear-gradient(rgba(255,255,255,0), rgba(255,255,255,0))',
  rim: 'inset 0 0 0 0 rgba(0,0,0,0)',
  // Hover just lengthens the drop a touch (a subtle lift); the flat glass + ring stay put, so hovering a
  // selected chip never reintroduces gloss.
  hoverSheen: 'linear-gradient(rgba(255,255,255,0), rgba(255,255,255,0))',
  hoverDrop: '5px 5px 8px 0px #000000',
}

export const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"
// Monospace accent face — the ORION brand mark and panel headings.
export const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"

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

// —— Neomorphic shadow system (reference component: the top-right toolbar) ————————
// Single light source, top-left, on the map surface (MAP_BG #141415). Raised SLABS (the pill) cast an
// outer pair: light up-left (negative offsets), dark down-right (positive).
//
// A raised BUTTON's recipe depends on WHAT IT SITS ON, and this is the rule:
//   • in an inset tray  -> outer dark only, thickness from an inner bevel   (NEO_BTN_*)
//   • on a raised slab  -> outer light + outer dark, plus a 1px rim         (NEO_CHEV_*)
// The reason is where the light shadow lands. A button in a tray throws its outer light onto the trench
// floor 7px away, and at any intensity strong enough to see, that washes out the very recess the button
// is meant to sit in — measured at over 2x the floor's luminance, brighter than the pill outside it. An
// inner bevel stays on the button's own face and can't do that. A button on a slab has no trench to
// wash, so it can afford the outer pair, and needs it: without a floor to contrast against, the bevel
// alone leaves it flat. Same light source either way — only the surface underneath changes.
//
// The tray recipe is also what the Figma reference draws (drop shadow down-right + inner top-left
// highlight, no outer light).
// On press the bevel flips (dark up-left, light down-right) and the outer cast drops, so the button
// sinks to the floor. No borders — the shadows are the edge. Blur ≈ 2× the offset so surfaces read as
// physical, not outlined. Backgrounds step lighter for raised slabs/buttons and darker when pressed in.
//
// Every piece of map chrome is assembled from the same three levels — slab / well / button. The toolbar
// is pill / tray / icon buttons, the search bar is slab / text well / icon button, the Flow toggle is
// pill / track / knob. They live here rather than in any one component because they are shared: the
// alternative is each surface redeclaring its own copy, which is exactly how one colour change turns
// into twenty-two edits across nine files.
export const NEO_BAR_BG      = '#1b1b1d'  // raised slab — a step up from the map surface
export const NEO_BAR_SHADOW  = '-4px -4px 8px 0px rgba(255,255,255,0.03), 4px 4px 8px 0px rgba(0,0,0,0.6)'
export const NEO_BAR_EDGE    = 'inset 1px 1px 1px 0px rgba(255,255,255,0.05), inset -1px -1px 2px 0px rgba(0,0,0,0.35)'
// Hover for slabs that are also BUTTONS — the big pills (Explore By rows, Save & Complete, Import more,
// SecondaryButton). Not for the toolbar/search-bar slabs, which are chrome and aren't clickable. The lift
// is the same shape as the icon buttons': the face steps up 8 points (#1b1b1d → #232325, matching
// NEO_BTN_BG → NEO_BTN_HOVER_BG), the outer pair gains a pixel of offset and blur, and both halves
// deepen. The outer light is free to brighten here — a slab sits on the panel, not in a trench, so the
// rule at the top of this block puts it on the same side as the chevron, not the tray buttons.
export const NEO_BAR_HOVER_BG = '#232325'
export const NEO_BAR_HOVER    = '-5px -5px 10px 0px rgba(255,255,255,0.045), 5px 5px 10px 0px rgba(0,0,0,0.7)'
// Icon buttons / knobs — raised at rest, lifted on hover, sunk (inset) on press. Outer dark casts
// down-right onto the surface below; the inner bevel supplies the thickness. The accent ring rides on
// top when active.
export const NEO_BTN_BG       = '#222224'  // raised button — the step above the well floor the extrusion reads from
export const NEO_BTN_HOVER_BG = '#2a2a2c'  // hover — the face rises toward the light, so it catches more of it
export const NEO_BTN_PRESS_BG = '#151517'  // pressed/active — drops below the slab surface
// The bevel runs tight to the edge (1.5px offset, 2px blur) rather than soft: a narrow band of light
// reads as a machined chamfer, a wide gradient reads as moulded rubber. The alphas carry more than they
// look like they should (0.09 / 0.5) precisely because the band is narrow — the same light spread over
// half the area needs the intensity back to land at the same depth.
export const NEO_BTN_RAISED = '4px 4px 8px 0px rgba(0,0,0,0.7), inset 1.5px 1.5px 2px 0px rgba(255,255,255,0.09), inset -1.5px -1.5px 2px 0px rgba(0,0,0,0.5)'
// Hover is a lift, and every part of it says so together: the face steps lighter (NEO_BTN_HOVER_BG), the
// cast beneath deepens (+1px offset, +2px blur, 0.7 → 0.8), and the bevel catches more light (0.11 →
// 0.13). The inner dark holds at 0.5 — the far edge is turning away from the light either way.
export const NEO_BTN_HOVER  = '5px 5px 10px 0px rgba(0,0,0,0.8), inset 1.5px 1.5px 2px 0px rgba(255,255,255,0.13), inset -1.5px -1.5px 2px 0px rgba(0,0,0,0.5)'
// Press drops the outer cast entirely — the button is on the floor, so it has nothing left to cast onto.
// Blur tightens with the bevel above, but the alphas deliberately don't: scaling them the way the raised
// state's were would put this past the well's own 0.7 and make a pressed button darker than the floor.
export const NEO_BTN_PRESS  = 'inset 3px 3px 3px 0px rgba(0,0,0,0.6), inset -1px -1px 1px 0px rgba(255,255,255,0.03)'
// Buttons sitting directly on a raised slab rather than in a tray — currently the toolbar's chevron.
// Outer light + outer dark (there's no trench floor for the light to wash), led by a 1px full-perimeter
// rim that catches the edge against the slab from every side. Press is shared with the tray buttons:
// sunk is sunk, and by then the outer cast is gone anyway.
export const NEO_CHEV_RAISED = 'inset 0 0 0 1px rgba(255,255,255,0.05), -4px -4px 8px 0px rgba(255,255,255,0.08), 4px 4px 8px 0px rgba(0,0,0,0.7)'
export const NEO_CHEV_HOVER  = 'inset 0 0 0 1px rgba(255,255,255,0.05), -5px -5px 10px 0px rgba(255,255,255,0.10), 5px 5px 10px 0px rgba(0,0,0,0.8)'
// The icon rail's nav buttons — standalone circles sitting directly on the rail (RAIL_BG #0F0F0F). By the
// rule at the top of this block that makes them the chevron's case, not the tray's: no trench floor for
// the outer light to wash, so rim + outer light + outer dark. What changes is the surface underneath —
// the rail sits ~12 points darker than the toolbar slab the chevron rides on, and a cast reads by its
// contrast against what it lands on, so the outer dark carries more here (0.8 to the chevron's 0.7) to
// land at the same depth.
// NOTE: NEO_RAIL_RAISED is no longer rail-only — the deck's play button is the same case (a standalone
// round button on a dark surface) and shares it verbatim. The name is now narrower than the truth; if a
// third surface takes it, rename the pair rather than copying the values again. Changing them here moves
// the deck too, which is intended: they're one recipe.
export const NEO_RAIL_SURFACE   = '#0F0F0F'  // the icon-rail / panel CONTAINER floor (LeftNav RAIL_BG) — darker than the raised icon buttons
export const NEO_RAIL_BG        = '#1a1a1c'  // the raised icon BUTTONS standing off the rail
export const NEO_RAIL_HOVER_BG  = '#222224'
export const NEO_RAIL_ACTIVE_BG = '#0d0d0f'  // sunk BELOW the rail surface — the only face here that goes darker than its ground
export const NEO_RAIL_RAISED = 'inset 0 0 0 1px rgba(255,255,255,0.05), -3px -3px 6px 0px rgba(255,255,255,0.06), 3px 3px 6px 0px rgba(0,0,0,0.8)'
export const NEO_RAIL_HOVER  = 'inset 0 0 0 1px rgba(255,255,255,0.05), -4px -4px 8px 0px rgba(255,255,255,0.08), 4px 4px 8px 0px rgba(0,0,0,0.85)'
// Active is a held press, not a hover: the button stays sunk for as long as its panel is on screen, which
// is what separates "you're on this page" from "you're pointing at this". Accent ring over the press, the
// same composition the toolbar's active buttons use. Its own press numbers rather than NEO_BTN_PRESS —
// that one's 3px offset is there to bottom out on NEO_TRAY_INSET's contour, and a rail button has no tray
// under it to bottom out on.
export const NEO_RAIL_ACTIVE = `inset 0 0 0 1.5px ${SELECTED.border}, inset 2px 2px 4px 0px rgba(0,0,0,0.6), inset -1px -1px 2px 0px rgba(255,255,255,0.03)`
// —— Deck instrument panel ——————————————————————————————————————————————————————————————
// Deck bento tiles — content modules, not controls: machined modules mounted on the deck panel, so they
// extrude and then hold still. No hover, no press; a tile that lifts under the cursor is claiming to be a
// button. Structurally these are NEO_BTN_RAISED at tile scale — outer dark only, thickness from an inner
// bevel — and they land on the tray side of the rule at the top of this block even though the deck panel
// isn't literally a trench: tiles are packed a GAP (8–12px) apart, so an outer light has no open ground to
// fall on and would just wash the neighbour it reaches. Two departures from the button, both from scale: a
// 250px face needs a longer cast than a 30px one to sit the same distance off its ground (10px of blur to
// the button's 8, at 0.8 for the darker panel), while the bevel does NOT scale with it — 1.5px is a
// machined chamfer at any size, and widening it in proportion would turn the edge to moulded rubber.
export const NEO_TILE_BG     = '#1a1a1c'  // one step down from NEO_BAR_BG: the deck panel is darker ground than the map
export const NEO_TILE_SHADOW = '4px 4px 10px 0px rgba(0,0,0,0.8), inset 1.5px 1.5px 2px 0px rgba(255,255,255,0.08), inset -1.5px -1.5px 2px 0px rgba(0,0,0,0.5)'
// Readout screens recessed INTO a tile — the disc platter and the BPM/Camelot circles. This is the DAW
// move the tiles exist to set up: a dark screen sunk into a lit panel, so the panel reads as machined
// around it. Same face as a held-down rail button (NEO_RAIL_ACTIVE_BG) because it's the same physical
// claim — a surface below its ground — and the deck is where that claim is at rest rather than momentary.
export const NEO_SCREEN_BG    = '#0d0d0f'
export const NEO_SCREEN_INSET = 'inset 2px 2px 4px 0px rgba(0,0,0,0.7), inset -1px -1px 2px 0px rgba(255,255,255,0.04)'
// Wells that hold a moving part — slider tracks, the VU meter. Shallower than a screen (0.6/0.03 to the
// screen's 0.7/0.04): a screen is read THROUGH and wants its own depth, a well only has to seat the thing
// riding in it, and out-darkening the knob it carries inverts which of the two is on top. Numerically this
// is NEO_RAIL_ACTIVE's press half — the same "sunk below the ground" surface — but kept as its own
// constant on the precedent NEO_BTN_PRESS/NEO_TRAY_INSET set just below: they share numbers today because
// the physics agree, not because a change to a slider track should travel to the icon rail.
export const NEO_WELL_INSET = 'inset 2px 2px 4px 0px rgba(0,0,0,0.6), inset -1px -1px 2px 0px rgba(255,255,255,0.03)'
// NOTE: the deck's visualizer tile is deliberately NOT in this system — it's a screen, not a gauge, so it
// carries no shadow at all and draws its edge with a plain border. It has no token here on purpose; see
// DeckVisualizer.jsx. Don't add one for it.
// The well a button sits in — recessed INTO the slab, so the button reads as a knob poking out of a
// trench instead of off a flat surface. Background steps DOWN from the slab (#1b1b1d → #111113) where a
// raised surface would step up, and that floor is what the buttons' #222224 faces are read against: the
// contrast gap between the two is what sells the extrusion, so the floor and the faces only make sense
// as a pair — darkening one without the other flattens both. This inset and NEO_BTN_PRESS share the same
// 3px offset so a pressed button bottoms out on the trench's own contour, though the press runs a tighter
// blur (3 to this 6) now that the buttons read machined and the wells still read moulded. The press also
// stays lighter (0.6 to this 0.7) so the floor is never out-darkened by something resting on it.
export const NEO_TRAY_BG    = '#111113'
export const NEO_TRAY_INSET = 'inset 3px 3px 6px 0px rgba(0,0,0,0.7), inset -1px -1px 3px 0px rgba(255,255,255,0.04)'
export const NEO_PANEL_SHADOW = 'drop-shadow(-6px -6px 12px rgba(255,255,255,0.025)) drop-shadow(6px 6px 14px rgba(0,0,0,0.65))'
export const NEO_PANEL_EDGE  = 'inset 1px 1px 1px 0px rgba(255,255,255,0.05), inset -1px -1px 2px 0px rgba(0,0,0,0.35)'
