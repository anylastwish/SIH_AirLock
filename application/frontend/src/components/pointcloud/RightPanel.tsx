import {
  ChevronDown,
  Copy,
  Info,
  Layers as LayersIcon,
  Mountain,
  RotateCw,
  Ruler,
  Settings,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  SEMANTIC_CLASSES,
  getPoint,
  selectionColor,
  type PointCloudDataset,
  type PointRecord,
} from '../../lib/pointCloud'
import {
  elevationStats,
  fmt,
  fmtDegrees,
  fmtMetres,
  measureSelection,
  neighbourhood,
  type Measurement,
} from '../../lib/pointCloudMath'
import { pc, usePC } from '../../lib/pointCloudStore'
import { DISABLED, FOCUS_RING, HOVER, PanelSection, SIDE_PANEL } from './ui'

/**
 * Right Inspector / Analytics panel. Everything here is computed from the
 * selected points of the dataset (lib/pointCloud.ts) — nothing is hard-coded.
 * The section skeleton and sizes never change with the selection so the panel
 * keeps the approved layout; empty values show "—".
 *
 * The panel scrolls internally; its content keeps the Figma layout (253 design
 * px) and is enlarged with the shared panel zoom (lib/hudLayout.ts). The
 * sections are accordions, all expanded by default.
 */

const ICON = { size: 13, strokeWidth: 1.5 } as const
const DASH = '—'

const copyText = (text: string) => {
  void navigator.clipboard?.writeText(text).catch(() => {})
}

/** Absolutely placed label/value row; `top` is the row's vertical centre in design px. */
function DataRow({
  top,
  label,
  children,
  tall = false,
}: {
  top: number
  label: ReactNode
  children: ReactNode
  tall?: boolean
}) {
  return (
    <div
      className="absolute left-[7px] flex items-center text-[7px]"
      style={{ top: top - (tall ? 10 : 6.75), height: tall ? 20 : 13.5 }}
    >
      <span className="w-[73.3px] leading-[8.5px] text-pc-muted">{label}</span>
      <span className="flex items-center gap-[4px] text-pc-text">{children}</span>
    </div>
  )
}

/** Side view (X across, Z up) of the real points around the active point. */
function PointPreview({ ds, id }: { ds: PointCloudDataset | null; id: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!ds || id === null) return
    const { data, center } = neighbourhood(ds, id, 4)
    if (data.length === 0) return
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < data.length; i += 6) {
      minX = Math.min(minX, data[i])
      maxX = Math.max(maxX, data[i])
      minZ = Math.min(minZ, data[i + 2])
      maxZ = Math.max(maxZ, data[i + 2])
    }
    const pad = 8
    const scale = Math.min(
      (canvas.width - pad * 2) / Math.max(maxX - minX, 1e-3),
      (canvas.height - pad * 2) / Math.max(maxZ - minZ, 1e-3),
    )
    const ox = (canvas.width - (maxX - minX) * scale) / 2
    const oy = (canvas.height + (maxZ - minZ) * scale) / 2
    const screen = (x: number, z: number): [number, number] => [ox + (x - minX) * scale, oy - (z - minZ) * scale]
    for (let i = 0; i < data.length; i += 6) {
      const [sx, sy] = screen(data[i], data[i + 2])
      ctx.fillStyle = `rgb(${data[i + 3]},${data[i + 4]},${data[i + 5]})`
      ctx.fillRect(sx - 1, sy - 1, 2.4, 2.4)
    }
    const [cx, cy] = screen(center[0], center[2])
    ctx.beginPath()
    ctx.arc(cx, cy, 5, 0, Math.PI * 2)
    ctx.fillStyle = selectionColor(0)
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }, [ds, id])

  return (
    <div className="absolute left-[152.1px] top-[24.6px] h-[91.4px] w-[83.6px] overflow-hidden rounded-[4px] border border-pc-line bg-[#06090b]">
      <canvas ref={ref} width={168} height={184} className="h-full w-full" aria-label="Neighbourhood preview (side view)" />
    </div>
  )
}

export function InspectorHeader() {
  return (
    <header className="flex h-[28px] items-center pl-[5px] pr-[10px] pt-[4px]">
      <Info size={13} strokeWidth={1.6} className="text-pc-text" />
      <h2 className="ml-[8px] flex-1 text-[9.1px] font-semibold leading-none text-white">Inspector</h2>
      <span className="flex items-center gap-[6px] text-[7px] text-pc-text" title="Inspector source">
        Point Cloud
        <ChevronDown size={9} strokeWidth={2} />
      </span>
    </header>
  )
}

export function SelectedPointCard({ ds, point }: { ds: PointCloudDataset | null; point: PointRecord | null }) {
  const cls = point ? SEMANTIC_CLASSES.find((c) => c.id === point.semanticClass) : null
  return (
    <section className="relative h-[171px] rounded-[5px] border border-pc-line bg-pc-box">
      <div className="flex h-[18px] items-center pl-[8px] pr-[6px]">
        <span className={`h-[7px] w-[7px] rounded-full ${point ? 'bg-[#c4c7ca]' : 'bg-[#4b5155]'}`} />
        <h3 className="ml-[9px] text-[7.7px] font-semibold leading-none text-white">
          {point ? `Point #${point.id}` : 'No point selected'}
        </h3>
        {point && (
          <button
            type="button"
            aria-label="Copy point ID"
            title="Copy point ID"
            onClick={() => copyText(String(point.id))}
            className={`ml-[8px] text-pc-muted hover:text-white ${FOCUS_RING}`}
          >
            <Copy size={8} strokeWidth={1.7} />
          </button>
        )}
        {point && (
          <span className="ml-auto flex h-[15.5px] w-[41px] items-center justify-center rounded-[4px] border border-pc-line bg-pc-field text-[6.8px] text-pc-text">
            Selected
          </span>
        )}
      </div>

      {!point && (
        <p className="absolute inset-x-[16px] top-[52px] text-center text-[7.5px] leading-[11px] text-pc-muted">
          Select a point, object or region to view details and measurements.
        </p>
      )}

      {point && (
        <>
          <DataRow top={30} label="X (m)">{fmt(point.x, 3)}</DataRow>
          <DataRow top={43.4} label="Y (m)">{fmt(point.y, 3)}</DataRow>
          <DataRow top={57} label="Z (m)">{fmt(point.z, 3)}</DataRow>
          <div className="absolute left-[7px] top-[65px] h-px w-[138px] bg-pc-line" />
          <DataRow top={74.6} label="Latitude">
            {point.latitude === null ? DASH : fmtDegrees(point.latitude, 'N', 'S')}
          </DataRow>
          <DataRow top={88.6} label="Longitude">
            {point.longitude === null ? DASH : fmtDegrees(point.longitude, 'E', 'W')}
          </DataRow>
          <DataRow top={102.7} label="Terrain Elevation (m)">{fmt(point.terrainElevation, 3)}</DataRow>
          <div className="absolute left-[7px] top-[110.5px] h-px w-[138px] bg-pc-line" />
          <DataRow top={121} label="Semantic Class">
            <span className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: cls?.color }} />
            {cls?.label}
          </DataRow>
          <DataRow top={137.2} label="Object ID">
            {point.objectId}
            <button
              type="button"
              aria-label="Copy object ID"
              title="Copy object ID"
              onClick={() => copyText(point.objectId)}
              className={`text-pc-muted hover:text-white ${FOCUS_RING}`}
            >
              <Copy size={8} strokeWidth={1.7} />
            </button>
          </DataRow>
          <DataRow top={155.5} label={<>Reconstruction<br />Confidence</>} tall>
            {fmt(point.reconstructionConfidence, 2)}
          </DataRow>
        </>
      )}

      {point && <PointPreview ds={ds} id={point.id} />}
    </section>
  )
}

export function SelectionSummary({ ids, activeId }: { ids: number[]; activeId: number | null }) {
  return (
    <PanelSection icon={<LayersIcon {...ICON} />} title="Selection Summary" height={29} className="relative h-[72px]">
      <div className="absolute left-[8.5px] right-[8px] top-[29.7px] flex h-[12px] items-center justify-between text-[7px]">
        <span className="text-pc-muted">Selected Points</span>
        <span className="flex items-baseline gap-[10px]">
          <span className="text-[11px] leading-none text-pc-text">{ids.length}</span>
          <span className="text-[6.5px] text-pc-muted">/ 5+</span>
        </span>
      </div>
      <div className="absolute left-[5.7px] right-[6.2px] top-[47.5px] flex gap-[7px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ids.map((id, index) => (
          <button
            key={id}
            type="button"
            onClick={() => pc.setActive(id)}
            title={`Show point #${id} in the inspector`}
            className={`flex h-[17.5px] w-[70.9px] shrink-0 items-center rounded-[4px] border bg-pc-field pl-[6px] ${FOCUS_RING} ${HOVER} ${
              id === activeId ? 'border-white/35' : 'border-pc-line'
            }`}
          >
            <span className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: selectionColor(index) }} />
            <span className="ml-[7px] text-[7px] text-pc-text">P{index + 1}</span>
            <span className="ml-[7px] text-[6.3px] text-pc-muted">#{id}</span>
          </button>
        ))}
        {ids.length === 0 && <span className="pl-[3px] pt-[3px] text-[6.5px] text-pc-dim">Click points in the viewport to select them.</span>}
      </div>
    </PanelSection>
  )
}

/* ---------------- measurements ---------------- */

interface Row {
  label: string
  value?: string
  chips?: string[]
  note?: string
}

const ROW_TOPS = [40, 55.7, 72, 88, 113]

function measurementView(m: Measurement, count: number): { title: string; rows: Row[] } {
  switch (m.kind) {
    case 'none':
      return { title: 'No selection', rows: [] }
    case 'point':
      return {
        title: '1 Point',
        rows: [
          { label: 'X', value: fmtMetres(m.x, 3) },
          { label: 'Y', value: fmtMetres(m.y, 3) },
          { label: 'Z', value: fmtMetres(m.z, 3) },
          { label: 'Terrain Elevation', value: fmtMetres(m.terrainElevation, 3) },
        ],
      }
    case 'line':
      return {
        title: '2 Points (Line)',
        rows: [
          { label: '3D Distance', value: fmtMetres(m.distance3d) },
          { label: 'Horizontal Distance', value: fmtMetres(m.horizontal) },
          { label: 'Vertical Difference', value: fmtMetres(m.vertical) },
          {
            label: 'Slope',
            value: `${fmt(m.slopeDeg, 1)}°${m.gradePct === null ? '' : ` (${fmt(m.gradePct, 1)}%)`}`,
          },
        ],
      }
    case 'triangle':
      return {
        title: '3 Points (Triangle)',
        rows: [
          { label: 'Triangle Area', value: `${fmt(m.area)} m²` },
          { label: 'Perimeter', value: fmtMetres(m.perimeter) },
          { label: 'Side Lengths', chips: ['AB', 'BC', 'CA'].map((n, i) => `${n}: ${fmt(m.sides[i])} m`) },
          { label: 'Plane Slope', value: `${fmt(m.planeSlopeDeg, 1)}°` },
          { label: '3D Distances', chips: ['AB', 'BC', 'CA'].map((n, i) => `${n}: ${fmt(m.distances3d[i])} m`) },
        ],
      }
    case 'polygon':
      return {
        title: '4 Points (Polygon)',
        rows: [
          { label: 'Boundary Perimeter', value: fmtMetres(m.perimeter) },
          { label: 'Surface Area', value: `${fmt(m.surfaceArea)} m²` },
          { label: 'Plan Area', value: `${fmt(m.planArea)} m²` },
          { label: 'Volume', value: 'N/A', note: 'needs a base surface' },
        ],
      }
    case 'region':
      return {
        title: `${count} Points (Region)`,
        rows: [
          { label: 'Centroid X', value: fmtMetres(m.centroid[0], 3) },
          { label: 'Centroid Y', value: fmtMetres(m.centroid[1], 3) },
          { label: 'Centroid Z', value: fmtMetres(m.centroid[2], 3) },
          { label: 'Terrain Elevation', value: `${fmtMetres(m.terrainMean, 3)} avg` },
        ],
      }
  }
}

export function Measurements({ measurement, count }: { measurement: Measurement; count: number }) {
  const { title, rows } = measurementView(measurement, count)
  return (
    <PanelSection
      icon={<Ruler {...ICON} />}
      title="Measurements"
      height={34}
      className="relative h-[128px]"
      right={
        <span className="flex h-[17px] min-w-[87px] items-center justify-center rounded-[4px] border border-pc-line bg-pc-field px-[8px] text-[6.5px] text-white">
          {title}
        </span>
      }
    >
      {rows.length === 0 && (
        <p className="absolute inset-x-[10px] top-[52px] text-center text-[7px] text-pc-dim">
          Select 1–5+ points to measure.
        </p>
      )}
      {rows.map((row, index) => {
        const top = ROW_TOPS[Math.min(index, ROW_TOPS.length - 1)]
        return (
          <div key={row.label}>
            {index === 4 && <div className="absolute left-[7px] top-[98px] h-px w-[225px] bg-pc-line" />}
            <div className="absolute left-[7px] flex h-[13px] items-center text-[7px]" style={{ top: top - 6.5 }}>
              <span className="w-[75.4px] text-pc-muted">{row.label}</span>
              {row.chips ? (
                <span className="grid w-[150.3px] grid-cols-3 gap-[2.3px]">
                  {row.chips.map((chip) => (
                    <span
                      key={chip}
                      className="flex h-[13px] items-center justify-center whitespace-nowrap rounded-[3px] border border-pc-line bg-pc-field text-[5.9px] text-pc-text"
                    >
                      {chip}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-pc-text">
                  {row.value}
                  {row.note && <span className="ml-[5px] text-[6px] text-pc-dim">({row.note})</span>}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </PanelSection>
  )
}

export function TerrainStatistics({ ds, ids }: { ds: PointCloudDataset | null; ids: number[] }) {
  const stats = useMemo(() => (ds ? elevationStats(ds, ids) : null), [ds, ids])
  const rows = [
    { label: 'Maximum Elevation', value: stats?.max },
    { label: 'Minimum Elevation', value: stats?.min },
    { label: 'Average Elevation', value: stats?.avg },
    { label: 'Elevation Range', value: stats?.range },
  ]
  return (
    <PanelSection
      icon={<Mountain {...ICON} size={13} />}
      title={
        <>
          Terrain Statistics <span className="text-[8px] font-normal text-pc-text">(Selected Points)</span>
        </>
      }
      height={28}
      className="h-[99px]"
    >
      <dl className="mt-[1px]">
        {rows.map((row) => (
          <div key={row.label} className="flex h-[16.2px] items-center justify-between pl-[9.9px] pr-[13px] text-[7px]">
            <dt className="text-pc-text">{row.label}</dt>
            <dd className="text-pc-text">{row.value === undefined ? DASH : fmtMetres(row.value, 3)}</dd>
          </div>
        ))}
      </dl>
    </PanelSection>
  )
}

export function Actions({ count }: { count: number }) {
  const buttons = [
    { label: 'Clear Selection', icon: <Trash2 size={10} strokeWidth={1.6} />, run: pc.clearSelection, disabled: count === 0 },
    { label: 'Restart Selection', icon: <RotateCw size={10} strokeWidth={1.6} />, run: pc.restartSelection, disabled: false },
  ]
  return (
    <PanelSection icon={<Settings {...ICON} />} title="Actions" height={28} className="mt-[2px] h-[101px]">
      <div className="grid grid-cols-2 gap-[7.5px] px-[7.7px] pt-[2px]">
        {buttons.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.run}
            className={`flex h-[32px] items-center justify-center gap-[7px] rounded-[4px] border border-pc-line bg-pc-field text-[7px] text-pc-text ${FOCUS_RING} ${
              action.disabled ? DISABLED : HOVER
            }`}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>
      <p className="mt-[9px] flex items-center gap-[5px] pl-[10px] text-[6px] text-pc-dim">
        <Info size={8} strokeWidth={1.6} />
        Selected points are preserved when switching views.
      </p>
    </PanelSection>
  )
}

export default function RightPanel() {
  const ds = usePC((s) => s.dataset)
  const ids = usePC((s) => s.selectedIds)
  const activeId = usePC((s) => s.activeId)
  const point = useMemo(() => (ds && activeId !== null ? getPoint(ds, activeId) : null), [ds, activeId])
  const measurement = useMemo(() => (ds ? measureSelection(ds, ids) : ({ kind: 'none' } as Measurement)), [ds, ids])

  return (
    <aside
      aria-label="Point cloud inspector"
      className={`${SIDE_PANEL} pc-scroll bottom-[66px] right-[11px] top-[90px]`}
      style={{ width: 'var(--pc-right-w, 253px)' }}
    >
      <div
        className="flex w-[253px] flex-col gap-[8px] px-[6px] pb-[6px] [&>*]:shrink-0"
        style={{ zoom: 'var(--pc-panel-zoom, 1)' }}
      >
        <InspectorHeader />
        <SelectedPointCard ds={ds} point={point} />
        <SelectionSummary ids={ids} activeId={activeId} />
        <Measurements measurement={measurement} count={ids.length} />
        <TerrainStatistics ds={ds} ids={ids} />
        <Actions count={ids.length} />
      </div>
    </aside>
  )
}
