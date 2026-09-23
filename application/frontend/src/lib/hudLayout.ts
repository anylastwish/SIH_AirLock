/**
 * Responsive geometry of the Point Cloud View HUD, shared by the scaled stage
 * (PointCloudView), the panels and the store's Default Survey View framing so
 * the model is always framed inside the free area between the panels.
 *
 * Every length is in design px (the 1440 × 804 Figma frame). The stage is
 * scaled uniformly to "contain" the viewport, so its width is always ≥ 1440 and
 * its height ≥ 804 design px — extra room goes to the central model area.
 */

export const DESIGN_WIDTH = 1440
export const DESIGN_HEIGHT = 804

/** Design width of each side panel's content (approved Figma layout, before zoom). */
export const LEFT_PANEL_CONTENT = 243
export const RIGHT_PANEL_CONTENT = 253
/** Space reserved beside the zoomed content for the thin panel scrollbar (≥ Firefox `thin` = 8px). */
export const PANEL_SCROLL_GUTTER = 8
const LEFT_INSET = 12
const RIGHT_INSET = 11

/** Bottom toolbar in its Figma size; it is centred at 50% + 3.5px, 23px above the bottom. */
export const TOOLBAR = { width: 717, height: 51, bottom: 23, centerOffset: 3.5 } as const
/** Bottom status bars (StatusBars.tsx): distance of their inner edge from the stage edge. */
const STATUS_LEFT_EXTENT = 15 + 278
const STATUS_RIGHT_EXTENT = 11 + 306
/** Lowest edge of the header cluster (model selector / analytics strip). */
const HEADER_EXTENT = 90
const GAP = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface HudLayout {
  /** Stage scale (design px → CSS px) and stage size in design px. */
  scale: number
  width: number
  height: number
  /** Uniform zoom applied to the side panels' content (readability). */
  panelZoom: number
  /** Outer widths of the side panels in design px (zoomed content + scrollbar gutter). */
  leftWidth: number
  rightWidth: number
  /** Uniform scale of the bottom toolbar. */
  toolbarScale: number
  /** Fraction of the viewport (centred) that is not covered by panels / toolbar — for camera framing. */
  fitX: number
  fitY: number
}

export function hudLayout(viewportWidth = window.innerWidth || DESIGN_WIDTH, viewportHeight = window.innerHeight || DESIGN_HEIGHT): HudLayout {
  const scale = Math.min(viewportWidth / DESIGN_WIDTH, viewportHeight / DESIGN_HEIGHT)
  const width = viewportWidth / scale
  const height = viewportHeight / scale

  // Smaller screens (smaller stage scale) get a larger panel zoom so the panel text keeps a
  // readable on-screen size; capped so the central model area stays dominant.
  const panelZoom = clamp(1.25 / Math.sqrt(scale), 1.2, 1.4)
  const leftWidth = LEFT_PANEL_CONTENT * panelZoom + PANEL_SCROLL_GUTTER
  const rightWidth = RIGHT_PANEL_CONTENT * panelZoom + PANEL_SCROLL_GUTTER

  // As large as possible (≤ 1.18×) while staying clear of the bottom status bars.
  const halfRoom = Math.min(
    width / 2 + TOOLBAR.centerOffset - STATUS_LEFT_EXTENT,
    width / 2 - TOOLBAR.centerOffset - STATUS_RIGHT_EXTENT,
  ) - GAP
  const toolbarScale = clamp((2 * halfRoom) / TOOLBAR.width, 1, 1.18)

  const sideExtent = Math.max(LEFT_INSET + leftWidth, RIGHT_INSET + rightWidth) + GAP
  const bottomExtent = TOOLBAR.bottom + TOOLBAR.height * toolbarScale + GAP
  const fitX = clamp((width - 2 * sideExtent) / width, 0.3, 1)
  const fitY = clamp((height - 2 * Math.max(HEADER_EXTENT, bottomExtent)) / height, 0.3, 1)

  return { scale, width, height, panelZoom, leftWidth, rightWidth, toolbarScale, fitX, fitY }
}
