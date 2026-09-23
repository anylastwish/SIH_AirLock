import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GeneratePanel from '../components/input/GeneratePanel'
import ModeSelector from '../components/input/ModeSelector'
import type { Mode } from '../components/input/ModeSelector'
import ProcessingView from '../components/input/ProcessingView'
import VisualizerPanel from '../components/input/VisualizerPanel'
import GlassPanel from '../components/ui/GlassPanel'
import { classifyModelFiles } from '../lib/formats'
import {
  GENERATION_STAGES,
  LOAD_STAGES,
  mockDurationPerWeight,
  startMockJob,
} from '../lib/pipeline'
import type { JobStatus, PipelineStage } from '../lib/pipeline'
import { premadeReconstruction, setActiveModel, uploadedModel } from '../lib/session'
import { REQUIRED_INPUTS } from '../lib/surveyInputs'
import type { SurveyFiles, SurveyInputId } from '../lib/surveyInputs'

interface Job {
  kind: 'generate' | 'load'
  status: JobStatus
}

/**
 * Input / Processing Page — the gateway between the Landing Page and the
 * Main Application. The user picks a workflow:
 *
 *  - Visualizer:     existing model file(s) → short load state → /app
 *  - Generate Model: survey inputs → mock processing → pre-made GLB → /app
 *
 * Neither path talks to a backend or the ML model yet. See
 * application/frontend/INPUT_PAGE.md.
 */
export default function InputPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode | null>(null)
  const [modelFiles, setModelFiles] = useState<File[]>([])
  const [surveyFiles, setSurveyFiles] = useState<SurveyFiles>({})
  const [job, setJob] = useState<Job | null>(null)
  const cancelJob = useRef<(() => void) | null>(null)

  // Stop any running mock timer if the page unmounts.
  useEffect(() => () => cancelJob.current?.(), [])

  const selection = useMemo(() => classifyModelFiles(modelFiles), [modelFiles])
  const missingRequired = REQUIRED_INPUTS.filter((spec) => !surveyFiles[spec.id]).length
  const canGenerate = missingRequired === 0
  const canOpen = selection.primary !== null && selection.error === null

  const runJob = (kind: Job['kind'], stages: PipelineStage[], onComplete: () => void) => {
    setJob({ kind, status: { state: 'running', stageIndex: 0, progress: 0 } })
    cancelJob.current = startMockJob(stages, mockDurationPerWeight(kind), (status) => {
      setJob({ kind, status })
      if (status.state === 'complete') {
        cancelJob.current = null
        onComplete()
      }
    })
  }

  const handleCancel = () => {
    cancelJob.current?.()
    cancelJob.current = null
    setJob(null)
  }

  const handleGenerate = () => {
    if (!canGenerate) return
    // Prototype: the pre-made GLB stands in for the reconstruction result.
    runJob('generate', GENERATION_STAGES, () => {
      setActiveModel(premadeReconstruction())
      navigate('/app')
    })
  }

  const handleOpenModel = () => {
    if (!canOpen || !selection.primary || !selection.format) return
    const { primary, format, companions } = selection
    runJob('load', LOAD_STAGES, () => {
      setActiveModel(uploadedModel(primary, format, companions))
      navigate('/app')
    })
  }

  const setSurveyFile = (id: SurveyInputId, file: File) =>
    setSurveyFiles((prev) => ({ ...prev, [id]: file }))

  const clearSurveyFile = (id: SurveyInputId) =>
    setSurveyFiles((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden bg-[#0a0a0a] text-white"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 55% at 50% 0%, rgba(255,255,255,0.07), transparent 70%), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 48px 48px, 48px 48px',
      }}
    >
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-xs text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft size={14} />
          Home
        </button>
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
          Geospatial Reconstruction
        </p>
      </header>

      <main className="flex justify-center px-4 pb-16 pt-2 sm:px-6">
        <GlassPanel className="w-full max-w-3xl rounded-3xl p-6 sm:p-9">
          {job ? (
            <ProcessingView
              title={job.kind === 'generate' ? 'Generating 3D Model' : 'Opening Model'}
              subtitle={
                job.kind === 'generate'
                  ? 'Preparing your survey reconstruction'
                  : 'Loading your model into the workspace'
              }
              stages={job.kind === 'generate' ? GENERATION_STAGES : LOAD_STAGES}
              status={job.status}
              prototypeNote={
                job.kind === 'generate'
                  ? 'Prototype preview — these stages are a simulated progress display. No reconstruction is running; a pre-made model will open when it completes.'
                  : undefined
              }
              onCancel={handleCancel}
            />
          ) : (
            <div className="space-y-7">
              <div className="text-center">
                <h1 className="text-xl font-semibold tracking-[0.2em] text-white">AIRLOCK++</h1>
                <p className="mt-5 text-lg text-white/90">What would you like to do?</p>
              </div>

              <ModeSelector value={mode} onChange={setMode} />

              {mode === null && (
                <p className="text-center text-xs text-white/35">
                  Choose a workflow to continue.
                </p>
              )}

              {mode === 'visualizer' && (
                <>
                  <div className="h-px bg-white/[0.07]" />
                  <VisualizerPanel
                    files={modelFiles}
                    onFilesChange={setModelFiles}
                    selection={selection}
                  />
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <PrimaryButton disabled={!canOpen} onClick={handleOpenModel}>
                      Open Model
                      <ArrowRight size={15} />
                    </PrimaryButton>
                    <p className="text-[11px] text-white/35">
                      Opens directly in the workspace — no reconstruction is run.
                    </p>
                  </div>
                </>
              )}

              {mode === 'generate' && (
                <>
                  <div className="h-px bg-white/[0.07]" />
                  <GeneratePanel
                    files={surveyFiles}
                    onSelect={setSurveyFile}
                    onRemove={clearSurveyFile}
                  />
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <PrimaryButton disabled={!canGenerate} onClick={handleGenerate}>
                      <Sparkles size={15} />
                      Generate 3D Model
                    </PrimaryButton>
                    <p className="text-[11px] text-white/35">
                      {canGenerate
                        ? 'All required inputs added.'
                        : `${REQUIRED_INPUTS.length - missingRequired} of ${REQUIRED_INPUTS.length} required inputs added.`}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </GlassPanel>
      </main>
    </div>
  )
}

function PrimaryButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 rounded-full bg-white px-9 py-3 text-sm font-medium text-black transition-all hover:shadow-glow disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none"
    >
      {children}
    </button>
  )
}
