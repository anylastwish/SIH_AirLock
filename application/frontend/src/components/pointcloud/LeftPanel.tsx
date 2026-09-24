import {
  Check,
  Eye,
  EyeOff,
  Focus,
  Grip,
  Layers as LayersIcon,
  Mountain,
  Palette,
  Search,
  Shield,
  Sun,
  Tag,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SEMANTIC_CLASSES } from '../../lib/pointCloud'
import { fmtCount } from '../../lib/pointCloudMath'
import {
  MIN_DENSITY,
  POINT_SIZE_RANGE,
  pc,
  usePC,
  type LayerId,
  type RenderMode,
  type SelectionMode,
} from '../../lib/pointCloudStore'
import {
  DISABLED,
  Dropdown,
  FOCUS_RING,
  HOVER,
  NumberField,
  PanelSection,
  RangeTrack,
  SectionHeader,
  SIDE_PANEL,
  SliderTrack,
  Toggle,
  ValueBox,
} from './ui'

/**
 * Left "Point Cloud" control panel. Every section is its own component and
 * talks to the central store (lib/pointCloudStore.ts): the renderer reacts to
 * the same state, so each control has an immediate visible effect on the model.
 * Sliders update live while dragging and record ONE undo step on release.
 *
 * Every section is an accordion (header toggles it). Defaults: Layers, Rendering
 * Mode, Point Density and Point Size expanded; the filters and Selection
 * collapsed. The panel scrolls internally; its content keeps the Figma layout
 * (243 design px) and is enlarged with the shared panel zoom (lib/hudLayout.ts).
 */

const ICON = { size: 12, strokeWidth: 1.6 } as const

const LAYERS: { id: LayerId; name: string }[] = [
  { id: 'points', name: 'Point Cloud' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'flightPath', name: 'Flight Path' },
  { id: 'surveyBoundary', name: 'Survey Boundary' },
]

export function Layers() {
  const layers = usePC((s) => s.layers)
  const flash = usePC((s) => s.layersFlash)
  const [highlight, setHighlight] = useState(false)
  const [open, setOpen] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  // The toolbar's Layers button pulses this section (expanding it and scrolling it into view).
  useEffect(() => {
    if (!flash) return
    setOpen(true)
    setHighlight(true)
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const timer = setTimeout(() => setHighlight(false), 1300)
    return () => clearTimeout(timer)
  }, [flash])

  return (
    <div ref={ref} className={`rounded-[5px] transition-shadow ${highlight ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.7)]' : ''}`}>
      <SectionHeader
        icon={<LayersIcon {...ICON} size={13} />}
        title={<span className="text-[9.6px]">Layers</span>}
        open={open}
        onToggle={() => setOpen((v) => !v)}
      />
      {open && (
      <ul className="mt-[1px] flex h-[79px] flex-col justify-center rounded-[5px] border border-pc-line bg-pc-box">
        {LAYERS.map((layer) => {
          const on = layers[layer.id]
          return (
            <li
              key={layer.id}
              className="flex h-[18.3px] shrink-0 items-center border-b border-pc-line pl-[9px] pr-[7.5px] last:border-b-0"
            >
              <button
                type="button"
                aria-label={`${on ? 'Hide' : 'Show'} ${layer.name}`}
                onClick={() => pc.setLayer(layer.id, !on)}
                className={`flex items-center text-pc-muted hover:text-white ${FOCUS_RING}`}
              >
                {on ? <Eye {...ICON} /> : <EyeOff {...ICON} />}
              </button>
              <span className={`ml-[12px] flex-1 text-[7px] ${on ? 'text-pc-text' : 'text-pc-dim'}`}>{layer.name}</span>
              <Toggle on={on} label={layer.name} onChange={(next) => pc.setLayer(layer.id, next)} />
            </li>
          )
        })}
      </ul>
      )}
    </div>
  )
}

const RENDER_MODES: { id: RenderMode; label: string }[] = [
  { id: 'rgb', label: 'RGB' },
  { id: 'semantic', label: 'Semantic' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'confidence', label: 'Confidence' },
]

export function RenderingMode() {
  const mode = usePC((s) => s.renderMode)
  return (
    <PanelSection icon={<Palette {...ICON} />} title="Rendering Mode" className="h-[45.6px]">
      <div role="radiogroup" aria-label="Rendering mode" className="mt-[1px] grid grid-cols-4 gap-[4.5px] px-[4px]">
        {RENDER_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={mode === item.id}
            onClick={() => pc.setRenderMode(item.id)}
            className={`flex h-[18.5px] items-center justify-center rounded-[4px] border text-[6.8px] ${FOCUS_RING} ${
              mode === item.id
                ? 'border-white/10 bg-[#44494d] text-white'
                : `border-pc-line bg-pc-field/40 text-pc-text ${HOVER}`
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </PanelSection>
  )
}

export function PointDensity() {
  const density = usePC((s) => s.density)
  const percent = `${Math.round(density * 100)}%`
  return (
    <PanelSection icon={<Grip {...ICON} />} title="Point Density" className="h-[46px]">
      <div className="flex gap-[10px] px-[7.7px]">
        <div className="mt-[2px] w-[163px]">
          <SliderTrack
            value={density}
            onChange={(v) => pc.setDensity(Math.max(MIN_DENSITY, v))}
            onCommit={pc.commit}
            label="Point density"
            valueText={percent}
            step={0.05}
          />
          <div className="mt-[3px] flex justify-between text-[6px] leading-none text-pc-muted">
            <span>Sparse</span>
            <span>Dense</span>
          </div>
        </div>
        <ValueBox className="-mt-[2px] h-[19px] w-[43px]">{percent}</ValueBox>
      </div>
    </PanelSection>
  )
}

export function PointSize() {
  const size = usePC((s) => s.pointSize)
  const [lo, hi] = POINT_SIZE_RANGE
  return (
    <PanelSection icon={<Sun {...ICON} />} title="Point Size" className="h-[47.5px]">
      <div className="flex gap-[10px] px-[7.7px]">
        <div className="mt-[3px] w-[163px]">
          <SliderTrack
            value={(size - lo) / (hi - lo)}
            onChange={(v) => pc.setPointSize(Math.round((lo + v * (hi - lo)) * 2) / 2)}
            onCommit={pc.commit}
            label="Point size"
            valueText={`${size} px`}
            step={0.1}
          />
          <div className="mt-[4px] flex justify-between text-[6px] leading-none text-pc-muted">
            <span>Smaller</span>
            <span>Larger</span>
          </div>
        </div>
        <ValueBox className="mt-[-1px] h-[19px] w-[43px]">{size} px</ValueBox>
      </div>
    </PanelSection>
  )
}

function ElevationField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}) {
  return (
    <label className="block h-[29px] rounded-[4px] border border-pc-line bg-pc-field px-[6px] pt-[4px] focus-within:border-white/30">
      <div className="text-[5.8px] leading-none text-pc-muted">{label}</div>
      <NumberField
        label={label}
        value={value}
        digits={1}
        onCommit={onCommit}
        className="mt-[3px] block text-[8px] leading-[9px]"
      />
    </label>
  )
}

export function ElevationFilter() {
  const ds = usePC((s) => s.dataset)
  const range = usePC((s) => s.elevation)
  const [z0, z1] = ds?.zRange ?? [0, 1]
  // Filter values are world-local; the UI shows real-world elevations (+ display offset).
  const dz = ds?.model.displayOffset[2] ?? 0
  const span = z1 - z0 || 1
  const toFraction = (v: number) => (v - z0) / span
  const commit = (patch: { min?: number; max?: number }) => {
    pc.setElevation(patch)
    pc.commit()
  }
  return (
    <PanelSection icon={<Mountain {...ICON} />} title="Elevation Filter" className="h-[79px]" defaultOpen={false}>
      <div className="grid grid-cols-[109px_107px] gap-[4.3px] px-[4.3px] pt-[0.5px]">
        <ElevationField label="Min Elevation (m)" value={range.min + dz} onCommit={(v) => commit({ min: v - dz })} />
        <ElevationField label="Max Elevation (m)" value={range.max + dz} onCommit={(v) => commit({ max: v - dz })} />
      </div>
      <div className="ml-[12.5px] mr-[15.5px] mt-[4px]">
        <RangeTrack
          from={toFraction(range.min)}
          to={toFraction(range.max)}
          onChange={({ from, to }) =>
            pc.setElevation({
              min: from === undefined ? undefined : z0 + from * span,
              max: to === undefined ? undefined : z0 + to * span,
            })
          }
          onCommit={pc.commit}
          label="Elevation range"
          valueText={`${(range.min + dz).toFixed(1)} to ${(range.max + dz).toFixed(1)} m`}
          step={0.02}
        />
      </div>
      <div className="mt-[4.5px] flex justify-between px-[7.5px] text-[6.3px] leading-none text-pc-muted">
        <span>{(z0 + dz).toFixed(0)} m</span>
        <span>{(z1 + dz).toFixed(0)} m</span>
      </div>
    </PanelSection>
  )
}

export function SemanticFilter() {
  const ds = usePC((s) => s.dataset)
  const enabled = usePC((s) => s.classes)
  const query = usePC((s) => s.classQuery)
  const visible = SEMANTIC_CLASSES.map((c, index) => ({ ...c, index })).filter((c) =>
    c.label.toLowerCase().includes(query.trim().toLowerCase()),
  )
  return (
    <PanelSection icon={<Tag {...ICON} />} title="Semantic Filter" className="h-[134.8px]" defaultOpen={false}>
      <label className="mx-[5px] flex h-[15.5px] items-center rounded-[4px] border border-pc-line bg-pc-field pl-[7px] focus-within:border-white/30">
        <Search size={8} strokeWidth={1.8} className="shrink-0 text-pc-text" />
        <input
          aria-label="Search classes"
          value={query}
          onChange={(event) => pc.setClassQuery(event.target.value)}
          placeholder="Search classes..."
          className="ml-[6px] w-full bg-transparent text-[6.5px] text-white outline-none placeholder:text-pc-muted"
        />
      </label>
      <ul className="mt-[5.8px]">
        {visible.map((item) => {
          const on = enabled[item.id]
          return (
            <li key={item.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => pc.toggleClass(item.id)}
                className={`flex h-[14.1px] w-full items-center pl-[7px] pr-[8.6px] text-left ${HOVER} ${FOCUS_RING}`}
              >
                <span
                  className={`flex h-[9px] w-[9px] shrink-0 items-center justify-center rounded-[2px] border ${
                    on ? 'border-transparent bg-[#e9ebec] text-[#111]' : 'border-white/35 bg-transparent'
                  }`}
                >
                  {on && <Check size={7} strokeWidth={3.4} />}
                </span>
                <span
                  className="ml-[7.9px] h-[6px] w-[6px] shrink-0 rounded-full"
                  style={{ backgroundColor: item.color, opacity: on ? 1 : 0.4 }}
                />
                <span className={`ml-[7.7px] flex-1 text-[6.8px] ${on ? 'text-pc-text' : 'text-pc-dim'}`}>
                  {item.label}
                </span>
                <span className="text-[6.5px] text-pc-muted">{fmtCount(ds?.classCounts[item.index] ?? 0)}</span>
              </button>
            </li>
          )
        })}
        {visible.length === 0 && <li className="pl-[8px] pt-[6px] text-[6.5px] text-pc-dim">No matching class</li>}
      </ul>
    </PanelSection>
  )
}

const trim = (v: number) => (Math.abs(v * 10 - Math.round(v * 10)) < 1e-6 ? v.toFixed(1) : v.toFixed(2))

export function ConfidenceFilter() {
  const range = usePC((s) => s.confidence)
  return (
    <PanelSection icon={<Shield {...ICON} />} title="Confidence Filter" className="h-[49.5px]" defaultOpen={false}>
      <div className="flex gap-[12px] px-[7.7px]">
        <div className="mt-[5px] w-[151px]">
          <RangeTrack
            from={range.min}
            to={range.max}
            onChange={({ from, to }) => pc.setConfidence({ min: from, max: to })}
            onCommit={pc.commit}
            label="Confidence range"
            valueText={`${trim(range.min)} to ${trim(range.max)}`}
            step={0.05}
          />
          <div className="mt-[3px] flex justify-between text-[6px] leading-none text-pc-muted">
            <span>0</span>
            <span>1</span>
          </div>
        </div>
        <ValueBox className="mt-[1px] h-[19px] w-[52.7px]">
          {trim(range.min)} – {trim(range.max)}
        </ValueBox>
      </div>
    </PanelSection>
  )
}

const MODES: { value: SelectionMode; label: string }[] = [
  { value: 'single', label: 'Single Point' },
  { value: 'multi', label: 'Multi Point' },
]

export function Selection() {
  const mode = usePC((s) => s.selectionMode)
  const count = usePC((s) => s.selectedIds.length)
  return (
    <PanelSection icon={<Focus {...ICON} />} title="Selection" className="h-[67px]" defaultOpen={false}>
      <div className="flex h-[19px] items-center px-[7.7px]">
        <span className="w-[57px] text-[6.5px] text-pc-muted">Selection Mode</span>
        <Dropdown
          label="Selection mode"
          value={mode}
          options={MODES}
          onChange={pc.setSelectionMode}
          className="h-full w-[77.6px]"
        />
        <button
          type="button"
          disabled={count === 0}
          onClick={pc.clearSelection}
          className={`ml-[7.4px] flex h-full w-[74px] items-center gap-[4px] whitespace-nowrap rounded-[4px] border border-pc-line bg-pc-field pl-[7px] text-[6.3px] text-pc-text ${FOCUS_RING} ${
            count === 0 ? DISABLED : HOVER
          }`}
        >
          <Trash2 size={9} strokeWidth={1.7} className="text-pc-muted" />
          Clear Selection
        </button>
      </div>
      <div className="mt-[8px] flex h-[10px] items-center justify-between pl-[7.7px] pr-[9.3px] text-[6.5px]">
        <span className="text-pc-muted">Selected Points</span>
        <span className="text-white">{count}</span>
      </div>
    </PanelSection>
  )
}

export default function LeftPanel() {
  return (
    <aside
      aria-label="Point cloud controls"
      className={`${SIDE_PANEL} pc-scroll bottom-[69px] left-[12px] top-[95px]`}
      style={{ width: 'var(--pc-left-w, 243px)' }}
    >
      <div
        className="flex w-[243px] flex-col gap-[7.3px] px-[4.5px] py-[6px] [&>*]:shrink-0"
        style={{ zoom: 'var(--pc-panel-zoom, 1)' }}
      >
        <Layers />
        <RenderingMode />
        <PointDensity />
        <PointSize />
        <ElevationFilter />
        <SemanticFilter />
        <ConfidenceFilter />
        <Selection />
      </div>
    </aside>
  )
}
