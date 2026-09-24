# Central control panel (bottom toolbar) & floating tool panels

Status: **current** (25 Sep 2026, deployed in `6e4f94f`). Source of truth for the bottom toolbar of the
Point Cloud View, its floating panels (Crop, Rotations) and the active / inactive button states.
Visual reference: `context/central_control_panel.png` (Figma export at ×2 → divide by 2 for design px).

```
 [Select][Pan][Lock][Focus]  [Flip]  |  [Ruler][Layers][Path]  [ CROP ]  [ mode read-out ]  |  [Rotations][− 234m +][2D][3D][⛶]
                                                ┌──── Crop panel ────┐        ┌─ Rotations ─┐
                                                │ X  [min] - [max]   │        │ Tilt   0–180│
                                                │ Y  [min] - [max]   │        │ Heading 0–360│
                                                │ Z  [min] - [max]   │        └─────────────┘
                                                └────────────────────┘   (both float 5 px above the bar)
```

## Files

| File | Role |
|---|---|
| `components/pointcloud/BottomToolbar.tsx` | the bar: groups, slots, Flip menu, Crop / Rotations buttons, zoom chips, 2D/3D, fullscreen |
| `components/pointcloud/CropControl.tsx` | floating **Crop** panel |
| `components/pointcloud/TiltHeadingControl.tsx` | floating **Rotations** panel (Tilt / Heading) — exports `ROTATIONS_PANEL_LEFT` |
| `components/pointcloud/ui.tsx` | shared: `FloatingPanel`, `FLOAT_CARD`, `ACTIVE_BLUE`, `HUD_SURFACE`, `HOVER`, `DISABLED`, `FOCUS_RING`, `BarSlider`, `RangeTrack` (`variant="bar"`), `NumberField`, `Toggle` |
| `components/pointcloud/PointCloudView.tsx` | mounts `BottomToolbar`, `CropControl`, `TiltHeadingControl` in the scaled HUD stage; Ctrl+Z / Ctrl+Y |
| `lib/pointCloudStore.ts` | all state the bar reads / writes (`pc.*` actions) |
| `lib/hudLayout.ts` | `toolbarScale` → CSS variable `--pc-toolbar-scale` |

## Geometry

- The bar is the Figma **717 × 51** design, centred at `50% + 3.5px`, `23px` above the stage bottom, scaled
  uniformly from its bottom-centre by `--pc-toolbar-scale` (1–1.18, as large as fits between the bottom
  status bars; ≈1.09 at 16:9). All positions below are **toolbar design px**.
- Groups (`HUD_SURFACE` glass, 29 px high, top 10): Select/Pan/Lock/Focus x 12 w 129 · Flip x 150 w 29 ·
  divider x 187 · Ruler/Layers/Path x 196 w 89 · **Crop x 293 w 69** · mode read-out x 371 w 78 · divider
  x 457 · Rotations/zoom/2D/3D/fullscreen x 464 w 239. Slots are 23 × 23, radius 5.
- **Floating panels** (`FloatingPanel`): `left` in toolbar px → CSS
  `calc(50% + 3.5px + (left − 358.5px) · --pc-toolbar-scale)`; bottom
  `calc(28px + 51px · --pc-toolbar-scale)` = 5 px above the scaled bar. Panel content itself is not scaled
  (same as the Rotations panel always was).

| Panel | left | size | cards |
|---|---|---|---|
| Crop | 191 | 264 × 198 | X / Y / Z: 243 × 49 at top 27.5 / 84 / 141, left 9 |
| Rotations | 465 (over the Rotations button) | 181 × 121 | Tilt / Heading: 167 × 34 at top 24 / 76, left 4 |

  Crop ends at x 455, Rotations starts at 465 → the two never overlap each other or the bar at any scale
  (measured at 1440 × 900: 34 px apart, 4.9 px above the bar).

## Controls

| Control | Kind | Action (store) | Active (blue) when |
|---|---|---|---|
| Select | tool | `pc.setTool('select')` — click picks points | tool = select |
| Pan | tool | `pc.setTool('pan')` — left drag pans | tool = pan |
| Lock | toggle | `pc.toggleLock()` — freezes camera, picking still works | locked |
| Focus | momentary | `pc.focus()` — selection's object / extent, whole survey if none | never |
| Flip | menu | glass menu → `pc.toggleFlip('horizontal' \| 'vertical')` | menu open or any flip on (items blue when on) |
| Ruler | momentary | multi-select + `pc.restartSelection()` | never |
| Layers | momentary | `pc.flashLayers()` — pulses the left-panel Layers section | never |
| Path | toggle | `pc.setLayer('flightPath', …)` | flight path shown |
| **Crop** | panel | `pc.toggleCropMode()` → `cropOpen` | Crop panel open |
| mode read-out | display | Select / Select · Multi / Pan / Locked | — |
| **Rotations** | panel | `pc.toggleRotations()` → `rotationsOpen` | Rotations panel open |
| − / + | momentary | `pc.zoomBy(1/1.25 \| 1.25)` — real distance, limits from model size | never |
| distance chip | momentary | shows camera distance (`234m`); click = `pc.resetView()` | never |
| 2D / 3D | mode | `pc.setViewMode('2d' \| '3d')` | current view mode |
| Fullscreen | toggle | Fullscreen API (store synced by `fullscreenchange`) | fullscreen |

Undo / Redo buttons were removed (their slot is now Crop); the history engine is unchanged and bound to
**Ctrl/⌘+Z** (undo) and **Ctrl+Y / Ctrl+Shift+Z** (redo), ignored while typing in an input.

## Active / inactive states

- **Inactive** = the existing dark glass: slots `border-hud-border bg-hud-slot` + `HOVER` (white 12 %);
  the Crop group button `bg-hud`; chips `HUD_SURFACE`.
- **Active** = `ACTIVE_BLUE` (`#0083D5` fill + border, hover `#1592e6`) — the app's accent, same as Invite.
  2D / 3D chips use `CHIP_ACTIVE` (same colours with `!` because `CHIP` already sets a glass bg).
- Rule: blue = something is **on** (tool, mode, toggle, open panel). Momentary actions are never blue.
  Default screen: **Select, Path, 3D** blue (they are on); **Crop, Rotations** dark and closed.
- `DISABLED` (40 % opacity) until a dataset is loaded (Focus, Flip, Crop, zoom, 2D/3D).
- A crop still applied while the Crop panel is closed shows a small white dot on the Crop button (not blue:
  blue means the panel is open).
- Replaced the former neutral `ACTIVE_FILL` (white 22 %), which no longer exists.

## State (lib/pointCloudStore.ts)

| Field | Default | Reset on new model | Notes |
|---|---|---|---|
| `tool` | `'select'` | yes | |
| `navLocked` | false | yes | |
| `flip` | none | yes | in undo history |
| `layers.flightPath` | true | yes | in undo history |
| `viewMode` | `'3d'` | yes | in undo history |
| `cropOpen` | **false** | yes (closed) | panel visibility only |
| `crop` | full model box, enabled | yes → new model's own bounds | viewport filter (not in history) |
| `rotationsOpen` | **false** (was true before Sep 2026) | kept | panel visibility only |
| `fullscreen` | false | kept | mirrors the browser |

Panel visibility lives only in the store — the toolbar button and the panel's X call the same action, so
they can never disagree; no component keeps its own open/closed state (the Flip menu's open state is the
one local exception: it is a transient menu).

## Crop panel (`CropControl.tsx`)

- Header: title **Crop**, then **On/Off** `Toggle` (`pc.setCropEnabled`, values kept while Off), **Reset**
  (`pc.resetCrop`: back to the model's full bounding box, camera untouched), **X** (`pc.toggleCropMode`).
- Cards X / Y / Z: min and max value boxes (`NumberField`, real-world metres = world-local + model display
  offset; Enter / blur commits) and a `RangeTrack variant="bar"` (white fill between two white ticks) over
  the axis' bounding-box range. Drag = `pc.setCropAxis` live; release / typed value = `pc.commitCrop`
  (deselects selected points that fell outside). Sliders are disabled while the crop is Off.
- Effect: shader uniforms `uCropMin / uCropMax / uCropOn` (+ the same test in CPU picking) → points outside
  are not drawn or pickable; the dataset and the source file are never modified. Crop box outline (white,
  50 %) is drawn while the panel is open and the crop is On. Details: `point-cloud-view.md` → "Crop".

## Rotations panel (`TiltHeadingControl.tsx`)

- Title **Rotations**, X closes (`pc.toggleRotations`). Two cards with icon, label, live degrees, min/max
  labels and a `BarSlider` (white fill + tick):
  - **Tilt 0–180°** = camera polar angle (0 top view, 90 level, 180 from below) → `pc.setCamera({ tilt })`;
    dragging Tilt in 2D switches to 3D.
  - **Heading 0–360°** = compass direction the camera looks → `pc.setCamera({ heading })`.
- Sliders follow mouse orbits; each release commits one undo step.

## Adding a new tool / floating panel

1. State: add `xxxOpen: boolean` (default false) + `toggleXxx()` to the store (reset in `initialState`).
2. Button: a `Slot` (or group-sized button like Crop) with `active={xxxOpen}` `pressed={xxxOpen}` →
   `ACTIVE_BLUE` automatically; keep momentary actions without `active`.
3. Panel: `<FloatingPanel title label left width height onClose={pc.toggleXxx}>` with `FLOAT_CARD` rows,
   mounted in `PointCloudView` next to `CropControl`. Pick `left` (toolbar px) so it does not overlap
   Crop (191–455) or Rotations (465–646).
4. Update this file.

## Verification (25 Sep 2026)

Headless Chrome, real clicks / drags, locally and on https://airlock-two.vercel.app (30 checks each, all
passed; CSS transitions frozen for colour reads because software GL renders ~1 fps): both panels closed and
dark by default; no crop in the left panel; Select/Pan and 2D/3D blue swap; Focus never blue; Crop /
Rotations blue when open, dark again via the button or X; panels 4.9 px above the bar, not overlapping;
X-max / Y-min drags hide 39 % of the points, three axes leave 28 %; typed Z max ↔ slider synced; On/Off
keeps values; Reset; Tilt drag → 90°, Heading → 90°; selection, measurements, render mode, density, point
size and wheel zoom unaffected.

## Change log

- Sep 2026 — Undo/Redo toolbar buttons → Crop (history to Ctrl+Z / Ctrl+Y).
- Sep 2026 — Crop controls moved from a left-panel section to the floating Crop panel; Rotations panel
  closed by default, titled, with icons; shared `FloatingPanel`; bar sliders get value ticks; active
  state changed from white (`ACTIVE_FILL`) to blue (`ACTIVE_BLUE`) for every stateful control.
- Earlier — zoom % chip → real camera distance; Tilt range 0–90 → 0–180 (`model-scaling-and-camera.md`);
  Single⇄Multi pointer slot → Flip menu.
