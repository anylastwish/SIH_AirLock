import type { ModelFormat } from './formats'
import {
  IDENTITY3,
  angleDeg,
  apply3,
  estimateGround,
  eulerDegToMat3,
  isRotation,
  mul3,
  quaternionToMat3,
  rotationBetween,
  transpose3,
  upAxisRotation,
  type GroundEstimate,
  type Mat3,
} from './modelAlignment'
import type { GeoReference, SemanticClassId, Vec3 } from './pointCloud'
import type { ActiveModel } from './session'

/**
 * Model metadata → one normalised `ModelState` (scale, orientation, position,
 * terrain reference) for every format.
 *
 * Each loader only *collects* metadata candidates (glTF extras, PLY / OBJ header
 * comments, the Sketchfab export node, an optional companion
 * `<model>.metadata.json`, the format's own conventions). `resolveModelState`
 * then picks every value by priority —
 *
 *   1 embedded (in the model file)   2 companion (AirLock++ ML pipeline)
 *   3 format convention              4 geometry estimate        5 safe default
 *
 * — so reliable metadata is never overwritten by a frontend estimate, and
 * missing / partial / malformed metadata simply falls through to the next
 * level. Full description: brain/model-scaling-and-camera.md.
 */

/* ------------------------------------ types ------------------------------------ */

export type LengthUnit = 'm' | 'cm' | 'mm' | 'dm' | 'km' | 'in' | 'ft' | 'us-ft' | 'yd'
export type MetadataLevel = 'embedded' | 'companion' | 'format' | 'geometry' | 'default'
export type Confidence = 'high' | 'medium' | 'low' | 'none'

export const UNIT_TO_METERS: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  dm: 0.1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  'us-ft': 1200 / 3937,
  yd: 0.9144,
}

const UNIT_ALIASES: Record<string, LengthUnit> = {
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  dm: 'dm', decimeter: 'dm', decimetre: 'dm',
  km: 'km', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  in: 'in', inch: 'in', inches: 'in',
  ft: 'ft', foot: 'ft', feet: 'ft', 'international foot': 'ft',
  'us-ft': 'us-ft', usft: 'us-ft', 'us survey foot': 'us-ft', 'us_survey_foot': 'us-ft', 'survey foot': 'us-ft',
  yd: 'yd', yard: 'yd', yards: 'yd',
}

/** Optional DTM in real-world (display) coordinates: `heights[row * cols + col]`, row 0 = min Y. */
export interface TerrainGridInput {
  originX: number
  originY: number
  cellSize: number
  cols: number
  rows: number
  heights: number[]
}

/** Everything one metadata block can say. Every field is optional (partial metadata is normal). */
export interface ParsedMetadata {
  units?: LengthUnit
  /** Native unit → metres. */
  unitsToMeters?: number
  /** Native axes → world (Z up, X east, Y north), row-major. */
  rotation?: Mat3
  /** World metres, added after scale + rotation. */
  translation?: Vec3
  /** Native coordinates of the model's reference point (rotation / scale pivot). */
  pivot?: Vec3
  coordinateSystem?: string
  /** WGS84 position of real-world coordinate (0, 0). */
  geoOrigin?: { latitude: number; longitude: number; height?: number }
  terrain?: { groundZ?: number; grid?: TerrainGridInput }
  boundingBox?: { min: Vec3; max: Vec3 }
  dimensions?: Vec3
  /** Source class code → semantic class (PLY `classification`-like property). */
  semanticClasses?: Record<number, SemanticClassId>
}

export interface MetadataCandidate {
  level: 'embedded' | 'companion' | 'format'
  /** Human-readable origin, e.g. "glTF extras", "survey.metadata.json". */
  label: string
  data: ParsedMetadata
}

export interface Provenance {
  source: MetadataLevel
  /** Which block / method produced the value. */
  label: string
  confidence: Confidence
}

/**
 * Clean internal model state (debug / future ML integration). Coordinate frames:
 *  - native:      coordinates as stored in the file (glTF: after its node hierarchy)
 *  - stored:      native − `sourceOrigin` (what `dataset.positions` holds, Float32)
 *  - world-local: `linear · stored` — metres, Z up, origin at the model centre;
 *                 rendering, picking, camera and measurements all use this frame
 *  - real-world:  world-local + `displayOffset` (Float64) — what the UI shows
 */
export interface ModelState {
  sourceFormat: ModelFormat
  /** Every metadata block that was found (used or not). */
  metadataSources: string[]
  warnings: string[]
  units: LengthUnit | 'custom' | 'unknown'
  unitsToMeters: number
  scale: Provenance
  /** Native → world rotation (row-major). */
  rotation: Mat3
  orientation: Provenance & {
    /** Rotation applied on top of the metadata / format orientation by terrain alignment, degrees. */
    correctionDeg: number
    inverted: boolean
    terrainAligned: boolean
  }
  /** rotation · unitsToMeters: stored → world-local (row-major). */
  linear: Mat3
  sourceOrigin: Vec3
  displayOffset: Vec3
  position: Provenance & { georeferenced: boolean }
  coordinateSystem: string
  geoReference: GeoReference | null
  ground: {
    source: MetadataLevel
    method: GroundEstimate['method'] | 'metadata'
    /** Ground normal in world-local coordinates (≈ +Z after alignment). */
    normal: Vec3
    /** World-local height of the ground plane at the model centre. */
    height: number
    confidence: Confidence
    inlierRatio: number
  }
  terrain: { source: 'classification' | 'metadata' | 'estimated'; reliable: boolean }
  originalBounds: { min: Vec3; max: Vec3 }
  finalBounds: { min: Vec3; max: Vec3 }
  dimensions: Vec3
  boundingSphere: { center: Vec3; radius: number }
}

/* ------------------------------------ parsing ------------------------------------ */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numArray = (v: unknown, length?: number): number[] | null => {
  if (!Array.isArray(v) || !v.every(isNum)) return null
  return length === undefined || v.length === length ? (v as number[]) : null
}
const vec3 = (v: unknown): Vec3 | null => {
  const a = numArray(v, 3)
  if (a) return [a[0], a[1], a[2]]
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (isNum(o.x) && isNum(o.y) && isNum(o.z)) return [o.x, o.y, o.z]
  }
  return null
}

export function parseUnit(value: unknown): LengthUnit | null {
  if (typeof value !== 'string') return null
  return UNIT_ALIASES[value.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null
}

function parseRotation(value: unknown): Mat3 | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if (o.quaternion !== undefined) return parseRotation(o.quaternion)
    if (o.matrix !== undefined) return parseRotation(o.matrix)
    if (o.euler !== undefined) {
      const e = numArray(o.euler, 3)
      return e ? eulerDegToMat3(e) : null
    }
    if (isNum(o.x) && isNum(o.y) && isNum(o.z) && isNum(o.w)) return quaternionToMat3([o.x, o.y, o.z, o.w])
    return null
  }
  const a = numArray(value)
  if (!a) return null
  let m: Mat3 | null = null
  if (a.length === 4) m = quaternionToMat3(a)
  else if (a.length === 3) m = eulerDegToMat3(a)
  else if (a.length === 9) m = [...a]
  else if (a.length === 16) m = [a[0], a[4], a[8], a[1], a[5], a[9], a[2], a[6], a[10]] // column-major 4×4
  return m && isRotation(m) ? m : null
}

/** Column-major 4×4 (glTF style) → uniform scale, rotation, translation. Mirrors / shear are rejected. */
function decomposeTransform(value: unknown, warnings: string[]) {
  const a = numArray(value, 16)
  if (!a) return null
  const cols: Vec3[] = [[a[0], a[1], a[2]], [a[4], a[5], a[6]], [a[8], a[9], a[10]]]
  const lengths = cols.map((c) => Math.hypot(...c))
  const scale = (lengths[0] + lengths[1] + lengths[2]) / 3
  if (!(scale > 0)) return null
  if (Math.max(...lengths) / Math.min(...lengths) > 1.001) warnings.push('transform has non-uniform scale — using the mean')
  const r: Mat3 = [
    cols[0][0] / lengths[0], cols[1][0] / lengths[1], cols[2][0] / lengths[2],
    cols[0][1] / lengths[0], cols[1][1] / lengths[1], cols[2][1] / lengths[2],
    cols[0][2] / lengths[0], cols[1][2] / lengths[1], cols[2][2] / lengths[2],
  ]
  const rotation = isRotation(r, 1e-2) ? r : null
  if (!rotation) warnings.push('transform rotation is mirrored or sheared — ignored')
  return { scale, rotation, translation: [a[12], a[13], a[14]] as Vec3 }
}

const SEMANTIC_IDS = new Set(['buildings', 'roads', 'vegetation', 'water', 'terrain', 'other'])
const WRAPPERS = ['airlock', 'airlockpp', 'airlock++', 'metadata', 'modelmetadata', 'model_metadata']

/**
 * Validate one metadata object. Unknown keys are ignored; malformed values are
 * dropped with a warning; returns null when nothing usable was found.
 */
export function parseMetadataObject(raw: unknown, warnings: string[] = []): ParsedMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const lower: Record<string, unknown> = {}
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    lower[k.toLowerCase()] = v
  })
  for (const wrapper of WRAPPERS) {
    if (lower[wrapper] && typeof lower[wrapper] === 'object') {
      const inner = parseMetadataObject(lower[wrapper], warnings)
      if (inner) return inner
    }
  }
  const pick = (...keys: string[]) => keys.map((k) => lower[k]).find((v) => v !== undefined && v !== null)
  const out: ParsedMetadata = {}

  const unitValue = pick('units', 'unit', 'lengthunit', 'length_unit', 'linearunit', 'linear_unit')
  if (unitValue !== undefined) {
    const unit = parseUnit(unitValue)
    if (unit) out.units = unit
    else warnings.push(`unknown unit "${String(unitValue)}" — ignored`)
  }
  let scale: number | null = null
  const scaleValue = pick('unitstometers', 'unitstometres', 'metersperunit', 'metresperunit', 'meterperunit', 'scale_to_meters', 'scaletometers', 'scale', 'scalefactor', 'scale_factor')
  if (scaleValue !== undefined) {
    const arr = numArray(scaleValue, 3)
    const s = isNum(scaleValue) ? scaleValue : arr ? (arr[0] + arr[1] + arr[2]) / 3 : typeof scaleValue === 'string' ? Number(scaleValue) : NaN
    if (arr && Math.max(...arr) / Math.min(...arr) > 1.001) warnings.push('non-uniform scale — using the mean')
    if (Number.isFinite(s) && s > 0 && s < 1e7) scale = s
    else warnings.push(`invalid scale "${String(scaleValue)}" — ignored`)
  }
  const transform = pick('transform', 'matrix', 'modeltransform', 'model_transform')
  const decomposed = transform !== undefined ? decomposeTransform(transform, warnings) : null
  if (transform !== undefined && !decomposed) warnings.push('transform is not a 16-number matrix — ignored')
  if (scale === null && decomposed) scale = decomposed.scale
  if (out.units || scale !== null) out.unitsToMeters = (out.units ? UNIT_TO_METERS[out.units] : 1) * (scale ?? 1)

  const rotationValue = pick('rotation', 'orientation', 'quaternion')
  if (rotationValue !== undefined) {
    const r = parseRotation(rotationValue)
    if (r) out.rotation = r
    else warnings.push('rotation is not a valid quaternion / Euler / rotation matrix — ignored')
  }
  if (!out.rotation && decomposed?.rotation) out.rotation = decomposed.rotation
  const upValue = pick('upaxis', 'up_axis', 'up')
  if (!out.rotation && upValue !== undefined) {
    const r = typeof upValue === 'string' ? upAxisRotation(upValue) : null
    if (r) out.rotation = r
    else warnings.push(`unknown up axis "${String(upValue)}" — ignored`)
  }

  const translation = vec3(pick('translation', 'offset', 'position')) ?? decomposed?.translation ?? null
  if (translation) out.translation = translation
  const origin = pick('origin', 'pivot', 'referencepoint', 'reference_point')
  if (origin !== undefined) {
    const o = origin as Record<string, unknown>
    const asVec = vec3(origin)
    if (asVec) out.pivot = asVec
    else if (o && isNum(o.latitude) && isNum(o.longitude)) out.geoOrigin = { latitude: o.latitude, longitude: o.longitude, height: isNum(o.height) ? o.height : undefined }
    else warnings.push('origin is neither [x, y, z] nor {latitude, longitude} — ignored')
  }
  const geo = pick('georeference', 'geo', 'geoorigin', 'geo_origin', 'wgs84')
  const geoSource = geo && typeof geo === 'object' ? (geo as Record<string, unknown>) : lower
  if (!out.geoOrigin && isNum(geoSource.latitude) && isNum(geoSource.longitude)) {
    if (Math.abs(geoSource.latitude) <= 90 && Math.abs(geoSource.longitude) <= 180)
      out.geoOrigin = { latitude: geoSource.latitude, longitude: geoSource.longitude, height: isNum(geoSource.height) ? geoSource.height : undefined }
    else warnings.push('latitude / longitude out of range — ignored')
  }
  const crs = pick('coordinatesystem', 'coordinate_system', 'crs', 'srs', 'epsg')
  if (typeof crs === 'string' && crs.trim()) out.coordinateSystem = crs.trim()
  else if (isNum(crs)) out.coordinateSystem = `EPSG:${crs}`

  const terrain = pick('terrainreference', 'terrain_reference', 'terrain', 'ground', 'groundinformation')
  if (terrain && typeof terrain === 'object') {
    const t = terrain as Record<string, unknown>
    const groundZ = [t.groundz, t.groundZ, t.height, t.elevation, t.z].find(isNum)
    const g = t.grid as Record<string, unknown> | undefined
    const grid =
      g && isNum(g.originX) && isNum(g.originY) && isNum(g.cellSize) && g.cellSize > 0 && isNum(g.cols) && isNum(g.rows) && numArray(g.heights)?.length === g.cols * g.rows
        ? (g as unknown as TerrainGridInput)
        : undefined
    if (g && !grid) warnings.push('terrain grid is incomplete — ignored')
    if (groundZ !== undefined || grid) out.terrain = { groundZ, grid }
  } else if (isNum(terrain)) out.terrain = { groundZ: terrain }

  const bbox = pick('boundingbox', 'bounding_box', 'bbox', 'bounds') as Record<string, unknown> | undefined
  const bMin = bbox ? vec3(bbox.min) : null
  const bMax = bbox ? vec3(bbox.max) : null
  if (bMin && bMax) out.boundingBox = { min: bMin, max: bMax }
  const dims = vec3(pick('dimensions', 'size', 'extent'))
  if (dims) out.dimensions = dims

  const classes = pick('semanticclasses', 'semantic_classes', 'classmap', 'class_map')
  if (classes && typeof classes === 'object') {
    const map: Record<number, SemanticClassId> = {}
    Object.entries(classes as Record<string, unknown>).forEach(([code, id]) => {
      if (Number.isFinite(Number(code)) && typeof id === 'string' && SEMANTIC_IDS.has(id)) map[Number(code)] = id as SemanticClassId
    })
    if (Object.keys(map).length) out.semanticClasses = map
  }

  return Object.keys(out).length ? out : null
}

/**
 * `comment key value` lines (PLY header, `# key value` in OBJ) → metadata.
 * Accepts `units cm`, `unit: mm`, `scale=0.01`, `up z`, `crs EPSG:32633`,
 * `offset 1 2 3`, and a whole JSON object after `airlock`.
 */
export function metadataFromComments(lines: string[], warnings: string[] = []): ParsedMetadata | null {
  const fields: Record<string, unknown> = {}
  for (const raw of lines) {
    const line = raw.trim()
    const json = line.match(/^(?:airlock|airlock\+\+|metadata)\s*[:=]?\s*(\{.*)$/i)
    if (json) {
      try {
        const parsed = parseMetadataObject(JSON.parse(json[1]), warnings)
        if (parsed) return parsed
      } catch {
        warnings.push('embedded JSON metadata is malformed — ignored')
      }
      continue
    }
    const kv = line.match(/^([A-Za-z][\w -]*?)\s*[:=]?\s+(.+)$/) ?? line.match(/^([A-Za-z][\w-]*)\s*[:=]\s*(.+)$/)
    if (!kv) continue
    const key = kv[1].trim().toLowerCase().replace(/\s+/g, '_')
    const value = kv[2].trim()
    const numbers = value.split(/[\s,]+/).map(Number)
    fields[key] = numbers.every(Number.isFinite) ? (numbers.length === 1 ? numbers[0] : numbers) : value
  }
  return parseMetadataObject(fields, warnings)
}

/* ------------------------------ companion metadata ------------------------------ */

/**
 * Optional companion file from the ML pipeline: `<model>.metadata.json` next to
 * the model. Never required. Uploaded companions ride along with the model
 * files; for served models (backend / pre-made) the sibling URL is probed.
 * Missing, non-JSON or malformed → null.
 */
export async function loadCompanionMetadata(
  model: ActiveModel,
  warnings: string[],
): Promise<{ label: string; raw: unknown } | null> {
  const base = model.name.replace(/\.[^.]+$/, '').toLowerCase()
  const names = [`${base}.metadata.json`, `${base}.airlock.json`, `${base}.transform.json`, 'metadata.json', 'transform.json']
  const readJson = async (url: string, label: string, strict: boolean) => {
    let text: string
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) return null
      // Dev servers / SPA hosts answer unknown paths with index.html — only accept JSON.
      if (strict && !(response.headers.get('content-type') ?? '').includes('json')) return null
      text = await response.text()
    } catch {
      return null // not reachable: simply no companion
    }
    try {
      return { label, raw: JSON.parse(text) as unknown }
    } catch {
      warnings.push(`${label} is not valid JSON — ignored`)
      return null
    }
  }
  for (const name of names) {
    const url = model.assets[name]
    if (url) {
      const found = await readJson(url, name, false)
      if (found) return found
    }
  }
  if (!model.url.startsWith('blob:')) {
    const sibling = model.url.replace(/\.[^./?#]+(?=([?#].*)?$)/, '.metadata.json')
    if (sibling !== model.url) return readJson(sibling, `${base}.metadata.json`, true)
  }
  return null
}

/* ------------------------------------ resolution ------------------------------------ */

const ORDER: Record<MetadataCandidate['level'], number> = { embedded: 0, companion: 1, format: 2 }
const SAMPLE_TARGET = 60_000
/**
 * Terrain alignment only rotates a model whose ground is at least this far off
 * level: real terrain has gentle slopes / undulation that a plane fit reports as
 * a fraction of a degree, and "correcting" that would just move the data.
 */
const MIN_CORRECTION_DEG = 2

export interface ResolveInput {
  format: ModelFormat
  candidates: MetadataCandidate[]
  /** Stored (native − sourceOrigin) positions. */
  positions: Float32Array
  count: number
  sourceOrigin: Vec3
  originalBounds: { min: Vec3; max: Vec3 }
  /** Per point: 1 = ground-classified by the source (e.g. PLY classification 2). */
  groundMask: Uint8Array | null
  /** Native-frame unit normals (an up/down cue), when the source has them. */
  normals: Float32Array | null
  warnings: string[]
}

export type ResolvedModel = Omit<ModelState, 'finalBounds' | 'dimensions' | 'boundingSphere' | 'terrain'> & {
  terrainInput: ParsedMetadata['terrain'] | null
  semanticClasses: Record<number, SemanticClassId> | null
}

/** Pick each value by priority, then estimate only what is still missing. */
export function resolveModelState(input: ResolveInput): ResolvedModel {
  const { candidates, positions, count, sourceOrigin, warnings } = input
  const ordered = [...candidates].sort((a, b) => ORDER[a.level] - ORDER[b.level])
  const first = <K extends keyof ParsedMetadata>(key: K) => {
    const hit = ordered.find((c) => c.data[key] !== undefined)
    return hit ? { value: hit.data[key] as NonNullable<ParsedMetadata[K]>, from: hit } : null
  }
  const confidenceOf = (c: MetadataCandidate, formatConfidence: Confidence): Confidence =>
    c.level === 'format' ? formatConfidence : 'high'

  /* 1. scale */
  const scaleHit = first('unitsToMeters')
  const unitsToMeters = scaleHit?.value ?? 1
  const unitHit = first('units')
  const units: ModelState['units'] = scaleHit
    ? unitHit && unitHit.from === scaleHit.from
      ? unitHit.value
      : scaleHit.value === 1 && unitHit
        ? unitHit.value
        : 'custom'
    : 'unknown'
  const scale: Provenance = scaleHit
    ? { source: scaleHit.from.level, label: scaleHit.from.label, confidence: confidenceOf(scaleHit.from, 'medium') }
    : { source: 'default', label: 'no unit information — 1 model unit shown as 1 m', confidence: 'none' }
  if (!scaleHit) warnings.push('scale unknown: 1 model unit is displayed as 1 m (not verified)')

  /* 2. orientation: metadata / format convention, then terrain alignment if not reliable */
  const rotationHit = first('rotation')
  const baseRotation = rotationHit?.value ?? [...IDENTITY3]
  const reliableOrientation = rotationHit !== null && rotationHit.from.level !== 'format'
  const sampleStep = Math.max(1, Math.floor(count / SAMPLE_TARGET))
  const sampleCount = Math.floor((count - 1) / sampleStep) + 1
  const makeSample = (m: Mat3) => {
    const sample = new Float64Array(sampleCount * 3)
    const mask = input.groundMask ? new Uint8Array(sampleCount) : null
    const normals = input.normals ? new Float64Array(sampleCount * 3) : null
    for (let k = 0; k < sampleCount; k += 1) {
      const i = k * sampleStep
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      sample[k * 3] = (m[0] * x + m[1] * y + m[2] * z) * unitsToMeters
      sample[k * 3 + 1] = (m[3] * x + m[4] * y + m[5] * z) * unitsToMeters
      sample[k * 3 + 2] = (m[6] * x + m[7] * y + m[8] * z) * unitsToMeters
      if (mask) mask[k] = input.groundMask![i]
      if (normals) normals.set(apply3(m, [input.normals![i * 3], input.normals![i * 3 + 1], input.normals![i * 3 + 2]]), k * 3)
    }
    return { sample, mask, normals }
  }
  const nominal = makeSample(baseRotation)
  const estimate = estimateGround(nominal.sample, nominal.mask, nominal.normals)
  /** Only a confident estimate may raise "looks off level" warnings. */
  const confidentEstimate = estimate.method === 'classification' || (estimate.inlierRatio >= 0.6 && estimate.signStrength >= 2)

  let rotation = baseRotation
  let orientation: ModelState['orientation']
  let groundNormal: Vec3 = [0, 0, 1]
  let groundHeight = estimate.groundOffset
  if (reliableOrientation) {
    orientation = {
      source: rotationHit!.from.level,
      label: rotationHit!.from.label,
      confidence: 'high',
      correctionDeg: 0,
      inverted: false,
      terrainAligned: false,
    }
    groundNormal = estimate.up
    if (confidentEstimate && estimate.tiltDeg > 20)
      warnings.push(`metadata orientation kept although the ground looks ${Math.round(estimate.tiltDeg)}° off level`)
  } else {
    const tilt = estimate.tiltDeg
    const planeOk = estimate.method === 'classification' || estimate.inlierRatio >= 0.4
    const accept =
      estimate.method !== 'none' &&
      planeOk &&
      (tilt <= 60 || (estimate.signStrength >= 1 && (estimate.flatness < 0.35 || estimate.method === 'classification')))
    if (accept && tilt < MIN_CORRECTION_DEG) {
      // Ground confirmed level — keep the source orientation (and its exact coordinates).
      orientation = {
        source: 'geometry',
        label: `ground-plane fit: already level (${tilt.toFixed(1)}°)`,
        confidence: estimate.inlierRatio >= 0.6 ? 'high' : 'medium',
        correctionDeg: 0,
        inverted: false,
        terrainAligned: false,
      }
      groundNormal = estimate.up
    } else if (accept) {
      const correction = rotationBetween(estimate.up, [0, 0, 1])
      rotation = mul3(correction, baseRotation)
      const strong = estimate.method === 'classification' || (estimate.signStrength >= 2 && estimate.inlierRatio >= 0.6)
      orientation = {
        source: 'geometry',
        label: estimate.method === 'classification' ? 'ground-classified points' : 'robust ground-plane fit',
        confidence: strong ? 'high' : 'medium',
        correctionDeg: tilt,
        inverted: tilt > 120,
        terrainAligned: tilt >= 0.05,
      }
    } else {
      orientation = rotationHit
        ? { source: 'format', label: rotationHit.from.label, confidence: 'low', correctionDeg: 0, inverted: false, terrainAligned: false }
        : { source: 'default', label: 'source axes (Z up)', confidence: 'none', correctionDeg: 0, inverted: false, terrainAligned: false }
      groundNormal = estimate.up
      warnings.push('ground / up direction could not be detected reliably — default orientation (adjust with Flip)')
    }
  }

  /* 3. position */
  const translationHit = first('translation')
  const pivotHit = first('pivot')
  const geoHit = first('geoOrigin')
  const crsHit = first('coordinateSystem')
  const linear = rotation.map((v) => v * unitsToMeters)
  const positioned = translationHit !== null || geoHit !== null || (crsHit !== null && !/^local/i.test(crsHit.value))
  let displayOffset: Vec3
  if (positioned) {
    // real = R·S·(native − pivot) + T  ⇒  offset of the stored frame = R·S·(origin − pivot) + T
    const pivot = pivotHit?.value ?? [0, 0, 0]
    const rel = apply3(linear, [sourceOrigin[0] - pivot[0], sourceOrigin[1] - pivot[1], sourceOrigin[2] - pivot[2]])
    const t = translationHit?.value ?? [0, 0, 0]
    displayOffset = [rel[0] + t[0], rel[1] + t[1], rel[2] + t[2]]
  } else {
    // Local model: keep the source's own coordinate values; estimated alignment turns about the model centre.
    displayOffset = apply3(baseRotation.map((v) => v * unitsToMeters), sourceOrigin)
  }
  const positionFrom = translationHit?.from ?? geoHit?.from ?? crsHit?.from
  const position: ModelState['position'] = positioned
    ? { source: positionFrom!.level, label: positionFrom!.label, confidence: confidenceOf(positionFrom!, 'medium'), georeferenced: geoHit !== null || crsHit !== null }
    : { source: 'default', label: 'local coordinates (not georeferenced)', confidence: 'none', georeferenced: false }

  let geoReference: GeoReference | null = null
  if (geoHit) {
    // geoOrigin is real-world (0, 0); toGeographic() works in world-local coordinates.
    const { latitude, longitude } = geoHit.value
    geoReference = {
      originLatitude: latitude + displayOffset[1] / 111_320,
      originLongitude: longitude + displayOffset[0] / (111_320 * Math.cos((latitude * Math.PI) / 180)),
    }
  }

  /* 4. ground information in the final frame */
  const toFinal = mul3(rotation, transpose3(baseRotation))
  const normalWorld = orientation.terrainAligned ? ([0, 0, 1] as Vec3) : apply3(toFinal, groundNormal)
  const terrainHit = first('terrain')
  let groundSource: MetadataLevel = estimate.method === 'none' ? 'default' : 'geometry'
  let groundMethod: ModelState['ground']['method'] = estimate.method
  if (terrainHit?.value.groundZ !== undefined) {
    groundHeight = terrainHit.value.groundZ - displayOffset[2]
    groundSource = terrainHit.from.level
    groundMethod = 'metadata'
  } else if (orientation.source === 'geometry') {
    groundHeight = estimate.groundOffset
  } else if (estimate.method !== 'none') {
    groundHeight = estimate.groundOffset * Math.max(0, normalWorld[2])
  }

  const metadataSources = candidates.map((c) => `${c.level}: ${c.label}`)
  if (angleDeg(normalWorld, [0, 0, 1]) > 5 && !orientation.terrainAligned && confidentEstimate)
    warnings.push('terrain is not level in the displayed orientation')

  return {
    sourceFormat: input.format,
    metadataSources,
    warnings,
    units,
    unitsToMeters,
    scale,
    rotation,
    orientation,
    linear,
    sourceOrigin,
    displayOffset,
    position,
    coordinateSystem: crsHit?.value ?? 'local',
    geoReference,
    ground: {
      source: groundSource,
      method: groundMethod,
      normal: normalWorld,
      height: groundHeight,
      confidence:
        groundMethod === 'metadata' || groundMethod === 'classification'
          ? 'high'
          : estimate.inlierRatio >= 0.6
            ? 'medium'
            : estimate.method === 'none'
              ? 'none'
              : 'low',
      inlierRatio: estimate.inlierRatio,
    },
    originalBounds: input.originalBounds,
    terrainInput: terrainHit?.value ?? null,
    semanticClasses: first('semanticClasses')?.value ?? null,
  }
}

/** Default ASPRS LAS classification codes → AirLock semantic classes. */
export const ASPRS_CLASSES: Record<number, SemanticClassId> = {
  2: 'terrain',
  3: 'vegetation',
  4: 'vegetation',
  5: 'vegetation',
  6: 'buildings',
  7: 'other',
  8: 'terrain',
  9: 'water',
  10: 'roads',
  11: 'roads',
  13: 'other',
  14: 'other',
  15: 'other',
  16: 'other',
  17: 'other',
  18: 'other',
}

/** Short label for the status read-out. */
export function scaleStatus(state: ModelState): string {
  if (state.scale.source === 'default') return 'Unknown'
  if (state.scale.source === 'format') return 'Format'
  return 'Metadata'
}
