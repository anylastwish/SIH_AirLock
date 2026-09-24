import { X } from 'lucide-react'
import { pc, usePC } from '../../lib/pointCloudStore'
import { BarSlider, FOCUS_RING, HOVER, HUD_SURFACE } from './ui'

/**
 * Floating Tilt / Heading panel above the right end of the bottom toolbar.
 * Both sliders drive the camera (via the store) and follow the camera when it
 * is moved with the mouse. Tilt 0–180°: the camera's polar angle around the
 * target — 0° straight down (top view), 90° level, 180° straight up from below.
 * Heading: compass direction the camera looks towards, 0–360°. The camera
 * orbits the current target; the model itself never rotates. Its position follows the scaled
 * toolbar (`--pc-toolbar-scale`): 5px above it, left edge over Rotations.
 */

function AngleRow({
  label,
  min,
  max,
  value,
  top,
  unit,
  onChange,
}: {
  label: string
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
    <div
      className="absolute left-[4px] h-[34px] w-[167px] rounded-[5px] border border-hud-border bg-hud backdrop-blur-[7.8px]"
      style={{ top }}
    >
      <span className="absolute left-[6px] top-[1px] flex items-baseline gap-[6px] font-jersey10 leading-[15px] text-white">
        <span className="text-[14px]">{label}</span>
        <span aria-hidden className="text-[10px] leading-[11px] text-white/55">
          {degrees}
        </span>
      </span>
      <span className="absolute left-[6px] top-[13px] font-jersey10 text-[8px] leading-[9px] text-white">{min}</span>
      <span className="absolute left-[6px] top-[13px] w-[152px] text-right font-jersey10 text-[8px] leading-[9px] text-white">
        {max}
      </span>
      <BarSlider
        value={value}
        onChange={onChange}
        onCommit={pc.commit}
        label={label}
        valueText={degrees}
        className="absolute left-[6px] top-[22px] h-[7px] w-[152px]"
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
    <div
      role="group"
      aria-label="Tilt and heading"
      className="pointer-events-auto absolute bottom-[calc(28px+51px*var(--pc-toolbar-scale,1))] left-[calc(50%+3.5px+106.5px*var(--pc-toolbar-scale,1))] h-[121px] w-[181px] rounded-[5px] border border-hud-border bg-hud-tilt backdrop-blur-[7.8px]"
    >
      <button
        type="button"
        title="Close"
        aria-label="Close tilt and heading"
        onClick={pc.toggleRotations}
        className={`${HUD_SURFACE} ${HOVER} ${FOCUS_RING} absolute left-[159px] top-[4px] flex h-[13px] w-[13px] items-center justify-center`}
      >
        <X size={9} strokeWidth={2.4} color="#fff" />
      </button>
      <AngleRow
        label="Tilt"
        min="0"
        max="180"
        top={24}
        value={tilt / 180}
        unit={tilt}
        onChange={(f) => pc.setCamera({ tilt: f * 180 })}
      />
      <AngleRow
        label="Heading"
        min="0"
        max="360"
        top={76}
        value={heading / 360}
        unit={heading}
        onChange={(f) => pc.setCamera({ heading: Math.min(f * 360, 359.9) })}
      />
    </div>
  )
}
