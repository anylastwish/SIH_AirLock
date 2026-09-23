import { FileCheck2, RefreshCw, UploadCloud, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { SurveyInputSpec } from '../../lib/surveyInputs'
import { extensionOf, formatBytes } from '../../lib/formats'

interface UploadCardProps {
  spec: SurveyInputSpec
  file: File | undefined
  onSelect: (file: File) => void
  onRemove: () => void
}

/**
 * One survey input: icon, name, Required/Optional tag, description and a
 * compact drop target that turns into a file row once something is chosen.
 */
export default function UploadCard({ spec, file, onSelect, onRemove }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const Icon = spec.icon

  const accept = (files: FileList | null) => {
    const picked = files?.[0]
    if (!picked) return
    if (!spec.extensions.includes(extensionOf(picked.name))) {
      setError(`Unsupported file type. Use ${spec.extensions.map((e) => `.${e}`).join(', ')}.`)
      return
    }
    setError(null)
    onSelect(picked)
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col gap-3 rounded-xl border p-3.5 transition-colors sm:flex-row sm:items-center sm:gap-4 ${
        dragging ? 'border-white/50 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/70 ring-1 ring-white/10">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white">{spec.title}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                spec.required
                  ? 'bg-white/90 text-black'
                  : 'border border-white/15 text-white/40'
              }`}
            >
              {spec.required ? 'Required' : 'Optional'}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-white/45">{spec.description}</p>
        </div>
      </div>

      <div className="w-full sm:w-[15.5rem] sm:shrink-0">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={spec.extensions.map((e) => `.${e}`).join(',')}
          onChange={(e) => {
            accept(e.target.files)
            e.target.value = ''
          }}
        />

        {file ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-2">
            <FileCheck2 size={15} className="shrink-0 text-white/70" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs text-white" title={file.name}>
                {file.name}
              </p>
              <p className="text-[10px] text-white/40">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label={`Replace ${spec.title}`}
              title="Replace"
              className="grid h-6 w-6 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${spec.title}`}
              title="Remove"
              className="grid h-6 w-6 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-2.5 text-xs text-white/50 transition-colors hover:border-white/40 hover:text-white/80"
          >
            <UploadCloud size={15} />
            <span>
              {dragging ? 'Drop to upload' : 'Drop file or'}{' '}
              {!dragging && <span className="text-white/80 underline underline-offset-2">Browse</span>}
            </span>
          </button>
        )}

        {error && <p className="mt-1.5 text-[11px] text-white/60">{error}</p>}
      </div>
    </div>
  )
}
