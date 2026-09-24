import { terrainAt, toReal, worldXYZ, type PointCloudDataset, type Vec3 } from './pointCloud'

/**
 * Pure helpers for the Point Cloud View: measurements, camera framing, formatting.
 *
 * All geometry here uses WORLD-LOCAL coordinates (metres, Z up — `worldXYZ`), the
 * same frame the renderer draws, so distances / areas / slopes are always in
 * normalised real-world units, never raw model units. Values shown as absolute
 * coordinates or elevations are converted with `toReal` (adds the Float64
 * display offset of georeferenced / source coordinates).
 */

/* ---------------- deterministic density sampling (mirrors the vertex shader) ---------------- */

/** Uniform [0,1) value for a point id. MUST stay identical to `hash01` in the vertex shader. */
export function hash01(id: number): number {
  let h = id >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 8) / 16777216
}

/* ---------------- measurements ---------------- */

export interface ElevationStats {
  max: number
  min: number
  avg: number
  range: number
}

export type Measurement =
  | { kind: 'none' }
  | {
      kind: 'point'
      x: number
      y: number
      z: number
      terrainElevation: number
      /** Point Z − terrain elevation (roof, tree, … height above ground). */
      heightAboveTerrain: number
    }
  | {
      kind: 'line'
      distance3d: number
      horizontal: number
      vertical: number
      slopeDeg: number
      gradePct: number | null
    }
  | {
      kind: 'triangle'
      area: number
      perimeter: number
      /** Horizontal (plan) lengths of AB, BC, CA. */
      sides: [number, number, number]
      /** 3D lengths of AB, BC, CA. */
      distances3d: [number, number, number]
      planeSlopeDeg: number
    }
  | {
      kind: 'polygon'
      perimeter: number
      surfaceArea: number
      planArea: number
      /** Volume between the polygon surface and the terrain, or null without a reliable base surface. */
      volume: number | null
      /** Boundary order (indices into the selection) used for the outline. */
      order: number[]
    }
  | { kind: 'region'; count: number; centroid: Vec3; terrainMean: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const dist3 = (a: Vec3, b: Vec3) => length(sub(a, b))
export const distXY = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1])
const triangleArea = (a: Vec3, b: Vec3, c: Vec3) => length(cross(sub(b, a), sub(c, a))) / 2

/** World-local (metres, Z up) position of a point — the frame used for rendering and measuring. */
export const pointXYZ = (ds: PointCloudDataset, id: number): Vec3 => worldXYZ(ds, id)

/**
 * Volume enclosed between a polygon's (fan-triangulated) surface and the terrain
 * below it, integrated on a plan-view grid. Only meaningful when the terrain is
 * a real base surface (classified ground or a supplied DTM) — otherwise null.
 */
function volumeAboveTerrain(ds: PointCloudDataset, ring: Vec3[]): number | null {
  if (!ds.model.terrain.reliable || ring.length < 3) return null
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const N = 48
  const dx = (x1 - x0) / N
  const dy = (y1 - y0) / N
  if (!(dx > 0 && dy > 0)) return null
  let volume = 0
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x = x0 + (i + 0.5) * dx
      const y = y0 + (j + 0.5) * dy
      for (let t = 1; t < ring.length - 1; t += 1) {
        const [a, b, c] = [ring[0], ring[t], ring[t + 1]]
        const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if (Math.abs(d) < 1e-12) continue
        const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
        const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
        const l3 = 1 - l1 - l2
        if (l1 < 0 || l2 < 0 || l3 < 0) continue
        const ground = terrainAt(ds, x, y)
        if (Number.isFinite(ground)) volume += (l1 * a[2] + l2 * b[2] + l3 * c[2] - ground) * dx * dy
        break
      }
    }
  }
  return volume
}

/** Boundary order for 4+ points: sort around the XY centroid so the outline never self-intersects. */
export function polygonOrder(points: Vec3[]): number[] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length
  return points
    .map((p, i) => ({ i, angle: Math.atan2(p[1] - cy, p[0] - cx) }))
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.i)
}

export function measureSelection(ds: PointCloudDataset, ids: number[]): Measurement {
  const pts = ids.map((id) => pointXYZ(ds, id))
  switch (pts.length) {
    case 0:
      return { kind: 'none' }
    case 1: {
      const [x, y, z] = toReal(ds, pts[0])
      const terrainElevation = ds.terrainElevation[ids[0]] + ds.model.displayOffset[2]
      return { kind: 'point', x, y, z, terrainElevation, heightAboveTerrain: z - terrainElevation }
    }
    case 2: {
      const [a, b] = pts
      const horizontal = distXY(a, b)
      const vertical = Math.abs(b[2] - a[2])
      return {
        kind: 'line',
        distance3d: dist3(a, b),
        horizontal,
        vertical,
        slopeDeg: (Math.atan2(vertical, horizontal) * 180) / Math.PI,
        gradePct: horizontal > 1e-9 ? (vertical / horizontal) * 100 : null,
      }
    }
    case 3: {
      const [a, b, c] = pts
      const normal = cross(sub(b, a), sub(c, a))
      const normalLength = length(normal)
      const planeSlopeDeg =
        normalLength > 1e-12 ? (Math.acos(Math.min(1, Math.abs(normal[2]) / normalLength)) * 180) / Math.PI : 0
      const distances3d: [number, number, number] = [dist3(a, b), dist3(b, c), dist3(c, a)]
      return {
        kind: 'triangle',
        area: normalLength / 2,
        perimeter: distances3d[0] + distances3d[1] + distances3d[2],
        sides: [distXY(a, b), distXY(b, c), distXY(c, a)],
        distances3d,
        planeSlopeDeg,
      }
    }
    case 4: {
      const order = polygonOrder(pts)
      const ring = order.map((i) => pts[i])
      let perimeter = 0
      let surfaceArea = 0
      let planArea = 0
      for (let i = 0; i < ring.length; i += 1) {
        const p = ring[i]
        const q = ring[(i + 1) % ring.length]
        perimeter += dist3(p, q)
        planArea += p[0] * q[1] - q[0] * p[1]
      }
      for (let i = 1; i < ring.length - 1; i += 1) surfaceArea += triangleArea(ring[0], ring[i], ring[i + 1])
      return {
        kind: 'polygon',
        perimeter,
        surfaceArea,
        planArea: Math.abs(planArea) / 2,
        volume: volumeAboveTerrain(ds, ring),
        order,
      }
    }
    default: {
      const centroid = toReal(ds, [
        pts.reduce((s, p) => s + p[0], 0) / pts.length,
        pts.reduce((s, p) => s + p[1], 0) / pts.length,
        pts.reduce((s, p) => s + p[2], 0) / pts.length,
      ])
      const terrainMean =
        ids.reduce((s, id) => s + ds.terrainElevation[id], 0) / ids.length + ds.model.displayOffset[2]
      return { kind: 'region', count: pts.length, centroid, terrainMean }
    }
  }
}

export function elevationStats(ds: PointCloudDataset, ids: number[]): ElevationStats | null {
  if (!ids.length) return null
  let max = -Infinity
  let min = Infinity
  let sum = 0
  for (const id of ids) {
    const z = pointXYZ(ds, id)[2]
    if (z > max) max = z
    if (z < min) min = z
    sum += z
  }
  const oz = ds.model.displayOffset[2]
  return { max: max + oz, min: min + oz, avg: sum / ids.length + oz, range: max - min }
}

/* ---------------- camera framing (Z-up local coordinates) ---------------- */

export const CAMERA_FOV = 45

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Camera-space basis for a view with the given compass heading and tilt (degrees).
 * Tilt 0–180 is the camera's polar angle around the target: 0 = straight down
 * (top view), 90 = level, 180 = looking straight up from below.
 */
export function viewBasis(heading: number, tilt: number) {
  const h = rad(heading)
  const t = rad(tilt)
  const forward: Vec3 = [Math.sin(h) * Math.sin(t), Math.cos(h) * Math.sin(t), -Math.cos(t)]
  let right = cross(forward, [0, 0, 1])
  if (length(right) < 1e-6) right = [Math.cos(h), -Math.sin(h), 0]
  const rl = length(right)
  right = [right[0] / rl, right[1] / rl, right[2] / rl]
  const up = cross(right, forward)
  return { forward, right, up }
}

/**
 * Smallest camera distance (for `CAMERA_FOV`) at which the box fits inside
 * `fitX` / `fitY` of the viewport half-width / half-height.
 */
export function frameBounds(
  min: Vec3,
  max: Vec3,
  aspect: number,
  heading: number,
  tilt: number,
  fitX = 1,
  fitY = 0.98,
): { target: Vec3; distance: number } {
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const { forward, right, up } = viewBasis(heading, tilt)
  const tanV = Math.tan(rad(CAMERA_FOV / 2))
  const tanH = tanV * aspect
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  let distance = 0
  for (let i = 0; i < 8; i += 1) {
    const corner: Vec3 = [
      (i & 1 ? max[0] : min[0]) - target[0],
      (i & 2 ? max[1] : min[1]) - target[1],
      (i & 4 ? max[2] : min[2]) - target[2],
    ]
    const depth = dot(corner, forward)
    distance = Math.max(
      distance,
      Math.abs(dot(corner, right)) / (tanH * fitX) - depth,
      Math.abs(dot(corner, up)) / (tanV * fitY) - depth,
    )
  }
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1
  return { target, distance: Math.max(distance, radius * 1.05) }
}

/* ---------------- neighbourhood preview ---------------- */

/* ---------------- focus / zoom range (model-size aware) ---------------- */

/** Close-inspection stand-off from a focused structure's surface (metres). */
export const INSPECTION_DISTANCE = 10

/**
 * Camera distance for focusing a structure of bounding-sphere `radius` whose
 * full framing needs `frameDistance`: ≈10 m outside the structure where that
 * still frames it; small objects get the (smaller) framing distance; the camera
 * always stays outside the bounding sphere so it never starts inside geometry.
 */
export function inspectionDistance(radius: number, frameDistance: number) {
  return Math.max(radius * 1.15, Math.min(frameDistance, radius + INSPECTION_DISTANCE))
}

/** Allowed camera distance range (FOV-45° framing distance) for a dataset, from its real size. */
export function zoomLimits(ds: PointCloudDataset) {
  const { min, max } = ds.focusBounds
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1
  return {
    min: Math.min(Math.max(radius * 0.0005, 0.02), 1),
    max: Math.max(radius * 60, ds.model.boundingSphere.radius * 12),
  }
}

/** World-local bounds of every point belonging to `objectId` (null if none). */
export function objectBounds(ds: PointCloudDataset, objectId: number): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  let found = 0
  for (let i = 0; i < ds.count; i += 1) {
    if (ds.objectIds[i] !== objectId) continue
    const p = worldXYZ(ds, i)
    for (let k = 0; k < 3; k += 1) {
      if (p[k] < min[k]) min[k] = p[k]
      if (p[k] > max[k]) max[k] = p[k]
    }
    found += 1
  }
  return found ? { min, max } : null
}

/* ---------------- neighbourhood preview ---------------- */

/** Up to `limit` points within `radius` metres of point `id` (flat world-local x,y,z,r,g,b, evenly thinned). */
export function neighbourhood(ds: PointCloudDataset, id: number, radius: number, limit = 1400) {
  // Search in the stored frame: rotation + uniform scale keep distances (÷ unitsToMeters).
  const cx = ds.positions[id * 3]
  const cy = ds.positions[id * 3 + 1]
  const cz = ds.positions[id * 3 + 2]
  const hits: number[] = []
  radius /= ds.model.unitsToMeters
  const r2 = radius * radius
  const p = ds.positions
  for (let i = 0; i < ds.count; i += 1) {
    const dx = p[i * 3] - cx
    if (dx > radius || dx < -radius) continue
    const dy = p[i * 3 + 1] - cy
    if (dy > radius || dy < -radius) continue
    const dz = p[i * 3 + 2] - cz
    if (dx * dx + dy * dy + dz * dz <= r2) hits.push(i)
  }
  const step = Math.max(1, hits.length / limit)
  const out: number[] = []
  for (let k = 0; k < hits.length; k += step) {
    const i = hits[Math.floor(k)]
    out.push(...worldXYZ(ds, i), ds.colors[i * 4], ds.colors[i * 4 + 1], ds.colors[i * 4 + 2])
  }
  return { data: new Float32Array(out), center: worldXYZ(ds, id), total: hits.length }
}

/* ---------------- formatting ---------------- */

export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export const fmtMetres = (value: number, digits = 2) => `${fmt(value, digits)} m`

/** Compact distance for tight read-outs: 35cm · 4.2m · 120m · 3.4km. */
export function fmtDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—'
  if (metres < 1) return `${Math.round(metres * 100)}cm`
  if (metres < 10) return `${metres.toFixed(1)}m`
  if (metres < 1000) return `${Math.round(metres)}m`
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)}km`
}

export function fmtCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(value)
}

export function fmtDegrees(latOrLon: number, positive: string, negative: string): string {
  return `${Math.abs(latOrLon).toFixed(6)}° ${latOrLon >= 0 ? positive : negative}`
}

/** 1-2-5 "nice" length ≤ `value` (for the scale read-out). */
export function niceLength(value: number): number {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  const f = value / base
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * base
}
