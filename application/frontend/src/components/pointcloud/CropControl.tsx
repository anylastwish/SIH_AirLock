import { RotateCcw } from 'lucide-react'
import { isCropActive, pc, usePC, type CropAxis } from '../../lib/pointCloudStore'
import { FLOAT_CARD, FOCUS_RING, FloatingPanel, HOVER, HUD_SURFACE, NumberField, RangeTrack, Toggle } from './ui'

/**
 * Crop — floating panel above the central control panel (reference
 * `context/central_control_panel.png`), opened / closed by the toolbar Crop
 * button (blue while open) or its X. VIEWPORT FILTER ONLY: it edits the store's
 * `crop` box (world-local metres), which the shader and picking test against —
 * the loaded dataset and the source file are never modified.
 *
 * Per axis: typed min / max (real-world values = world-local + display offset,
 * like the other filters) synchronised with a two-tick bar slider over the
 * model's own bounding box. Header: Enabled toggle (values kept while off),
 * Reset Crop, close.
 */

/** Toolbar x of the panel (over the Measure / Crop groups); 10 px clear of the Rotations panel. */
const CROP_PANEL_LEFT = 191

const AXES: { axis: CropAxis; label: string; hint: string; top: number }[] = [
  { axis: 0, label: 'X', hint: 'X (east)', top: 27.5 },
  { axis: 1, label: 'Y', hint: 'Y (north)', top: 84 },
  { axis: 2, label: 'Z', hint: 'Z (elevation)', top: 141 },
]

function CropValue({ label, value, onCommit, left }: { label: string; value: number; onCommit: (v: number) => void; left: number }) {
  return (
    <label
      className="absolute top-[6px] flex h-[16px] w-[58px] items-center rounded-[4px] border border-hud-border bg-hud-slot px-[4px] focus-within:border-white/40"
      style={{ left }}
    >
      <NumberField label={label} value={value} digits={1} onCommit={onCommit} className="text-center font-jersey10 text-[11px] leading-[12px]" />
    </label>
  )
}

export default function CropControl() {
  const open = usePC((s) => s.cropOpen)
  const ds = usePC((s) => s.dataset)
  const crop = usePC((s) => s.crop)
  const active = usePC(isCropActive)
  if (!open || !ds) return null
  const offset = ds.model.displayOffset
  const commitValue = (axis: CropAxis, patch: { min?: number; max?: number }) => {
    pc.setCropAxis(axis, patch)
    pc.commitCrop()
  }
  return (
    <FloatingPanel
      title="Crop"
      label="Crop"
      left={CROP_PANEL_LEFT}
      width={264}
      height={198}
      onClose={pc.toggleCropMode}
      actions={
        <>
          <span className="font-jersey10 text-[9px] leading-[10px] text-white/55" title={active ? 'Part of the model is hidden' : undefined}>
            {crop.enabled ? 'On' : 'Off'}
          </span>
          <Toggle on={crop.enabled} label="Crop enabled" onChange={pc.setCropEnabled} />
          <button
            type="button"
            title="Reset crop (show the whole model)"
            aria-label="Reset crop"
            onClick={pc.resetCrop}
            className={`${HUD_SURFACE} ${HOVER} ${FOCUS_RING} ml-[2px] flex h-[13px] w-[13px] items-center justify-center`}
          >
            <RotateCcw size={8} strokeWidth={2.4} color="#fff" />
          </button>
        </>
      }
    >
      {AXES.map(({ axis, label, hint, top }) => {
        const lo = ds.bounds.min[axis]
        const hi = ds.bounds.max[axis]
        const span = hi - lo || 1
        const min = crop.min[axis]
        const max = crop.max[axis]
        const o = offset[axis]
        return (
          <div key={label} className={`${FLOAT_CARD} left-[9px] h-[49px] w-[243px]`} style={{ top }}>
            <span className="absolute left-[7px] top-[2px] font-jersey10 text-[14px] leading-[15px] text-white" title={hint}>
              {label}
            </span>
            <CropValue label={`${label} min (m)`} value={min + o} left={37} onCommit={(v) => commitValue(axis, { min: v - o })} />
            <span aria-hidden className="absolute left-[99px] top-[7px] font-jersey10 text-[12px] leading-[13px] text-white">
              -
            </span>
            <CropValue label={`${label} max (m)`} value={max + o} left={111} onCommit={(v) => commitValue(axis, { max: v - o })} />
            <span className="absolute left-[175px] top-[9px] font-jersey10 text-[9px] leading-[10px] text-white/55">m</span>
            <RangeTrack
              variant="bar"
              from={(min - lo) / span}
              to={(max - lo) / span}
              onChange={({ from, to }) =>
                pc.setCropAxis(axis, {
                  min: from === undefined ? undefined : lo + from * span,
                  max: to === undefined ? undefined : lo + to * span,
                })
              }
              onCommit={pc.commitCrop}
              label={`${label} crop range`}
              valueText={`${(min + o).toFixed(1)} to ${(max + o).toFixed(1)} m`}
              step={0.01}
              disabled={!crop.enabled}
              className="!absolute left-[38px] top-[31px] h-[7px] w-[198px]"
            />
          </div>
        )
      })}
    </FloatingPanel>
  )
}
