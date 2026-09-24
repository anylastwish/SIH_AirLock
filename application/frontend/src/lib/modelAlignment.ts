import type { Vec3 } from './pointCloud'

/**
 * Pure geometry for automatic model orientation / terrain alignment.
 *
 * Everything here works on a small *sample* of the cloud (tens of thousands of
 * points, Float64, already scaled to metres and centred) — never on the full
 * dataset — and runs once while a model loads. See
 * brain/model-scaling-and-camera.md for the algorithm and its limits.
 *
 * Matrices are row-major 3×3 `number[9]` (`Mat3`); vectors are `Vec3`.
 */

export type Mat3 = number[]

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
/** glTF / OBJ convention (Y up) → AirLock world (Z up, X east, Y north): (x, y, z) → (x, −z, y). */
export const Y_UP_TO_Z_UP: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0]

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1]
}
export const angleDeg = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))))) * 180) / Math.PI

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r += 1)
    for (let c = 0; c < 3; c += 1) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return out
}
export const apply3 = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]
export const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
export const det3 = (m: Mat3) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])

/** True for a proper rotation (orthonormal, det +1) within `tolerance`. */
export function isRotation(m: Mat3, tolerance = 1e-3): boolean {
  if (m.length !== 9 || m.some((v) => !Number.isFinite(v))) return false
  const p = mul3(m, transpose3(m))
  for (let i = 0; i < 9; i += 1) if (Math.abs(p[i] - IDENTITY3[i]) > tolerance) return false
  return Math.abs(det3(m) - 1) < tolerance
}

/** Rodrigues: rotation of `angle` radians about unit `axis`. */
export function axisAngle(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = normalize(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

/** Smallest rotation turning direction `from` onto `to`. Opposite vectors rotate 180° about a horizontal axis. */
export function rotationBetween(from: Vec3, to: Vec3): Mat3 {
  const a = normalize(from)
  const b = normalize(to)
  const c = dot(a, b)
  if (c > 1 - 1e-12) return [...IDENTITY3]
  if (c < -1 + 1e-12) {
    // Any axis ⟂ a works; prefer X so an upside-down Z-up model keeps its east axis.
    const axis = Math.abs(a[0]) < 0.9 ? normalize(cross(a, [1, 0, 0])) : normalize(cross(a, [0, 1, 0]))
    return axisAngle(axis, Math.PI)
  }
  return axisAngle(cross(a, b), Math.acos(c))
}

export function quaternionToMat3([x, y, z, w]: number[]): Mat3 {
  const l = Math.hypot(x, y, z, w) || 1
  x /= l
  y /= l
  z /= l
  w /= l
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}

/** Intrinsic X→Y→Z Euler angles in degrees (R = Rz · Ry · Rx, i.e. applied X first). */
export function eulerDegToMat3([x, y, z]: number[]): Mat3 {
  const r = Math.PI / 180
  return mul3(axisAngle([0, 0, 1], z * r), mul3(axisAngle([0, 1, 0], y * r), axisAngle([1, 0, 0], x * r)))
}

/** Rotation whose +Z (world up) is the given source axis, e.g. 'y' for Y-up data, '-z' for upside-down Z-up. */
export function upAxisRotation(axis: string): Mat3 | null {
  const table: Record<string, Vec3> = {
    x: [1, 0, 0], '+x': [1, 0, 0], '-x': [-1, 0, 0],
    y: [0, 1, 0], '+y': [0, 1, 0], '-y': [0, -1, 0],
    z: [0, 0, 1], '+z': [0, 0, 1], '-z': [0, 0, -1],
  }
  const up = table[axis.trim().toLowerCase()]
  if (!up) return null
  if (up[1] === 1) return [...Y_UP_TO_Z_UP] // glTF convention: keep −Z forward → north
  return rotationBetween(up, [0, 0, 1])
}

/* ------------------------------ eigen / PCA ------------------------------ */

/** Jacobi eigen-decomposition of a symmetric 3×3 matrix. Returns eigenpairs sorted by descending value. */
export function symmetricEigen3(m: Mat3): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
  const a = [...m]
  const v = [...IDENTITY3]
  for (let sweep = 0; sweep < 32; sweep += 1) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5])
    if (off < 1e-14) break
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q]
      if (Math.abs(apq) < 1e-18) continue
      const app = a[p * 3 + p]
      const aqq = a[q * 3 + q]
      const theta = (aqq - app) / (2 * apq)
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p]
        const akq = a[k * 3 + q]
        a[k * 3 + p] = c * akp - s * akq
        a[k * 3 + q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k]
        const aqk = a[q * 3 + k]
        a[p * 3 + k] = c * apk - s * aqk
        a[q * 3 + k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k * 3 + p]
        const vkq = v[k * 3 + q]
        v[k * 3 + p] = c * vkp - s * vkq
        v[k * 3 + q] = s * vkp + c * vkq
      }
    }
  }
  const pairs = [0, 1, 2]
    .map((i) => ({ value: a[i * 3 + i], vector: normalize([v[i], v[3 + i], v[6 + i]]) }))
    .sort((p, q) => q.value - p.value)
  return {
    values: [pairs[0].value, pairs[1].value, pairs[2].value],
    vectors: [pairs[0].vector, pairs[1].vector, pairs[2].vector],
  }
}

/** Mean + covariance of the listed sample points (`ids` = null → all). */
function pca(sample: Float64Array, ids: ArrayLike<number> | null) {
  const count = ids ? ids.length : sample.length / 3
  const mean: Vec3 = [0, 0, 0]
  for (let k = 0; k < count; k += 1) {
    const i = ids ? ids[k] : k
    mean[0] += sample[i * 3]
    mean[1] += sample[i * 3 + 1]
    mean[2] += sample[i * 3 + 2]
  }
  mean[0] /= count
  mean[1] /= count
  mean[2] /= count
  const c = [0, 0, 0, 0, 0, 0] // xx xy xz yy yz zz
  for (let k = 0; k < count; k += 1) {
    const i = ids ? ids[k] : k
    const x = sample[i * 3] - mean[0]
    const y = sample[i * 3 + 1] - mean[1]
    const z = sample[i * 3 + 2] - mean[2]
    c[0] += x * x
    c[1] += x * y
    c[2] += x * z
    c[3] += y * y
    c[4] += y * z
    c[5] += z * z
  }
  const eig = symmetricEigen3([c[0], c[1], c[2], c[1], c[3], c[4], c[2], c[4], c[5]].map((v) => v / count))
  return { mean, ...eig }
}

/* ------------------------------ ground estimation ------------------------------ */

export interface GroundEstimate {
  /** Unit ground normal ("up") in the frame of the input sample. */
  up: Vec3
  /** Angle between `up` and the sample frame's +Z, degrees (≈180 = upside down). */
  tiltDeg: number
  /** Up/down decided by geometry evidence: 2 = both cues agree, 1 = one cue, 0 = no evidence. */
  signStrength: number
  /** Plane-fit support: inliers / ground candidates (0–1). */
  inlierRatio: number
  /** Smallest / middle PCA eigenvalue of the whole sample — small = wide, flat survey. */
  flatness: number
  method: 'classification' | 'plane-fit' | 'none'
  /** Ground height along `up` at the sample's origin (the model centre), metres. */
  groundOffset: number
  /** Ground candidate cells used (plane-fit) or ground points (classification). */
  support: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quantiles(values: Float64Array, qs: number[]) {
  const sorted = Float64Array.from(values).sort()
  return qs.map((q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))])
}

/**
 * Which way is up along `axis`? A survey's ground is a dense, sharp "floor"
 * with only noise below it, while roofs / trees form a sparse, long tail above.
 * Two independent cues vote: tail length and band density. When the source has
 * normals, a third cue dominates: photogrammetry / drone normals face the
 * capturing cameras, i.e. mostly upward. Returns −4…+4 (positive = `axis`
 * already points up); callers clamp the strength to 0–2.
 */
function verticalVote(sample: Float64Array, axis: Vec3, normals: Float64Array | null): number {
  let normalVote = 0
  if (normals) {
    let sum = 0
    let used = 0
    for (let i = 0; i < normals.length; i += 3) {
      const d = normals[i] * axis[0] + normals[i + 1] * axis[1] + normals[i + 2] * axis[2]
      if (normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0) continue
      sum += d
      used += 1
    }
    const mean = used ? sum / used : 0
    normalVote = mean > 0.2 ? 2 : mean < -0.2 ? -2 : 0
  }
  const n = sample.length / 3
  const h = new Float64Array(n)
  for (let i = 0; i < n; i += 1) h[i] = sample[i * 3] * axis[0] + sample[i * 3 + 1] * axis[1] + sample[i * 3 + 2] * axis[2]
  const [q01, q10, q90, q99] = quantiles(h, [0.01, 0.1, 0.9, 0.99])
  const span = q99 - q01
  if (!(span > 1e-9)) return 0
  const lowTail = q10 - q01
  const highTail = q99 - q90
  const tailVote = highTail > lowTail * 1.4 ? 1 : lowTail > highTail * 1.4 ? -1 : 0
  const band = span * 0.15
  let low = 0
  let high = 0
  for (let i = 0; i < n; i += 1) {
    if (h[i] >= q01 && h[i] < q01 + band) low += 1
    else if (h[i] <= q99 && h[i] > q99 - band) high += 1
  }
  const densityVote = low > high * 1.4 ? 1 : high > low * 1.4 ? -1 : 0
  return tailVote + densityVote + normalVote
}

const NO_GROUND = (flatness: number): GroundEstimate => ({
  up: [0, 0, 1],
  tiltDeg: 0,
  signStrength: 0,
  inlierRatio: 0,
  flatness,
  method: 'none',
  groundOffset: 0,
  support: 0,
})

/**
 * Robust ground-plane estimate for a centred, metric sample (Float64 xyz).
 *
 * 1. Ground-classified points (if the source had them) → least-squares plane.
 * 2. Otherwise: PCA picks the candidate up axis (smallest-variance direction of
 *    a wide survey; falls back to the input +Z for compact / tall objects),
 *    `verticalVote` decides which side is up (inversion), then per-cell
 *    *low-percentile* points (not the absolute lowest — outliers) feed a RANSAC
 *    plane fit, refined by PCA on the inliers.
 */
export function estimateGround(
  sample: Float64Array,
  groundMask: Uint8Array | null = null,
  normals: Float64Array | null = null,
): GroundEstimate {
  const n = sample.length / 3
  if (n < 50) return NO_GROUND(1)
  const whole = pca(sample, null)
  const flatness = whole.values[1] > 1e-12 ? whole.values[2] / whole.values[1] : 1

  /* 1. semantic ground points */
  if (groundMask) {
    const ids: number[] = []
    for (let i = 0; i < n; i += 1) if (groundMask[i]) ids.push(i)
    if (ids.length >= Math.max(30, n * 0.02)) {
      const plane = pca(sample, ids)
      let up = plane.vectors[2]
      // Orient towards the non-ground points (buildings, trees stand on the ground).
      let side = 0
      for (let i = 0; i < n; i += 1) {
        if (groundMask[i]) continue
        side += (sample[i * 3] - plane.mean[0]) * up[0] + (sample[i * 3 + 1] - plane.mean[1]) * up[1] + (sample[i * 3 + 2] - plane.mean[2]) * up[2]
      }
      if (side < 0 || (side === 0 && up[2] < 0)) up = [-up[0], -up[1], -up[2]]
      return {
        up,
        tiltDeg: angleDeg(up, [0, 0, 1]),
        signStrength: 2,
        inlierRatio: 1,
        flatness,
        method: 'classification',
        groundOffset: dot(plane.mean, up),
        support: ids.length,
      }
    }
  }

  /* 2. candidate up axis */
  let axis: Vec3 = [0, 0, 1]
  const e3 = whole.vectors[2]
  const offNominal = Math.min(angleDeg(e3, [0, 0, 1]), angleDeg(e3, [0, 0, -1]))
  // Wide & flat → trust PCA; sideways axes (Y-up vs Z-up mix-ups) only when very flat.
  if (flatness < 0.5 && (offNominal < 60 || flatness < 0.2)) axis = e3[2] >= 0 ? e3 : [-e3[0], -e3[1], -e3[2]]
  const vote = verticalVote(sample, axis, normals)
  if (vote < 0) axis = [-axis[0], -axis[1], -axis[2]]

  /* 3. per-cell low points in a frame where `axis` is +Z */
  const toLocal = rotationBetween(axis, [0, 0, 1])
  const local = new Float64Array(n * 3)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i += 1) {
    const p = apply3(toLocal, [sample[i * 3], sample[i * 3 + 1], sample[i * 3 + 2]])
    local.set(p, i * 3)
    minX = Math.min(minX, p[0])
    maxX = Math.max(maxX, p[0])
    minY = Math.min(minY, p[1])
    maxY = Math.max(maxY, p[1])
  }
  const GRID = 32
  const extent = Math.max(maxX - minX, maxY - minY, 1e-9)
  const cellSize = extent / GRID
  const cells = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) {
    const cx = Math.min(GRID - 1, Math.floor((local[i * 3] - minX) / cellSize))
    const cy = Math.min(GRID - 1, Math.floor((local[i * 3 + 1] - minY) / cellSize))
    const key = cy * GRID + cx
    const list = cells.get(key)
    if (list) list.push(i)
    else cells.set(key, [i])
  }
  const candidates: number[] = []
  cells.forEach((ids) => {
    if (ids.length < 3) return
    ids.sort((p, q) => local[p * 3 + 2] - local[q * 3 + 2])
    candidates.push(ids[Math.floor(ids.length * 0.05)])
  })
  const base: GroundEstimate = {
    up: axis,
    tiltDeg: angleDeg(axis, [0, 0, 1]),
    signStrength: Math.min(2, Math.abs(vote)),
    inlierRatio: 0,
    flatness,
    method: 'none',
    groundOffset: 0,
    support: candidates.length,
  }
  if (candidates.length < 12) return base

  /* 4. RANSAC plane over the candidates (deterministic seed) */
  const rand = mulberry32(0xa11c0c)
  const threshold = extent * 0.015
  const cosLimit = Math.cos((45 * Math.PI) / 180)
  let bestInliers: number[] = []
  const at = (i: number): Vec3 => [local[i * 3], local[i * 3 + 1], local[i * 3 + 2]]
  for (let iter = 0; iter < 200; iter += 1) {
    const a = at(candidates[Math.floor(rand() * candidates.length)])
    const b = at(candidates[Math.floor(rand() * candidates.length)])
    const c = at(candidates[Math.floor(rand() * candidates.length)])
    const normal = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])
    const len = Math.hypot(...normal)
    if (len < 1e-12) continue
    const nn: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len]
    if (Math.abs(nn[2]) < cosLimit) continue
    const d = dot(nn, a)
    const inliers = candidates.filter((i) => Math.abs(dot(nn, at(i)) - d) < threshold)
    if (inliers.length > bestInliers.length) bestInliers = inliers
  }
  if (bestInliers.length < 6) return base
  const refined = pca(local, bestInliers)
  let normalLocal = refined.vectors[2]
  if (normalLocal[2] < 0) normalLocal = [-normalLocal[0], -normalLocal[1], -normalLocal[2]]
  const up = normalize(apply3(transpose3(toLocal), normalLocal))
  return {
    up,
    tiltDeg: angleDeg(up, [0, 0, 1]),
    signStrength: Math.min(2, Math.abs(vote)),
    inlierRatio: bestInliers.length / candidates.length,
    flatness,
    method: 'plane-fit',
    groundOffset: dot(refined.mean, normalLocal),
    support: candidates.length,
  }
}
