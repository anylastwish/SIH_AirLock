import type { ModelFormat } from './formats'

/**
 * Hand-off between the Input Page and the Main Application.
 *
 * The Input Page decides *what* to show (an uploaded model, or the temporary
 * pre-made reconstruction) and stores it here; the Main Application reads it
 * on mount. Keeping this behind two functions means the backend integration
 * can later replace it with "fetch the asset for job/session X" without the
 * Main Application caring where the model came from.
 */

/**
 * Temporary stand-in for a reconstruction result. Drop the pre-made GLB at
 * `public/models/survey-reconstruction.glb` (served at this URL).
 */
export const PREMADE_MODEL_URL = '/models/survey-reconstruction.glb'

export interface ActiveModel {
  /** `generated` = output of the Generate Model flow, `uploaded` = Visualizer flow. */
  origin: 'generated' | 'uploaded'
  format: ModelFormat
  name: string
  /** URL of the primary asset (public path or blob: URL). */
  url: string
  /**
   * Companion files (buffers, textures, materials) keyed by lower-case file
   * name, so relative references inside the model can be resolved to blob URLs.
   */
  assets: Record<string, string>
}

let activeModel: ActiveModel | null = null

function revoke(model: ActiveModel | null) {
  if (!model) return
  if (model.origin === 'uploaded') URL.revokeObjectURL(model.url)
  Object.values(model.assets).forEach((url) => URL.revokeObjectURL(url))
}

export function setActiveModel(model: ActiveModel | null) {
  revoke(activeModel)
  activeModel = model
}

export function getActiveModel(): ActiveModel | null {
  return activeModel
}

/** Session model for the Generate Model flow (prototype: the pre-made GLB). */
export function premadeReconstruction(): ActiveModel {
  return {
    origin: 'generated',
    format: 'glb',
    name: 'Survey reconstruction',
    url: PREMADE_MODEL_URL,
    assets: {},
  }
}

/** Session model for an uploaded file set; blob URLs live until replaced. */
export function uploadedModel(primary: File, format: ModelFormat, companions: File[]): ActiveModel {
  return {
    origin: 'uploaded',
    format,
    name: primary.name,
    url: URL.createObjectURL(primary),
    assets: Object.fromEntries(
      companions.map((file) => [file.name.toLowerCase(), URL.createObjectURL(file)]),
    ),
  }
}
