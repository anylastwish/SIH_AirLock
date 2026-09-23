import { Box, Check, Cpu } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type Mode = 'visualizer' | 'generate'

interface ModeOption {
  id: Mode
  icon: LucideIcon
  title: string
  tagline: string
  question: string
  description: string
}

const OPTIONS: ModeOption[] = [
  {
    id: 'visualizer',
    icon: Box,
    title: 'Visualizer',
    tagline: 'View an existing model',
    question: 'Already have a model?',
    description: 'Upload a previously generated 3D model to visualize, inspect and measure it.',
  },
  {
    id: 'generate',
    icon: Cpu,
    title: 'Generate Model',
    tagline: 'Create a new 3D reconstruction',
    question: 'Have new drone survey data?',
    description: 'Upload drone survey data to generate a georeferenced 3D model.',
  },
]

interface ModeSelectorProps {
  value: Mode | null
  onChange: (mode: Mode) => void
}

export default function ModeSelector({ value, onChange }: ModeSelectorProps) {
  return (
    <div role="radiogroup" aria-label="Workflow" className="grid gap-3 sm:grid-cols-2">
      {OPTIONS.map(({ id, icon: Icon, title, tagline, question, description }) => {
        const selected = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(id)}
            className={`relative flex gap-4 rounded-2xl border p-4 text-left transition-all ${
              selected
                ? 'border-white/50 bg-white/[0.09] shadow-glow'
                : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]'
            } ${value && !selected ? 'opacity-60 hover:opacity-100' : ''}`}
          >
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 transition-colors ${
                selected
                  ? 'bg-white text-black ring-white'
                  : 'bg-white/[0.06] text-white/70 ring-white/15'
              }`}
            >
              <Icon size={18} />
            </div>

            <div className="min-w-0 pr-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
                {question}
              </p>
              <p className="mt-1 text-base font-semibold text-white">{title}</p>
              <p className="text-sm text-white/70">{tagline}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/45">{description}</p>
            </div>

            <span
              className={`absolute right-4 top-4 grid h-5 w-5 place-items-center rounded-full border transition-colors ${
                selected ? 'border-white bg-white text-black' : 'border-white/25 text-transparent'
              }`}
            >
              <Check size={12} strokeWidth={3} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
