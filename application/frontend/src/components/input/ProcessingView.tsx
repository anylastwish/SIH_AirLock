import { Check, Loader2 } from 'lucide-react'
import type { JobStatus, PipelineStage } from '../../lib/pipeline'

interface ProcessingViewProps {
  title: string
  subtitle: string
  stages: PipelineStage[]
  status: JobStatus
  /** Shown when the progress is simulated. */
  prototypeNote?: string
  onCancel: () => void
}

/**
 * Renders a JobStatus. It knows nothing about where the status comes from,
 * so the mock timer can be swapped for backend job polling unchanged.
 */
export default function ProcessingView({
  title,
  subtitle,
  stages,
  status,
  prototypeNote,
  onCancel,
}: ProcessingViewProps) {
  const percent = Math.floor(status.progress)
  const done = status.state === 'complete'

  return (
    <div className="mx-auto max-w-md space-y-6 py-2" role="status" aria-live="polite">
      <div className="text-center">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="mt-1 text-xs text-white/45">{subtitle}</p>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="text-white/70">{stages[status.stageIndex].label}</span>
          <span className="tabular-nums text-white/50">{percent}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-100 ease-linear"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      </div>

      <ol className="space-y-1.5">
        {stages.map((stage, index) => {
          const complete = done || index < status.stageIndex
          const active = !done && index === status.stageIndex
          return (
            <li key={stage.id} className="flex items-center gap-3 text-xs">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  complete
                    ? 'border-white bg-white text-black'
                    : active
                      ? 'border-white/50 text-white'
                      : 'border-white/15 text-transparent'
                }`}
              >
                {complete ? (
                  <Check size={11} strokeWidth={3} />
                ) : active ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : null}
              </span>
              <span
                className={complete ? 'text-white/50' : active ? 'text-white' : 'text-white/30'}
              >
                {stage.label}
              </span>
            </li>
          )
        })}
      </ol>

      {prototypeNote && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[11px] leading-relaxed text-white/40">
          {prototypeNote}
        </p>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-white/15 px-5 py-1.5 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
