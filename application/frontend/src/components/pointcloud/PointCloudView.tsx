import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { MODEL_FORMATS } from '../../lib/formats'
import { hudLayout, type HudLayout } from '../../lib/hudLayout'
import { pc } from '../../lib/pointCloudStore'
import type { ActiveModel } from '../../lib/session'
import ModelStatusBadge from '../viewer/ModelStatusBadge'
import PointCloudViewer from '../viewer/PointCloudViewer'
import BottomToolbar from './BottomToolbar'
import LeftPanel from './LeftPanel'
import RightPanel from './RightPanel'
import { CopyrightStatus, LocationStatus } from './StatusBars'
import TiltHeadingControl from './TiltHeadingControl'
import TopBar from './TopBar'

/**
 * Fit the design frame (1440 × 804 design px) inside the viewport (contain). The
 * HUD is laid out in design px and scaled uniformly, so proportions stay
 * identical on any desktop size; the stage is stretched to the viewport aspect
 * so edge-anchored panels still hug the screen edges on wider or taller windows.
 * Panel / toolbar sizes come from lib/hudLayout.ts and are handed to the HUD as
 * CSS variables.
 */
function useStageLayout(): HudLayout {
  const [layout, setLayout] = useState(() => hudLayout())

  useEffect(() => {
    const onResize = () => setLayout(hudLayout())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return layout
}

interface PointCloudViewProps {
  model: ActiveModel
}

/**
 * Point Cloud View — the Main Application Page. A full-screen WebGL layer
 * (PointCloudViewer) sits underneath; every panel is a translucent overlay in
 * the scaled HUD stage. All panels read / write the central store
 * (lib/pointCloudStore.ts); the renderer reacts to the same state.
 */
export default function PointCloudView({ model }: PointCloudViewProps) {
  const stage = useStageLayout()
  const stageStyle = {
    width: stage.width,
    height: stage.height,
    transform: `scale(${stage.scale})`,
    '--pc-panel-zoom': stage.panelZoom,
    '--pc-left-w': `${stage.leftWidth}px`,
    '--pc-right-w': `${stage.rightWidth}px`,
    '--pc-toolbar-scale': stage.toolbarScale,
  } as CSSProperties

  // Load (or reuse) the dataset for this model — lib/pointCloud.ts dispatches on
  // model.format (GLB/GLTF and PLY today); any other format has no loader yet.
  useEffect(() => {
    if (MODEL_FORMATS[model.format].loader !== null) void pc.load(model)
    else pc.markUnsupported(`${MODEL_FORMATS[model.format].label} preview isn't available yet.`)
  }, [model])

  // Keep the store in sync with the browser's fullscreen state; Esc clears the selection.
  useEffect(() => {
    const onFullscreen = () => pc.setFullscreen(document.fullscreenElement !== null)
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && !document.fullscreenElement && target?.tagName !== 'INPUT') pc.clearSelection()
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    window.addEventListener('keydown', onKey)
    onFullscreen()
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-black text-white">
      <PointCloudViewer />

      <div
        className="pointer-events-none absolute left-0 top-0 z-10 origin-top-left"
        style={stageStyle}
      >
        <TopBar />
        <LeftPanel />
        <RightPanel />
        <TiltHeadingControl />
        <BottomToolbar />
        <CopyrightStatus />
        <LocationStatus />
        <ModelStatusBadge modelName={model.name} />
      </div>
    </div>
  )
}
