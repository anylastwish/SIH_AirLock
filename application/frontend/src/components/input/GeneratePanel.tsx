import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { OPTIONAL_INPUTS, REQUIRED_INPUTS } from '../../lib/surveyInputs'
import type { SurveyFiles, SurveyInputId } from '../../lib/surveyInputs'
import UploadCard from './UploadCard'

interface GeneratePanelProps {
  files: SurveyFiles
  onSelect: (id: SurveyInputId, file: File) => void
  onRemove: (id: SurveyInputId) => void
}

export default function GeneratePanel({ files, onSelect, onRemove }: GeneratePanelProps) {
  const [optionalOpen, setOptionalOpen] = useState(false)
  const optionalCount = OPTIONAL_INPUTS.filter((i) => files[i.id]).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white">Survey Inputs</h2>
        <p className="mt-1 text-xs text-white/45">
          Provide the drone survey data to reconstruct into a georeferenced 3D model.
        </p>
      </div>

      <div className="space-y-2.5">
        {REQUIRED_INPUTS.map((spec) => (
          <UploadCard
            key={spec.id}
            spec={spec}
            file={files[spec.id]}
            onSelect={(file) => onSelect(spec.id, file)}
            onRemove={() => onRemove(spec.id)}
          />
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.015]">
        <button
          type="button"
          onClick={() => setOptionalOpen((open) => !open)}
          aria-expanded={optionalOpen}
          aria-controls="optional-data"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span>
            <span className="text-sm font-medium text-white/70">Optional Data</span>
            <span className="ml-2 text-xs text-white/35">
              {optionalCount > 0
                ? `${optionalCount} of ${OPTIONAL_INPUTS.length} added`
                : 'Improves accuracy when available'}
            </span>
          </span>
          <ChevronDown
            size={16}
            className={`text-white/40 transition-transform ${optionalOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <div
          id="optional-data"
          className={`grid transition-[grid-template-rows] duration-300 ${
            optionalOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-2.5 px-3 pb-3">
              {OPTIONAL_INPUTS.map((spec) => (
                <UploadCard
                  key={spec.id}
                  spec={spec}
                  file={files[spec.id]}
                  onSelect={(file) => onSelect(spec.id, file)}
                  onRemove={() => onRemove(spec.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
