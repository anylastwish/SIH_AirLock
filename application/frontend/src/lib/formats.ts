/**
 * Model-format registry for the Visualizer workflow.
 *
 * Each supported format declares which Main Application view it belongs to
 * and whether the prototype has a loader for it. Routing a new format to a
 * viewer later means changing one entry here (plus adding the loader) — the
 * Input Page and Main Application read from this table instead of hardcoding
 * extensions.
 */

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'las' | 'ply' | 'fbx'
export type AppView = 'cesium' | 'semantic' | 'pointcloud'

interface ModelFormatInfo {
  label: string
  /** Main Application view that should open for this format. */
  view: AppView
  /** Loader available in the prototype viewer. `null` = accepted, not renderable yet. */
  loader: 'gltf' | 'ply' | null
}

export const MODEL_FORMATS: Record<ModelFormat, ModelFormatInfo> = {
  glb: { label: 'GLB', view: 'cesium', loader: 'gltf' },
  gltf: { label: 'GLTF', view: 'cesium', loader: 'gltf' },
  obj: { label: 'OBJ', view: 'cesium', loader: null },
  fbx: { label: 'FBX', view: 'cesium', loader: null },
  las: { label: 'LAS', view: 'pointcloud', loader: null },
  ply: { label: 'PLY', view: 'pointcloud', loader: 'ply' },
}

/** Files that ride along with a primary model file (materials, buffers, textures). */
export const COMPANION_EXTENSIONS = [
  'mtl',
  'bin',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'bmp',
  'tga',
  'tif',
  'tiff',
]

export const VISUALIZER_ACCEPT = [
  ...Object.keys(MODEL_FORMATS),
  ...COMPANION_EXTENSIONS,
].map((ext) => `.${ext}`)

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function isModelFormat(ext: string): ext is ModelFormat {
  return ext in MODEL_FORMATS
}

export interface ModelSelection {
  primary: File | null
  format: ModelFormat | null
  companions: File[]
  /** Blocks "Open Model". */
  error: string | null
  /** Non-blocking guidance. */
  hint: string | null
}

/** Works out the primary model file and its companions from everything the user added. */
export function classifyModelFiles(files: File[]): ModelSelection {
  const primaries = files.filter((f) => isModelFormat(extensionOf(f.name)))
  const companions = files.filter((f) => !isModelFormat(extensionOf(f.name)))

  if (files.length === 0) {
    return { primary: null, format: null, companions, error: null, hint: null }
  }
  if (primaries.length === 0) {
    return {
      primary: null,
      format: null,
      companions,
      error: 'Add a model file (GLB, GLTF, OBJ, LAS, PLY or FBX).',
      hint: null,
    }
  }
  if (primaries.length > 1) {
    return {
      primary: null,
      format: null,
      companions,
      error: `Select one model at a time — remove one of: ${primaries.map((f) => f.name).join(', ')}.`,
      hint: null,
    }
  }

  const primary = primaries[0]
  const format = extensionOf(primary.name) as ModelFormat
  const names = new Set(companions.map((f) => extensionOf(f.name)))

  let hint: string | null = null
  if (format === 'obj' && !names.has('mtl')) {
    hint = 'No .mtl file added — the model will open without materials.'
  } else if (format === 'gltf' && !names.has('bin') && companions.length === 0) {
    hint = 'If this GLTF references external .bin or texture files, add them too.'
  }

  return { primary, format, companions, error: null, hint }
}

/** Adds newly chosen files to the list; a file with the same name replaces the old one. */
export function mergeFiles(existing: File[], incoming: File[]): File[] {
  const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f]))
  incoming.forEach((f) => byName.set(f.name.toLowerCase(), f))
  return [...byName.values()]
}
