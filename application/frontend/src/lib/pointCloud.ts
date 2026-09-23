import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import type { ActiveModel } from './session'

/**
 * Generic point-cloud data model for the Point Cloud View.
 *
 * The renderer, the UI state and the inspector only ever see `PointCloudDataset`.
 * Today it is produced by the GLB adapter below (prototype); real LAS/LAZ/PLY
 * parsers or backend ML output only need to return the same structure —
 * nothing in the UI or renderer changes.
 *
 * Conventions
 *  - Local coordinates are metres, right-handed, **Z up** (X east, Y north), like LAS.
 *  - A point's ID is its index in these arrays (stable for the lifetime of the dataset).
 *  - All per-point arrays are structure-of-arrays typed arrays; `colors` and `meta`
 *    are laid out so they can be uploaded to the GPU unchanged.
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

/** Optional link between local XY (metres) and WGS84. `null` = not georeferenced. */
export interface GeoReference {
  /** Latitude / longitude (degrees) of local X = 0, Y = 0. */
  originLatitude: number
  originLongitude: number
}

export interface PointCloudDataset {
  name: string
  count: number
  /** xyz per point, local metres, Z up. */
  positions: Float32Array
  /** rgba per point: rgb = original colour, a = reconstruction confidence (0–255 ≙ 0–1). */
  colors: Uint8Array
  /** per point: [semanticClass index, semanticConfidence 0–255, 0, 0]. */
  meta: Uint8Array
  /** Ground height under each point (DTM/DEM lookup in the prototype: derived grid). */
  terrainElevation: Float32Array
  /** Stable object/instance number per point (see `objectLabel`). */
  objectIds: Uint32Array
  /** xyz unit normal per point, only when the source actually carried normals (e.g. PLY `nx ny nz`). */
  normals: Float32Array | null
  /** Full extent of the data. */
  bounds: { min: Vec3; max: Vec3 }
  /** 1st–99th percentile extent — used for camera framing and helper geometry. */
  focusBounds: { min: Vec3; max: Vec3 }
  zRange: [number, number]
  /** Points per semantic class (index = SEMANTIC_CLASSES order). */
  classCounts: number[]
  /** Mean reconstruction confidence, 0–1. */
  meanConfidence: number
  geoReference: GeoReference | null
  /** What produced this dataset (documentation / debugging). */
  source: {
    kind: 'gltf-prototype' | 'ply-prototype'
    sourcePoints: number
    stride: number
    unitsToMeters: number
  }
}

export interface PointRecord {
  id: number
  x: number
  y: number
  z: number
  latitude: number | null
  longitude: number | null
  terrainElevation: number
  rgb: Vec3
  semanticClass: SemanticClassId
  semanticConfidence: number
  reconstructionConfidence: number
  objectId: string
}

export const OBJECT_ID_BASE = 10000
export const objectLabel = (objectId: number) => `OBJ_${objectId}`

export function toGeographic(ds: PointCloudDataset, x: number, y: number) {
  if (!ds.geoReference) return null
  const { originLatitude, originLongitude } = ds.geoReference
  const metresPerDegLat = 111_320
  const latitude = originLatitude + y / metresPerDegLat
  const longitude = originLongitude + x / (metresPerDegLat * Math.cos((originLatitude * Math.PI) / 180))
  return { latitude, longitude }
}

export function getPoint(ds: PointCloudDataset, id: number): PointRecord {
  const x = ds.positions[id * 3]
  const y = ds.positions[id * 3 + 1]
  const z = ds.positions[id * 3 + 2]
  const geo = toGeographic(ds, x, y)
  return {
    id,
    x,
    y,
    z,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    terrainElevation: ds.terrainElevation[id],
    rgb: [ds.colors[id * 4], ds.colors[id * 4 + 1], ds.colors[id * 4 + 2]],
    semanticClass: SEMANTIC_CLASSES[ds.meta[id * 4]].id,
    semanticConfidence: ds.meta[id * 4 + 1] / 255,
    reconstructionConfidence: ds.colors[id * 4 + 3] / 255,
    objectId: objectLabel(ds.objectIds[id]),
  }
}

/* ------------------------------------------------------------------ */
/* Prototype adapter: three.js object graph (GLB/GLTF) → dataset       */
/* ------------------------------------------------------------------ */

/** Cap on prototype points: keeps memory, GPU load and picking responsive. */
const DEFAULT_MAX_POINTS = 6_500_000
/** Surface samples drawn from mesh-only models (no point primitives). */
const MESH_SAMPLES = 400_000

export interface AdapterOptions {
  maxPoints?: number
  /** Scene units → metres. Default: undo the Sketchfab normalisation node if present. */
  unitsToMeters?: number
  geoReference?: GeoReference | null
  onPhase?: (message: string) => void
  /** Recorded on the dataset's `source.kind` (documentation only). Default 'gltf-prototype'. */
  sourceKind?: PointCloudDataset['source']['kind']
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Sketchfab exports wrap the source data in a uniformly scaled node; undo it to get source units (metres). */
function detectUnitsToMeters(root: THREE.Object3D): number {
  const node = root.getObjectByName('Sketchfab_model')
  if (!node) return 1
  const scale = new THREE.Vector3().setFromMatrixScale(node.matrix)
  return scale.x > 0 && Math.abs(scale.x - 1) > 1e-6 ? 1 / scale.x : 1
}

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

export async function datasetFromObject3D(
  root: THREE.Object3D,
  name: string,
  options: AdapterOptions = {},
): Promise<PointCloudDataset> {
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS
  const phase = options.onPhase ?? (() => {})
  root.updateMatrixWorld(true)
  const unitsToMeters = options.unitsToMeters ?? detectUnitsToMeters(root)

  const clouds: THREE.Points[] = []
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Points).isPoints) clouds.push(object as THREE.Points)
    else if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
  })
  // Normals are only captured for the point-copy path (below) — meshes are already
  // area-sampled without shading, so per-vertex normals wouldn't be used there.
  const hasNormals = clouds.some((c) => !!c.geometry.getAttribute('normal'))

  const sourcePoints = clouds.reduce((sum, c) => sum + c.geometry.getAttribute('position').count, 0)
  const stride = Math.max(1, Math.ceil(sourcePoints / maxPoints))
  const cloudCount = clouds.reduce(
    (sum, c) => sum + Math.ceil(c.geometry.getAttribute('position').count / stride),
    0,
  )
  const meshCount = meshes.length ? Math.max(0, Math.min(maxPoints - cloudCount, MESH_SAMPLES)) : 0
  const n = cloudCount + meshCount
  if (n === 0) throw new Error('No point or mesh geometry found in this model.')

  const positions = new Float32Array(n * 3)
  const colors = new Uint8Array(n * 4)
  const meta = new Uint8Array(n * 4)
  const normals = hasNormals ? new Float32Array(n * 3) : null
  let w = 0

  /* --- 1. positions + colours (+ normals) (Y-up scene units → Z-up metres) ------ */
  phase('Extracting points…')
  for (const cloud of clouds) {
    const geometry = cloud.geometry
    const pos = geometry.getAttribute('position')
    const col = geometry.getAttribute('color')
    const nrm = geometry.getAttribute('normal')
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
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
      positions[w * 3] = wx * unitsToMeters
      positions[w * 3 + 1] = -wz * unitsToMeters
      positions[w * 3 + 2] = wy * unitsToMeters
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
      // Direction only: rotate by the 3×3 part of the world matrix (no translation),
      // same Y-up→Z-up axis swap as position. Assumes no non-uniform scale (true for
      // our wrapper objects and the Sketchfab uniform-scale node).
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
          normals[w * 3 + 1] = -rz / len
          normals[w * 3 + 2] = ry / len
        } else {
          normals[w * 3] = 0
          normals[w * 3 + 1] = 0
          normals[w * 3 + 2] = 0
        }
      }
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
        area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
        cumulative.push(area)
        tri.push({ mesh, i0, i1, i2 })
      }
    }
    const tint = new THREE.Color()
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
      let u = rand()
      let v = rand()
      if (u + v > 1) {
        u = 1 - u
        v = 1 - v
      }
      const wgt = [1 - u - v, u, v]
      const ids = [i0, i1, i2]
      const p = new THREE.Vector3()
      const q = new THREE.Vector3()
      for (let k = 0; k < 3; k += 1) p.add(q.fromBufferAttribute(pos, ids[k]).multiplyScalar(wgt[k]))
      p.applyMatrix4(mesh.matrixWorld)
      positions[w * 3] = p.x * unitsToMeters
      positions[w * 3 + 1] = -p.z * unitsToMeters
      positions[w * 3 + 2] = p.y * unitsToMeters
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
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
      w += 1
    }
  }

  /* --- 2. extents ---------------------------------------------------------- */
  phase('Analysing extents…')
  await tick()
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const value = positions[i * 3 + k]
      if (value < min[k]) min[k] = value
      if (value > max[k]) max[k] = value
    }
  }
  const sampleStep = Math.max(1, Math.floor(n / 200_000))
  const axes = [0, 1, 2].map(() => [] as number[])
  for (let i = 0; i < n; i += sampleStep) for (let k = 0; k < 3; k += 1) axes[k].push(positions[i * 3 + k])
  const fMin: Vec3 = [0, 0, 0]
  const fMax: Vec3 = [0, 0, 0]
  axes.forEach((values, k) => {
    values.sort((p, q) => p - q)
    fMin[k] = percentile(values, 0.01)
    fMax[k] = percentile(values, 0.99)
  })
  const zLowCut = percentile(axes[2], 0.005)

  /* --- 3. terrain elevation proxy (DTM stand-in): smoothed per-cell minimum -- */
  phase('Deriving terrain…')
  await tick()
  const extentX = max[0] - min[0] || 1
  const extentY = max[1] - min[1] || 1
  const cell = Math.max(extentX, extentY) / 96
  const gx = Math.ceil(extentX / cell) + 1
  const gy = Math.ceil(extentY / cell) + 1
  const cellMin = new Float32Array(gx * gy).fill(Infinity)
  const cellOf = (i: number) =>
    Math.floor((positions[i * 3 + 1] - min[1]) / cell) * gx + Math.floor((positions[i * 3] - min[0]) / cell)
  for (let i = 0; i < n; i += 1) {
    const z = positions[i * 3 + 2]
    if (z < zLowCut) continue
    const c = cellOf(i)
    if (z < cellMin[c]) cellMin[c] = z
  }
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
  const terrainElevation = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const g = ground[cellOf(i)]
    const z = positions[i * 3 + 2]
    terrainElevation[i] = Number.isFinite(g) ? Math.min(g, z) : z
  }

  /* --- 4. reconstruction-confidence proxy: local point density -------------- */
  phase('Estimating confidence…')
  await tick()
  const voxel = Math.max(extentX, extentY, max[2] - min[2]) / 128
  const vx = Math.ceil(extentX / voxel) + 1
  const vy = Math.ceil(extentY / voxel) + 1
  const vz = Math.ceil((max[2] - min[2]) / voxel) + 1
  const voxels = new Uint32Array(vx * vy * vz)
  const voxelOf = (i: number) =>
    (Math.floor((positions[i * 3 + 2] - min[2]) / voxel) * vy + Math.floor((positions[i * 3 + 1] - min[1]) / voxel)) * vx +
    Math.floor((positions[i * 3] - min[0]) / voxel)
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

  /* --- 5. semantic class (rule-based placeholder) + object ids -------------- */
  phase('Classifying…')
  await tick()
  const classCounts = SEMANTIC_CLASSES.map(() => 0)
  const objectIds = new Uint32Array(n)
  const registry = new Map<number, number>()
  const objectCell = Math.max(extentX, extentY) / 24
  const ox = Math.ceil(extentX / objectCell) + 1
  for (let i = 0; i < n; i += 1) {
    const r = colors[i * 4]
    const g = colors[i * 4 + 1]
    const b = colors[i * 4 + 2]
    const height = positions[i * 3 + 2] - terrainElevation[i]
    const lum = (r + g + b) / 3
    const sat = Math.max(r, g, b) - Math.min(r, g, b)
    let cls: SemanticClassId
    let strength = 200
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
    const index = CLASS_INDEX[cls]
    meta[i * 4] = index
    meta[i * 4 + 1] = strength
    classCounts[index] += 1
    const key =
      ((Math.floor((positions[i * 3 + 1] - min[1]) / objectCell) * ox +
        Math.floor((positions[i * 3] - min[0]) / objectCell)) *
        8 +
        index) |
      0
    let id = registry.get(key)
    if (id === undefined) {
      id = OBJECT_ID_BASE + registry.size
      registry.set(key, id)
    }
    objectIds[i] = id
  }

  return {
    name,
    count: n,
    positions,
    colors,
    meta,
    terrainElevation,
    objectIds,
    normals,
    bounds: { min, max },
    focusBounds: { min: fMin, max: fMax },
    zRange: [min[2], max[2]],
    classCounts,
    meanConfidence: confidenceSum / n,
    geoReference: options.geoReference ?? null,
    source: {
      kind: options.sourceKind ?? 'gltf-prototype',
      sourcePoints: sourcePoints || meshCount,
      stride,
      unitsToMeters,
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

async function loadFromGLTF(
  model: ActiveModel,
  onProgress: (fraction: number) => void,
  onPhase: (message: string) => void,
): Promise<PointCloudDataset> {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    const name = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '').toLowerCase()
    return model.assets[name] ?? url
  })
  const gltf = await new GLTFLoader(manager).loadAsync(model.url, (event) => {
    if (event.lengthComputable) onProgress(event.loaded / event.total)
  })
  try {
    return await datasetFromObject3D(gltf.scene, model.name, { onPhase, sourceKind: 'gltf-prototype' })
  } finally {
    disposeObject(gltf.scene)
  }
}

/**
 * PLY adapter. `PLYLoader` (three.js) parses both ASCII and binary
 * (little/big-endian) PLY transparently and normalises `vertex` properties
 * into standard `position` / `color` (0–1 floats) / `normal` attributes —
 * exactly the shapes `datasetFromObject3D` already reads for GLB/GLTF.
 *
 * The parsed geometry is wrapped in a throwaway `Points` (plain vertex list)
 * or `Mesh` (the PLY has a `face` element → indexed triangles) so it can reuse
 * the *entire* existing point/mesh extraction, extents, terrain, confidence
 * and semantic-classification pipeline unchanged — adding PLY needed no
 * changes to that shared logic, only this adapter.
 *
 * The wrapper's material `.color` is only used by `datasetFromObject3D` as the
 * fallback tint for vertices with no colour attribute — these materials are
 * never actually rendered.
 */
async function loadFromPLY(
  model: ActiveModel,
  onProgress: (fraction: number) => void,
  onPhase: (message: string) => void,
): Promise<PointCloudDataset> {
  let geometry: THREE.BufferGeometry
  try {
    geometry = await new PLYLoader().loadAsync(model.url, (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
  } catch (error) {
    console.error('Failed to parse PLY', model.url, error)
    throw new Error('This PLY file could not be parsed. It may be corrupted or use an unsupported PLY variant.')
  }

  onPhase('Parsing PLY…')
  if (!geometry.getAttribute('position')?.count) {
    geometry.dispose()
    throw new Error('This PLY file has no readable point data.')
  }

  // A `face` element (indexed triangles) means the PLY is a surface mesh, not a
  // point cloud — route it through the mesh-sampling path instead. (A PLY using
  // the legacy non-indexed per-face-vertex-colour layout falls back to being
  // treated as a dense point cloud of its expanded vertices — every point still
  // renders with its correct colour, just without triangle-surface sampling.)
  const isMesh = geometry.index !== null && geometry.index.count > 0
  const object: THREE.Object3D = isMesh
    ? new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0b0b0 }))
    : new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff }))

  try {
    return await datasetFromObject3D(object, model.name, { onPhase, sourceKind: 'ply-prototype' })
  } finally {
    disposeObject(object)
  }
}

/**
 * Load the active model and convert it into a dataset. `model.format` picks the
 * adapter; every adapter returns the same generic `PointCloudDataset`, so the
 * renderer/UI never know (or care) which file format produced it. Add LAS/LAZ
 * or a backend tile source the same way: one more `case` returning a dataset.
 */
export async function loadPointCloud(
  model: ActiveModel,
  onProgress: (fraction: number) => void,
  onPhase: (message: string) => void,
): Promise<PointCloudDataset> {
  switch (model.format) {
    case 'glb':
    case 'gltf':
      return loadFromGLTF(model, onProgress, onPhase)
    case 'ply':
      return loadFromPLY(model, onProgress, onPhase)
    default:
      throw new Error(`${model.format.toUpperCase()} isn't supported by the point-cloud loader yet.`)
  }
}

/** Highlight colours for the first three selected points (P1–P3); later points use the fallback. */
export const SELECTION_COLORS = ['#5bb974', '#3d8fe0', '#8b5cc7'] as const
export const SELECTION_FALLBACK = '#d5d8da'
export const selectionColor = (index: number) => SELECTION_COLORS[index] ?? SELECTION_FALLBACK
