/**
 * Processing-state model for the Input Page.
 *
 * PROTOTYPE ONLY: `startMockJob` is a timer that walks through UI placeholder
 * stages. Nothing is uploaded, reconstructed or measured. The stage list and
 * `JobStatus` shape are the contract the UI renders; the real integration
 * replaces `startMockJob` with polling a backend job and mapping its response
 * to `JobStatus`, and the UI does not change.
 */

export interface PipelineStage {
  id: string
  label: string
  /** Relative duration; only used by the mock timer. */
  weight: number
}

export interface JobStatus {
  state: 'running' | 'complete'
  /** Index into the stage list of the stage currently shown as active. */
  stageIndex: number
  /** 0–100. */
  progress: number
}

export const GENERATION_STAGES: PipelineStage[] = [
  { id: 'upload', label: 'Uploading survey data', weight: 1.4 },
  { id: 'prepare', label: 'Preparing input data', weight: 1 },
  { id: 'video', label: 'Processing video', weight: 1.6 },
  { id: 'sync', label: 'Synchronizing GPS & metadata', weight: 1.2 },
  { id: 'geometry', label: 'Reconstructing 3D geometry', weight: 2.4 },
  { id: 'pointcloud', label: 'Preparing point cloud', weight: 1.2 },
  { id: 'semantic', label: 'Preparing semantic model', weight: 1.2 },
  { id: 'cesium', label: 'Preparing Cesium model', weight: 1 },
  { id: 'finalize', label: 'Finalizing reconstruction', weight: 0.8 },
]

export const LOAD_STAGES: PipelineStage[] = [
  { id: 'read', label: 'Reading files', weight: 1 },
  { id: 'validate', label: 'Validating model', weight: 1 },
  { id: 'open', label: 'Opening workspace', weight: 1 },
]

const MS_PER_WEIGHT_GENERATE = 1050
const MS_PER_WEIGHT_LOAD = 380

export function mockDurationPerWeight(kind: 'generate' | 'load'): number {
  return kind === 'generate' ? MS_PER_WEIGHT_GENERATE : MS_PER_WEIGHT_LOAD
}

/**
 * Runs a timer-driven fake job. Returns a cancel function; after cancelling,
 * no further callbacks fire.
 */
export function startMockJob(
  stages: PipelineStage[],
  msPerWeight: number,
  onStatus: (status: JobStatus) => void,
): () => void {
  const totalWeight = stages.reduce((sum, s) => sum + s.weight, 0)
  const totalMs = totalWeight * msPerWeight
  const startedAt = performance.now()
  let cancelled = false

  const timer = window.setInterval(() => {
    if (cancelled) return
    const fraction = Math.min((performance.now() - startedAt) / totalMs, 1)

    let cumulative = 0
    let stageIndex = stages.length - 1
    for (let i = 0; i < stages.length; i += 1) {
      cumulative += stages[i].weight / totalWeight
      if (fraction < cumulative) {
        stageIndex = i
        break
      }
    }

    if (fraction >= 1) {
      window.clearInterval(timer)
      onStatus({ state: 'complete', stageIndex: stages.length - 1, progress: 100 })
      return
    }
    onStatus({ state: 'running', stageIndex, progress: fraction * 100 })
  }, 60)

  return () => {
    cancelled = true
    window.clearInterval(timer)
  }
}
