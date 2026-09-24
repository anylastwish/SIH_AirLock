import type { ReactNode } from 'react'
import { pc, usePC } from '../../lib/pointCloudStore'
import { BarSlider, FLOAT_CARD, FloatingPanel } from './ui'

/**
 * Rotations — floating Tilt / Heading panel above the right end of the central
 * control panel (reference `context/central_control_panel.png`). Closed by
 * default; the toolbar Rotations button (blue while open) or the panel's X
 * toggles `rotationsOpen` in the store.
 *
 * Both sliders drive the camera (via the store) and follow the camera when it
 * is moved with the mouse. Tilt 0–180°: the camera's polar angle around the
 * target — 0° straight down (top view), 90° level, 180° straight up from below.
 * Heading: compass direction the camera looks towards, 0–360°. The camera
 * orbits the current target; the model itself never rotates.
 */

/** Toolbar x of the panel: its left edge sits over the Rotations button. */
export const ROTATIONS_PANEL_LEFT = 465

function TiltGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="h-[17px] w-[17px]" fill="none" aria-hidden>
      <path d="M2 15.5h14L10.5 3.5z" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M11.8 15.5a3.4 3.4 0 0 0-1.6-2.9" stroke="#fff" strokeWidth="1.1" />
    </svg>
  )
}

function HeadingGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="h-[17px] w-[17px]" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="7.3" stroke="#fff" strokeWidth="1.3" />
      <path d="M12.4 5.6 6.3 8.4l2.6.8.8 2.6z" fill="#fff" stroke="#fff" strokeWidth="0.9" strokeLinejoin="round" />
    </svg>
  )
}

function AngleRow({
  label,
  icon,
  min,
  max,
  value,
  top,
  unit,
  onChange,
}: {
  label: string
  icon: ReactNode
  min: string
  max: string
  /** 0–1 slider position. */
  value: number
  top: number
  /** Current value in degrees. */
  unit: number
  onChange: (fraction: number) => void
}) {
  const degrees = `${Math.round(unit)}°`
  return (
    <div className={`${FLOAT_CARD} left-[4px] h-[34px] w-[167px]`} style={{ top }}>
      <span className="absolute left-[5px] top-[8px] flex h-[17px] w-[17px] items-center justify-center">{icon}</span>
      <span className="absolute left-[26px] top-[1px] flex items-baseline gap-[6px] font-jersey10 leading-[15px] text-white">
        <span className="text-[14px]">{label}</span>
        <span aria-hidden className="text-[10px] leading-[11px] text-white/55">
          {degrees}
        </span>
      </span>
      <span className="absolute left-[26px] top-[13px] font-jersey10 text-[8px] leading-[9px] text-white">{min}</span>
      <span className="absolute left-[26px] top-[13px] w-[133px] text-right font-jersey10 text-[8px] leading-[9px] text-white">
        {max}
      </span>
      <BarSlider
        value={value}
        onChange={onChange}
        onCommit={pc.commit}
        label={label}
        valueText={degrees}
        className="absolute left-[26px] top-[22px] h-[7px] w-[133px]"
      />
    </div>
  )
}

export default function TiltHeadingControl() {
  const open = usePC((s) => s.rotationsOpen)
  const tilt = usePC((s) => s.camera.tilt)
  const heading = usePC((s) => s.camera.heading)
  if (!open) return null
  return (
    <FloatingPanel title="Rotations" label="Tilt and heading" left={ROTATIONS_PANEL_LEFT} width={181} height={121} onClose={pc.toggleRotations}>
      <AngleRow
        label="Tilt"
        icon={<TiltGlyph />}
        min="0"
        max="180"
        top={24}
        value={tilt / 180}
        unit={tilt}
        onChange={(f) => pc.setCamera({ tilt: f * 180 })}
      />
      <AngleRow
        label="Heading"
        icon={<HeadingGlyph />}
        min="0"
        max="360"
        top={76}
        value={heading / 360}
        unit={heading}
        onChange={(f) => pc.setCamera({ heading: Math.min(f * 360, 359.9) })}
      />
    </FloatingPanel>
  )
}
