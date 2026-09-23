import { File as FileIcon, UploadCloud, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  MODEL_FORMATS,
  VISUALIZER_ACCEPT,
  extensionOf,
  formatBytes,
  mergeFiles,
} from '../../lib/formats'
import type { ModelSelection } from '../../lib/formats'

const FORMAT_CHIPS = ['GLB', 'GLTF', 'OBJ + MTL + Textures', 'LAS', 'PLY', 'FBX']

interface VisualizerPanelProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  selection: ModelSelection
}

export default function VisualizerPanel({ files, onFilesChange, selection }: VisualizerPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string[]>([])

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list)
    const supported = new Set(VISUALIZER_ACCEPT.map((e) => e.slice(1)))
    const accepted = incoming.filter((f) => supported.has(extensionOf(f.name)))
    setRejected(incoming.filter((f) => !supported.has(extensionOf(f.name))).map((f) => f.name))
    if (accepted.length) onFilesChange(mergeFiles(files, accepted))
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const removeFile = (target: File) => onFilesChange(files.filter((f) => f !== target))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Upload Existing Model</h2>
        <p className="mt-1 text-xs text-white/45">
          Upload a previously generated model or supported visualization asset.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={VISUALIZER_ACCEPT.join(',')}
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-3 rounded-xl border border-dashed px-5 py-7 text-center transition-colors ${
          dragging ? 'border-white/60 bg-white/[0.08]' : 'border-white/20 bg-white/[0.03]'
        }`}
      >
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-white/70 ring-1 ring-white/10">
          <UploadCloud size={18} />
        </div>
        <div>
          <p className="text-sm text-white/80">
            {dragging ? 'Drop to add files' : 'Drag & drop model files here'}
          </p>
          <p className="mt-0.5 text-xs text-white/40">
            For OBJ, include the .mtl and texture files. For GLTF, include any .bin and textures.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-white/20 bg-white/5 px-5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-white/40 hover:text-white"
        >
          Browse files
        </button>
        <div className="flex flex-wrap justify-center gap-1.5">
          {FORMAT_CHIPS.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-white/40"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {rejected.length > 0 && (
        <p className="text-xs text-white/60">
          Not supported and skipped: {rejected.join(', ')}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file) => {
            const ext = extensionOf(file.name)
            const isPrimary = file === selection.primary
            return (
              <li
                key={file.name}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
              >
                <FileIcon size={15} className="shrink-0 text-white/60" />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-xs text-white" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-[10px] text-white/40">{formatBytes(file.size)}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    isPrimary
                      ? 'bg-white/90 text-black'
                      : 'border border-white/15 text-white/40'
                  }`}
                >
                  {ext in MODEL_FORMATS ? 'Model' : ext === 'mtl' || ext === 'bin' ? ext : 'Texture'}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(file)}
                  aria-label={`Remove ${file.name}`}
                  className="grid h-6 w-6 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {selection.error && <p className="text-xs text-white/70">{selection.error}</p>}
      {!selection.error && selection.hint && (
        <p className="text-xs text-white/45">{selection.hint}</p>
      )}
    </div>
  )
}
