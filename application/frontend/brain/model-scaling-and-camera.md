# Model scaling, auto-positioning, camera clipping & zoom

Status: **done** (Sep 2026). Solves four viewer problems without changing the dark HUD design:

1. accurate real-world scale for measurements,
2. automatic model positioning / orientation (incl. inverted or tilted ML reconstructions),
3. dynamic camera clipping (model no longer disappears when zooming out),
4. real-distance zoom range (the fixed "5000 %" limit is gone), Focus / Tilt 0–180° / Heading.

The user uploads **only the model**. `transform.json` / `metadata.json` are never required; a companion
`<model>.metadata.json` from the ML pipeline is used automatically when the app can see it.

```
upload model ─► loader collects geometry + metadata candidates (embedded · companion · format)
             ─► resolveModelState(): pick each value by priority, estimate only what's missing
             ─► ModelState { unitsToMeters, rotation, linear, displayOffset, ground, terrain, … }
             ─► analysis in world-local metres (bounds, terrain/DTM, confidence, classes)
             ─► viewer: model transform at scene level · clipping from bounding sphere · zoom from size
             ─► measurements in normalised world coordinates
```

## Files

| File | Role |
|---|---|
| `lib/modelMetadata.ts` **(new)** | `ModelState` type (the internal debug/ML model state), metadata parsing (`parseMetadataObject`, `metadataFromComments`), companion lookup (`loadCompanionMetadata`), priority resolver (`resolveModelState`), ASPRS class map, `scaleStatus()` |
| `lib/modelAlignment.ts` **(new)** | pure geometry: 3×3 rotations (Rodrigues, quaternion, Euler, up-axis), symmetric eigen-solver / PCA, `estimateGround()` (robust ground plane, inversion vote) |
| `lib/pointCloud.ts` | dataset now keeps **original coordinates** + `model: ModelState`; `worldXYZ`, `sourceXYZ`, `toReal`, `terrainAt`; loaders collect metadata; **new OBJ(+MTL+textures) loader**; texture colour sampling for meshes; PLY header/classification parsing; terrain grid from ground classes / supplied DTM / estimate |
| `lib/pointCloudMath.ts` | measurements in world-local metres + real-world display values; height above terrain; polygon volume (only with a real base surface); tilt as polar angle; `zoomLimits`, `inspectionDistance`, `objectBounds`, `fmtDistance` |
| `lib/pointCloudStore.ts` | tilt 0–180 (polar), zoom clamped by model size, new Focus rules, camera validation (`isValidCamera`) |
| `components/viewer/PointCloudViewer.tsx` | points inside an `aligned` group (matrix = model transform); dynamic near/far; polar range 0–180°; picking through the full matrix chain; NaN-safe camera |
| `components/pointcloud/TiltHeadingControl.tsx` | Tilt slider 0–180 |
| `components/pointcloud/BottomToolbar.tsx` | zoom chip shows real camera distance (e.g. `234m`, `5.7km`) instead of `%` |
| `components/pointcloud/StatusBars.tsx` | `Scale: Metadata / Format / Unknown` (tooltip = full model state summary); real-world position/elevation; altitude from polar tilt |
| `components/pointcloud/RightPanel.tsx` | 1 point: + *Height Above Terrain*; terrain values marked *(estimated)* without a real DTM; polygon volume when a base surface exists |
| `components/pointcloud/LeftPanel.tsx` | elevation filter shows real-world elevations |
| `lib/formats.ts`, `input/VisualizerPanel.tsx`, `viewer/ModelStatusBadge.tsx` | OBJ enabled; optional `.json` companion accepted (chip "Metadata"); badge text |

## Coordinate frames (the core idea)

| Frame | Meaning | Where |
|---|---|---|
| **native** | coordinates exactly as in the file (glTF: after its own node hierarchy) | `sourceXYZ(ds, id)` |
| **stored** | native − `model.sourceOrigin` (Float64 bbox centre) — Float32 keeps full precision even for UTM-size values | `ds.positions` (GPU + CPU) |
| **world-local** | `model.linear · stored` = unit scale · orientation · terrain alignment. Metres, Z up (X east, Y north), origin at the model centre. **Rendering, picking, camera, bounds, terrain, filters and all measurements use this frame** | `worldXYZ(ds, id)` / `pointXYZ` |
| **real-world** | world-local + `model.displayOffset` (Float64) — georeferenced / source coordinate values shown in the UI | `toReal(ds, p)` |

- The original data is **never rewritten**: `positions` are the source coordinates (only re-based on a
  constant), normals stay native. The model transform is applied at **scene level** — the viewer puts the
  points in an `aligned` group whose matrix is `model.linear`; the shader gets world Z via `uZRow`
  (3rd matrix row) for the elevation filter / colouring; the normal-shading light is rotated into the
  native frame (`Rᵀ·L`).
- Transform order (conceptual pipeline): original → unit/scale → orientation (metadata / format axis
  convention) → terrain alignment (geometry correction, about the model centre) → translation / origin
  (`displayOffset`) → world → viewer.
- Distances are translation-invariant, so measurements use world-local; absolute values (point X/Y/Z,
  terrain elevation, centroid, elevation statistics, status bar, elevation filter labels) add `displayOffset`.

## Metadata handling

### Priority (per value — scale, rotation, translation / pivot, geo origin, CRS, terrain, class map)

1. **embedded** in the model file
2. **companion** `<model>.metadata.json` generated by AirLock++
3. **format** convention / format-specific unit or georeferencing info
4. **geometry** estimation (orientation / ground / terrain only — never scale)
5. **default** (scale 1 unit = 1 m *marked Unknown*, source axes, local position)

Each value is taken from the highest level that has it, so partial metadata works naturally (CASE B:
scale from metadata, rotation estimated). Reliable orientation (levels 1–2) is **never** re-estimated;
format convention orientation (level 3) is treated as a *nominal* axis convention that geometry may refine.

### Supported sources

| Format | Embedded (1) | Format convention (3) |
|---|---|---|
| GLB / GLTF | `extras` on the root, `asset`, scene and top-level nodes (keys below, or wrapped in `airlock` / `metadata`); **Sketchfab export node** (`Sketchfab_model`): uniform normalisation scale is undone (→ units) and its −90° X rotation proves the source was Z-up (→ reliable orientation) | glTF 2.0: metres, Y up (scale confidence *medium*, orientation *nominal*) |
| PLY | header `comment` / `obj_info` lines: `units cm`, `unit: mm`, `scale=0.01`, `up z`, `crs EPSG:32633`, `offset x y z`, or `comment airlock {…json…}`; a classification-like vertex property (`classification`, `scalar_Classification`, `class`, `label`, `semantic`…) is read as per-point classes | none (nominal Z up, units unknown) |
| OBJ (+MTL+textures) | only explicit `# units …` / `# up …` comments before the first vertex — OBJ scale is **not** assumed | nominal Y up, units unknown |
| LAS / LAZ, FBX | not loadable yet (no loader existed); `ModelState` / priority system is ready — a LAS loader should add its header scale/offset/CRS as a `format` candidate | — |

### Companion metadata (`<model>.metadata.json`)

Looked up automatically, never required (`loadCompanionMetadata`):
- uploaded files: `<name>.metadata.json`, `<name>.airlock.json`, `<name>.transform.json`, `metadata.json`,
  `transform.json` among the files dropped with the model (`json` is an accepted companion extension);
- served models (backend / pre-made URL): the sibling URL `<model>.metadata.json` is probed; only a
  `content-type: …json` answer counts (SPA hosts return `index.html` for missing files).

Recognised keys (case-insensitive; also nested under `airlock` / `metadata`):

```jsonc
{
  "units": "cm",                 // m cm mm dm km in ft us-ft yd (+ long names)
  "scale": 1,                    // native → metres multiplier (× units factor); number or [sx,sy,sz]
  "upAxis": "z",                 // x y z -x -y -z   (or:)
  "rotation": [0,0,0,1],         // quaternion [x,y,z,w] | Euler deg [x,y,z] (R = Rz·Ry·Rx) | 3×3 row-major | 4×4 col-major
  "transform": [/* 16, column-major */],  // full native → world; decomposed into uniform scale, rotation, translation
  "translation": [x, y, z],      // world metres after scale+rotation
  "origin": [x, y, z],           // native pivot  —or—  { "latitude": …, "longitude": …, "height": … }
  "coordinateSystem": "EPSG:32633",
  "terrainReference": { "groundZ": 312.4, "grid": { "originX", "originY", "cellSize", "cols", "rows", "heights": [] } },
  "boundingBox": { "min": [..], "max": [..] }, "dimensions": [..],
  "semanticClasses": { "2": "terrain", "6": "buildings" }
}
```
`real = R·S·(native − origin) + translation`. A geo `origin` is the WGS84 position of real (0, 0).
Malformed values are dropped individually with a warning (`ModelState.warnings`); a malformed file is
ignored and loading continues with the next level. The viewer never fails because metadata is missing.

## Scale normalisation

- `unitsToMeters` from metadata/format; **unknown** otherwise → 1 model unit is *displayed* as 1 m but
  `scale.source = 'default'`, `confidence = 'none'`, `units = 'unknown'` and the status strip says
  **Scale: Unknown** (tooltip explains). Size is **never** used to guess units (a 100-unit building could
  be 100 m or 100 cm). No known-reference estimation exists yet (hook: add a `geometry` scale candidate
  when a reference object/GPS baseline is available).
- Everything downstream (bounds, terrain, measurements, zoom limits, 10 m inspection distance) is in
  world-local metres, i.e. already scaled. Example: a cm PLY with `comment units cm` measures 50 m, not 5000.

## Automatic positioning / terrain alignment (`estimateGround`)

Runs once at load on a ≤ 60 k point sample (Float64, scaled, nominal orientation):

1. **Ground-classified points** (PLY classification = ASPRS 2/8 or companion class map) → least-squares
   plane; up = the side the non-ground points stand on. Confidence high.
2. Otherwise **PCA**: the smallest-variance axis of a wide survey is the candidate up (accepted if the
   cloud is flat — λ₃/λ₂ < 0.5 — and near the nominal axis, or sideways only when very flat < 0.2).
3. **Which side is up** (inverted ML projections): votes from (a) tail asymmetry — roofs/trees make a long
   sparse upper tail, the ground a sharp floor; (b) band density — the lowest band is dense ground;
   (c) normals, when present (photogrammetry normals face the cameras, i.e. up; weight 2).
4. **Robust ground plane**: 32×32 plan grid; per cell the **5th-percentile** low point (not the absolute
   lowest — noise/outliers below ground are ignored); RANSAC (200 its, threshold 1.5 % of extent, planes
   > 45° rejected) then PCA refinement on inliers.
5. Decision (`resolveModelState`): apply the correction rotation (minimal rotation ground-normal → +Z,
   180° about X for an inverted model) only when the plane fit is supported (inliers ≥ 40 % or ground
   classes) and, for > 60° corrections, the up/down vote agrees and the cloud is flat. Corrections below
   **2°** are not applied (real terrain slope / undulation; the model keeps its exact source coordinates)
   — reported as "already level". Otherwise the default orientation is kept, a warning says so, and the
   user can use the existing Flip control.

Local (non-georeferenced) models keep their own coordinate values: `displayOffset = R₀·S·sourceOrigin`
(estimated corrections turn about the model centre). Metadata-positioned models use
`displayOffset = R·S·(sourceOrigin − pivot) + translation` — georeferenced relationships are preserved,
the camera just targets the useful centre (world-local origin ≈ model centre).

## Terrain elevation

`Point Z` and `Terrain Elevation` are separate values; *Height Above Terrain* = Z − terrain.
DTM sources, best first: ground-classified points (`terrain.source = 'classification'`, reliable) › supplied
grid in companion metadata (`'metadata'`, reliable) › lowest-surface proxy (`'estimated'`, marked
*(estimated)* in Measurements). Grid holes (e.g. under large buildings) are filled from neighbours. Polygon
**volume** is only computed when the terrain is reliable (a real base surface); otherwise "N/A".

## Camera clipping

- `updateClipping()` runs before every rendered frame (and inside every programmatic pose): from the
  camera distance to the model's bounding sphere (full world bounds):
  `far = (d_centre + R)·1.05`; `near = 0.8·(d_centre − R)` when outside the sphere, otherwise
  `min(0.01·d_target, 1 m)`; `near ≥ far·2·10⁻⁵`.
- Root cause of the old bug: near/far were only set by programmatic poses, so mouse-wheel zoom-out pushed
  the model past a stale far plane. Now any camera change re-sizes the frustum.
- Logarithmic depth was evaluated and **not** used: with the adaptive planes the far/near ratio stays
  ≤ 5·10⁴ (fine for a 24-bit depth buffer with points), while log depth would need custom shader chunks
  and disables early-z. Revisit only for multi-km scenes with close inspection *and* far context at once.

## Zoom, Focus, Tilt, Heading

- **Zoom range** (`zoomLimits`, FOV-45 framing distance): min = clamp(0.0005 · focus radius, 2 cm, 1 m);
  max = max(60 · focus radius, 12 · full bounding radius). Applies to wheel (OrbitControls min/maxDistance)
  and the toolbar −/+ (no % cap). Example (demo castle): 4.8 cm … 5.7 km.
- The toolbar chip shows the **real camera distance** (`fmtDistance`: `35cm`, `4.2m`, `234m`, `5.7km`);
  clicking it still resets to the Default Survey View.
- **Focus** (Target button): nothing selected → whole survey (Default Survey View); one point → the
  object it belongs to (its `objectId` extent — the inspector's *Object ID*); 2+ points → their extent.
  Distance = `inspectionDistance(radius, frameDistance)` = `max(1.15·r, min(frameDistance, r + 10 m))`:
  ≈10 m outside the structure when that frames it, the (smaller) framing distance for small objects, and
  never inside the bounding sphere.
- **Tilt 0–180°** = camera polar angle around the target (Google-Earth-Studio convention):
  0° top view, 90° level, 180° looking straight up from below. OrbitControls polar range is now 0–180° so
  mouse orbit and the slider agree. Default 48° (= the approved 42° below the horizon). 2D = tilt 0.
  The camera moves; the model never rotates.
- **Heading 0–360°**: compass direction the camera looks towards; orbits the current target.
- **Camera safety**: `isValidCamera` rejects NaN/Infinity poses in the store (previous pose kept, console
  warning); the renderer restores the last valid pose if a mouse interaction ever produced a non-finite
  camera; distance is clamped to the zoom range.

## Performance

- One extra pass for native bounds (needed for the Float64 re-basing); the orientation analysis uses a
  ≤ 60 k sample; world coordinates are computed on the fly in the analysis loops (no second copy of the
  cloud). All of it runs once at load; camera operations never scan points (clipping uses the cached
  bounding sphere). Demo GLB (6.3 M points): download + parse + analysis measured 7.6 s (Node, warm) and
  12 s (headless Chrome, software GL).
- Focus on an object scans `objectIds` once (Uint32 compare, ~20 ms for 6 M points).
- Texture reads for mesh colours are capped at 2048 px per texture and cached per texture.

## Verification (Sep 2026)

Node harness (esbuild bundle of the real modules, outside the repo) — synthetic 120 k-point drone surveys
with buildings, trees, below-ground outliers, undulating terrain; checks against known values:
PLY metres without metadata (scale Unknown, 50.000 model units, level, source coordinates preserved) ·
PLY cm with `comment units cm` (A–B = 50.000 m) · cm without metadata (stays 5000 units, not invented) ·
8° tilt (corrected 7.7°, vertical error 0.2 m / 50 m) · inverted (detected 179.6°, roofs above terrain) ·
Y-up PLY (90° corrected) · GLB convention (no spurious correction) · GLB extras cm + up z (metadata wins,
real 5° slope not "corrected") · partial metadata (scale companion, orientation estimated) · UTM-size
coordinates (50 m to 0.01 mm, real coordinates to 1 cm) · 5 km and 20 m surveys (zoom limits) · large empty
area (terrain fully filled) · ground-classified PLY (reliable terrain, volume) · malformed metadata.
Integration through `loadPointCloud` over HTTP: demo GLB (Sketchfab node → embedded scale ×71.65 +
orientation; Z 744.8–803.7 m unchanged; SPA `index.html` sibling not mistaken for metadata) · Parque
Copán GLB · binary PLY with `scalar_Classification` · companion `.metadata.json` auto-detected (mm + geo
origin) · malformed embedded + companion JSON ignored with warnings · inverted OBJ+MTL (corrected 179.9°).
Real-data estimator check: Parque Copán without metadata → "already level (1.8°)", inverted copy → 178°
detected. Castle-on-a-hill without metadata → plane support 32 % < 40 % → default orientation kept + warning
(no wrong flip). Headless Chrome on `/app`: default view, 60× wheel zoom-out to 5.7 km (model still
rendered), toolbar zoom to the limit, tilt 150° / heading 200° (view from below), tilt 0, focus on an
object (14 m), wheel zoom-in to the 4.8 cm limit, NaN camera rejected. `tsc -b` and `vite build` clean.

## Limitations

- No geometry-based scale estimation (needs a known reference) — unknown scale stays *Unknown*.
- Terrain alignment assumes a survey-like scene with a dominant ground. Dome/hill-top or single-object
  scans often give weak plane support → default orientation (user can Flip). A genuinely sloped site
  with no metadata and > 2° mean slope will be levelled (metadata or ground classes prevent this).
- 180° inversion is resolved by rotating 180° about X (east axis kept). If the source was flipped about
  another horizontal axis, the corrected model is upright but turned 180° in plan (heading) — geometry
  cannot tell north without metadata; georeferenced data should carry a rotation.
- Geo origin → lat/lon uses the existing flat-earth approximation (`toGeographic`); projected CRS values are
  shown as coordinates, not converted to lat/lon (no proj library).
- `CESIUM_RTC` / ECEF glTF and LAS/LAZ/FBX loaders are not implemented.
- Supplied DTM grids are resampled onto the internal ~96×96 grid.
- Object focus uses the prototype object ids (24×24 plan cells per class), not real instances.
