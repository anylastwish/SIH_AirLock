import { scaleStatus, type ModelState } from '../../lib/modelMetadata'
import { toGeographic, toReal } from '../../lib/pointCloud'
import { CAMERA_FOV, fmtDegrees, niceLength, pointXYZ } from '../../lib/pointCloudMath'
import { pc, usePC } from '../../lib/pointCloudStore'
import { FOCUS_RING } from './ui'

/**
 * Bottom-left copyright / confidence strip and bottom-right live viewer read-out
 * (scale · camera altitude · elevation · position · compass). Values are derived
 * from the dataset and the camera / selection in the store.
 */

const BAR =
  'pointer-events-auto absolute bottom-[29px] h-[31px] rounded-[5px] border border-[rgba(117,117,117,0.06)] bg-[rgba(117,117,117,0.19)] backdrop-blur-[7.8px]'
const TEXT = 'absolute top-[9px] whitespace-nowrap font-jersey10 text-[12px] leading-[13px]'

function Compass({ heading }: { heading: number }) {
  return (
    <button
      type="button"
      title={`Heading ${Math.round(heading)}° — click to face north`}
      aria-label="Compass: face north"
      onClick={() => {
        pc.setCamera({ heading: 0 }, true)
        pc.commit()
      }}
      className={`absolute left-[273px] top-[1px] h-[27px] w-[27px] rounded-full ${FOCUS_RING}`}
    >
      <svg viewBox="0 0 27 27" className="h-full w-full" style={{ transform: `rotate(${-heading}deg)` }} aria-hidden>
        <circle cx="13.5" cy="13.5" r="13.5" fill="#f4f4f4" />
        <circle cx="13.5" cy="13.5" r="11.3" fill="none" stroke="#9a9a9a" strokeWidth="0.6" />
        {/* four-point star: red north, dark east/south/west */}
        <path d="M13.5 3.6 L15.6 13.5 L11.4 13.5 Z" fill="#d6332f" />
        <path d="M13.5 23.4 L15.6 13.5 L11.4 13.5 Z" fill="#26282b" />
        <path d="M3.6 13.5 L13.5 11.4 L13.5 15.6 Z" fill="#26282b" />
        <path d="M23.4 13.5 L13.5 11.4 L13.5 15.6 Z" fill="#26282b" />
        <circle cx="13.5" cy="13.5" r="1.2" fill="#f4f4f4" />
      </svg>
    </button>
  )
}

/** Tooltip summary of how scale / orientation / position were determined (lib/modelMetadata.ts). */
function modelSummary(state: ModelState): string {
  const units = state.units === 'unknown' ? 'unknown (1 unit shown as 1 m)' : state.units === 'custom' ? `× ${state.unitsToMeters.toPrecision(4)} → m` : state.units
  const orientation =
    state.orientation.source === 'geometry'
      ? `Auto (${state.orientation.label}${state.orientation.inverted ? ', inverted model corrected' : state.orientation.correctionDeg >= 0.05 ? `, ${state.orientation.correctionDeg.toFixed(1)}° levelled` : ''})`
      : `${state.orientation.source === 'default' ? 'Default' : state.orientation.source === 'format' ? 'Format' : 'Metadata'} — ${state.orientation.label}`
  return [
    `Scale: ${scaleStatus(state)} — ${state.scale.label}`,
    `Units: ${units}`,
    `Orientation: ${orientation}`,
    `Position: ${state.position.georeferenced ? 'Georeferenced' : 'Local'} (${state.coordinateSystem})`,
    `Terrain: ${state.terrain.source}${state.terrain.reliable ? '' : ' (estimated)'}`,
    ...state.warnings.map((w) => `⚠ ${w}`),
  ].join('\n')
}

export function CopyrightStatus() {
  const confidence = usePC((s) => (s.dataset ? `${Math.round(s.dataset.meanConfidence * 100)}%` : '--'))
  const state = usePC((s) => s.dataset?.model ?? null)
  return (
    <div className={`${BAR} left-[15px] w-[278px]`}>
      <span className={`${TEXT} left-[10px] text-[10px] text-[#f0f0f0]`}>Copyright @ AirLock++</span>
      <span className={`${TEXT} left-[117px] text-[10px] text-[#f0f0f0]`} title="Mean reconstruction confidence of the dataset">
        Confidence: {confidence}
      </span>
      {state && (
        <span className={`${TEXT} left-[192px] text-[10px] text-[#f0f0f0]`} title={modelSummary(state)}>
          Scale: {scaleStatus(state)}
        </span>
      )}
    </div>
  )
}

const DIVIDER = <span aria-hidden className="mx-[8px] h-[17px] w-px shrink-0 bg-white/[0.11]" />

export function LocationStatus() {
  const ds = usePC((s) => s.dataset)
  const camera = usePC((s) => s.camera)
  const activeId = usePC((s) => s.activeId)

  // Position read-out follows the selected point, otherwise the point the camera orbits.
  // Values are real-world (world-local + the model's display offset).
  const local = ds && activeId !== null ? pointXYZ(ds, activeId) : camera.target
  const at = ds ? toReal(ds, local) : local
  const geo = ds ? toGeographic(ds, local[0], local[1]) : null

  const metresPerPixel = (2 * camera.distance * Math.tan((CAMERA_FOV * Math.PI) / 360)) / Math.max(window.innerHeight, 1)
  const scale = niceLength(metresPerPixel * 90)
  const targetZ = ds ? toReal(ds, camera.target)[2] : camera.target[2]
  const altitude = targetZ + Math.cos((camera.tilt * Math.PI) / 180) * camera.distance

  return (
    <div className={`${BAR} right-[11px] flex w-[306px] items-center overflow-hidden pl-[13px] pr-[40px]`}>
      <span className={`${TEXT.replace('absolute top-[9px]', 'relative')} text-[#cfcfcf]`} title="Map scale">
        {scale >= 1000 ? `${scale / 1000}km` : `${scale}m`}
      </span>
      {DIVIDER}
      <span className={`${TEXT.replace('absolute top-[9px]', 'relative')} text-[#cfcfcf]`} title="Camera altitude">
        Camera: {Math.round(altitude)}m
      </span>
      {DIVIDER}
      <span className={`${TEXT.replace('absolute top-[9px]', 'relative')} text-[#cfcfcf]`} title="Elevation at the read-out position">
        {Math.round(at[2])}m
      </span>
      {DIVIDER}
      <span
        className={`${TEXT.replace('absolute top-[9px]', 'relative')} text-[#cfcfcf]`}
        title={geo ? 'Latitude / longitude' : 'Local coordinates (dataset is not georeferenced)'}
      >
        {geo
          ? `${fmtDegrees(geo.latitude, 'N', 'S')} ${fmtDegrees(geo.longitude, 'E', 'W')}`
          : `X ${at[0].toFixed(1)}  Y ${at[1].toFixed(1)}`}
      </span>
      <Compass heading={camera.heading} />
    </div>
  )
}
