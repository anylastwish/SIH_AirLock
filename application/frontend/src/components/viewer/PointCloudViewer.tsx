import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  SEMANTIC_CLASSES,
  selectionColor,
  type PointCloudDataset,
  type Vec3,
} from '../../lib/pointCloud'
import {
  CAMERA_FOV,
  dist3,
  fmtMetres,
  hash01,
  pointXYZ,
  polygonOrder,
} from '../../lib/pointCloudMath'
import {
  getState,
  pc,
  subscribe,
  usePC,
  type CameraState,
  type PointCloudState,
} from '../../lib/pointCloudStore'

/**
 * WebGL layer of the Point Cloud View.
 *
 * The whole cloud is ONE `THREE.Points` draw call. Layers, density, elevation /
 * class / confidence filters and the colour mode are evaluated per point in the
 * vertex shader from a handful of uniforms, so no UI interaction ever rebuilds
 * or re-uploads point data. The store is subscribed to directly (not through
 * React) so slider drags cost one uniform write + one frame.
 *
 * Coordinates: data is Z-up local metres; the scene group is rotated so three.js
 * (Y-up) shows it correctly. `toThree` / `fromThree` convert camera vectors.
 * Everything drawn from data sits in a child `model` group whose negative scale
 * applies the toolbar Flip (mirror about the survey centre) without touching data.
 */

/* ------------------------------ shaders ------------------------------ */

const VERTEX = /* glsl */ `
attribute vec4 aColor;   // rgb = original colour, a = reconstruction confidence
attribute vec4 aMeta;    // x = semantic class index
uniform float uSize;
uniform int uMode;       // 0 rgb, 1 semantic, 2 elevation, 3 confidence
uniform float uDensity;
uniform float uPointsOn;
uniform vec2 uZFilter;
uniform vec2 uZDomain;
uniform vec2 uConfFilter;
uniform int uClassMask;
uniform vec3 uClassColors[6];
varying vec3 vColor;

// Only compiled in when the dataset actually carries per-point normals (see
// PointCloudDataset.normals — currently PLY nx/ny/nz; GLB point clouds in
// this app have none). Absent, this whole block — and the material's
// USE_NORMAL_SHADING define — doesn't exist, so GLB rendering is unaffected.
#ifdef USE_NORMAL_SHADING
attribute vec3 aNormal;
uniform vec3 uLightDir;
#endif

// Keep identical to hash01() in lib/pointCloudMath.ts (used for picking).
float hash01(uint id) {
  uint h = id;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return float(h >> 8u) / 16777216.0;
}

vec3 turbo(float x) {
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(
    dot(v4, vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
    dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
    dot(v4, vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973))
  );
}

// dark purple (low) -> orange -> pale yellow (high)
vec3 confidenceRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.10, 0.03, 0.28);
  vec3 b = vec3(0.58, 0.15, 0.40);
  vec3 c = vec3(0.95, 0.52, 0.16);
  vec3 d = vec3(0.99, 0.96, 0.66);
  if (t < 0.34) return mix(a, b, t / 0.34);
  if (t < 0.67) return mix(b, c, (t - 0.34) / 0.33);
  return mix(c, d, (t - 0.67) / 0.33);
}

void main() {
  int cls = int(aMeta.x + 0.5);
  float z = position.z;
  bool visible = uPointsOn > 0.5
    && hash01(uint(gl_VertexID)) < uDensity
    && z >= uZFilter.x && z <= uZFilter.y
    && aColor.a >= uConfFilter.x && aColor.a <= uConfFilter.y
    && ((uClassMask >> cls) & 1) == 1;
  if (!visible) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  vec3 c = aColor.rgb;
  if (uMode == 1) c = uClassColors[cls];
  else if (uMode == 2) c = turbo((z - uZDomain.x) / max(uZDomain.y - uZDomain.x, 1e-6));
  else if (uMode == 3) c = confidenceRamp(aColor.a);
#ifdef USE_NORMAL_SHADING
  // Simple fixed-direction headlight shading — a shading cue when the source
  // (e.g. PLY) actually carries normals; guard against a zero/degenerate normal.
  float nlen = length(aNormal);
  vec3 nn = nlen > 1e-4 ? aNormal / nlen : vec3(0.0, 0.0, 1.0);
  float ndotl = max(dot(nn, uLightDir), 0.0);
  vColor = c * (0.55 + 0.45 * ndotl);
#else
  vColor = c;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`

const FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`

/** Selected-point marker: tinted centre, white ring, dark outer edge. */
const MARK_VERTEX = /* glsl */ `
attribute vec3 aTint;
uniform float uSize;
varying vec3 vTint;
void main() {
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`
const MARK_FRAGMENT = /* glsl */ `
varying vec3 vTint;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  vec3 col = vTint;
  if (d > 0.62) col = vec3(1.0);
  if (d > 0.88) col = vec3(0.02);
  gl_FragColor = vec4(col, 1.0);
}
`

/* ------------------------------ helpers ------------------------------ */

const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const toThree = (v: Vec3) => new THREE.Vector3(v[0], v[2], -v[1])
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
]
const MODE_INDEX = { rgb: 0, semantic: 1, elevation: 2, confidence: 3 } as const
const FOV_2D = 6
const MAX_SELECTED = 512
const MARKER_SIZE = 15

const classMask = (s: PointCloudState) =>
  SEMANTIC_CLASSES.reduce(
    (mask, c, i) => (s.classes[c.id] && (c.id !== 'terrain' || s.layers.terrain) ? mask | (1 << i) : mask),
    0,
  )

function shortestAngle(from: number, to: number) {
  return from + ((((to - from) % 360) + 540) % 360) - 180
}

/* ------------------------------ viewer ------------------------------ */

function createViewer(container: HTMLElement, ds: PointCloudDataset): () => void {
  const initial = getState()
  const pixelRatio = Math.min(window.devicePixelRatio, 2)

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setClearColor(0x000000, 1)
  container.appendChild(renderer.domElement)
  const canvas = renderer.domElement

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 5000)
  const world = new THREE.Group()
  world.rotation.x = -Math.PI / 2 // local Z-up → three.js Y-up
  scene.add(world)
  const model = new THREE.Group()
  world.add(model)

  /* ---- point cloud (single draw call) ---- */
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(ds.positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(ds.colors, 4, true))
  geometry.setAttribute('aMeta', new THREE.BufferAttribute(ds.meta, 4, false))
  // Present only for formats that actually carry normals (PLY today); the shader
  // branch that reads it is compiled out entirely via `defines` when absent, so
  // GLB (ds.normals === null) renders through the exact same code path as before.
  const hasNormals = ds.normals !== null
  if (hasNormals) geometry.setAttribute('aNormal', new THREE.BufferAttribute(ds.normals!, 3))
  const uniforms = {
    uSize: { value: 3 },
    uMode: { value: 0 },
    uDensity: { value: 1 },
    uPointsOn: { value: 1 },
    uZFilter: { value: new THREE.Vector2(ds.zRange[0], ds.zRange[1]) },
    uZDomain: { value: new THREE.Vector2(ds.zRange[0], ds.zRange[1]) },
    uConfFilter: { value: new THREE.Vector2(0, 1) },
    uClassMask: { value: 63 },
    uClassColors: { value: SEMANTIC_CLASSES.map((c) => new THREE.Vector3(...hexToRgb(c.color))) },
    uLightDir: { value: new THREE.Vector3(0.35, 0.55, 0.75).normalize() },
  }
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    defines: hasNormals ? { USE_NORMAL_SHADING: 1 } : undefined,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  model.add(points)

  /* ---- helper geometry: survey boundary + prototype flight path ---- */
  const fb = ds.focusBounds
  const padX = (fb.max[0] - fb.min[0]) * 0.03
  const padY = (fb.max[1] - fb.min[1]) * 0.03
  const [x0, x1, y0, y1] = [fb.min[0] - padX, fb.max[0] + padX, fb.min[1] - padY, fb.max[1] + padY]
  const ground = fb.min[2]
  const boundary = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => new THREE.Vector3(x, y, ground)),
    ),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  )
  const flightAltitude = fb.max[2] + 4
  const passes = 6
  const flightVertices: THREE.Vector3[] = []
  for (let i = 0; i < passes; i += 1) {
    const x = x0 + ((i + 0.5) / passes) * (x1 - x0)
    const [ya, yb] = i % 2 === 0 ? [y0, y1] : [y1, y0]
    flightVertices.push(new THREE.Vector3(x, ya, flightAltitude), new THREE.Vector3(x, yb, flightAltitude))
  }
  const flightPath = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(flightVertices),
    new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, dashSize: 3, gapSize: 2.5 }),
  )
  flightPath.computeLineDistances()
  model.add(boundary, flightPath)

  /* ---- selection markers + measurement overlay (drawn on top) ---- */
  const markPositions = new Float32Array(MAX_SELECTED * 3)
  const markTints = new Float32Array(MAX_SELECTED * 3)
  const markGeometry = new THREE.BufferGeometry()
  markGeometry.setAttribute('position', new THREE.BufferAttribute(markPositions, 3))
  markGeometry.setAttribute('aTint', new THREE.BufferAttribute(markTints, 3))
  markGeometry.setDrawRange(0, 0)
  const markMaterial = new THREE.ShaderMaterial({
    vertexShader: MARK_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    uniforms: { uSize: { value: MARKER_SIZE * pixelRatio } },
    depthTest: false,
    depthWrite: false,
  })
  const markers = new THREE.Points(markGeometry, markMaterial)
  markers.frustumCulled = false
  markers.renderOrder = 12

  const lineBuffer = new Float32Array(3 * 2 * 8)
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(lineBuffer, 3))
  lineGeometry.setDrawRange(0, 0)
  const lines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }),
  )
  lines.frustumCulled = false
  lines.renderOrder = 10

  const fillBuffer = new Float32Array(3 * 3 * 6)
  const fillGeometry = new THREE.BufferGeometry()
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(fillBuffer, 3))
  fillGeometry.setDrawRange(0, 0)
  const fill = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.14,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  fill.frustumCulled = false
  fill.renderOrder = 9
  model.add(fill, lines, markers)

  /* ---- distance labels (DOM, positioned each frame) ---- */
  const labelLayer = document.createElement('div')
  labelLayer.className = 'pointer-events-none absolute inset-0 overflow-hidden'
  container.appendChild(labelLayer)
  let labels: { position: THREE.Vector3; element: HTMLDivElement }[] = []
  const setLabels = (entries: { at: Vec3; text: string }[]) => {
    labels.forEach((l) => l.element.remove())
    world.updateMatrixWorld(true)
    labels = entries.map(({ at, text }) => {
      const element = document.createElement('div')
      element.className =
        'absolute left-0 top-0 whitespace-nowrap rounded-[4px] border border-hud-border bg-black/60 px-[5px] py-[1px] font-jersey10 text-[12px] leading-[13px] text-white backdrop-blur-[4px]'
      element.textContent = text
      labelLayer.appendChild(element)
      return { position: model.localToWorld(new THREE.Vector3(...at)), element }
    })
  }
  const projected = new THREE.Vector3()
  const placeLabels = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    for (const { position, element } of labels) {
      projected.copy(position).project(camera)
      const visible = projected.z > -1 && projected.z < 1
      element.style.display = visible ? 'block' : 'none'
      element.style.transform = `translate(${(projected.x * 0.5 + 0.5) * w}px, ${(-projected.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`
    }
  }

  /* ---- camera <-> store ---- */
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.screenSpacePanning = true
  controls.maxPolarAngle = Math.PI / 2

  const focusRadius = Math.hypot(...([0, 1, 2].map((k) => fb.max[k] - fb.min[k]) as Vec3)) / 2 || 1
  const clampMin = new THREE.Vector3(fb.min[0] - focusRadius * 0.3, fb.min[2] - focusRadius * 0.3, -(fb.max[1] + focusRadius * 0.3))
  const clampMax = new THREE.Vector3(fb.max[0] + focusRadius * 0.3, fb.max[2] + focusRadius * 0.6, -(fb.min[1] - focusRadius * 0.3))

  let needsRender = true
  let applying = false
  let syncPending = false
  let tween: { from: CameraState; to: CameraState; fromFov: number; toFov: number; start: number; duration: number } | null = null
  let currentFov = initial.viewMode === '2d' ? FOV_2D : CAMERA_FOV

  const fovScale = (fov: number) => Math.tan(rad(CAMERA_FOV / 2)) / Math.tan(rad(fov / 2))

  const applyPose = (cam: CameraState, fov: number) => {
    applying = true
    // Discard pending damping momentum from a previous mouse drag: with damping off,
    // update() consumes it against the old pose, which we overwrite right below.
    controls.enableDamping = false
    controls.update()
    if (Math.abs(camera.fov - fov) > 1e-6) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    currentFov = fov
    const scale = fovScale(fov)
    const dist = cam.distance * scale
    const h = rad(cam.heading)
    const t = rad(Math.min(cam.tilt, 89.99))
    const target = toThree(cam.target)
    const ox = -Math.sin(h) * Math.cos(t) * dist
    const oy = -Math.cos(h) * Math.cos(t) * dist
    const oz = Math.sin(t) * dist
    camera.position.set(target.x + ox, target.y + oz, target.z - oy)
    controls.target.copy(target)
    const base = getState().defaultCamera?.distance ?? cam.distance
    controls.minDistance = base * 0.02 * scale
    controls.maxDistance = base * 6 * scale
    camera.near = Math.max(0.05, (cam.distance * scale) / 400)
    camera.far = cam.distance * scale + focusRadius * 6
    camera.updateProjectionMatrix()
    controls.update()
    controls.enableDamping = true
    applying = false
    needsRender = true
  }

  const readPose = (): CameraState => {
    const t = controls.target
    const offset = camera.position.clone().sub(t)
    const localX = offset.x
    const localY = -offset.z
    const localZ = offset.y
    const length = offset.length() || 1
    return {
      target: [t.x, -t.z, t.y],
      distance: length / fovScale(camera.fov),
      heading: (deg(Math.atan2(-localX, -localY)) + 360) % 360,
      tilt: deg(Math.asin(Math.max(-1, Math.min(1, localZ / length)))),
    }
  }

  const flushSync = () => {
    if (!syncPending) return
    syncPending = false
    pc.syncCamera(readPose())
  }

  const startTween = (to: CameraState, toFov: number) => {
    tween = { from: readPose(), to, fromFov: currentFov, toFov, start: performance.now(), duration: 450 }
  }

  controls.addEventListener('start', () => {
    tween = null
  })
  controls.addEventListener('change', () => {
    needsRender = true
    if (applying) return
    // Keep the view target inside the survey so the model can't be lost.
    const target = controls.target
    const clamped = target.clone().clamp(clampMin, clampMax)
    if (!clamped.equals(target)) {
      const delta = clamped.sub(target)
      applying = true
      target.add(delta)
      camera.position.add(delta)
      applying = false
    }
    syncPending = true
  })
  controls.addEventListener('end', () => {
    flushSync()
    pc.commit()
  })

  const configureControls = (s: PointCloudState) => {
    controls.enabled = !s.navLocked
    controls.mouseButtons =
      s.tool === 'pan'
        ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
        : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    // 2D presentation is top-down only: lock the polar angle, heading stays free.
    controls.minPolarAngle = 1e-4
    controls.maxPolarAngle = s.viewMode === '2d' ? 1e-4 : Math.PI / 2
    canvas.style.cursor = s.navLocked ? 'default' : s.tool === 'pan' ? 'grab' : 'crosshair'
  }

  /* ---- flip (mirror about the focus-bounds centre, data space) ---- */
  const applyFlip = (s: PointCloudState) => {
    model.scale.set(s.flip.horizontal ? -1 : 1, 1, s.flip.vertical ? -1 : 1)
    model.position.set(s.flip.horizontal ? fb.min[0] + fb.max[0] : 0, 0, s.flip.vertical ? fb.min[2] + fb.max[2] : 0)
  }

  /* ---- store → GPU / overlays ---- */
  const syncUniforms = (s: PointCloudState) => {
    uniforms.uSize.value = s.pointSize * pixelRatio
    uniforms.uMode.value = MODE_INDEX[s.renderMode]
    uniforms.uDensity.value = s.density
    uniforms.uPointsOn.value = s.layers.points ? 1 : 0
    uniforms.uZFilter.value.set(s.elevation.min, s.elevation.max)
    uniforms.uConfFilter.value.set(s.confidence.min, s.confidence.max)
    uniforms.uClassMask.value = classMask(s)
    boundary.visible = s.layers.surveyBoundary
    flightPath.visible = s.layers.flightPath
  }

  const updateOverlay = (s: PointCloudState) => {
    const ids = s.selectedIds.slice(0, MAX_SELECTED)
    const pts = ids.map((id) => pointXYZ(ds, id))
    ids.forEach((_, i) => {
      markPositions.set(pts[i], i * 3)
      markTints.set(hexToRgb(selectionColor(i)), i * 3)
    })
    markGeometry.setDrawRange(0, ids.length)
    markGeometry.attributes.position.needsUpdate = true
    markGeometry.attributes.aTint.needsUpdate = true

    // Measurement outline: 2 points → line, 3 → triangle, 4 → polygon; 5+ → highlights only.
    let ring: Vec3[] = []
    if (pts.length === 2) ring = pts
    else if (pts.length === 3) ring = pts
    else if (pts.length === 4) ring = polygonOrder(pts).map((i) => pts[i])
    const closed = ring.length >= 3
    const segments = closed ? ring.length : Math.max(0, ring.length - 1)
    for (let i = 0; i < segments; i += 1) {
      lineBuffer.set(ring[i], i * 6)
      lineBuffer.set(ring[(i + 1) % ring.length], i * 6 + 3)
    }
    lineGeometry.setDrawRange(0, segments * 2)
    lineGeometry.attributes.position.needsUpdate = true

    let triangles = 0
    if (closed) {
      for (let i = 1; i < ring.length - 1; i += 1) {
        fillBuffer.set(ring[0], triangles * 9)
        fillBuffer.set(ring[i], triangles * 9 + 3)
        fillBuffer.set(ring[i + 1], triangles * 9 + 6)
        triangles += 1
      }
    }
    fillGeometry.setDrawRange(0, triangles * 3)
    fillGeometry.attributes.position.needsUpdate = true

    setLabels(
      Array.from({ length: segments }, (_, i) => {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        return {
          at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as Vec3,
          text: fmtMetres(dist3(a, b)),
        }
      }),
    )
  }

  /* ---- picking (CPU, screen-space nearest visible point) ---- */
  const pick = (clientX: number, clientY: number): number | null => {
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const W = rect.width
    const H = rect.height
    camera.updateMatrixWorld()
    world.updateMatrixWorld(true)
    const e = new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(model.matrixWorld).elements
    const s = getState()
    const tolerance = Math.max(7, s.pointSize * 2 + 4)
    const tol2 = tolerance * tolerance
    const mask = classMask(s)
    const { min: zMin, max: zMax } = s.elevation
    const cMin = s.confidence.min * 255 - 1e-6
    const cMax = s.confidence.max * 255 + 1e-6
    const density = s.density
    const pos = ds.positions
    const meta = ds.meta
    const col = ds.colors
    const candidates: number[] = []
    if (!s.layers.points) return null
    for (let i = 0; i < ds.count; i += 1) {
      const z = pos[i * 3 + 2]
      if (z < zMin || z > zMax) continue
      if (((mask >> meta[i * 4]) & 1) === 0) continue
      const conf = col[i * 4 + 3]
      if (conf < cMin || conf > cMax) continue
      const x = pos[i * 3]
      const y = pos[i * 3 + 1]
      const w = e[3] * x + e[7] * y + e[11] * z + e[15]
      if (w <= 0) continue
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W - px
      if (sx > tolerance || sx < -tolerance) continue
      const sy = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5) * H - py
      const d2 = sx * sx + sy * sy
      if (d2 > tol2) continue
      if (density < 1 && hash01(i) >= density) continue
      candidates.push(i, d2, w)
    }
    if (!candidates.length) return null
    let nearestDepth = Infinity
    for (let k = 2; k < candidates.length; k += 3) nearestDepth = Math.min(nearestDepth, candidates[k])
    const depthWindow = nearestDepth * 1.02 + 1e-3
    let best = -1
    let bestD2 = Infinity
    for (let k = 0; k < candidates.length; k += 3) {
      if (candidates[k + 2] <= depthWindow && candidates[k + 1] < bestD2) {
        bestD2 = candidates[k + 1]
        best = candidates[k]
      }
    }
    return best < 0 ? null : best
  }

  let down: { x: number; y: number; t: number; button: number } | null = null
  const onPointerDown = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY, t: performance.now(), button: event.button }
  }
  const onPointerUp = (event: PointerEvent) => {
    const start = down
    down = null
    if (!start || start.button !== 0 || event.button !== 0) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > 5 || performance.now() - start.t > 700) return
    if (getState().tool !== 'select') return
    pc.pickPoint(pick(event.clientX, event.clientY), event.ctrlKey || event.shiftKey || event.metaKey)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)

  /* ---- store subscription ---- */
  let prev = initial
  syncUniforms(initial)
  applyFlip(initial)
  configureControls(initial)
  applyPose(initial.camera, initial.viewMode === '2d' ? FOV_2D : CAMERA_FOV)
  updateOverlay(initial)

  const unsubscribe = subscribe(() => {
    const s = getState()
    if (
      s.layers !== prev.layers ||
      s.renderMode !== prev.renderMode ||
      s.density !== prev.density ||
      s.pointSize !== prev.pointSize ||
      s.elevation !== prev.elevation ||
      s.confidence !== prev.confidence ||
      s.classes !== prev.classes
    ) {
      syncUniforms(s)
      needsRender = true
    }
    if (s.flip !== prev.flip) applyFlip(s)
    if (s.selectedIds !== prev.selectedIds || s.flip !== prev.flip) {
      updateOverlay(s)
      needsRender = true
    }
    if (s.tool !== prev.tool || s.navLocked !== prev.navLocked || s.viewMode !== prev.viewMode) configureControls(s)
    if (s.cameraRev !== prev.cameraRev) {
      const fov = s.viewMode === '2d' ? FOV_2D : CAMERA_FOV
      if (s.cameraAnimate) startTween(s.camera, fov)
      else {
        tween = null
        applyPose(s.camera, fov)
      }
    }
    prev = s
  })

  /* ---- loop (render on demand) ---- */
  let frameId = 0
  const animate = () => {
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.start) / tween.duration)
      const eased = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      const { from, to } = tween
      const lerp = (a: number, b: number) => a + (b - a) * eased
      applyPose(
        {
          target: [lerp(from.target[0], to.target[0]), lerp(from.target[1], to.target[1]), lerp(from.target[2], to.target[2])],
          distance: Math.exp(lerp(Math.log(from.distance), Math.log(to.distance))),
          heading: lerp(from.heading, shortestAngle(from.heading, to.heading)),
          tilt: lerp(from.tilt, to.tilt),
        },
        lerp(tween.fromFov, tween.toFov),
      )
      if (k >= 1) tween = null
    }
    if (controls.update()) needsRender = true
    if (syncPending && !tween) flushSync()
    if (needsRender) {
      needsRender = false
      renderer.render(scene, camera)
      placeLabels()
      const debug = (window as unknown as { __pointCloud?: { frames?: number } }).__pointCloud
      if (debug) debug.frames = (debug.frames ?? 0) + 1
    }
    frameId = requestAnimationFrame(animate)
  }
  animate()

  const resizeObserver = new ResizeObserver(() => {
    camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1)
    camera.updateProjectionMatrix()
    renderer.setSize(container.clientWidth, container.clientHeight)
    needsRender = true
  })
  resizeObserver.observe(container)

  return () => {
    cancelAnimationFrame(frameId)
    unsubscribe()
    resizeObserver.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointerup', onPointerUp)
    controls.dispose()
    geometry.dispose()
    material.dispose()
    markGeometry.dispose()
    markMaterial.dispose()
    lineGeometry.dispose()
    fillGeometry.dispose()
    boundary.geometry.dispose()
    flightPath.geometry.dispose()
    renderer.dispose()
    canvas.remove()
    labelLayer.remove()
  }
}

/** Full-screen renderer host. Renders nothing (black) until a dataset is available. */
export default function PointCloudViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const dataset = usePC((s) => s.dataset)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !dataset) return
    return createViewer(container, dataset)
  }, [dataset])

  return <div ref={containerRef} className="absolute inset-0 z-0" />
}
