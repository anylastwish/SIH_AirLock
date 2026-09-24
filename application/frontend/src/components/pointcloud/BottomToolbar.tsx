import {
  Crosshair,
  FlipHorizontal2,
  FlipVertical2,
  Hand,
  Layers as LayersIcon,
  Lock,
  Maximize,
  Minimize,
  MousePointer2,
  Redo2,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fmtDistance } from '../../lib/pointCloudMath'
import { pc, usePC, type FlipAxis } from '../../lib/pointCloudStore'
import { ACTIVE_FILL, DISABLED, FOCUS_RING, HOVER, HUD_SURFACE } from './ui'

/**
 * Bottom floating toolbar — common to the Cesium, Semantic and Point Cloud
 * views. Groups are placed at the Figma coordinates (717 × 51 bar) so order,
 * spacing and separators match the approved design. The whole bar (icons, hit
 * areas, separators) is scaled uniformly by `--pc-toolbar-scale` (≈1.09–1.18×,
 * lib/hudLayout.ts) from its bottom-centre, so it stays centred and aligned
 * while growing as far as the bottom status bars allow. Each control drives the
 * central store:
 *
 *   Select / Pan   navigation tool (click-to-pick vs drag-to-pan)
 *   Lock           freezes camera navigation (picking still works)
 *   Target         focus on the selection, or the whole survey when empty
 *   Flip           menu: mirror the model horizontally and / or vertically
 *   Ruler          start a new multi-point measurement
 *   Layers         highlight the Layers panel section
 *   Path           toggle the flight-path layer
 *   Undo / Redo    view + selection history
 *   Rotations      show / hide the Tilt & Heading panel
 *   − 120m +       zoom by real camera distance to the target (range from the model's
 *                  size, no fixed % cap); clicking the distance = default survey view
 *   2D / 3D        top-down (near-orthographic) vs perspective camera
 *   Fullscreen     enter / leave fullscreen
 */

const GLYPH = { size: 16, strokeWidth: 2, color: '#fff' } as const

function RulerGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-[16px] w-[16px]" aria-hidden>
      <g transform="rotate(-45 8 8)">
        <rect x="-0.5" y="4" width="17" height="8" rx="1.3" fill="#fff" />
        <path d="M3 4v3.2M5.6 4v2M8.2 4v3.2M10.8 4v2M13.4 4v3.2" stroke="#2b2b2b" strokeWidth="1" />
      </g>
    </svg>
  )
}

function PolylineGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" fill="none" aria-hidden>
      <path d="M3 15 L8 8.5 L11.5 12 L15.5 3.5" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="3" cy="15" r="1.7" fill="#fff" />
      <circle cx="15.5" cy="3.5" r="1.7" fill="#fff" />
    </svg>
  )
}

/** Mirror glyph: two triangles reflected across a dashed axis. */
function FlipGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-[16px] w-[16px]" fill="none" aria-hidden>
      <path d="M8 1.5v13" stroke="#fff" strokeWidth="1.2" strokeDasharray="1.6 1.4" />
      <path d="M6 3.5 1.5 12.5H6z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M10 3.5l4.5 9H10z" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

const FLIP_OPTIONS: { axis: FlipAxis; label: string; Icon: typeof FlipHorizontal2 }[] = [
  { axis: 'horizontal', label: 'Flip horizontal', Icon: FlipHorizontal2 },
  { axis: 'vertical', label: 'Flip vertical', Icon: FlipVertical2 },
]

/** Toolbar Flip / Mirror slot with a small glass menu for the two axes. */
function FlipControl({ disabled }: { disabled: boolean }) {
  const flip = usePC((s) => s.flip)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const flipped = flip.horizontal || flip.vertical

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef}>
      <Slot
        left={2}
        title={flipped ? `Flip / mirror model (${[flip.horizontal && 'horizontal', flip.vertical && 'vertical'].filter(Boolean).join(' + ')})` : 'Flip / mirror model'}
        active={flipped || open}
        pressed={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <FlipGlyph />
      </Slot>
      {open && !disabled && (
        <div
          role="menu"
          aria-label="Flip model"
          className={`${HUD_SURFACE} absolute bottom-[calc(100%+20px)] left-1/2 flex w-[128px] -translate-x-1/2 flex-col gap-[3px] p-[3px] shadow-glass`}
        >
          {FLIP_OPTIONS.map(({ axis, label, Icon }) => (
            <button
              key={axis}
              type="button"
              role="menuitemcheckbox"
              aria-checked={flip[axis]}
              onClick={() => pc.toggleFlip(axis)}
              className={`${Q} flex h-[23px] items-center gap-[6px] rounded-[5px] border px-[6px] text-left ${FOCUS_RING} ${
                flip[axis] ? ACTIVE_FILL : `border-hud-border bg-hud-slot ${HOVER}`
              }`}
            >
              <Icon {...GLYPH} size={14} />
              <span className="flex-1">{label}</span>
              {flip[axis] && <span className="text-white/70">On</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A Figma slot: a dim rounded square holding one icon; hover / active / disabled states. */
function Slot({
  left,
  children,
  title,
  onClick,
  active = false,
  disabled = false,
  pressed,
}: {
  left: number
  children?: ReactNode
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-[2px] flex h-[23px] w-[23px] items-center justify-center rounded-[5px] border ${FOCUS_RING} ${
        disabled ? `${DISABLED} border-hud-border bg-hud-slot` : active ? ACTIVE_FILL : `border-hud-border bg-hud-slot ${HOVER}`
      }`}
      style={{ left }}
    >
      {children}
    </button>
  )
}

/** Rounded group that holds a few slots. `left` is the group's Figma x inside the bar. */
function Group({ left, width, children }: { left: number; width: number; children?: ReactNode }) {
  return (
    <div className={`${HUD_SURFACE} absolute top-[10px] h-[29px]`} style={{ left, width }}>
      {children}
    </div>
  )
}

function Divider({ left }: { left: number }) {
  return <span aria-hidden className="absolute top-[4px] h-[39px] w-px bg-white/35" style={{ left }} />
}

const Q = 'font-jersey10 text-[10px] leading-[11px] text-white'
const CHIP = `${HUD_SURFACE} ${Q} absolute flex items-center justify-center ${FOCUS_RING}`

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => {})
}

export default function BottomToolbar() {
  const tool = usePC((s) => s.tool)
  const locked = usePC((s) => s.navLocked)
  const multi = usePC((s) => s.selectionMode === 'multi')
  const flightPath = usePC((s) => s.layers.flightPath)
  const canUndo = usePC((s) => s.canUndo)
  const canRedo = usePC((s) => s.canRedo)
  const rotationsOpen = usePC((s) => s.rotationsOpen)
  const viewMode = usePC((s) => s.viewMode)
  const fullscreen = usePC((s) => s.fullscreen)
  const cameraDistance = usePC((s) => (s.dataset ? fmtDistance(s.camera.distance) : '—'))
  const ready = usePC((s) => s.dataset !== null)

  const status = locked ? 'Locked' : tool === 'pan' ? 'Pan' : multi ? 'Select · Multi' : 'Select'

  return (
    <div
      role="toolbar"
      aria-label="Viewer tools"
      className={`${HUD_SURFACE} pointer-events-auto absolute bottom-[23px] left-[calc(50%+3.5px)] h-[51px] w-[717px] origin-bottom -translate-x-1/2 scale-[var(--pc-toolbar-scale,1)]`}
    >
      {/* Select / pan / lock / target */}
      <Group left={12} width={129}>
        <Slot left={3} title="Select points" active={tool === 'select'} pressed={tool === 'select'} onClick={() => pc.setTool('select')}>
          <MousePointer2 {...GLYPH} fill="#fff" />
        </Slot>
        <Slot left={35} title="Pan camera" active={tool === 'pan'} pressed={tool === 'pan'} onClick={() => pc.setTool('pan')}>
          <Hand {...GLYPH} strokeWidth={1.8} />
        </Slot>
        <Slot left={67} title={locked ? 'Unlock navigation' : 'Lock navigation'} active={locked} pressed={locked} onClick={pc.toggleLock}>
          <Lock {...GLYPH} fill="#fff" />
        </Slot>
        <Slot left={99} title="Focus on selection (default survey view when nothing is selected)" disabled={!ready} onClick={pc.focus}>
          <Crosshair {...GLYPH} strokeWidth={1.8} />
        </Slot>
      </Group>

      {/* Flip / mirror */}
      <Group left={150} width={29}>
        <FlipControl disabled={!ready} />
      </Group>

      <Divider left={187} />

      {/* Measure / layers / path */}
      <Group left={196} width={89}>
        <Slot
          left={5}
          title="New measurement (multi-point)"
          onClick={() => {
            pc.setSelectionMode('multi')
            pc.restartSelection()
          }}
        >
          <RulerGlyph />
        </Slot>
        <Slot left={32} title="Show layer controls" onClick={pc.flashLayers}>
          <LayersIcon {...GLYPH} fill="#fff" />
        </Slot>
        <Slot
          left={60}
          title={flightPath ? 'Hide flight path' : 'Show flight path'}
          active={flightPath}
          pressed={flightPath}
          onClick={() => pc.setLayer('flightPath', !flightPath)}
        >
          <PolylineGlyph />
        </Slot>
      </Group>

      {/* Undo / redo */}
      <Group left={293} width={69}>
        <Slot left={6} title="Undo" disabled={!canUndo} onClick={pc.undo}>
          <Undo2 {...GLYPH} size={14} />
        </Slot>
        <Slot left={39} title="Redo" disabled={!canRedo} onClick={pc.redo}>
          <Redo2 {...GLYPH} size={14} />
        </Slot>
      </Group>

      {/* Current interaction mode read-out */}
      <Group left={371} width={78}>
        <span aria-live="polite" className={`${Q} flex h-full items-center justify-center text-white/70`}>
          {status}
        </span>
      </Group>

      <Divider left={457} />

      {/* Rotations / zoom / 2D-3D / fullscreen */}
      <Group left={464} width={239}>
        <button
          type="button"
          aria-pressed={rotationsOpen}
          title={rotationsOpen ? 'Hide tilt & heading' : 'Show tilt & heading'}
          onClick={pc.toggleRotations}
          className={`${Q} absolute left-[5px] top-[2px] flex h-[23px] w-[57px] items-center justify-center rounded-[5px] ${FOCUS_RING} ${
            rotationsOpen ? 'bg-white/[0.31] hover:bg-white/[0.4]' : `border border-hud-border bg-hud-slot ${HOVER}`
          }`}
        >
          Rotations
        </button>

        <span className="absolute left-[71px] top-[2px] h-[23px] w-[66px] rounded-[5px] border border-hud-border bg-hud-slot" />
        <button type="button" title="Zoom out" aria-label="Zoom out" disabled={!ready} onClick={() => pc.zoomBy(1 / 1.25)} className={`${CHIP} left-[76px] top-[7px] h-[13px] w-[13px] ${ready ? HOVER : DISABLED}`}>
          -
        </button>
        <button
          type="button"
          title="Camera distance to the target — click to return to the default survey view"
          aria-label="Reset to default survey view"
          disabled={!ready}
          onClick={pc.resetView}
          className={`${CHIP} left-[93px] top-[7px] h-[13px] w-[24px] whitespace-nowrap ${ready ? HOVER : DISABLED}`}
        >
          {cameraDistance}
        </button>
        <button type="button" title="Zoom in" aria-label="Zoom in" disabled={!ready} onClick={() => pc.zoomBy(1.25)} className={`${CHIP} left-[121px] top-[7px] h-[13px] w-[13px] ${ready ? HOVER : DISABLED}`}>
          +
        </button>

        <button
          type="button"
          title="2D top-down view"
          aria-pressed={viewMode === '2d'}
          disabled={!ready}
          onClick={() => pc.setViewMode('2d')}
          className={`${CHIP} left-[145px] top-[2px] h-[23px] w-[23px] !rounded-full ${viewMode === '2d' ? `${ACTIVE_FILL} !bg-white/[0.28]` : HOVER}`}
        >
          2D
        </button>
        <button
          type="button"
          title="3D perspective view"
          aria-pressed={viewMode === '3d'}
          disabled={!ready}
          onClick={() => pc.setViewMode('3d')}
          className={`${CHIP} left-[175px] top-[2px] h-[23px] w-[23px] !rounded-full ${viewMode === '3d' ? `${ACTIVE_FILL} !bg-white/[0.28]` : HOVER}`}
        >
          3D
        </button>

        <Slot left={210} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
          {fullscreen ? (
            <Minimize size={15} strokeWidth={2} color="#fff" />
          ) : (
            <Maximize size={15} strokeWidth={2} color="#fff" />
          )}
        </Slot>
      </Group>
    </div>
  )
}
