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
                           TiltHeadingControl, StatusBars, PointCloudView (scaled stage), ui.tsx (primitives)
```
`viewer/ModelViewer.tsx` (Phase-1 stand-in) was **deleted**; `PointCloudViewer` replaces it.

## Data layer (`lib/pointCloud.ts`)
**Multi-format support: see `brain/ply-format-support.md` for the PLY adapter, the GLB/PLY code-sharing
design, and how to add the next format (LAS, OBJ, FBX, textured GLTF…) the same way.**
- **`PointCloudDataset`**: structure-of-arrays typed arrays — `positions` (xyz, Float32), `colors`
  (RGBA Uint8: rgb + reconstruction confidence in A), `meta` (Uint8×4: semantic class index, semantic
  confidence), `terrainElevation`, `objectIds`, `normals` (xyz Float32 or `null` — only when the source
  carried normals, e.g. PLY `nx/ny/nz`), plus bounds/`focusBounds` (1–99 % extent), `zRange`,
  `classCounts`, `meanConfidence`, `geoReference | null`, `source` (`{ kind: 'gltf-prototype' |
  'ply-prototype', … }`).
  `colors`/`meta`/`normals` are uploaded to the GPU unchanged; the same arrays serve CPU picking.
- **Conventions**: local metres, right-handed, **Z up** (X east, Y north) like LAS. Point ID = array
  index (stable; density sampling never renumbers). Z (point elevation) and `terrainElevation`
  (ground under the point) are separate fields, never assumed equal.
- **Shared adapter** — `datasetFromObject3D(root, name, options)` — takes any three.js object graph
  (a GLTF scene, or a single `Points`/`Mesh` wrapping a parsed PLY geometry) and produces a
  `PointCloudDataset`. GLB/GLTF and PLY are two thin *loaders* (`loadFromGLTF`, `loadFromPLY` in the
  same file) that both funnel into this one pipeline — adding PLY changed zero lines of the shared
  extraction/extents/terrain/confidence/semantic logic below:
  - Point primitives are copied (uniform stride, cap `DEFAULT_MAX_POINTS = 6.5 M`; the source has 12.6 M
    so stride = 2 → 6.32 M points). Mesh-only models get 400 k area-weighted deterministic surface samples
    (vertex colour or material colour; textures are **not** sampled).
  - Scene Y-up → Z-up. Units: the Sketchfab normalisation node (`Sketchfab_model`, scale 0.01396) is
    undone, giving the file's source coordinates (≈ 168 × 193 m footprint, Z 744.8–803.7 m). **Assumption:
    source units are metres.** Override via `AdapterOptions.unitsToMeters`.
  - **Derived, placeholder attributes (replace with real data later):**
    `terrainElevation` = smoothed per-cell minimum on a ~96×96 XY grid (DTM stand-in);
    reconstruction confidence = log local point density per voxel (sparse edges/halo ⇒ low);
    semantic class = rule-based on colour + height above terrain (water/vegetation/roads/terrain/buildings/other);
    object id = (24×24 XY cell, class) registry → `OBJ_10000+`. These are proxies, **not ML output**.
  - **No georeference**: latitude/longitude show “—”; the bottom-right bar shows local X/Y instead.
    Pass `geoReference` (origin lat/lon) to `datasetFromObject3D` to enable lat/lon everywhere.
- `loadPointCloud(model, onProgress, onPhase)` is the single entry point used by the store; it dispatches
  on `model.format` (`glb`/`gltf` → `loadFromGLTF`, `ply` → `loadFromPLY`). To add LAS/backend tiles: write
  another loader returning a `PointCloudDataset` (or reusing `datasetFromObject3D`) and add one `case`.

## Renderer (`viewer/PointCloudViewer.tsx`)
- **One `THREE.Points`**; per-point work happens in the vertex shader from uniforms, so changing layers,
  density, size, filters or colour mode never rebuilds or re-uploads point data:
  visible = points-layer ∧ `hash01(gl_VertexID) < density` ∧ z ∈ elevation range ∧ confidence ∈ range ∧
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
  Target is clamped to the survey bounds (+30 %) and polar angle limited to ≤ 90° so the view can't be lost.
- **2D** = top-down with FOV 6° and the distance scaled to keep the same framing (near-orthographic “dolly
  zoom”); polar angle locked, heading still free. **3D** restores the previous tilt.
- Rendering is **on demand** (only on camera/state change); a frame counter is written to
  `window.__pointCloud.frames` for automated tests.

## State (`lib/pointCloudStore.ts`)
One store holds: dataset + load status, layers, render mode, density, point size, elevation range, class
flags (+ search query), confidence range, selection mode/tool/lock, `selectedIds`/`activeId`, camera
`{target, distance, heading, tilt}`, view mode (2d/3d), Tilt/Heading panel open, fullscreen, canUndo/canRedo.
- **Heading** = compass direction the camera looks towards (0 = north); **tilt** = degrees below the
  horizon (0 level … 90 straight down); `distance` = FOV-45° framing distance. The model never rotates.
- **Undo/redo** (max 100): snapshots of layers, mode, density, size, elevation, classes, confidence,
  selection, camera, view mode. Discrete actions commit immediately; sliders commit **on release**; mouse
  camera moves commit on OrbitControls `end`. Chrome state (tool, lock, panel open, fullscreen) is not undoable.
- **Default Survey View** is computed from the dataset's 1–99 % bounds, fitted into the free central area
  between the side panels, header and toolbar (`hudLayout().fitX / fitY`, ≈ 0.54 × 0.78 at 1440×804),
  heading 0°, tilt 42°. Reset only changes the camera.
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
| Measurements | 1 pt: X/Y/Z/terrain elev · 2 pts: 3D, horizontal, vertical, slope (°, %) · 3 pts: 3D area, perimeter, horizontal side lengths, plane slope, 3D distances · 4 pts: 3D perimeter, 3D surface (fan triangulation), plan area, **Volume = N/A (needs a base surface)** · 5+: centroid X/Y/Z, mean terrain elevation |
| Terrain Statistics | max/min/mean/range of selected point Z |
| Actions | Clear Selection · Restart Selection (clear + select tool) |
| Tilt / Heading | sliders drive the camera and follow mouse orbits; value shown next to the label; close (X) hides, **Rotations** reopens. Dragging Tilt in 2D switches back to 3D. |
| Toolbar | Select · Pan (drag pans) · Lock (freezes navigation, picking still works) · Focus (selection, or the Default Survey View when empty) · **Flip** (glass menu: Flip horizontal / Flip vertical, each a toggle; button highlighted while any flip is on — replaced the old Single⇄Multi Pointer toggle, which remains in the Left panel Selection dropdown; the Ruler still switches to Multi) · Ruler (new multi-point measurement) · Layers (pulses Layers section) · Path (toggle flight path) · Undo/Redo (disabled when empty) · centre box = current mode read-out · Rotations · − / **zoom % (click = reset to Default Survey View)** / + · 2D · 3D · Fullscreen (Fullscreen API, Esc/exit synced) |
| Status bars | left: mean dataset confidence; right: map scale (≈90 px, 1-2-5), camera altitude, elevation and position of the selected point (else the orbit target), compass (rotates with heading; click = face north) |
| Keyboard | Esc clears selection; sliders support arrows/Home/End |

## Visual system (unchanged design, one deliberate change)
- Left/right panels are now **translucent glass** like the toolbar/tilt panel/status bars:
  `SIDE_PANEL` = `rgba(32,38,43,.6)` + 1 px light border + 7.8 px blur + shadow (`HUD_SURFACE` is the grey
  variant for small controls, `MENU_SURFACE` for dropdowns). Same recipe everywhere via `ui.tsx` constants.
- States stay neutral: `HOVER` (white/12 %), `ACTIVE_FILL` (white/22 % + border), `DISABLED` (40 % opacity),
  `FOCUS_RING`. No new accent colours (only the design's existing chip/class colours).
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
- PLY is supported (`brain/ply-format-support.md`); no LAS/LAZ loader yet (formats.ts still marks it
  unrenderable). Tiled/backend streaming would need a chunked dataset + octree picking; today one dataset
  (≤ 6.5 M points) lives in memory (~250 MB CPU + ~125 MB GPU).
- No georeference for the prototype (lat/lon “—”). Volume needs a reference/base surface.
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
