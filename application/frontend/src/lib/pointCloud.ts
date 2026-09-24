import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import type { ModelFormat } from './formats'
import { Y_UP_TO_Z_UP, type Mat3 } from './modelAlignment'
import {
  ASPRS_CLASSES,
  loadCompanionMetadata,
  metadataFromComments,
  parseMetadataObject,
  resolveModelState,
  type MetadataCandidate,
  type ModelState,
} from './modelMetadata'
import type { ActiveModel } from './session'

/**
 * Generic point-cloud data model for the Point Cloud View.
 *
 * The renderer, the UI state and the inspector only ever see `PointCloudDataset`.
 * Loaders (GLB/GLTF, PLY, OBJ) only collect geometry + metadata; the shared
 * `datasetFromObject3D` pipeline turns them into this structure.
 *
 * Coordinate frames (see `ModelState` and brain/model-scaling-and-camera.md)
 *  - `positions` hold the model's ORIGINAL (native) coordinates, only re-based on
 *    `model.sourceOrigin` (Float64) so Float32 keeps full precision. They are
 *    never scaled, rotated or re-aligned.
 *  - `model.linear` (scale · rotation) maps them to **world-local** coordinates:
 *    metres, right-handed, **Z up** (X east, Y north), origin at the model centre.
 *    Rendering applies it as a scene-level matrix; measurements, picking, camera,
 *    bounds and terrain all work in this frame (`worldXYZ`).
 *  - Real-world coordinates shown in the UI = world-local + `model.displayOffset`
 *    (`toReal`) — preserves georeferenced / source coordinate values.
 *  - A point's ID is its index in these arrays (stable for the lifetime of the dataset).
 */

/** Order matters: the index is what the GPU (`meta[0]`) and the class mask use. */
export const SEMANTIC_CLASSES = [
  { id: 'buildings', label: 'Buildings', color: '#d9534f' },
  { id: 'roads', label: 'Roads', color: '#a3a8ad' },
  { id: 'vegetation', label: 'Vegetation', color: '#5bb974' },
  { id: 'water', label: 'Water', color: '#3d8fe0' },
  { id: 'terrain', label: 'Terrain', color: '#b58a5b' },
  { id: 'other', label: 'Other', color: '#8b5cc7' },
] as const

export type SemanticClassId = (typeof SEMANTIC_CLASSES)[number]['id']
export const CLASS_INDEX = Object.fromEntries(
  SEMANTIC_CLASSES.map((c, i) => [c.id, i]),
) as Record<SemanticClassId, number>

export type Vec3 = [number, number, number]

/** Optional link between world-local XY (metres) and WGS84. `null` = not georeferenced. */
export interface GeoReference {
  /** Latitude / longitude (degrees) of world-local X = 0, Y = 0. */
  originLatitude: number
  originLongitude: number
}

/** Terrain (DTM) height grid in world-local coordinates; `NaN` = no data. */
export interface TerrainGrid {
  minX: number
  minY: number
  cell: number
  gx: number
  gy: number
  heights: Float32Array
  /** classification = source ground points, metadata = supplied DTM, estimated = lowest-surface proxy. */
  source: 'classification' | 'metadata' | 'estimated'
}

export interface PointCloudDataset {
  name: string
  count: number
  /** xyz per point: native coordinates − `model.sourceOrigin` (untransformed source data). */
  positions: Float32Array
  /** rgba per point: rgb = original colour, a = reconstruction confidence (0–255 ≙ 0–1). */
  colors: Uint8Array
  /** per point: [semanticClass index, semanticConfidence 0–255, 0, 0]. */
  meta: Uint8Array
  /** World-local ground height under each point (from `terrain`). */
  terrainElevation: Float32Array
  terrain: TerrainGrid
  /** Stable object/instance number per point (see `objectLabel`). */
  objectIds: Uint32Array
  /** xyz unit normal per point in the native frame, only when the source carried normals. */
  normals: Float32Array | null
  /** Full extent of the data (world-local). */
  bounds: { min: Vec3; max: Vec3 }
  /** 1st–99th percentile extent (world-local) — used for camera framing and helper geometry. */
  focusBounds: { min: Vec3; max: Vec3 }
  /** World-local Z extent. */
  zRange: [number, number]
  /** Points per semantic class (index = SEMANTIC_CLASSES order). */
  classCounts: number[]
  /** Mean reconstruction confidence, 0–1. */
  meanConfidence: number
  geoReference: GeoReference | null
  /** Scale / orientation / position / terrain provenance and the model transform. */
  model: ModelState
  /** What produced this dataset (documentation / debugging). */
  source: {
    kind: 'gltf-prototype' | 'ply-prototype' | 'obj-prototype'
    sourcePoints: number
    stride: number
    unitsToMeters: number
  }
}

export interface PointRecord {
  id: number
  /** Real-world coordinates (world-local + display offset). */
  x: number
  y: number
  z: number
  latitude: number | null
  longitude: number | null
  /** Real-world terrain height under the point (separate from `z`). */
  terrainElevation: number
  /** z − terrainElevation. */
  heightAboveTerrain: number
  rgb: Vec3
  semanticClass: SemanticClassId
  semanticConfidence: number
  reconstructionConfidence: number
  objectId: string
}

export const OBJECT_ID_BASE = 10000
export const objectLabel = (objectId: number) => `OBJ_${objectId}`

/** World-local position of point `id` (the frame used for rendering and measuring). */
export function worldXYZ(ds: PointCloudDataset, id: number): Vec3 {
  const m = ds.model.linear
  const x = ds.positions[id * 3]
  const y = ds.positions[id * 3 + 1]
  const z = ds.positions[id * 3 + 2]
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
}

/** Original (native) coordinates of point `id`, exactly as in the source file. */
export function sourceXYZ(ds: PointCloudDataset, id: number): Vec3 {
  const o = ds.model.sourceOrigin
  return [ds.positions[id * 3] + o[0], ds.positions[id * 3 + 1] + o[1], ds.positions[id * 3 + 2] + o[2]]
}

/** World-local → real-world (georeferenced / source) coordinates. */
export function toReal(ds: PointCloudDataset, p: Vec3): Vec3 {
  const o = ds.model.displayOffset
  return [p[0] + o[0], p[1] + o[1], p[2] + o[2]]
}

/** Terrain height (world-local) at a world-local XY; NaN outside the grid. */
export function terrainAt(ds: PointCloudDataset, x: number, y: number): number {
  const t = ds.terrain
  const cx = Math.floor((x - t.minX) / t.cell)
  const cy = Math.floor((y - t.minY) / t.cell)
  if (cx < 0 || cy < 0 || cx >= t.gx || cy >= t.gy) return Number.NaN
  return t.heights[cy * t.gx + cx]
}

export function toGeographic(ds: PointCloudDataset, x: number, y: number) {
  if (!ds.geoReference) return null
  const { originLatitude, originLongitude } = ds.geoReference
  const metresPerDegLat = 111_320
  const latitude = originLatitude + y / metresPerDegLat
  const longitude = originLongitude + x / (metresPerDegLat * Math.cos((originLatitude * Math.PI) / 180))
  return { latitude, longitude }
}

export function getPoint(ds: PointCloudDataset, id: number): PointRecord {
  const world = worldXYZ(ds, id)
  const [x, y, z] = toReal(ds, world)
  const geo = toGeographic(ds, world[0], world[1])
  const terrainElevation = ds.terrainElevation[id] + ds.model.displayOffset[2]
  return {
    id,
    x,
    y,
    z,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    terrainElevation,
    heightAboveTerrain: z - terrainElevation,
    rgb: [ds.colors[id * 4], ds.colors[id * 4 + 1], ds.colors[id * 4 + 2]],
    semanticClass: SEMANTIC_CLASSES[ds.meta[id * 4]].id,
    semanticConfidence: ds.meta[id * 4 + 1] / 255,
    reconstructionConfidence: ds.colors[id * 4 + 3] / 255,
    objectId: objectLabel(ds.objectIds[id]),
  }
}

/* ------------------------------------------------------------------ */
/* Shared adapter: three.js object graph (GLB/GLTF/PLY/OBJ) → dataset  */
/* ------------------------------------------------------------------ */

/** Cap on prototype points: keeps memory, GPU load and picking responsive. */
const DEFAULT_MAX_POINTS = 6_500_000
/** Surface samples drawn from mesh-only models (no point primitives). */
const MESH_SAMPLES = 400_000
/** Longest texture edge read back for colour sampling (larger textures are downscaled). */
const MAX_TEXTURE_READ = 2048

export interface AdapterOptions {
  maxPoints?: number
  onPhase?: (message: string) => void
  /** Recorded on the dataset's `source.kind` (documentation only). Default 'gltf-prototype'. */
  sourceKind?: PointCloudDataset['source']['kind']
  /** Source format (model-state documentation). Default 'glb'. */
  format?: ModelFormat
  /** Metadata candidates collected by the loader (embedded / companion / format convention). */
  metadata?: MetadataCandidate[]
  /** Non-fatal notes collected while loading (malformed metadata etc.). */
  warnings?: string[]
  /** Explicit override: native units → metres (treated as embedded metadata). */
  unitsToMeters?: number
  geoReference?: GeoReference | null
  /** Set when the loader already thinned the file (fast PLY path): original count + stride. */
  source?: { sourcePoints: number; stride: number }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Byte value multiplier for a colour attribute, by component type. */
function colorScale(array: ArrayLike<number>): number {
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return 1
  if (array instanceof Uint16Array) return 255 / 65535
  return 255
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

function percentile(sorted: ArrayLike<number>, q: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))]
}

type TextureSampler = (u: number, v: number, out: number[]) => void

/** Reads a (loaded) texture back once so mesh samples can take their colour from it. */
function textureSampler(texture: THREE.Texture | null | undefined): TextureSampler | null {
  const image = texture?.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!texture || !image || !image.width || !image.height || typeof document === 'undefined') return null
  const k = Math.min(1, MAX_TEXTURE_READ / Math.max(image.width, image.height))
  const w = Math.max(1, Math.round(image.width * k))
  const h = Math.max(1, Math.round(image.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  let data: Uint8ClampedArray
  try {
    ctx.drawImage(image, 0, 0, w, h)
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null
  }
  const flipY = texture.flipY
  return (u, v, out) => {
    const fu = u - Math.floor(u)
    const fv = v - Math.floor(v)
    const px = Math.min(w - 1, Math.floor(fu * w))
    const py = Math.min(h - 1, Math.floor((flipY ? 1 - fv : fv) * h))
    const o = (py * w + px) * 4
    out[0] = data[o]
    out[1] = data[o + 1]
    out[2] = data[o + 2]
  }
}

/** Fill empty (NaN) cells of a height grid from their neighbours until none are left. */
function fillHoles(grid: Float32Array, gx: number, gy: number) {
  for (let pass = 0; pass < gx + gy; pass += 1) {
    let missing = 0
    const next = grid.slice()
    for (let cy = 0; cy < gy; cy += 1) {
      for (let cx = 0; cx < gx; cx += 1) {
        if (Number.isFinite(grid[cy * gx + cx])) continue
        let sum = 0
        let weight = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue
            const value = grid[ny * gx + nx]
            if (Number.isFinite(value)) {
              sum += value
              weight += 1
            }
          }
        }
        if (weight) next[cy * gx + cx] = sum / weight
        else missing += 1
      }
    }
    grid.set(next)
    if (missing === 0) return
  }
}

export async function datasetFromObject3D(
  root: THREE.Object3D,
  name: string,
  options: AdapterOptions = {},
): Promise<PointCloudDataset> {
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS
  const phase = options.onPhase ?? (() => {})
  const warnings = options.warnings ?? []
  const candidates = [...(options.metadata ?? [])]
  if (options.unitsToMeters !== undefined)
    candidates.push({ level: 'embedded', label: 'loader override', data: { unitsToMeters: options.unitsToMeters } })
  root.updateMatrixWorld(true)

  const clouds: THREE.Points[] = []
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Points).isPoints) clouds.push(object as THREE.Points)
    else if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
  })
  // Normals are only captured for the point-copy path (below) — meshes are already
  // area-sampled without shading, so per-vertex normals wouldn't be used there.
  const hasNormals = clouds.some((c) => !!c.geometry.getAttribute('normal'))
  const hasClasses = clouds.some((c) => !!c.geometry.getAttribute('classification'))

  const sourcePoints = clouds.reduce((sum, c) => sum + c.geometry.getAttribute('position').count, 0)
  const stride = Math.max(1, Math.ceil(sourcePoints / maxPoints))
  const cloudCount = clouds.reduce(
    (sum, c) => sum + Math.ceil(c.geometry.getAttribute('position').count / stride),
    0,
  )
  const meshCount = meshes.length ? Math.max(0, Math.min(maxPoints - cloudCount, MESH_SAMPLES)) : 0
  const n = cloudCount + meshCount
  if (n === 0) throw new Error('No point or mesh geometry found in this model.')

  /* --- 0. native bounds (Float64) → re-base origin so Float32 keeps precision ---- */
  phase('Inspecting model…')
  const nMin: Vec3 = [Infinity, Infinity, Infinity]
  const nMax: Vec3 = [-Infinity, -Infinity, -Infinity]
  const grow = (x: number, y: number, z: number) => {
    if (x < nMin[0]) nMin[0] = x
    if (y < nMin[1]) nMin[1] = y
    if (z < nMin[2]) nMin[2] = z
    if (x > nMax[0]) nMax[0] = x
    if (y > nMax[1]) nMax[1] = y
    if (z > nMax[2]) nMax[2] = z
  }
  for (const object of [...clouds, ...meshes]) {
    const pos = object.geometry.getAttribute('position')
    const e = object.matrixWorld.elements
    const step = (object as THREE.Points).isPoints ? stride : 1
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      grow(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14])
    }
  }
  if (![...nMin, ...nMax].every(Number.isFinite)) throw new Error('This model has invalid (non-finite) coordinates.')
  const origin: Vec3 = [(nMin[0] + nMax[0]) / 2, (nMin[1] + nMax[1]) / 2, (nMin[2] + nMax[2]) / 2]

  const positions = new Float32Array(n * 3)
  const colors = new Uint8Array(n * 4)
  const meta = new Uint8Array(n * 4)
  const normals = hasNormals ? new Float32Array(n * 3) : null
  const sourceClass = hasClasses ? new Uint8Array(n) : null
  let w = 0

  /* --- 1. positions + colours (+ normals, classes) in the NATIVE frame -------- */
  phase('Extracting points…')
  await tick()
  for (const cloud of clouds) {
    const geometry = cloud.geometry
    const pos = geometry.getAttribute('position')
    const col = geometry.getAttribute('color')
    const nrm = geometry.getAttribute('normal')
    const cls = geometry.getAttribute('classification')
    const e = cloud.matrixWorld.elements
    const fallback = (cloud.material as THREE.PointsMaterial).color
    const posArray = pos.array as ArrayLike<number>
    const direct = !(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    const cs = col ? colorScale(col.array as ArrayLike<number>) : 0
    const colDirect = col && !(col as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    const nrmDirect = nrm && !(nrm as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    const nrmArray = nrm ? (nrm.array as ArrayLike<number>) : null
    for (let i = 0; i < pos.count; i += stride) {
      const x = direct ? posArray[i * 3] : pos.getX(i)
      const y = direct ? posArray[i * 3 + 1] : pos.getY(i)
      const z = direct ? posArray[i * 3 + 2] : pos.getZ(i)
      positions[w * 3] = e[0] * x + e[4] * y + e[8] * z + e[12] - origin[0]
      positions[w * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13] - origin[1]
      positions[w * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] - origin[2]
      if (col && colDirect) {
        const a = col.array as ArrayLike<number>
        const o = i * col.itemSize
        colors[w * 4] = a[o] * cs
        colors[w * 4 + 1] = a[o + 1] * cs
        colors[w * 4 + 2] = a[o + 2] * cs
      } else if (col) {
        colors[w * 4] = col.getX(i) * 255
        colors[w * 4 + 1] = col.getY(i) * 255
        colors[w * 4 + 2] = col.getZ(i) * 255
      } else {
        colors[w * 4] = fallback.r * 255
        colors[w * 4 + 1] = fallback.g * 255
        colors[w * 4 + 2] = fallback.b * 255
      }
      // Direction only: rotate by the 3×3 part of the world matrix (no translation).
      // Assumes no non-uniform scale (true for our wrapper objects and export nodes).
      if (normals) {
        if (nrm) {
          const nx = nrmDirect ? nrmArray![i * 3] : nrm.getX(i)
          const ny = nrmDirect ? nrmArray![i * 3 + 1] : nrm.getY(i)
          const nz = nrmDirect ? nrmArray![i * 3 + 2] : nrm.getZ(i)
          const rx = e[0] * nx + e[4] * ny + e[8] * nz
          const ry = e[1] * nx + e[5] * ny + e[9] * nz
          const rz = e[2] * nx + e[6] * ny + e[10] * nz
          const len = Math.hypot(rx, ry, rz) || 1
          normals[w * 3] = rx / len
          normals[w * 3 + 1] = ry / len
          normals[w * 3 + 2] = rz / len
        } else {
          normals[w * 3] = 0
          normals[w * 3 + 1] = 0
          normals[w * 3 + 2] = 0
        }
      }
      if (sourceClass) sourceClass[w] = cls ? Math.max(0, Math.min(255, Math.round(cls.getX(i)))) : 0
      w += 1
    }
  }

  /* Mesh-only models: draw area-weighted surface samples (deterministic). */
  if (meshCount > 0) {
    const rand = mulberry32(1337)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const tri: { mesh: THREE.Mesh; i0: number; i1: number; i2: number }[] = []
    const cumulative: number[] = []
    let area = 0
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position')
      const index = mesh.geometry.index
      const triangles = index ? index.count / 3 : pos.count / 3
      for (let t = 0; t < triangles; t += 1) {
        const i0 = index ? index.getX(t * 3) : t * 3
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
        a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld)
        b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld)
        c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld)
        area += b.sub(a).cross(c.sub(a)).length() / 2
        cumulative.push(area)
        tri.push({ mesh, i0, i1, i2 })
      }
    }
    const samplers = new Map<THREE.Texture, TextureSampler | null>()
    const texel = [0, 0, 0]
    const tint = new THREE.Color()
    const p = new THREE.Vector3()
    const q = new THREE.Vector3()
    for (let s = 0; s < meshCount && area > 0; s += 1) {
      const target = rand() * area
      let lo = 0
      let hi = cumulative.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cumulative[mid] < target) lo = mid + 1
        else hi = mid
      }
      const { mesh, i0, i1, i2 } = tri[lo]
      const pos = mesh.geometry.getAttribute('position')
      const col = mesh.geometry.getAttribute('color')
      const uv = mesh.geometry.getAttribute('uv')
      let u = rand()
      let v = rand()
      if (u + v > 1) {
        u = 1 - u
        v = 1 - v
      }
      const wgt = [1 - u - v, u, v]
      const ids = [i0, i1, i2]
      p.set(0, 0, 0)
      for (let k = 0; k < 3; k += 1) p.add(q.fromBufferAttribute(pos, ids[k]).multiplyScalar(wgt[k]))
      p.applyMatrix4(mesh.matrixWorld)
      positions[w * 3] = p.x - origin[0]
      positions[w * 3 + 1] = p.y - origin[1]
      positions[w * 3 + 2] = p.z - origin[2]
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
      let sampler: TextureSampler | null = null
      if (material?.map && uv) {
        if (!samplers.has(material.map)) samplers.set(material.map, textureSampler(material.map))
        sampler = samplers.get(material.map) ?? null
      }
      if (sampler) {
        let tu = 0
        let tv = 0
        for (let k = 0; k < 3; k += 1) {
          tu += uv.getX(ids[k]) * wgt[k]
          tv += uv.getY(ids[k]) * wgt[k]
        }
        sampler(tu, tv, texel)
        const m = material.color ?? tint.setRGB(1, 1, 1)
        colors[w * 4] = texel[0] * m.r
        colors[w * 4 + 1] = texel[1] * m.g
        colors[w * 4 + 2] = texel[2] * m.b
      } else {
        if (col) {
          let r = 0
          let g = 0
          let bl = 0
          for (let k = 0; k < 3; k += 1) {
            r += col.getX(ids[k]) * wgt[k]
            g += col.getY(ids[k]) * wgt[k]
            bl += col.getZ(ids[k]) * wgt[k]
          }
          tint.setRGB(r, g, bl)
        } else {
          tint.copy(material?.color ?? new THREE.Color(0.7, 0.7, 0.7))
        }
        colors[w * 4] = tint.r * 255
        colors[w * 4 + 1] = tint.g * 255
        colors[w * 4 + 2] = tint.b * 255
      }
      w += 1
    }
  }

  /* --- 2. scale / orientation / position (metadata first, then geometry) ------ */
  phase('Resolving scale & orientation…')
  await tick()
  const ordered = [...candidates].sort((p, q) => ['embedded', 'companion', 'format'].indexOf(p.level) - ['embedded', 'companion', 'format'].indexOf(q.level))
  const classMap = ordered.find((c) => c.data.semanticClasses)?.data.semanticClasses ?? ASPRS_CLASSES
  // Source classes are only trusted when some points carry a real (non-"unclassified") code.
  let classified = 0
  if (sourceClass) for (let i = 0; i < n; i += 1) if (classMap[sourceClass[i]]) classified += 1
  const useSourceClasses = sourceClass !== null && classified >= Math.max(50, n * 0.01)
  let groundMask: Uint8Array | null = null
  if (useSourceClasses) {
    groundMask = new Uint8Array(n)
    for (let i = 0; i < n; i += 1) groundMask[i] = classMap[sourceClass![i]] === 'terrain' ? 1 : 0
  }
  const resolved = resolveModelState({
    format: options.format ?? 'glb',
    candidates,
    positions,
    count: n,
    sourceOrigin: origin,
    originalBounds: { min: nMin, max: nMax },
    groundMask,
    normals,
    warnings,
  })
  const L: Mat3 = resolved.linear
  const wx = (i: number) => L[0] * positions[i * 3] + L[1] * positions[i * 3 + 1] + L[2] * positions[i * 3 + 2]
  const wy = (i: number) => L[3] * positions[i * 3] + L[4] * positions[i * 3 + 1] + L[5] * positions[i * 3 + 2]
  const wz = (i: number) => L[6] * positions[i * 3] + L[7] * positions[i * 3 + 1] + L[8] * positions[i * 3 + 2]

  /* --- 3. world-local extents ------------------------------------------------ */
  phase('Analysing extents…')
  await tick()
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const sampleStep = Math.max(1, Math.floor(n / 200_000))
  const axes = [0, 1, 2].map(() => [] as number[])
  for (let i = 0; i < n; i += 1) {
    const p: Vec3 = [wx(i), wy(i), wz(i)]
    for (let k = 0; k < 3; k += 1) {
      if (p[k] < min[k]) min[k] = p[k]
      if (p[k] > max[k]) max[k] = p[k]
    }
    if (i % sampleStep === 0) for (let k = 0; k < 3; k += 1) axes[k].push(p[k])
  }
  const fMin: Vec3 = [0, 0, 0]
  const fMax: Vec3 = [0, 0, 0]
  axes.forEach((values, k) => {
    values.sort((p, q) => p - q)
    fMin[k] = percentile(values, 0.01)
    fMax[k] = percentile(values, 0.99)
  })
  const zLowCut = percentile(axes[2], 0.005)

  /* --- 4. terrain (DTM): ground points › supplied grid › lowest-surface proxy -- */
  phase('Deriving terrain…')
  await tick()
  const extentX = max[0] - min[0] || 1
  const extentY = max[1] - min[1] || 1
  const cell = Math.max(extentX, extentY) / 96
  const gx = Math.ceil(extentX / cell) + 1
  const gy = Math.ceil(extentY / cell) + 1
  const cellMin = new Float32Array(gx * gy).fill(Infinity)
  const cellOf = (x: number, y: number) => Math.floor((y - min[1]) / cell) * gx + Math.floor((x - min[0]) / cell)
  for (let i = 0; i < n; i += 1) {
    if (groundMask && !groundMask[i]) continue
    const z = wz(i)
    if (!groundMask && z < zLowCut) continue
    const c = cellOf(wx(i), wy(i))
    if (z < cellMin[c]) cellMin[c] = z
  }
  for (let c = 0; c < cellMin.length; c += 1) if (!Number.isFinite(cellMin[c])) cellMin[c] = Number.NaN
  const ground = new Float32Array(gx * gy)
  for (let pass = 0; pass < 2; pass += 1) {
    const source = pass === 0 ? cellMin : ground
    const target = pass === 0 ? ground : new Float32Array(gx * gy)
    for (let cy = 0; cy < gy; cy += 1) {
      for (let cx = 0; cx < gx; cx += 1) {
        let sum = 0
        let weight = 0
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue
            const value = source[ny * gx + nx]
            if (!Number.isFinite(value)) continue
            const wgt = dx === 0 && dy === 0 ? 2 : 1
            sum += value * wgt
            weight += wgt
          }
        }
        target[cy * gx + cx] = weight ? sum / weight : Number.NaN
      }
    }
    if (pass === 1) ground.set(target)
  }
  fillHoles(ground, gx, gy)
  let terrainSource: TerrainGrid['source'] = groundMask ? 'classification' : 'estimated'
  const suppliedGrid = resolved.terrainInput?.grid
  if (suppliedGrid) {
    // Supplied DTM is in real-world coordinates: resample it onto the working grid.
    const [ox, oy, oz] = resolved.displayOffset
    let hits = 0
    for (let cy = 0; cy < gy; cy += 1) {
      for (let cx = 0; cx < gx; cx += 1) {
        const col = Math.floor((min[0] + (cx + 0.5) * cell + ox - suppliedGrid.originX) / suppliedGrid.cellSize)
        const row = Math.floor((min[1] + (cy + 0.5) * cell + oy - suppliedGrid.originY) / suppliedGrid.cellSize)
        if (col < 0 || row < 0 || col >= suppliedGrid.cols || row >= suppliedGrid.rows) continue
        const h = suppliedGrid.heights[row * suppliedGrid.cols + col]
        if (!Number.isFinite(h)) continue
        ground[cy * gx + cx] = h - oz
        hits += 1
      }
    }
    if (hits > 0) terrainSource = 'metadata'
    else warnings.push('supplied terrain grid does not overlap the model — estimated terrain used')
  }
  const reliableTerrain = terrainSource !== 'estimated'
  const terrainElevation = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const g = ground[cellOf(wx(i), wy(i))]
    const z = wz(i)
    terrainElevation[i] = Number.isFinite(g) ? (reliableTerrain ? g : Math.min(g, z)) : z
  }

  /* --- 5. reconstruction-confidence proxy: local point density -------------- */
  phase('Estimating confidence…')
  await tick()
  const voxel = Math.max(extentX, extentY, max[2] - min[2]) / 128
  const vx = Math.ceil(extentX / voxel) + 1
  const vy = Math.ceil(extentY / voxel) + 1
  const vz = Math.ceil((max[2] - min[2]) / voxel) + 1
  const voxels = new Uint32Array(vx * vy * vz)
  const voxelOf = (i: number) =>
    (Math.floor((wz(i) - min[2]) / voxel) * vy + Math.floor((wy(i) - min[1]) / voxel)) * vx + Math.floor((wx(i) - min[0]) / voxel)
  for (let i = 0; i < n; i += 1) voxels[voxelOf(i)] += 1
  const occupied: number[] = []
  for (let v = 0; v < voxels.length; v += 1) if (voxels[v] > 0) occupied.push(voxels[v])
  occupied.sort((p, q) => p - q)
  const reference = Math.log1p(percentile(occupied, 0.9))
  let confidenceSum = 0
  for (let i = 0; i < n; i += 1) {
    const c = Math.min(1, Math.log1p(voxels[voxelOf(i)]) / reference)
    colors[i * 4 + 3] = Math.round(c * 255)
    confidenceSum += c
  }

  /* --- 6. semantic class (source classes, else rule-based placeholder) + object ids */
  phase('Classifying…')
  await tick()
  const classCounts = SEMANTIC_CLASSES.map(() => 0)
  const objectIds = new Uint32Array(n)
  const registry = new Map<number, number>()
  const objectCell = Math.max(extentX, extentY) / 24
  const ox = Math.ceil(extentX / objectCell) + 1
  for (let i = 0; i < n; i += 1) {
    const x = wx(i)
    const y = wy(i)
    let cls: SemanticClassId
    let strength = 200
    const mapped = useSourceClasses ? classMap[sourceClass![i]] : undefined
    if (mapped) {
      cls = mapped
      strength = 255
    } else {
      const r = colors[i * 4]
      const g = colors[i * 4 + 1]
      const b = colors[i * 4 + 2]
      const height = wz(i) - terrainElevation[i]
      const lum = (r + g + b) / 3
      const sat = Math.max(r, g, b) - Math.min(r, g, b)
      if (b > r + 14 && b > g - 4) cls = 'water'
      else if (g > r + 6 && g >= b + 12) cls = 'vegetation'
      else if (height < 1.2) {
        if (sat < 28 && lum < 140) cls = 'roads'
        else cls = 'terrain'
      } else if (sat < 55 && lum > 90) cls = 'buildings'
      else {
        cls = 'other'
        strength = 120
      }
    }
    const index = CLASS_INDEX[cls]
    meta[i * 4] = index
    meta[i * 4 + 1] = strength
    classCounts[index] += 1
    const key =
      ((Math.floor((y - min[1]) / objectCell) * ox + Math.floor((x - min[0]) / objectCell)) * 8 + index) | 0
    let id = registry.get(key)
    if (id === undefined) {
      id = OBJECT_ID_BASE + registry.size
      registry.set(key, id)
    }
    objectIds[i] = id
  }

  const { terrainInput: _terrainInput, semanticClasses: _semanticClasses, ...state } = resolved
  const model: ModelState = {
    ...state,
    terrain: { source: terrainSource, reliable: reliableTerrain },
    finalBounds: { min, max },
    dimensions: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    boundingSphere: {
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1,
    },
  }

  return {
    name,
    count: n,
    positions,
    colors,
    meta,
    terrainElevation,
    terrain: { minX: min[0], minY: min[1], cell, gx, gy, heights: ground, source: terrainSource },
    objectIds,
    normals,
    bounds: { min, max },
    focusBounds: { min: fMin, max: fMax },
    zRange: [min[2], max[2]],
    classCounts,
    meanConfidence: confidenceSum / n,
    geoReference: options.geoReference ?? resolved.geoReference,
    model,
    source: {
      kind: options.sourceKind ?? 'gltf-prototype',
      sourcePoints: options.source?.sourcePoints ?? (sourcePoints || meshCount),
      stride: stride * (options.source?.stride ?? 1),
      unitsToMeters: resolved.unitsToMeters,
    },
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) return
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose()
      })
      material.dispose()
    })
  })
}

/* ------------------------------------------------------------------ */
/* Loaders: geometry + metadata candidates for each format            */
/* ------------------------------------------------------------------ */

interface LoadContext {
  /** Companion metadata (if any) + warnings, shared by every loader. */
  metadata: MetadataCandidate[]
  warnings: string[]
  onProgress: (fraction: number) => void
  onPhase: (message: string) => void
}

/** Resolves companion references (buffers, textures, .mtl) to uploaded blobs; `idle()` waits for pending loads. */
function assetManager(model: ActiveModel) {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    const file = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '').toLowerCase()
    return model.assets[file] ?? url
  })
  let active = 0
  let waiters: (() => void)[] = []
  const start = manager.itemStart.bind(manager)
  const end = manager.itemEnd.bind(manager)
  manager.itemStart = (url: string) => {
    active += 1
    start(url)
  }
  manager.itemEnd = (url: string) => {
    active = Math.max(0, active - 1)
    end(url)
    if (active === 0) {
      waiters.forEach((resolve) => resolve())
      waiters = []
    }
  }
  const idle = (timeout = 20_000) =>
    active === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, timeout)
        })
  return { manager, idle }
}

const progressOf = (onProgress: (fraction: number) => void) => (event: ProgressEvent) => {
  if (event.lengthComputable) onProgress(event.loaded / event.total)
}

/** Embedded glTF metadata: extras (root, asset, scene, top nodes) + the Sketchfab export node. */
function gltfMetadata(gltf: { userData: Record<string, unknown>; asset: { extras?: unknown }; scene: THREE.Group }, warnings: string[]) {
  const found: MetadataCandidate[] = []
  const add = (raw: unknown, label: string) => {
    const data = parseMetadataObject(raw, warnings)
    if (data) found.push({ level: 'embedded', label, data })
  }
  add(gltf.userData, 'glTF root extras')
  add(gltf.asset?.extras, 'glTF asset extras')
  add(gltf.scene.userData, 'glTF scene extras')
  gltf.scene.children.forEach((child) => add(child.userData, `glTF node "${child.name}" extras`))

  // Sketchfab wraps the uploaded data in one node: a uniform normalisation scale
  // (undo it → source units) and, for Z-up sources, a −90° X rotation to Y-up.
  const node = gltf.scene.getObjectByName('Sketchfab_model')
  if (node) {
    node.updateWorldMatrix(true, false)
    const scale = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    node.matrixWorld.decompose(new THREE.Vector3(), quaternion, scale)
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion)
    const data: MetadataCandidate['data'] = {}
    if (scale.x > 0 && Math.abs(scale.x - 1) > 1e-6) {
      data.units = 'm'
      data.unitsToMeters = 1 / scale.x
    }
    if (up.y > 0.999) data.rotation = [...Y_UP_TO_Z_UP] // source was Z-up; the export node records it
    if (Object.keys(data).length) found.push({ level: 'embedded', label: 'Sketchfab export node', data })
  }
  return found
}

async function loadFromGLTF(model: ActiveModel, ctx: LoadContext): Promise<PointCloudDataset> {
  const { manager } = assetManager(model)
  const gltf = await new GLTFLoader(manager).loadAsync(model.url, progressOf(ctx.onProgress))
  try {
    const embedded = gltfMetadata(gltf as unknown as Parameters<typeof gltfMetadata>[0], ctx.warnings)
    const format: MetadataCandidate = {
      level: 'format',
      label: 'glTF 2.0 convention (metres, Y up)',
      data: { units: 'm', unitsToMeters: 1, rotation: [...Y_UP_TO_Z_UP] },
    }
    return await datasetFromObject3D(gltf.scene, model.name, {
      onPhase: ctx.onPhase,
      sourceKind: 'gltf-prototype',
      format: model.format,
      metadata: [...embedded, ...ctx.metadata, format],
      warnings: ctx.warnings,
    })
  } finally {
    disposeObject(gltf.scene)
  }
}

/** Custom PLY vertex properties that carry per-point semantic classes. */
const PLY_CLASS_PROPERTIES = ['classification', 'scalar_classification', 'class', 'scalar_class', 'label', 'scalar_label', 'semantic', 'semantic_class', 'category']

/** Byte size of each PLY scalar type (both naming styles). */
const PLY_TYPE_SIZE: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4, double: 8, float64: 8,
}

interface PlyProperty {
  name: string
  type: string
  /** true for `property list …` (faces). */
  list: boolean
}

/** PLY header (ASCII, before `end_header`): format, elements + properties, comments, byte length. */
function parsePlyHeader(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1 << 16))
  const text = new TextDecoder('latin1').decode(bytes)
  const end = text.indexOf('end_header')
  // Header ends after the newline that follows `end_header` (latin1 keeps char index = byte index).
  const newline = end >= 0 ? text.indexOf('\n', end) : -1
  const headerLength = newline >= 0 ? newline + 1 : -1
  const lines = (end >= 0 ? text.slice(0, end) : '').split(/\r\n|\r|\n/)
  const comments: string[] = []
  const elements: { name: string; count: number; properties: PlyProperty[] }[] = []
  let format = ''
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] === 'format') format = parts[1] ?? ''
    else if (parts[0] === 'comment' || parts[0] === 'obj_info') comments.push(line.trim().replace(/^(comment|obj_info)\s+/, ''))
    else if (parts[0] === 'element') elements.push({ name: parts[1], count: Number(parts[2]) || 0, properties: [] })
    else if (parts[0] === 'property' && elements.length) {
      const list = parts[1] === 'list'
      elements[elements.length - 1].properties.push({ name: list ? parts[4] : parts[2], type: list ? parts[3] : parts[1], list })
    }
  }
  const vertex = elements.find((e) => e.name === 'vertex')
  const vertexProperties = vertex ? vertex.properties.filter((p) => !p.list).map((p) => p.name) : []
  return { format, headerLength, elements, comments, vertexProperties }
}

type PlyHeader = ReturnType<typeof parsePlyHeader>

/**
 * Fast path for binary point-cloud PLYs (the common photogrammetry / ML output:
 * `vertex` only, no faces). Reads straight from the file buffer with a DataView
 * into typed arrays, taking every `stride`-th vertex so at most `maxPoints` are
 * kept. `PLYLoader` instead builds plain JS arrays for EVERY vertex — for an
 * 18 M-point, 500 MB file that is ~40 s and ~1.7 GB of heap, enough to freeze or
 * crash a browser tab. Returns null when the file is not this simple layout
 * (ASCII, faces, vertex not first, …) so the caller falls back to `PLYLoader`.
 */
function parseBinaryPlyPoints(buffer: ArrayBuffer, header: PlyHeader, maxPoints: number) {
  const little = header.format === 'binary_little_endian'
  if (!little && header.format !== 'binary_big_endian') return null
  if (header.headerLength < 0 || header.elements[0]?.name !== 'vertex') return null
  if (header.elements.some((e) => e.name === 'face' && e.count > 0)) return null
  const vertex = header.elements[0]
  if (vertex.properties.some((p) => p.list || !PLY_TYPE_SIZE[p.type])) return null

  const offsets = new Map<string, { offset: number; type: string }>()
  let recordSize = 0
  for (const p of vertex.properties) {
    offsets.set(p.name.toLowerCase(), { offset: recordSize, type: p.type })
    recordSize += PLY_TYPE_SIZE[p.type]
  }
  const find = (...names: string[]) => names.map((n) => offsets.get(n)).find((v) => v !== undefined)
  const px = find('x')
  const py = find('y')
  const pz = find('z')
  if (!px || !py || !pz) return null
  const total = Math.min(vertex.count, Math.floor((buffer.byteLength - header.headerLength) / recordSize))
  if (total <= 0) return null

  const view = new DataView(buffer, header.headerLength)
  const read = (o: number, type: string): number => {
    switch (type) {
      case 'float': case 'float32': return view.getFloat32(o, little)
      case 'double': case 'float64': return view.getFloat64(o, little)
      case 'uchar': case 'uint8': return view.getUint8(o)
      case 'char': case 'int8': return view.getInt8(o)
      case 'ushort': case 'uint16': return view.getUint16(o, little)
      case 'short': case 'int16': return view.getInt16(o, little)
      case 'uint': case 'uint32': return view.getUint32(o, little)
      default: return view.getInt32(o, little)
    }
  }
  const nx = find('nx', 'normal_x')
  const ny = find('ny', 'normal_y')
  const nz = find('nz', 'normal_z')
  const cr = find('red', 'diffuse_red', 'r')
  const cg = find('green', 'diffuse_green', 'g')
  const cb = find('blue', 'diffuse_blue', 'b')
  const cls = find(...PLY_CLASS_PROPERTIES)
  // Colour → byte: uchar as-is, ushort /257, float/double assumed 0–1.
  const colourScale = (type: string) => (PLY_TYPE_SIZE[type] === 1 ? 1 : type.includes('short') || type.includes('16') ? 1 / 257 : 255)

  const stride = Math.max(1, Math.ceil(total / maxPoints))
  const n = Math.ceil(total / stride)
  const positions = new Float32Array(n * 3)
  const normals = nx && ny && nz ? new Float32Array(n * 3) : null
  const colors = cr && cg && cb ? new Uint8Array(n * 3) : null
  const classes = cls ? new Float32Array(n) : null
  const rs = cr ? colourScale(cr.type) : 1
  const gs = cg ? colourScale(cg.type) : 1
  const bs = cb ? colourScale(cb.type) : 1
  for (let k = 0; k < n; k += 1) {
    const base = k * stride * recordSize
    positions[k * 3] = read(base + px.offset, px.type)
    positions[k * 3 + 1] = read(base + py.offset, py.type)
    positions[k * 3 + 2] = read(base + pz.offset, pz.type)
    if (normals) {
      normals[k * 3] = read(base + nx!.offset, nx!.type)
      normals[k * 3 + 1] = read(base + ny!.offset, ny!.type)
      normals[k * 3 + 2] = read(base + nz!.offset, nz!.type)
    }
    if (colors) {
      colors[k * 3] = Math.min(255, Math.round(read(base + cr!.offset, cr!.type) * rs))
      colors[k * 3 + 1] = Math.min(255, Math.round(read(base + cg!.offset, cg!.type) * gs))
      colors[k * 3 + 2] = Math.min(255, Math.round(read(base + cb!.offset, cb!.type) * bs))
    }
    if (classes) classes[k] = read(base + cls!.offset, cls!.type)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true))
  if (classes) geometry.setAttribute('classification', new THREE.BufferAttribute(classes, 1))
  return { geometry, sourcePoints: total, stride }
}

/**
 * PLY adapter. `PLYLoader` (three.js) parses both ASCII and binary
 * (little/big-endian) PLY transparently and normalises `vertex` properties
 * into standard `position` / `color` (0–1 floats) / `normal` attributes —
 * exactly the shapes `datasetFromObject3D` already reads for GLB/GLTF. The file
 * is read once; its header is inspected first for metadata comments and a
 * classification-like vertex property (mapped to a `classification` attribute).
 *
 * The parsed geometry is wrapped in a throwaway `Points` (plain vertex list)
 * or `Mesh` (the PLY has a `face` element → indexed triangles) so it can reuse
 * the whole shared extraction / transform / terrain / classification pipeline.
 * The wrapper's material `.color` is only the fallback tint for vertices with
 * no colour attribute — these materials are never actually rendered.
 */
async function loadFromPLY(model: ActiveModel, ctx: LoadContext): Promise<PointCloudDataset> {
  const loader = new THREE.FileLoader()
  loader.setResponseType('arraybuffer')
  const buffer = (await loader.loadAsync(model.url, progressOf(ctx.onProgress))) as ArrayBuffer

  ctx.onPhase('Parsing PLY…')
  await tick()
  const header = parsePlyHeader(buffer)
  if (header.headerLength < 0 || !new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, 3)).startsWith('ply'))
    throw new Error('This file is not a valid PLY (missing "ply" / "end_header" header).')
  let geometry: THREE.BufferGeometry
  let source: { sourcePoints: number; stride: number } | undefined
  try {
    const fast = parseBinaryPlyPoints(buffer, header, DEFAULT_MAX_POINTS)
    if (fast) {
      geometry = fast.geometry
      source = { sourcePoints: fast.sourcePoints, stride: fast.stride }
    } else {
      const plyLoader = new PLYLoader()
      const classProperty = header.vertexProperties.find((p) => PLY_CLASS_PROPERTIES.includes(p.toLowerCase()))
      if (classProperty) plyLoader.setCustomPropertyNameMapping({ classification: [classProperty] })
      geometry = plyLoader.parse(buffer)
    }
  } catch (error) {
    console.error('Failed to parse PLY', model.url, error)
    throw new Error('This PLY file could not be parsed. It may be corrupted or use an unsupported PLY variant.')
  }
  if (!geometry.getAttribute('position')?.count) {
    geometry.dispose()
    throw new Error('This PLY file has no readable point data.')
  }

  // A `face` element (indexed triangles) means the PLY is a surface mesh, not a
  // point cloud — route it through the mesh-sampling path instead. (A PLY using
  // the legacy non-indexed per-face-vertex-colour layout falls back to being
  // treated as a dense point cloud of its expanded vertices.)
  const isMesh = geometry.index !== null && geometry.index.count > 0
  const object: THREE.Object3D = isMesh
    ? new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0b0b0 }))
    : new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff }))

  const embedded = metadataFromComments(header.comments, ctx.warnings)
  try {
    return await datasetFromObject3D(object, model.name, {
      onPhase: ctx.onPhase,
      sourceKind: 'ply-prototype',
      format: 'ply',
      metadata: [...(embedded ? [{ level: 'embedded' as const, label: 'PLY header comments', data: embedded }] : []), ...ctx.metadata],
      warnings: ctx.warnings,
      source,
    })
  } finally {
    disposeObject(object)
  }
}

/**
 * OBJ (+ MTL + textures) adapter. Geometry is surface-sampled like any mesh;
 * colours come from the MTL diffuse texture / colour. OBJ has no unit or axis
 * metadata — only explicit `# units cm` / `# up z` style comments are used,
 * otherwise scale stays unknown and orientation is estimated from geometry.
 */
async function loadFromOBJ(model: ActiveModel, ctx: LoadContext): Promise<PointCloudDataset> {
  const { manager, idle } = assetManager(model)
  const fileLoader = new THREE.FileLoader(manager)
  fileLoader.setResponseType('text')
  const text = (await fileLoader.loadAsync(model.url, progressOf(ctx.onProgress))) as string

  ctx.onPhase('Parsing OBJ…')
  const objLoader = new OBJLoader(manager)
  const mtlName = text.match(/^\s*mtllib\s+(.+?)\s*$/m)?.[1]
  const mtlUrl = mtlName ? model.assets[decodeURIComponent(mtlName.split(/[\\/]/).pop() ?? '').toLowerCase()] : undefined
  if (mtlUrl) {
    try {
      const materials = await new MTLLoader(manager).loadAsync(mtlUrl)
      materials.preload()
      objLoader.setMaterials(materials)
    } catch (error) {
      console.warn('Failed to load MTL', mtlName, error)
      ctx.warnings.push('the .mtl file could not be read — default colours used')
    }
  }
  const group = objLoader.parse(text)
  await idle() // textures referenced by the MTL finish loading before colours are sampled

  const comments: string[] = []
  for (const line of text.slice(0, 1 << 16).split(/\r\n|\r|\n/)) {
    if (/^\s*v\s/.test(line)) break
    const comment = line.match(/^\s*#\s*(.+)$/)
    if (comment) comments.push(comment[1])
  }
  const embedded = metadataFromComments(comments, ctx.warnings)
  const format: MetadataCandidate = {
    level: 'format',
    label: 'OBJ convention (Y up, units unspecified)',
    data: { rotation: [...Y_UP_TO_Z_UP] },
  }
  try {
    return await datasetFromObject3D(group, model.name, {
      onPhase: ctx.onPhase,
      sourceKind: 'obj-prototype',
      format: 'obj',
      metadata: [...(embedded ? [{ level: 'embedded' as const, label: 'OBJ header comments', data: embedded }] : []), ...ctx.metadata, format],
      warnings: ctx.warnings,
    })
  } finally {
    disposeObject(group)
  }
}

/**
 * Load the active model and convert it into a dataset. `model.format` picks the
 * adapter; every adapter returns the same generic `PointCloudDataset`, so the
 * renderer/UI never know (or care) which file format produced it. An optional
 * companion `<model>.metadata.json` is looked up first (never required).
 */
export async function loadPointCloud(
  model: ActiveModel,
  onProgress: (fraction: number) => void,
  onPhase: (message: string) => void,
): Promise<PointCloudDataset> {
  const warnings: string[] = []
  const metadata: MetadataCandidate[] = []
  const companion = await loadCompanionMetadata(model, warnings)
  if (companion) {
    const data = parseMetadataObject(companion.raw, warnings)
    if (data) metadata.push({ level: 'companion', label: companion.label, data })
    else warnings.push(`${companion.label}: no usable fields — ignored`)
  }
  const ctx: LoadContext = { metadata, warnings, onProgress, onPhase }
  let ds: PointCloudDataset
  switch (model.format) {
    case 'glb':
    case 'gltf':
      ds = await loadFromGLTF(model, ctx)
      break
    case 'ply':
      ds = await loadFromPLY(model, ctx)
      break
    case 'obj':
      ds = await loadFromOBJ(model, ctx)
      break
    default:
      throw new Error(`${model.format.toUpperCase()} isn't supported by the point-cloud loader yet.`)
  }
  console.info('[AirLock++] model state', ds.name, ds.model)
  return ds
}

/** Highlight colours for the first three selected points (P1–P3); later points use the fallback. */
export const SELECTION_COLORS = ['#5bb974', '#3d8fe0', '#8b5cc7'] as const
export const SELECTION_FALLBACK = '#d5d8da'
export const selectionColor = (index: number) => SELECTION_COLORS[index] ?? SELECTION_FALLBACK
