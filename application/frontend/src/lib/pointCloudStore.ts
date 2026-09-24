import { useSyncExternalStore } from 'react'
import type { ActiveModel } from './session'
import {
  SEMANTIC_CLASSES,
  loadPointCloud,
  type PointCloudDataset,
  type SemanticClassId,
  type Vec3,
} from './pointCloud'
import { hudLayout } from './hudLayout'
import { frameBounds, inspectionDistance, objectBounds, pointXYZ, zoomLimits } from './pointCloudMath'

/**
 * Centralised Point Cloud View state.
 *
 * One plain external store (no state library): React reads it with
 * `usePC(selector)`, the WebGL renderer subscribes directly so slider drags
 * never re-render React. Sub-objects are replaced immutably, so selectors that
 * return them are referentially stable.
 *
 * Flow:  UI action → store → (renderer uniforms | overlays | inspector) — see
 * brain/point-cloud-view.md.
 */

export type RenderMode = 'rgb' | 'semantic' | 'elevation' | 'confidence'
export type SelectionMode = 'single' | 'multi'
export type Tool = 'select' | 'pan'
export type ViewMode = '2d' | '3d'
export type LayerId = 'points' | 'terrain' | 'flightPath' | 'surveyBoundary'
export type FlipAxis = 'horizontal' | 'vertical'

/** Mirroring of the displayed model about its survey centre (data coordinates are untouched). */
export interface FlipState {
  /** Mirror east ⇄ west (local X). */
  horizontal: boolean
  /** Mirror top ⇄ bottom (local Z, upside down). */
  vertical: boolean
}

/** Camera pose in world-local Z-up metres; `distance` is the FOV-45° framing distance. */
export interface CameraState {
  target: Vec3
  distance: number
  /** Compass heading the camera looks towards, degrees 0–360 (0 = north). */
  heading: number
  /**
   * Camera polar angle around the target, degrees 0–180: 0 = straight down (top
   * view), 90 = level with the target, 180 = straight up from below.
   */
  tilt: number
}

/** Everything undo/redo can restore. */
export interface ViewSettings {
  layers: Record<LayerId, boolean>
  renderMode: RenderMode
  /** 0–1 fraction of points drawn. */
  density: number
  /** Screen size of a point in px. */
  pointSize: number
  elevation: { min: number; max: number }
  classes: Record<SemanticClassId, boolean>
  confidence: { min: number; max: number }
  selectedIds: number[]
  activeId: number | null
  camera: CameraState
  viewMode: ViewMode
  flip: FlipState
}

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number; message: string }
  | { kind: 'ready' }
  | { kind: 'unsupported'; message: string }
  | { kind: 'error'; message: string }

export type CropAxis = 0 | 1 | 2

/**
 * Visualization-only crop: an axis-aligned box in WORLD-LOCAL coordinates (the
 * frame points are rendered and measured in). Points outside are not drawn and
 * not pickable; the dataset / source file are never touched. `min`/`max`
 * persist while `enabled` is off, so the crop can be toggled without losing it.
 */
export interface CropState {
  enabled: boolean
  min: Vec3
  max: Vec3
}

export interface PointCloudState extends ViewSettings {
  dataset: PointCloudDataset | null
  crop: CropState
  /** Crop Mode: the toolbar Crop button shows the crop controls + crop box. */
  cropOpen: boolean
  status: LoadStatus
  defaultCamera: CameraState | null
  selectionMode: SelectionMode
  tool: Tool
  navLocked: boolean
  classQuery: string
  rotationsOpen: boolean
  fullscreen: boolean
  /** Bumped when the camera must be (re)applied by the renderer. */
  cameraRev: number
  cameraAnimate: boolean
  /** Bumped by the toolbar Layers button to highlight the Layers section. */
  layersFlash: number
  canUndo: boolean
  canRedo: boolean
}

export const DEFAULT_HEADING = 0
/** 48° from vertical = 42° below the horizon (the approved default survey view). */
export const DEFAULT_TILT = 48
export const TILT_RANGE: [number, number] = [0, 180]
/** Tilt of the 2D (top-down) presentation. */
const TILT_2D = 0
export const DEFAULT_POINT_SIZE = 2
export const POINT_SIZE_RANGE: [number, number] = [1, 6]
export const MIN_DENSITY = 0.01
const HISTORY_LIMIT = 100

const allClasses = () =>
  Object.fromEntries(SEMANTIC_CLASSES.map((c) => [c.id, true])) as Record<SemanticClassId, boolean>

const emptyCamera: CameraState = { target: [0, 0, 0], distance: 100, heading: DEFAULT_HEADING, tilt: DEFAULT_TILT }

/** Crop covering the whole dataset (its full world-local bounding box) — a no-op crop. */
export const fullCrop = (ds: PointCloudDataset | null): CropState => ({
  enabled: true,
  min: ds ? [...ds.bounds.min] : [-Infinity, -Infinity, -Infinity],
  max: ds ? [...ds.bounds.max] : [Infinity, Infinity, Infinity],
})

/** True when the crop hides part of the model (enabled and smaller than the full bounds). */
export function isCropActive(s: Pick<PointCloudState, 'crop' | 'dataset'>): boolean {
  const ds = s.dataset
  if (!ds || !s.crop.enabled) return false
  return [0, 1, 2].some((k) => s.crop.min[k] > ds.bounds.min[k] || s.crop.max[k] < ds.bounds.max[k])
}

/** Is a world-local position inside the active crop? (Always true when the crop is disabled.) */
export function insideCrop(crop: CropState, p: Vec3): boolean {
  if (!crop.enabled) return true
  return p[0] >= crop.min[0] && p[0] <= crop.max[0] && p[1] >= crop.min[1] && p[1] <= crop.max[1] && p[2] >= crop.min[2] && p[2] <= crop.max[2]
}

const initialState = (): PointCloudState => ({
  dataset: null,
  crop: fullCrop(null),
  cropOpen: false,
  status: { kind: 'idle' },
  defaultCamera: null,
  layers: { points: true, terrain: true, flightPath: true, surveyBoundary: false },
  renderMode: 'rgb',
  density: 1,
  pointSize: DEFAULT_POINT_SIZE,
  elevation: { min: 0, max: 1 },
  classes: allClasses(),
  confidence: { min: 0, max: 1 },
  selectedIds: [],
  activeId: null,
  camera: emptyCamera,
  viewMode: '3d',
  flip: { horizontal: false, vertical: false },
  selectionMode: 'single',
  tool: 'select',
  navLocked: false,
  classQuery: '',
  rotationsOpen: false,
  fullscreen: false,
  cameraRev: 0,
  cameraAnimate: false,
  layersFlash: 0,
  canUndo: false,
  canRedo: false,
})

let state: PointCloudState = initialState()
const listeners = new Set<() => void>()

export const getState = () => state
export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function set(patch: Partial<PointCloudState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

/** React hook: `const density = usePC((s) => s.density)`. */
export function usePC<T>(selector: (s: PointCloudState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

/* ------------------------------ undo / redo ------------------------------ */

type Snapshot = ViewSettings
const snapshotOf = (s: PointCloudState): Snapshot => ({
  layers: s.layers,
  renderMode: s.renderMode,
  density: s.density,
  pointSize: s.pointSize,
  elevation: s.elevation,
  classes: s.classes,
  confidence: s.confidence,
  selectedIds: s.selectedIds,
  activeId: s.activeId,
  camera: s.camera,
  viewMode: s.viewMode,
  flip: s.flip,
})
let past: Snapshot[] = []
let future: Snapshot[] = []
let present: Snapshot | null = null

/**
 * The crop is not part of the history (it is a view region, not a step). A
 * restored selection therefore drops points hidden by the current crop.
 */
function withinCrop(snapshot: Snapshot): Snapshot {
  const ds = state.dataset
  if (!ds || !isCropActive(state)) return snapshot
  const selectedIds = snapshot.selectedIds.filter((id) => insideCrop(state.crop, pointXYZ(ds, id)))
  if (selectedIds.length === snapshot.selectedIds.length) return snapshot
  const activeId = snapshot.activeId !== null && selectedIds.includes(snapshot.activeId) ? snapshot.activeId : (selectedIds[selectedIds.length - 1] ?? null)
  return { ...snapshot, selectedIds, activeId }
}

function syncHistoryFlags() {
  set({ canUndo: past.length > 0, canRedo: future.length > 0 })
}
function resetHistory() {
  past = []
  future = []
  present = snapshotOf(state)
  syncHistoryFlags()
}

/* -------------------------------- helpers -------------------------------- */

/** Where a data-space point is drawn once the current flip is applied (mirrors about the focus-bounds centre). */
export function displayXYZ(ds: PointCloudDataset, p: Vec3, flip: FlipState): Vec3 {
  const { min, max } = ds.focusBounds
  return [
    flip.horizontal ? min[0] + max[0] - p[0] : p[0],
    p[1],
    flip.vertical ? min[2] + max[2] - p[2] : p[2],
  ]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const viewportAspect = () => (window.innerWidth || 1440) / Math.max(window.innerHeight || 800, 1)

function defaultCameraFor(ds: PointCloudDataset): CameraState {
  const { min, max } = ds.focusBounds
  // Fit inside the free area between the side panels, header and toolbar (lib/hudLayout.ts).
  const { fitX, fitY } = hudLayout()
  const { target, distance } = frameBounds(min, max, viewportAspect(), DEFAULT_HEADING, DEFAULT_TILT, fitX, fitY)
  return { target, distance, heading: DEFAULT_HEADING, tilt: DEFAULT_TILT }
}

function normaliseCamera(camera: CameraState): CameraState {
  const ds = state.dataset
  const limits = ds ? zoomLimits(ds) : null
  return {
    ...camera,
    distance: limits ? clamp(camera.distance, limits.min, limits.max) : camera.distance,
    heading: ((camera.heading % 360) + 360) % 360,
    tilt: clamp(camera.tilt, TILT_RANGE[0], TILT_RANGE[1]),
  }
}

/** Camera safety: every value finite, distance positive. */
export const isValidCamera = (c: CameraState) =>
  c.target.every(Number.isFinite) &&
  Number.isFinite(c.distance) &&
  c.distance > 0 &&
  Number.isFinite(c.heading) &&
  Number.isFinite(c.tilt)

function pushCamera(camera: CameraState, animate: boolean, extra: Partial<PointCloudState> = {}) {
  // An invalid pose (NaN / Infinity from a degenerate selection etc.) keeps the previous valid camera.
  const next = normaliseCamera(camera)
  if (!isValidCamera(next)) {
    console.warn('Ignoring invalid camera state', camera)
    if (Object.keys(extra).length) set(extra)
    return
  }
  set({ camera: next, cameraRev: state.cameraRev + 1, cameraAnimate: animate, ...extra })
}

let loadKey: string | null = null
let lastPercent = -1
/** Tilt to return to when leaving the 2D presentation. */
let lastTilt3d = DEFAULT_TILT

/* -------------------------------- actions -------------------------------- */

export const pc = {
  /** Load (once per model URL) and initialise the dataset. */
  async load(model: ActiveModel, loader = loadPointCloud) {
    if (loadKey === model.url && (state.dataset || state.status.kind === 'loading')) return
    loadKey = model.url
    lastPercent = -1
    set({ dataset: null, status: { kind: 'loading', progress: 0, message: 'Downloading model…' } })
    try {
      const ds = await loader(
        model,
        (progress) => {
          const percent = Math.round(progress * 100)
          if (percent === lastPercent) return
          lastPercent = percent
          set({
            status: {
              kind: 'loading',
              progress,
              message: progress < 1 ? 'Downloading model…' : 'Parsing model…',
            },
          })
        },
        (message) => set({ status: { kind: 'loading', progress: 1, message } }),
      )
      if (loadKey !== model.url) return
      pc.initDataset(ds)
    } catch (error) {
      console.error('Failed to load point cloud', model.url, error)
      loadKey = null
      set({
        status: {
          kind: 'error',
          message: error instanceof Error && error.message ? error.message : 'Could not load this model file.',
        },
      })
    }
  },

  markUnsupported(message: string) {
    loadKey = null
    set({ dataset: null, status: { kind: 'unsupported', message } })
  },

  /** Install a dataset (from any source) and reset the view to its defaults. */
  initDataset(ds: PointCloudDataset) {
    const defaultCamera = defaultCameraFor(ds)
    state = {
      ...initialState(),
      dataset: ds,
      // A new model always starts uncropped, from ITS OWN bounding box (never the previous model's crop).
      crop: fullCrop(ds),
      status: { kind: 'ready' },
      defaultCamera,
      camera: defaultCamera,
      elevation: { min: ds.zRange[0], max: ds.zRange[1] },
      rotationsOpen: state.rotationsOpen,
      fullscreen: state.fullscreen,
      cameraRev: state.cameraRev + 1,
    }
    resetHistory()
    listeners.forEach((listener) => listener())
  },

  /* ---- layers / appearance ---- */
  setLayer(id: LayerId, visible: boolean) {
    set({ layers: { ...state.layers, [id]: visible } })
    pc.commit()
  },
  setRenderMode(mode: RenderMode) {
    set({ renderMode: mode })
    pc.commit()
  },
  /** Slider drag: call `commit()` on release. */
  setDensity(density: number) {
    set({ density: clamp(density, MIN_DENSITY, 1) })
  },
  setPointSize(size: number) {
    set({ pointSize: clamp(size, POINT_SIZE_RANGE[0], POINT_SIZE_RANGE[1]) })
  },

  /* ---- filters ---- */
  setElevation(range: { min?: number; max?: number }) {
    const ds = state.dataset
    if (!ds) return
    let min = clamp(range.min ?? state.elevation.min, ds.zRange[0], ds.zRange[1])
    let max = clamp(range.max ?? state.elevation.max, ds.zRange[0], ds.zRange[1])
    if (min > max) {
      if (range.min !== undefined) max = min
      else min = max
    }
    set({ elevation: { min, max } })
  },
  setConfidence(range: { min?: number; max?: number }) {
    let min = clamp(range.min ?? state.confidence.min, 0, 1)
    let max = clamp(range.max ?? state.confidence.max, 0, 1)
    if (min > max) {
      if (range.min !== undefined) max = min
      else min = max
    }
    set({ confidence: { min, max } })
  },
  toggleClass(id: SemanticClassId) {
    set({ classes: { ...state.classes, [id]: !state.classes[id] } })
    pc.commit()
  },
  setClassQuery(query: string) {
    set({ classQuery: query })
  },

  /* ---- selection ---- */
  setSelectionMode(mode: SelectionMode) {
    set({ selectionMode: mode })
  },
  setTool(tool: Tool) {
    set({ tool })
  },
  toggleLock() {
    set({ navLocked: !state.navLocked })
  },
  /** A viewport click: `id` is the picked point, or null for empty space. */
  pickPoint(id: number | null, additive = false) {
    const multi = additive || state.selectionMode === 'multi'
    if (id === null) {
      if (!multi && state.selectedIds.length) pc.clearSelection()
      return
    }
    let ids: number[]
    if (multi) ids = state.selectedIds.includes(id) ? state.selectedIds.filter((p) => p !== id) : [...state.selectedIds, id]
    else ids = state.selectedIds.length === 1 && state.selectedIds[0] === id ? [] : [id]
    set({ selectedIds: ids, activeId: ids.includes(id) ? id : (ids[ids.length - 1] ?? null) })
    pc.commit()
  },
  setActive(id: number) {
    if (state.selectedIds.includes(id)) set({ activeId: id })
  },
  clearSelection() {
    if (!state.selectedIds.length) return
    set({ selectedIds: [], activeId: null })
    pc.commit()
  },
  /** Clear and get ready for a new selection sequence. */
  restartSelection() {
    set({ tool: 'select' })
    pc.clearSelection()
  },

  /* ---- camera ---- */
  /** Programmatic camera change (sliders, buttons). `animate` = tween, otherwise apply instantly. */
  setCamera(patch: Partial<CameraState>, animate = false) {
    const camera = { ...state.camera, ...patch }
    const leaving2d = state.viewMode === '2d' && patch.tilt !== undefined && patch.tilt > TILT_2D + 0.5
    pushCamera(camera, animate, leaving2d ? { viewMode: '3d' } : {})
  },
  /** Renderer → store: the user moved the camera with the mouse (no re-apply). */
  syncCamera(camera: CameraState) {
    if (isValidCamera(camera)) set({ camera })
  },
  /**
   * Focus / Target: nothing selected → whole survey; one point → the object it
   * belongs to (inspector "Object ID"); several points → their extent. The
   * distance comes from the real bounding box (≈10 m stand-off where the
   * structure allows it — see `inspectionDistance`), never a fixed factor.
   */
  focus() {
    const ds = state.dataset
    if (!ds) return
    const ids = state.selectedIds
    // Nothing selected → frame the whole survey exactly like the Default Survey View.
    if (ids.length === 0) {
      pc.resetView()
      return
    }
    const aspect = viewportAspect()
    const { heading, tilt } = state.camera
    let box: { min: Vec3; max: Vec3 } | null = null
    if (ids.length === 1) {
      box = objectBounds(ds, ds.objectIds[ids[0]])
    } else {
      const min: Vec3 = [Infinity, Infinity, Infinity]
      const max: Vec3 = [-Infinity, -Infinity, -Infinity]
      for (const id of ids) {
        const p = pointXYZ(ds, id)
        for (let k = 0; k < 3; k += 1) {
          min[k] = Math.min(min[k], p[k])
          max[k] = Math.max(max[k], p[k])
        }
      }
      for (let k = 0; k < 3; k += 1) {
        const pad = Math.max(0.5, (max[k] - min[k]) * 0.15)
        min[k] -= pad
        max[k] += pad
      }
      box = { min, max }
    }
    let target: Vec3
    let distance: number
    if (box) {
      // Flip mirrors the displayed model: mirror the box corners the same way.
      const a = displayXYZ(ds, box.min, state.flip)
      const b = displayXYZ(ds, box.max, state.flip)
      const min: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])]
      const max: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]
      const framed = frameBounds(min, max, aspect, heading, tilt, 0.8, 0.8)
      const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
      target = framed.target
      distance = inspectionDistance(radius, framed.distance)
    } else {
      target = displayXYZ(ds, pointXYZ(ds, ids[0]), state.flip)
      distance = inspectionDistance(0, Infinity)
    }
    pushCamera({ ...state.camera, target, distance }, true)
    pc.commit()
  },
  /** Default Survey View — camera only, no data or selection changes. */
  resetView() {
    const ds = state.dataset
    if (!ds) return
    const defaultCamera = defaultCameraFor(ds)
    set({ defaultCamera })
    pushCamera(defaultCamera, true, { viewMode: '3d' })
    pc.commit()
  },
  /** Toolbar − / +: real camera distance, limited only by the model's size (`zoomLimits`). */
  zoomBy(factor: number) {
    pushCamera({ ...state.camera, distance: state.camera.distance / factor }, true)
    pc.commit()
  },
  setViewMode(mode: ViewMode) {
    if (mode === state.viewMode) return
    if (mode === '2d') {
      lastTilt3d = state.camera.tilt
      pushCamera({ ...state.camera, tilt: TILT_2D }, true, { viewMode: '2d' })
    } else {
      pushCamera({ ...state.camera, tilt: lastTilt3d }, true, { viewMode: '3d' })
    }
    pc.commit()
  },

  /** Mirror the displayed model along one axis (toggles). */
  toggleFlip(axis: FlipAxis) {
    set({ flip: { ...state.flip, [axis]: !state.flip[axis] } })
    pc.commit()
  },

  /* ---- chrome ---- */
  toggleRotations() {
    set({ rotationsOpen: !state.rotationsOpen })
  },
  setFullscreen(fullscreen: boolean) {
    set({ fullscreen })
  },
  flashLayers() {
    set({ layersFlash: state.layersFlash + 1 })
  },

  /* ---- crop (visualization only — the dataset is never modified) ---- */
  /** Toolbar Crop button: show / hide the crop controls and crop box. The crop itself stays applied. */
  toggleCropMode() {
    set({ cropOpen: !state.cropOpen })
  },
  /** Slider drag / typed value for one axis (world-local metres). Call `commitCrop()` on release. */
  setCropAxis(axis: CropAxis, range: { min?: number; max?: number }) {
    const ds = state.dataset
    if (!ds) return
    const lo = ds.bounds.min[axis]
    const hi = ds.bounds.max[axis]
    let min = clamp(range.min ?? state.crop.min[axis], lo, hi)
    let max = clamp(range.max ?? state.crop.max[axis], lo, hi)
    if (min > max) {
      if (range.min !== undefined) max = min
      else min = max
    }
    const nextMin: Vec3 = [...state.crop.min]
    const nextMax: Vec3 = [...state.crop.max]
    nextMin[axis] = min
    nextMax[axis] = max
    set({ crop: { ...state.crop, min: nextMin, max: nextMax } })
  },
  setCropEnabled(enabled: boolean) {
    set({ crop: { ...state.crop, enabled } })
    pc.commitCrop()
  },
  /** Back to the model's full bounding box (camera unchanged). */
  resetCrop() {
    set({ crop: { ...fullCrop(state.dataset), enabled: state.crop.enabled } })
    pc.commitCrop()
  },
  /**
   * Crop edit finished: selected points now outside the visible region are
   * deselected, so measurements only ever use visible points (the points
   * themselves stay in the dataset and reappear when the crop is widened).
   */
  commitCrop() {
    const ds = state.dataset
    if (!ds) return
    const kept = state.selectedIds.filter((id) => insideCrop(state.crop, pointXYZ(ds, id)))
    if (kept.length === state.selectedIds.length) return
    set({ selectedIds: kept, activeId: state.activeId !== null && kept.includes(state.activeId) ? state.activeId : (kept[kept.length - 1] ?? null) })
    pc.commit()
  },

  /* ---- history ---- */
  /** Record the current view/selection as an undo step (no-op if nothing changed). */
  commit() {
    const snap = snapshotOf(state)
    if (present && JSON.stringify(present) === JSON.stringify(snap)) return
    if (present) past.push(present)
    if (past.length > HISTORY_LIMIT) past.shift()
    present = snap
    future = []
    syncHistoryFlags()
  },
  undo() {
    const previous = past.pop()
    if (!previous) return
    if (present) future.push(present)
    present = previous
    set({ ...withinCrop(previous), cameraRev: state.cameraRev + 1, cameraAnimate: true })
    syncHistoryFlags()
  },
  redo() {
    const next = future.pop()
    if (!next) return
    if (present) past.push(present)
    present = next
    set({ ...withinCrop(next), cameraRev: state.cameraRev + 1, cameraAnimate: true })
    syncHistoryFlags()
  },
}


// Debug handle for the browser console / automated tests (read-only use recommended).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __pointCloud: unknown }).__pointCloud = { pc, getState }
}
