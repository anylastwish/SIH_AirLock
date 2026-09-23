# PLY format support

Status: **done.** `.ply` (ASCII and binary, little- or big-endian) is a second
first-class input format alongside GLB/GLTF in the Point Cloud View. Uploading
a PLY through the existing Visualizer flow loads and renders it in the same
interactive viewer — same camera, same left/right panels, same filters,
selection and measurements — with **zero changes to GLB behaviour** (verified,
see Testing below). This builds on `brain/point-cloud-view.md`; read that
first for the renderer/store architecture this slots into.

## What changed

| File | Change |
|---|---|
| `lib/pointCloud.ts` | Added `loadFromPLY` (new) and renamed the old `loadPointCloud` body to `loadFromGLTF`; new public `loadPointCloud` dispatches on `model.format`. Added `normals` to `PointCloudDataset` and normal capture to `datasetFromObject3D`. Widened `source.kind` to `'gltf-prototype' \| 'ply-prototype'`. |
| `lib/formats.ts` | `ply` entry: `loader: null` → `loader: 'ply'`. Widened the `loader` union to `'gltf' \| 'ply' \| null`. |
| `components/pointcloud/PointCloudView.tsx` | Load gate changed from `loader === 'gltf'` to `loader !== null`, so any registered loader (not just GLTF) is used. |
| `components/viewer/PointCloudViewer.tsx` | Vertex shader gained an **optional**, `#ifdef`-gated normal-shading branch, compiled in only for datasets that have normals. |
| `components/viewer/ModelStatusBadge.tsx` | "Try a GLB / GLTF model." → "Try a GLB, GLTF or PLY model." (copy only). |
| `INPUT_PAGE.md` | Supported-formats table: PLY moved from "accepted, not rendered" to "renders". |
| `components/input/VisualizerPanel.tsx`, `lib/session.ts` | **Unchanged** — PLY was already in `MODEL_FORMATS`/`VISUALIZER_ACCEPT`/the upload UI from Phase 1; only the loader was missing. |

## Why this design: one shared pipeline, two thin loaders

`lib/pointCloud.ts` already had `datasetFromObject3D(root, name, options)`: it
walks a three.js object graph, copies every `Points`' vertices (with position/
colour, now +normal), area-samples any `Mesh` surfaces, then derives extents,
terrain elevation, confidence and semantic class — entirely from the resulting
`positions`/`colors` arrays, with no knowledge of where they came from.

So PLY support is **two small loader functions**, not a parallel pipeline:

```
loadPointCloud(model, onProgress, onPhase)
├─ format glb/gltf → loadFromGLTF → GLTFLoader → datasetFromObject3D(gltf.scene, …)      (unchanged)
└─ format ply      → loadFromPLY  → PLYLoader  → wrap geometry as Points|Mesh
                                               → datasetFromObject3D(wrapper, …)          (new adapter)
```

`loadFromPLY` parses the file with three.js's own `PLYLoader`
(`three/examples/jsm/loaders/PLYLoader.js`, already a transitive dependency —
no new package), then wraps the resulting `BufferGeometry` in a throwaway
`THREE.Points` (plain vertex list) or `THREE.Mesh` (the PLY has a `face`
element → indexed triangles) and hands it to the **same**
`datasetFromObject3D` GLB already uses. That single change point is why every
existing control — camera, filters, selection, measurements, undo/redo — works
on a PLY dataset with no PLY-specific code anywhere else in the app: the
renderer and every panel only ever see a generic `PointCloudDataset`.

The wrapper's material `.color` is only read by `datasetFromObject3D` as the
fallback tint for points/faces with no colour attribute (white for points,
light grey for mesh faces) — these throwaway materials are never rendered.

## Attribute handling

- **Position**: always present (required); `getAttribute('position').count === 0`
  is treated as a load failure (see Error handling).
- **Colour**: `PLYLoader` normalises `red/green/blue` (or `diffuse_red/…`)
  uchar properties into a `color` attribute as **Float32, already divided by
  255** (verified in `node_modules/three/examples/jsm/loaders/PLYLoader.js`
  and confirmed `Color.setRGB(r,g,b)` there performs no colour-space
  conversion — the values are the literal `channel/255`). The existing
  `colorScale()` helper's Float32 branch (`× 255`) round-trips this back to a
  0–255 byte exactly, the same code path used for GLTF's `COLOR_0` accessor. A
  PLY with no colour property falls back to white (points) — every existing
  colour/render mode (RGB, Semantic, Elevation, Confidence) still works, since
  those don't depend on the source having real colour.
- **Normals**: `PLYLoader` builds a `normal` attribute from `nx/ny/nz`
  properties (Float32, itemSize 3, whatever scale the file used — not
  necessarily unit length). `datasetFromObject3D` now reads it (only in the
  point-copy path, not mesh-sampling — see Limitations), rotates it by the
  3×3 part of the wrapper's world matrix (same Y-up→Z-up axis swap as
  position, translation ignored since it's a direction), and re-normalises.
  Stored as `PointCloudDataset.normals: Float32Array | null` — `null` unless
  *some* point cloud in the graph actually had a `normal` attribute (points
  without one, in a mixed graph, get a zero vector; the shader treats a
  near-zero normal as "up" rather than propagating `NaN`).
- **Other PLY properties** (`uv`, `alpha`, custom scalar fields, …): not
  consumed. `alpha`/`opacity` in particular is not mapped to anything (the
  existing "confidence" channel is a derived proxy, not sourced from the
  file — see `point-cloud-view.md`'s Data layer).
- **ASCII vs binary**: no special-casing needed — `PLYLoader.parse()` branches
  on the header's `format` line (`ascii` / `binary_little_endian` /
  `binary_big_endian`) internally; both were exercised in testing.
- **Point cloud vs mesh PLY**: `loadFromPLY` treats the file as a mesh only if
  the parsed geometry has a non-empty `index` (i.e. the PLY had a `face`
  element with `vertex_indices`), and routes it through the mesh area-sampling
  path (dense pseudo-point-cloud, same as an OBJ/FBX mesh would once those get
  loaders). Otherwise every vertex becomes one point, uncapped up to
  `DEFAULT_MAX_POINTS` (6.5 M) with uniform-stride thinning above that.

## Normal-based shading (visual use of normals)

A point cloud has no faces to light, so "use normals for appropriate
rendering" is implemented as a simple, optional headlight shading term in the
point shader: `finalColor = baseColor × (0.55 + 0.45 × max(dot(normal,
lightDir), 0))`. This is **only compiled into the shader** — via
`ShaderMaterial({ defines: { USE_NORMAL_SHADING: 1 } })` guarding an
`#ifdef` block around both the `aNormal` attribute declaration and its use —
when `dataset.normals !== null`. For a dataset without normals (every GLB
point cloud in this app, and a PLY with no `nx/ny/nz`), the compiled shader
has no `aNormal` reference at all and produces the exact same colour as
before; this is the mechanism that guarantees GLB rendering is unaffected
(confirmed byte-for-byte in testing, not just by inspection).

## Error / loading / unsupported states

Reuses the existing states end-to-end — no new UI:
- **Unsupported**: formats with no loader (OBJ, FBX, LAS) still short-circuit
  in `PointCloudView` via `MODEL_FORMATS[format].loader === null` →
  `pc.markUnsupported(...)`, gated per-format before any file is even parsed.
- **Loading**: `PLYLoader.loadAsync(url, onProgress)` reports byte progress the
  same way `GLTFLoader` does; `ModelStatusBadge` shows it identically.
- **Corrupt / not actually a PLY**: `PLYLoader`'s own `parse()` can throw for
  malformed binary data (out-of-bounds reads) — caught and rethrown as
  *"This PLY file could not be parsed. It may be corrupted or use an
  unsupported PLY variant."* A file that "parses" but yields 0 vertices (bad
  header the regex doesn't match, or a genuinely empty PLY) is caught
  separately as *"This PLY file has no readable point data."* Both surface
  through the same `status.kind === 'error'` path GLB load failures already
  use — black viewport, glass error badge, panels sit in their empty/disabled
  state, nothing crashes.

## Limitations / assumptions (carried into `point-cloud-view.md`'s proxy list)

- **No axis-convention detection.** PLY carries no up-axis metadata (unlike
  glTF, which mandates Y-up — the reason the GLB path swaps axes). PLY
  vertices are read as-is and pushed through the *same* Y-up→Z-up swap as
  GLB. Real-world point-cloud PLYs (COLMAP, RealityCapture, CloudCompare,
  Open3D) are exported with all kinds of conventions, so a PLY may appear
  rotated 90° depending on the source tool. Fix: expose axis convention as an
  upload option, or auto-detect from a bounding-box heuristic.
- **Units assumed metres.** Same assumption the GLB path makes for "generic"
  scenes (only relaxed there via the Sketchfab-specific node it detects);
  `AdapterOptions.unitsToMeters` can override per-load if needed later.
   *(Placeholders like elevation range or the scale bar will simply be wrong
  if a PLY is actually in centimetres/feet/etc. — the data model doesn't
  currently record source units, so nothing downstream can compensate.)*
- **Normals only on the point-copy path.** A mesh-typed PLY (has `face`
  elements) goes through the existing barycentric area-sampling — which
  already doesn't use normals for GLB mesh assets either — so PLY mesh
  normals are parsed but not read. Scoped out to avoid duplicating the
  sampling loop for a secondary case; would slot in the same way if needed.
- **Legacy non-indexed per-face-vertex colours.** A rare PLY variant colours
  each face's 3 expanded vertices instead of shared vertices; three.js's
  `PLYLoader` responds by dropping the index (`toNonIndexed()`), which makes
  `loadFromPLY`'s `index !== null` mesh check miss it. It still renders
  correctly as a dense point cloud of the expanded vertices (every point has
  a valid position + colour) — it just skips triangle-surface sampling. Not
  seen in any modern export tool tested; documented rather than special-cased.
- **No PLY texture/UV sampling** — only per-vertex colour, matching how the
  GLB mesh-fallback path already works (no texture sampling there either).
- **`source.sourcePoints`** for a mesh-typed PLY reports the sampled count
  (e.g. 400 000), not the file's actual vertex count — this mirrors a
  pre-existing GLB mesh-fallback quirk (the field is debug/documentation
  metadata, never shown in the UI), not something new.

## Extending to the next format (LAS, OBJ, FBX, textured GLTF…)

Follow the same shape:
1. Parse the file into three.js buffers (or write a small parser that fills
   `positions`/`colors`/`normals` typed arrays directly).
2. Either wrap the result as a `Points`/`Mesh` and call
   `datasetFromObject3D(wrapper, name, { onPhase, sourceKind: '<name>-prototype' })`,
   or, for a source that doesn't map naturally to a three.js object graph
   (e.g. a LAS point record stream), build a `PointCloudDataset` by hand —
   the shared post-processing (extents/terrain/confidence/semantic) lives in
   `datasetFromObject3D` today but only needs `positions`/`colors`/`n`, so it
   could be factored out further if a second hand-built adapter shows up.
3. Add one `case` to the `loadPointCloud` switch in `lib/pointCloud.ts`.
4. Flip that format's `loader` in `lib/formats.ts` from `null` to something
   truthy (widen the `loader` union type).
5. Nothing else — `PointCloudView`'s load gate, the renderer, both panels, the
   toolbar and the store are already format-agnostic.

## Testing done

Automated with puppeteer-core + headless Chrome, driven through the **real
upload UI** (Landing → Input → Visualizer mode → real `<input type="file">` →
Open Model → `/app`), not by injecting data directly:
- **ASCII PLY**, vertex colours only, no faces/normals (4 000 pts) — loads,
  renders, colours match the file, `hasNormals: false`.
- **Binary (little-endian) PLY**, vertex colours + normals, no faces (6 000
  pts) — loads, renders, `hasNormals: true` with a real (non-zero, ≈unit)
  transformed normal sampled back from the dataset.
- **Binary mesh PLY** (5 verts / 6 indexed triangular faces, per-vertex
  colours) — routes through the mesh path, renders as a dense (400 000-pt)
  coloured point splat of the shape, confirming the `face`-element branch.
- **Corrupt file** (garbage bytes, not a PLY) and **empty PLY** (valid header,
  0 vertices) — both surface a clean `error` status with a readable message,
  black viewport, no console errors, no crash.
- **Interactivity on a loaded PLY**: point picking → Inspector shows real
  X/Y/Z/terrain elevation/semantic class/object id/confidence for the clicked
  point; mouse-orbit camera; Point Size slider (1→6 px); Point Density slider;
  Rendering Mode → Elevation — all confirmed changing store state and the
  screenshot, with zero console errors.
- **GLB regression**: re-loaded the existing pre-made GLB after all of the
  above changes and compared against the pre-PLY baseline — `count`
  (6 316 337), `classCounts` (all six values), `meanConfidence`, `zRange` and
  `source` all **identical**, zero console errors, screenshot pixel-identical
  composition. This is the concrete evidence (not just code review) that GLB
  behaviour is unchanged.
- `tsc -b` and `vite build` both clean; the production bundle grew from
  861 KB → 870 KB minified (PLYLoader.js is the only new module, +1 in the
  build's "modules transformed" count) — no new npm dependency was added.
