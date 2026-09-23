import { useState } from 'react'
import PointCloudView from '../components/pointcloud/PointCloudView'
import { getActiveModel, premadeReconstruction } from '../lib/session'

/**
 * Main Application Page — currently the Point Cloud View (visual only).
 *
 * The model comes from the Input Page hand-off in lib/session; visiting /app
 * directly falls back to the pre-made GLB so the view is never empty. Cesium /
 * Semantic views, the model-type switch and all Point Cloud functionality are
 * NOT implemented yet. See application/frontend/brain/point-cloud-view.md.
 */
export default function MainApplication() {
  const [model] = useState(() => getActiveModel() ?? premadeReconstruction())

  return <PointCloudView model={model} />
}
