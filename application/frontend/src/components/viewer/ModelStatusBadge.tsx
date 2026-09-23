import { AlertCircle, Loader2 } from 'lucide-react'
import { usePC } from '../../lib/pointCloudStore'
import { HUD_SURFACE } from '../pointcloud/ui'

/**
 * Small floating readout of what the loader is doing (download → parse →
 * analyse) and of load failures. Hidden once the point cloud is on screen so the
 * Point Cloud View stays clean. Lives inside the scaled HUD stage (design px),
 * top-centre under the header.
 */
export default function ModelStatusBadge({ modelName }: { modelName: string }) {
  const status = usePC((s) => s.status)
  if (status.kind === 'ready' || status.kind === 'idle') return null

  const loading = status.kind === 'loading'
  const text = loading
    ? `${status.message}${status.progress < 1 && status.progress > 0 ? ` ${Math.round(status.progress * 100)}%` : ''}`
    : status.message

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[74px] flex justify-center">
      <div
        role="status"
        className={`${HUD_SURFACE} pointer-events-auto flex max-w-[360px] items-start gap-[6px] px-[10px] py-[6px] font-jersey10 text-[12px] leading-[13px] text-white/80`}
      >
        {loading ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-white/60" />
        ) : (
          <AlertCircle size={11} className="mt-[1px] shrink-0 text-white/60" />
        )}
        <span>
          {text}
          <span className="block text-white/45">
            {loading ? modelName : status.kind === 'unsupported' ? 'Try a GLB, GLTF or PLY model.' : 'Check the model file and reload.'}
          </span>
        </span>
      </div>
    </div>
  )
}
