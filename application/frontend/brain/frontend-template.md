# Frontend Visual Template — Implementation Notes

> **SUPERSEDED (Main Application Page).** The `/app` page, the `components/layout/*`
> shell, `SceneBackground`, `ViewSwitcher` and the teal/glass template described below
> were **replaced by the Point Cloud View** — see `brain/point-cloud-view.md` for the
> current implementation. The Landing page, `GlassPanel` (used by the Input Page) and
> the general stack notes below are still accurate. Kept for history.

Status: **visual shell only**. No upload processing, backend calls, ML
orchestration, real view engines, measurements or cross-view sync exist yet.
This document describes what was built and what the next phase needs to plug in.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS (utility styling + custom glass/accent tokens in `tailwind.config.js`)
- `react-router-dom` for the two-route flow (`/` landing, `/app` main application)
- `three` — used only for the full-screen placeholder background scene
- `lucide-react` — icon set for all placeholder controls

No Cesium, Potree, or any real 3D-data-format loader is wired in yet. That is
deliberate per the current task scope.

## Page structure

```
src/
├── pages/
│   ├── LandingPage.tsx        black screen, single "Enter Application" button → /app
│   └── MainApplication.tsx    composes the full-screen shell below
├── components/
│   ├── viewer/
│   │   └── SceneBackground.tsx   placeholder full-screen 3D scene (see below)
│   ├── layout/
│   │   ├── TopBar.tsx
│   │   ├── ViewSwitcher.tsx
│   │   ├── LeftSidebar.tsx
│   │   ├── RightSidebar.tsx
│   │   └── BottomToolbar.tsx
│   └── ui/
│       └── GlassPanel.tsx        shared frosted-glass surface used by everything above
```

## Design decisions

- **3D viewer is the background, not a card.** `MainApplication` stacks
  `SceneBackground` at `z-0` covering the full viewport; every HUD region is
  `position: absolute` above it. Nothing sits "inside" a panel that isn't a
  literal panel (top bar, sidebars, toolbar, view switcher).
- **`SceneBackground` is a stand-in, not the real viewer.** It's a small
  Three.js scene (a teal wireframe ground grid, randomly placed massing
  blocks with glowing edges, a slow orbiting camera, a sparse particle
  field) built only to make the shell feel like an immersive geospatial
  digital twin, matching the mood of `context/sample_design.png`. It has no
  relation to Cesium, Potree, or the eventual semantic renderer and should
  be deleted/replaced per view in the next phase, not extended.
- **One shared `GlassPanel` component** defines the frosted-glass treatment
  (dark translucent background, `backdrop-blur-xl`, subtle border, soft
  shadow, rounded corners) so every floating region — top bar, both
  sidebars, bottom toolbar, view switcher — reads as one consistent system
  instead of five separately tuned surfaces.
- **Every floating region wrapper is `pointer-events-none` with
  `pointer-events-auto` on the actual panel(s) inside it.** This keeps the
  (currently non-interactive) 3D background clickable/free in the empty
  space around panels, which matters once real camera controls exist.
- **`ViewSwitcher` toggles local React state only** (which pill is
  highlighted). It does not swap any rendering engine — Cesium is shown
  active by default per the required flow, and switching is purely a style
  change for now.
- Colors/tokens (`glass`, `glass-border`, `accent-teal`, `accent-blue`,
  `shadow-glass`, `shadow-glow`) live in `tailwind.config.js` so future
  panels/components reuse the same palette instead of hardcoding rgba values.

## Panel layout (matches task spec A–F)

| Region | File | Notes |
|---|---|---|
| A. Top bar | `TopBar.tsx` | identity block, survey/project pill, search/notifications/settings/user icons — all inert |
| B. Left sidebar | `LeftSidebar.tsx` | two stacked glass panels: tabbed Layers/Classes/Tools list with disabled search input + placeholder rows, and an empty "Objects" panel |
| C. Right sidebar | `RightSidebar.tsx` | "Inspector" panel with empty-state copy + 4 placeholder metric tiles (`--` values), plus a separate "Reconstruction Quality" panel with an empty progress bar |
| D. Bottom toolbar | `BottomToolbar.tsx` | centered pill of 8 tool icons (select/navigate/measure/inspect/focus/grid/reset/fullscreen) + a coordinate/altitude/2D-3D HUD readout anchored to the right |
| E. View switcher | `ViewSwitcher.tsx` | Cesium / Semantic / Point Cloud segmented control, floating top-center, Cesium active by default |
| F. Center | `SceneBackground.tsx` via `MainApplication.tsx` | full-viewport, nothing else placed over it besides the floating regions above |

## Explicitly NOT implemented (by design, this phase)

- Generation Mode upload form (drone video / GPS / flight metadata / optional inputs)
- View Mode model upload (GLB/GLTF/OBJ/LAS/PLY/FBX)
- Any backend API calls or job-status polling
- Any ML orchestration
- Real Cesium, Potree, or semantic renderer — `SceneBackground` is a decorative placeholder only
- Loading/progress UI for reconstruction jobs
- Measurement tools (area, distance, elevation stats, etc.)
- Object/point selection and the Inspector's real data binding
- Cross-view synchronization (Point ID → Object ID → Geographic XYZ → Semantic Object → Cesium Geometry)
- Layer/class filtering logic in the left sidebar
- Landing page content beyond the single button

## Considerations for the next phase

- When real per-view renderers are added, they should each replace
  `SceneBackground` under a shared "viewer" interface (e.g. mount/unmount
  per active view from `ViewSwitcher`'s state) rather than living alongside it.
- `ViewSwitcher`'s local `active` state should be lifted to wherever
  view/session state ends up living (context, store, or router state) once
  switching actually needs to drive which renderer is mounted and which
  precomputed assets are fetched.
- The Inspector's 4 metric tiles are intentionally generic (`Area`,
  `Perimeter`, `Elevation`, `Confidence`) — the real set differs per view and
  per selection-count per `context/Point Cloud Context.pdf`'s 1/2/3/4/5+
  point rules, so this will likely need a few distinct inspector layouts,
  not one fixed grid.
- Left sidebar tabs (`Layers` / `Classes` / `Tools`) are placeholders for
  where semantic class filters, Cesium layer toggles, and point-cloud
  filters will eventually live — they are not yet differentiated per view.
- No file upload, drag-and-drop, or `<input type="file">` exists anywhere —
  Generation Mode and View Mode entry points still need to be designed and
  built as their own step before this shell is "complete."
- `three` is currently a dependency only for the placeholder background. If
  Cesium and/or Potree are added later, confirm there's no unnecessary
  duplication of Three.js versions (Potree depends on Three.js internally).
