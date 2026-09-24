# Point Cloud View — Main Application Page

Status: **Phase 2 done — fully interactive.** The approved visual design
(`context/Point_Cloud_View.png` + `Point Cloud CSS.txt`, built in Phase 1) is
unchanged; every control now drives real state and the WebGL point cloud.
Data currently comes from the pre-made GLB through a *prototype adapter*, but
the renderer/UI only see a generic dataset, so real LAS/PLY/ML output can replace
it without touching the UI.

```
USER ACTION → pointCloudStore (state) → PointCloudViewer (GPU uniforms / overlays)
                                      → panels (Inspector, Measurements, status bars)
```

## Files

```
lib/pointCloud.ts          DATA: PointCloudDataset type, SEMANTIC_CLASSES, getPoint(), GLB adapter
                           (datasetFromObject3D) + loadPointCloud(model)
lib/pointCloudMath.ts      PURE MATH: measurements, polygon order, camera framing, neighbourhood sampling,
                           density hash, number formatting
lib/pointCloudStore.ts     STATE: one external store (useSyncExternalStore, no library), actions `pc.*`,
                           undo/redo history, `usePC(selector)` hook, `window.__pointCloud` debug handle
lib/hudLayout.ts           LAYOUT: responsive HUD geometry (stage scale, panel zoom/widths, toolbar scale,
                           free central area for camera framing) - see "Responsive HUD layout" below
components/viewer/
  PointCloudViewer.tsx     RENDERER: one THREE.Points draw call, shaders, picking, selection/measurement
                           overlays, camera <-> store sync, on-demand render loop
  ModelStatusBadge.tsx     load progress / error badge (reads store)
components/pointcloud/     HUD (unchanged layout): TopBar, LeftPanel, RightPanel, BottomToolbar,
                           TiltHeadingControl (Rotations), CropControl (Crop), StatusBars, PointCloudView (scaled stage), ui.tsx (primitives)
```
`viewer/ModelViewer.tsx` (Phase-1 stand-in) was **deleted**; `PointCloudViewer` replaces it.

## Data layer (`lib/pointCloud.ts`)
**Multi-format support: see `brain/ply-format-support.md` for the PLY adapter, the GLB/PLY code-sharing
design, and how to add the next format (LAS, OBJ, FBX, textured GLTF…) the same way.**
**Scale / units, metadata, automatic orientation + terrain alignment, coordinate frames, camera clipping,
zoom, Focus and Tilt 0–180°: see `brain/model-scaling-and-camera.md` (supersedes the unit / axis / camera
notes below where they differ — marked "→ updated").**
- **`PointCloudDataset`**: structure-of-arrays typed arrays — `positions` (xyz, Float32), `colors`
  (RGBA Uint8: rgb + reconstruction confidence in A), `meta` (Uint8×4: semantic class index, semantic
  confidence), `terrainElevation`, `objectIds`, `normals` (xyz Float32 or `null` — only when the source
  carried normals, e.g. PLY `nx/ny/nz`), plus bounds/`focusBounds` (1–99 % extent), `zRange`,
  `classCounts`, `meanConfidence`, `geoReference | null`, `source` (`{ kind: 'gltf-prototype' |
  'ply-prototype', … }`).
  `colors`/`meta`/`normals` are uploaded to the GPU unchanged; the same arrays serve CPU picking.
- **Conventions** (→ updated): `positions` hold the **original** coordinates (re-based on a Float64
  origin); `dataset.model` (`ModelState`) maps them to **world-local** metres, right-handed, **Z up**
  (X east, Y north) — use `worldXYZ`/`pointXYZ`, never raw `positions`, for geometry; `toReal` for displayed
  values. Point ID = array index (stable; density sampling never renumbers). Z (point elevation) and
  `terrainElevation` (ground under the point) are separate fields, never assumed equal.
- **Shared adapter** — `datasetFromObject3D(root, name, options)` — takes any three.js object graph
  (a GLTF scene, or a single `Points`/`Mesh` wrapping a parsed PLY geometry) and produces a
  `PointCloudDataset`. GLB/GLTF and PLY are two thin *loaders* (`loadFromGLTF`, `loadFromPLY` in the
  same file) that both funnel into this one pipeline — adding PLY changed zero lines of the shared
  extraction/extents/terrain/confidence/semantic logic below:
  - Point primitives are copied (uniform stride, cap `DEFAULT_MAX_POINTS = 6.5 M`; the source has 12.6 M
    so stride = 2 → 6.32 M points). Mesh-only models get 400 k area-weighted deterministic surface samples
    (vertex colour or material colour; textures are **not** sampled).
  - (→ updated) Orientation and units are resolved by priority (embedded › companion › format › geometry ›
    default) — see `model-scaling-and-camera.md`. For the demo GLB the Sketchfab node (`Sketchfab_model`,
    scale 0.01396, −90° X) is embedded metadata: normalisation undone, source Z-up, giving the same source
    coordinates as before (≈ 168 × 193 m footprint, Z 744.8–803.7 m). Mesh samples now take their colour
    from the diffuse texture when there is one (OBJ/MTL, textured glTF).
  - **Derived, placeholder attributes (replace with real data later):**
    `terrainElevation` = smoothed per-cell minimum on a ~96×96 XY grid (DTM stand-in);
    reconstruction confidence = log local point density per voxel (sparse edges/halo ⇒ low);
    semantic class = rule-based on colour + height above terrain (water/vegetation/roads/terrain/buildings/other)
    — unless the source carries per-point classes (PLY classification → ASPRS map), which then win;
    object id = (24×24 XY cell, class) registry → `OBJ_10000+`. These are proxies, **not ML output**.
  - **No georeference**: latitude/longitude show “—”; the bottom-right bar shows local X/Y instead.
    Pass `geoReference` (origin lat/lon) to `datasetFromObject3D` to enable lat/lon everywhere.
- `loadPointCloud(model, onProgress, onPhase)` is the single entry point used by the store; it first looks
  for an optional companion `<model>.metadata.json`, then dispatches on `model.format` (`glb`/`gltf` →
  `loadFromGLTF`, `ply` → `loadFromPLY`, `obj` → `loadFromOBJ`). To add LAS/backend tiles: write
  another loader returning a `PointCloudDataset` (or reusing `datasetFromObject3D`) and add one `case`.

## Renderer (`viewer/PointCloudViewer.tsx`)
- **One `THREE.Points`**; per-point work happens in the vertex shader from uniforms, so changing layers,
  density, size, filters or colour mode never rebuilds or re-uploads point data:
  visible = points-layer ∧ `hash01(gl_VertexID) < density` ∧ **inside crop box** ∧ z ∈ elevation range ∧ confidence ∈ range ∧
  class allowed (bitmask; Terrain class also requires the Terrain layer). Hidden points are moved outside clip space.
- **Density** uses a deterministic integer hash of the point ID (`hash01`, identical in GLSL and in
  `pointCloudMath.ts`) → nested, non-jumping subsets; original data untouched.
- **Colour modes** (`uMode`): RGB (raw stored colour, output as-is), Semantic (class colours from
  `SEMANTIC_CLASSES`), Elevation (continuous turbo ramp over the dataset Z range), Confidence
  (dark purple → orange → pale yellow).
- **Point size** = `uSize` (px × devicePixelRatio, no attenuation). Range 1–6 px, 0.5 steps, default 2 px.
- **Picking** is CPU screen-space: every *visible* point (same rules as the shader, incl. density hash) is
  projected; candidates within a pixel tolerance (`max(7, size*2+4)`) are resolved front-most-first, then
  nearest to cursor. ~6 M points ⇒ tens of ms per click. (An octree would be the scale-up path.)
  Click vs drag is distinguished (<5 px, <700 ms); Ctrl/Shift = additive.
- **Overlays** (drawn on top, depth test off): coloured ring markers per selected point (P1 green, P2 blue,
  P3 purple, then light grey — the design's existing chip colours), white outline + translucent fill for
  2 pts (line), 3 pts (triangle), 4 pts (polygon ordered around the XY centroid), DOM labels with 3D edge
  lengths. 5+ points only get markers (no invented geometry).
- **Helper layers**: *Survey Boundary* = rectangle of the 1–99 % XY extent at ground level (default OFF);
  *Flight Path* = **prototype** dashed lawn-mower path 4 m above the highest surveyed point (default ON,
  faint) — replace with real trajectory data when available.
- **Camera**: OrbitControls for mouse orbit/pan/zoom; the store is the source of truth for programmatic
  changes. Pose = target + framing distance + heading + tilt (see below). Programmatic changes tween
  (450 ms) or apply instantly (slider drags); damping momentum is flushed before every programmatic pose.
  Target is clamped to the survey bounds (+30 %). (→ updated) Polar angle 0–180° (views from below allowed),
  near/far recomputed from the model's bounding sphere every frame, zoom range from the model's size, NaN-safe.
  Points sit in an `aligned` group whose matrix is the model transform (`dataset.model.linear`).
- **2D** = top-down with FOV 6° and the distance scaled to keep the same framing (near-orthographic “dolly
  zoom”); polar angle locked, heading still free. **3D** restores the previous tilt.
- Rendering is **on demand** (only on camera/state change); a frame counter is written to
  `window.__pointCloud.frames` for automated tests.

## State (`lib/pointCloudStore.ts`)
One store holds: dataset + load status, layers, render mode, density, point size, elevation range, class
flags (+ search query), confidence range, selection mode/tool/lock, `selectedIds`/`activeId`, camera
`{target, distance, heading, tilt}`, view mode (2d/3d), `rotationsOpen` / `cropOpen` (floating panels, both
closed by default), `crop`, fullscreen, canUndo/canRedo.
- **Heading** = compass direction the camera looks towards (0 = north); **tilt** (→ updated) = camera polar
  angle 0–180° (0 top view, 90 level, 180 from below; was "0–90° below the horizon"); `distance` = FOV-45°
  framing distance, clamped by `zoomLimits`. The model never rotates.
- **Undo/redo** (max 100; toolbar buttons replaced by Crop in Sep 2026 — now Ctrl/⌘+Z, Ctrl+Y / Ctrl+Shift+Z;
  the history engine and `pc.commit()` calls are unchanged): snapshots of layers, mode, density, size, elevation, classes, confidence,
  selection, camera, view mode. Discrete actions commit immediately; sliders commit **on release**; mouse
  camera moves commit on OrbitControls `end`. Chrome state (tool, lock, panel open, fullscreen) is not undoable.
- **Default Survey View** is computed from the dataset's 1–99 % bounds, fitted into the free central area
  between the side panels, header and toolbar (`hudLayout().fitX / fitY`, ≈ 0.54 × 0.78 at 1440×804),
  heading 0°, tilt 48° (= 42° below the horizon, same view as before). Reset only changes the camera.
- **Flip** (`flip: { horizontal, vertical }`, `pc.toggleFlip(axis)`) mirrors the *displayed* model about the
  focus-bounds centre (horizontal = X / east⇄west, vertical = Z / upside down). It is part of the undo
  snapshot and resets on a new dataset. Data coordinates never change: filters, the inspector and the status
  bar keep true survey values; `displayXYZ()` maps a data point to where it is drawn (used by Focus). The
  renderer applies it as a negative scale on a `model` group inside `world` (picking uses `model.matrixWorld`).

## Controls → behaviour
| Control | Behaviour |
|---|---|
| Layers: Point Cloud / Terrain / Flight Path / Survey Boundary | show/hide points / **Terrain-class points** / dashed path / boundary rectangle. Eye icon and switch both toggle. |
| Rendering Mode | RGB (default) · Semantic · Elevation · Confidence — recolours instantly |
| Point Density | 1–100 % deterministic subset; read-out follows |
| Point Size | 1–6 px |
| Elevation Filter | typed min/max (Enter/blur) or two-knob range slider over the dataset Z range |
| Semantic Filter | checkboxes per class (counts from dataset), search box filters the list |
| Confidence Filter | two-knob range 0–1 (default 0–1 = everything) |
| Selection | Single / Multi dropdown; Clear Selection; count. Single: click replaces / re-click deselects / empty click clears. Multi: click toggles. |
| Inspector | active point (last selected, or click a chip): id, X/Y/Z, lat/lon (— if not georeferenced), terrain elevation, class, object id, confidence; copy buttons; **preview = side view of the real neighbouring points** |
| Selection Summary | count `n / 5+`, scrollable chips P1…Pn (click = make active) |
| Measurements | all in normalised world metres (→ `model-scaling-and-camera.md`). 1 pt: X/Y/Z/terrain elev/**height above terrain** · 2 pts: 3D, horizontal, vertical, slope (°, %) · 3 pts: 3D area, perimeter, horizontal side lengths, plane slope, 3D distances · 4 pts: 3D perimeter, 3D surface (fan triangulation), plan area, **Volume above terrain only with a real base surface (ground classes / supplied DTM), else N/A** · 5+: centroid X/Y/Z, mean terrain elevation. Terrain values are marked *(estimated)* without a real DTM |
| Terrain Statistics | max/min/mean/range of selected point Z |
| Actions | Clear Selection · Restart Selection (clear + select tool) |
| Rotations (Tilt / Heading) | floating panel above the central control panel, **closed by default**; toolbar **Rotations** (blue while open) or the panel's X toggles it. Sliders drive the camera and follow mouse orbits; value shown next to the label. Tilt 0–180° (0 top view · 90 level · 180 from below); Heading 0–360°. Dragging Tilt in 2D switches back to 3D. |
| Toolbar | Select · Pan (drag pans) · Lock (freezes navigation, picking still works) · Focus (selection, or the Default Survey View when empty) · **Flip** (glass menu: Flip horizontal / Flip vertical, each a toggle; button highlighted while any flip is on — replaced the old Single⇄Multi Pointer toggle, which remains in the Left panel Selection dropdown; the Ruler still switches to Multi) · Ruler (new multi-point measurement) · Layers (pulses Layers section) · Path (toggle flight path) · **Crop** (replaced Undo/Redo; the whole group box is the button, blue while the Crop panel is open — see "Crop" below) · centre box = current mode read-out · Rotations · − / **camera distance, e.g. `234m` (click = reset to Default Survey View; was zoom %)** / + · 2D · 3D · Fullscreen (Fullscreen API, Esc/exit synced). Focus: one point → its object at ≈10 m stand-off, several → their extent |
| Status bars | left: mean dataset confidence + **Scale: Metadata / Format / Unknown** (tooltip: units, orientation, position, terrain source, warnings); right (real-world values): map scale (≈90 px, 1-2-5), camera altitude, elevation and position of the selected point (else the orbit target), compass (rotates with heading; click = face north) |
| Crop | toolbar Crop (blue while open) → **floating Crop panel above the central control panel** (not in the left panel): X / Y / Z cards with typed min–max (real-world m) synced with two-tick bar sliders over the model's bounding box; header On/Off toggle, Reset, close (X); subtle crop box in the view |
| Keyboard | Esc clears selection; **Ctrl/⌘+Z undo, Ctrl+Y / Ctrl+Shift+Z redo** (history moved off the toolbar); sliders support arrows/Home/End |

## Crop (visualization only) — Sep 2026
Replaces the toolbar Undo/Redo. Limits which part of the loaded model is **drawn and pickable**; the
dataset, the uploaded file and the source model are never modified — fully reversible.
- **State** (`pointCloudStore.ts`): `crop: { enabled, min: Vec3, max: Vec3 }` in **world-local** metres
  (the same frame as rendering / measurements / elevation filter) + `cropOpen` (Crop Mode = controls + box
  shown). `fullCrop(ds)` = the dataset's full `bounds` (computed at load from the real, transformed model —
  no hard-coded coordinates); `initDataset` always installs `fullCrop(ds)` so a new model never inherits
  the previous crop, and closes Crop Mode. Helpers: `isCropActive` (enabled and smaller than the bounds),
  `insideCrop(crop, p)`.
- **Actions**: `toggleCropMode`, `setCropAxis(axis, {min?, max?})` (clamped to the bounds, min ≤ max; slider
  drags call it live), `commitCrop` (on slider release / typed value), `setCropEnabled` (values kept while
  disabled), `resetCrop` (back to the full box, keeps enabled state, camera untouched).
- **Rendering**: the vertex shader computes `w = uLinear * position` (model transform) once and tests
  `uCropMin ≤ w ≤ uCropMax` (`uCropOn`) **together with** the existing tests — final visibility = points
  layer ∧ density ∧ **crop** ∧ elevation ∧ confidence ∧ semantic class. A crop change writes 2 vec3
  uniforms + 1 float and re-renders one frame: no reload, re-parse, buffer upload or scene rebuild.
  (`uLinear` replaced the former `uZRow`; z for the elevation filter / colouring is `w.z`.)
- **Crop box**: unit-cube `EdgesGeometry` in the `model` group (so it follows Flip), scaled/moved to the
  crop, white 50 % opacity, depth test off, visible only while Crop Mode is open and the crop is enabled.
- **Picking / measurements**: CPU picking applies the same crop test (cropped-out points can't be
  selected). On `commitCrop` (and after Ctrl+Z/Y restores a selection) selected points outside the active
  crop are deselected, so Measurements / Terrain Statistics only ever use visible points. The crop is not
  an undo step (view region, like panel state).
- **UI** (→ updated, see "Central control panel" below): the Crop controls are a floating panel
  (`CropControl.tsx`) above the central control panel — they were first built as a left-panel section and
  moved out; the left panel no longer contains anything crop-related. Toolbar button is blue only while
  the panel is open; a crop still applied behind a closed panel shows a small white dot on the button.
- **Verified** (headless Chrome, real UI, demo GLB): button present / no Undo-Redo; opens panel; full
  bounds initially; mouse-dragged X max 60 % and X min 25 % hide points live; Y min/max, typed Z max,
  Z min; all axes at once; elevation filter + semantic filter combine with crop; clicks pick only inside;
  selection pruned when cropped out; disable → full model with values kept, re-enable restores; Reset
  (camera unchanged); wheel / tilt / heading; Ctrl+Z; closing Crop Mode keeps the crop; uploading a
  second model (Parque Copán GLB) resets the crop to its own bounds; source file untouched. `tsc`/build clean.
- **Limitations**: axis-aligned box in world-local axes only (no rotated box, no drag handles in 3D);
  the Default Survey View / Focus frame the whole model, not the crop; crop is not saved across reloads.
  Sliders are disabled while the crop is Off (typed values still apply).

## Central control panel — floating tools & active states
**Full reference: `brain/central-control-panel.md`** (layout / coordinates, every control and its action,
active-blue rules, `cropOpen` / `rotationsOpen` state, Crop and Rotations floating panels, how to add a tool).
Summary: Crop and Rotations are floating panels 5 px above the bar (shared `FloatingPanel`), both closed
by default and toggled from their toolbar button (blue while open) or the panel X; every stateful control
is blue (`ACTIVE_BLUE`, #0083D5) when on, momentary actions never; the left panel has no crop controls.

## Visual system (unchanged design, one deliberate change)
- Left/right panels are now **translucent glass** like the toolbar/tilt panel/status bars:
  `SIDE_PANEL` = `rgba(32,38,43,.6)` + 1 px light border + 7.8 px blur + shadow (`HUD_SURFACE` is the grey
  variant for small controls, `MENU_SURFACE` for dropdowns). Same recipe everywhere via `ui.tsx` constants.
- States: `HOVER` (white/12 %), `DISABLED` (40 % opacity), `FOCUS_RING`; **active controls in the central
  control panel = `ACTIVE_BLUE` (#0083D5)** — replaced the neutral `ACTIVE_FILL` (white/22 %) in Sep 2026 per
  `context/central_control_panel.png`. No other new accent colours.
- Layout regression: at 2048×1143 the panel/toolbar/menu edges still match the reference within ~1 px
  (numeric edge scan against `Point_Cloud_View.png`).

### Small deviations from the static design (needed for functionality)
- Slider knobs show the real value (e.g. Point Density knob at the right end for 100 %, not mid-track).
- Elevation range/labels use the dataset's real Z range (745–804 m), not −50…300 m; default point size is 2 px (design placeholder said 3 px).
- Measurements header shows a read-only state badge followed by the accordion chevron; Inspector “Point Cloud ▾”
  and the “Point Cloud Model ▾” selector remain visual (other views don't exist yet; the latter has a tooltip).
- Tilt/Heading show the current degrees beside the label; the reserved toolbar box shows the active mode.
- Empty states: inspector message “Select a point, object or region to view details and measurements.”,
  “—” in Terrain Statistics, “Select 1–5+ points to measure.”

## Responsive HUD layout (panels / toolbar sizing)
Goal: readable side panels and a larger toolbar without redesigning anything — the Figma layout inside each
panel/toolbar is untouched and enlarged **uniformly**, so every absolute position (Inspector card, measurement
rows, toolbar slots) stays aligned. All numbers live in `lib/hudLayout.ts` (`hudLayout(vw, vh)`), shared by
`PointCloudView` (stage), the panels (via CSS variables) and the store (camera framing).

- **Stage**: unchanged — the 1440×804 design frame is scaled to *contain* the viewport, so the stage is always
  ≥ 1440 × 804 design px; extra width/height goes to the central area and panel height.
  `PointCloudView` publishes `--pc-panel-zoom`, `--pc-left-w`, `--pc-right-w`, `--pc-toolbar-scale` on the stage.
- **Side panels** (`LeftPanel`, `RightPanel`): outer `<aside>` = glass shell + `.pc-scroll`, anchored
  top *and* bottom (left `top 95 / bottom 69`, right `top 90 / bottom 66` — the same edges as the old fixed
  640 / 648 px heights at 804 px, taller on taller stages). Width = content × zoom + 8 px scrollbar gutter.
  Inner `<div>` keeps the original design width (243 / 253 px) and gets CSS `zoom: var(--pc-panel-zoom)`.
  - Panel zoom = `clamp(1.25 / sqrt(stageScale), 1.2, 1.4)`: 1.2 on large screens, up to 1.4 on small ones so
    text keeps a readable on-screen size (≈ 312 / 324 px wide at 1440×804, was 243 / 253).
  - Why `zoom` on an inner div (not `transform`, not on the aside): zoom changes layout size, so the scroll
    height is right; keeping it off the aside keeps its `top/left/bottom` offsets in plain design px.
    Pointer maths (sliders use `getBoundingClientRect` ratios) is unaffected — verified.
- **Scrolling**: `.pc-scroll` (index.css) = `overflow-y: auto`, `overscroll-behavior: contain`,
  `scrollbar-gutter: stable` (expanding / collapsing never shifts content), 6 px thumb `rgba(255,255,255,.12)`
  (.22 on hover), transparent track; Firefox gets `scrollbar-width: thin`. The wheel over a panel scrolls the
  panel, not the 3D view (OrbitControls only listens on the canvas).
- **Accordions** (`ui.tsx`): `PanelSection` has `defaultOpen` (default `true`); the header row is a button
  (`aria-expanded`, chevron up/down). The section's `h-[…]` class is its *expanded* height; collapsed it gets
  `!h-auto` and the body is unmounted. `SectionHeader` without `onToggle` renders the old static header.
  - Left defaults: Layers, Rendering Mode, Point Density, Point Size **expanded**; Elevation, Semantic,
    Confidence, Selection **collapsed**. Layers has its own toggle; the toolbar Layers button expands it and
    scrolls it into view before pulsing.
  - Right: Selection Summary, Measurements, Terrain Statistics, Actions are collapsible, all **expanded** by
    default (the Inspector header and Selected Point card are not accordions). Collapse state is per mount.
- **Bottom toolbar**: the whole bar is scaled uniformly with `scale(var(--pc-toolbar-scale))`, `origin-bottom`,
  still centred at 50 % + 3.5 px, 23 px from the bottom. Scale = as large as fits between the bottom status
  bars (8 px gap), clamped 1–1.18: ≈ 1.09 at 16:9 (783 × 56, slots 25 px), 1.18 on wider stages. The Flip menu
  scales with it. `TiltHeadingControl` follows through `calc()` on the same variable (5 px above the bar, left
  edge over Rotations).
- **Central model area**: the WebGL canvas is still full-screen under the translucent panels (the design shows
  the model faintly behind them); keeping the model unobstructed is done by framing, not by shrinking the canvas:
  `fitX = (stageW − 2·max(panel extent + 8)) / stageW`, `fitY` from the header (90 px) / toolbar extents.
  The default camera is computed on load / Reset (not on window resize — Reset or the zoom % re-frames).
- Constants duplicated in `hudLayout.ts` (status-bar and header extents, toolbar Figma size) must be kept in
  sync if the `StatusBars.tsx` / `TopBar.tsx` / `BottomToolbar.tsx` geometry changes.
- Limitation: the HUD is still one uniformly scaled design frame, so on very small windows (below ~1024 px wide)
  everything, panels included, gets proportionally smaller; there is no separate mobile layout.

## Verification done
Automated with puppeteer-core + headless Chrome (harness lives outside the repo, driven through the real UI):
layers, all 4 modes, density (50 % visited twice ⇒ identical pixel count), point size, elevation (typed + drag),
semantic (checkbox + search), confidence, single/multi selection, clear/restart, measurements for 1–6 points
**checked against independently computed values (all equal)**, terrain stats, overlays, orbit/pan/zoom (mouse
+ wheel), tilt/heading sliders, focus/reset, 2D/3D, lock, panel close/reopen, undo/redo (13 steps back to defaults),
fullscreen, 1366×768 / 1280×620 / 2048×1143 / 2560×1080 layouts, `tsc` and `vite build`.
Panel/toolbar sizing update (same approach, real GLB, 6.3 M points): all interaction checks passed — accordion
defaults, expand/collapse (left + right), wheel scrolling of both panels with the last controls reachable,
density/size/confidence sliders map the pointer exactly inside the zoomed panels (50 % click gives 0.500),
elevation input, semantic checkbox, selection dropdown, picking + shift-click gives “2 Points (Line)”, Clear
Selection, every toolbar control incl. the Flip menu, undo/redo, tilt slider; toolbar icons centred (0 px offset).
Layout at 1440×804, 1920×1080, 1366×768, 1280×620, 2560×1080, 1024×768, 1280×1024: no horizontal overflow or
clipping in the panels, toolbar centred and clear of the status bars, default-framed model 0 % under the side
panels (0.17 % at 2560×1080). The toolbar covers 1.4–2.4 % of model pixels on screens 16:9 or wider (0 % on
4:3 / 5:4): the sparse fringe of stray points outside the 1–99 % framing bounds at the survey's near edge,
not the dense body.
`window.__pointCloud = { pc, getState, frames }` is exposed for such tests.

## Known limitations / next steps
- Semantic class, confidence, terrain elevation, object ids and the flight path are **prototype proxies** (see
  Data layer); replace with ML/DEM/trajectory outputs by providing them in the dataset — UI/renderer need no change.
- PLY and OBJ(+MTL+textures) are supported; no LAS/LAZ or FBX loader yet (formats.ts still marks them
  unrenderable). Tiled/backend streaming would need a chunked dataset + octree picking; today one dataset
  (≤ 6.5 M points) lives in memory (~250 MB CPU + ~125 MB GPU).
- No georeference for the prototype (lat/lon “—”); a companion `.metadata.json` with a geo origin enables it.
  Volume needs a reliable base surface (ground classes or supplied DTM).
- Header menus, Invite, profile, Overall Analytics strip and view switching (Cesium/Semantic) are still visual.
- Cross-view sync: `pointId`, `objectId` and `semanticClass` are stable per point (see `getPoint`) —
  Point → Object → Semantic → Cesium mapping can hang off these.
- The 354 MB GLB takes ~10–60 s to download/parse on first load (badge shows progress) and is copied to `dist/`.
- Software GL (headless) renders a frame in ~1 s; on a real GPU the single draw call is interactive.

## Tuning log (minor changes)
- Left panel inset 4.5 px, section gap 7.3 px, fixed (expanded) section heights (unchanged from Phase 1 tuning);
  right panel content 253 px wide. Outer panel sizes are now responsive (see "Responsive HUD layout").
- Slider fraction is measured against the visible track (the hit area is 8 px wider) — fixes knob/pointer offset.
- Programmatic camera changes flush OrbitControls damping momentum first (fixed heading drift after a mouse orbit).
- Flight path: 6 passes, dashed, 32 % opacity, 4 m above the model (a first version 45 % of the height above
  with solid lines cluttered the composition).
- Focus with nothing selected = Default Survey View (spec: focus survey bounds + always be able to reset).
- Selection tolerance `max(7, pointSize*2+4)` px; depth window 2 % of the nearest candidate.
- Sep 2026 (model scaling & camera task, details in `model-scaling-and-camera.md`): default tilt stored as 48°
  polar (same pose as the old 42° below horizon); zoom chip shows camera distance; multi-point Focus padding
  now max(0.5 m, 15 %) (was max(2 m, 35 %)) since the distance rule already adds the stand-off; the fixed
  0.3 × default-distance single-point focus was replaced by object focus; near/far no longer depend on the
  default distance.
- Sep 2026: model files without an extension are identified by content on upload; large binary point PLYs
  use a fast typed-array reader (18 M-point `sarang_dense_cloud` — see `ply-format-support.md`).
