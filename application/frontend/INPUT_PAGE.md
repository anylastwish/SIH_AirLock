# Input / Processing Page

The gateway between the Landing Page and the Main Application. The user picks
a workflow, supplies inputs, and is sent to the workspace.

```
/  Landing  →  /input  Input / Processing  →  /app  Main Application
                 ├─ Visualizer      (existing model → short load → /app)
                 └─ Generate Model  (survey inputs → mock processing → pre-made GLB → /app)
```

**Status: frontend prototype.** Nothing is uploaded, no backend is called, no
reconstruction runs. The Generate flow shows simulated progress and then opens
a pre-made GLB.

## Files

```
src/
├── pages/InputPage.tsx              page + workflow state (mode, files, running job)
├── components/input/
│   ├── ModeSelector.tsx             Visualizer / Generate Model cards
│   ├── VisualizerPanel.tsx          multi-file upload + file list + validation messages
│   ├── GeneratePanel.tsx            required inputs + collapsible "Optional Data"
│   ├── UploadCard.tsx               one survey input (icon, tag, drop zone, file row)
│   └── ProcessingView.tsx           renders a JobStatus (progress bar + stage list)
├── components/viewer/
│   ├── PointCloudViewer.tsx         WebGL point-cloud renderer (Point Cloud View; replaced ModelViewer)
│   └── ModelStatusBadge.tsx         load progress / failed / unsupported readout (reads the point-cloud store)
└── lib/
    ├── formats.ts                   model-format registry, file classification, helpers
    ├── surveyInputs.ts              Generate inputs: required/optional, accepted extensions
    ├── pipeline.ts                  stage lists, JobStatus type, mock timer
    └── session.ts                   hand-off of the model to show in /app
```

Route `/input` is registered in `App.tsx`. The Landing Page's **Enter
Application** button now navigates to `/input` (it used to go to `/app`).

## Visualizer workflow

1. Select **Visualizer**.
2. Drop or browse for files (multiple allowed). Unsupported types are skipped
   with a message.
3. `classifyModelFiles` finds the one primary model file and treats the rest as
   companions. It blocks **Open Model** if there is no model file or more than
   one, and shows non-blocking hints (e.g. OBJ without an `.mtl`).
4. **Open Model** → a short load state (`LOAD_STAGES`) → `/app`.

No reconstruction is triggered.

**Supported formats**

| Format | Routes to view | Renders in prototype |
|---|---|---|
| GLB, GLTF | Cesium | Yes (Point Cloud View renderer) |
| PLY (ASCII + binary) | Point Cloud | Yes (Point Cloud View renderer) |
| OBJ, FBX | Cesium | No — accepted, shows a notice |
| LAS | Point Cloud | No — accepted, shows a notice |

Companion files accepted alongside a model: `.mtl`, `.bin`, and textures
(`png jpg jpeg webp bmp tga tif tiff`). For GLTF/OBJ, relative references
resolve by file name to the uploaded companions.

To route a format elsewhere or add a loader, edit its entry in
`MODEL_FORMATS` (`lib/formats.ts`) and add the loader in the viewer.

## Generate workflow

1. Select **Generate Model**.
2. Provide the three required inputs. **Generate 3D Model** stays disabled
   until all three are present; the helper text shows "N of 3 required inputs
   added". Optional inputs never gate the button.
3. **Generate 3D Model** → processing view → pre-made GLB → `/app`.

| Input | Tag | Accepted extensions |
|---|---|---|
| Drone Video | Required | mp4, mov, avi |
| GPS Coordinates | Required | csv, gpx, kml, srt |
| Flight Metadata | Required | json, xml, csv, txt |
| IMU Data | Optional | csv, txt, json |
| Barometric Altitude | Optional | csv, txt, json |
| Camera Intrinsic Parameters | Optional | json, xml, yaml, yml, txt (upload only, no form yet) |
| RTK / PPK Corrections | Optional | pos, obs, nav, csv, txt |

Optional inputs live in a collapsed **Optional Data** section. Validation is
extension-only; content validation belongs to the backend. The extension lists
are in `lib/surveyInputs.ts` and are an assumption, not a spec — adjust them
once the pipeline's real input formats are fixed.

## Mock processing

`lib/pipeline.ts` → `startMockJob` is a timer (≈ 12 s for Generate, ≈ 1 s for
the Visualizer load) that walks the stage list and emits `JobStatus`
(`{ state, stageIndex, progress }`). The Generate stages (uploading, video,
GPS sync, geometry, point cloud, semantic, Cesium, finalize) are **UI
placeholders** — the processing view says so on screen. Cancel returns to the
form with the user's files intact.

## Temporary GLB behavior

On Generate completion the page stores `premadeReconstruction()` in
`lib/session.ts`. It points at **`/models/survey-reconstruction.glb`**, i.e.
`public/models/survey-reconstruction.glb`.

> The GLB now lives at `public/models/survey-reconstruction.glb` (a point-cloud GLB,
> ≈354 MB, chosen by the user). Replace the file (same name) or change
> `PREMADE_MODEL_URL` in `lib/session.ts` to use another model.

## Main Application redirect

- Both workflows call `setActiveModel(...)` then `navigate('/app')`.
- `MainApplication` reads `getActiveModel()` once on mount and falls back to
  `premadeReconstruction()` when `/app` is opened directly.
- `/app` is currently the **Point Cloud View** (`brain/point-cloud-view.md`) for
  every format — the format registry's `view` field is not used yet and there is no
  view switching (Cesium / Semantic are not built).
- GLB/GLTF are converted by the prototype adapter in `lib/pointCloud.ts` into a generic point-cloud dataset and
  rendered by `PointCloudViewer` (see `brain/point-cloud-view.md`); the view is fully interactive. Unsupported formats
  (OBJ/FBX/LAS/PLY) and load failures show a black viewport plus a status badge.
- The active model lives in memory. Uploaded models use `blob:` URLs and do not
  survive a page refresh (refreshing `/app` shows the pre-made GLB).

## Future backend / ML integration points

The frontend never talks to the ML model; it talks to the backend.

| Prototype piece | Replace with |
|---|---|
| `startMockJob` in `pipeline.ts` | Submit survey files to the backend, poll job status, map the response to `JobStatus`. `ProcessingView` is unchanged. |
| `GENERATION_STAGES` | Stage names/weights reported by the backend job. |
| `premadeReconstruction()` in `session.ts` | Asset descriptor returned for the finished job (URLs for Cesium / semantic / point-cloud assets). |
| `uploadedModel()` in `session.ts` | Backend asset/file loading for the Visualizer (upload or reference an existing asset). |
| `PointCloudViewer` + `lib/pointCloud.ts` adapter | Point Cloud renderer is done; swap the GLB adapter for LAS/PLY/backend output (same `PointCloudDataset`). Cesium / Semantic viewers later, chosen from `MODEL_FORMATS[...].view`. |
| Session in memory | Route param or stored job/asset id so `/app` survives refresh. |
