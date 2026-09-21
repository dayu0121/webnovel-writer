import { MODEL_DIMENSIONS, type ModelDimensionPreset } from './model-dimensions'

export interface EmbeddingModelOption {
  readonly id: string
  readonly name?: string
  readonly dimensions?: readonly number[]
  readonly defaultDimension?: number
}

const normalize = (model: string) => model.trim().replace(/^models\//i, '').toLowerCase()

/** Match explicit aliases only; private forks, quantizations and new versions may differ. */
export function knownDimensions(model: string): ModelDimensionPreset | undefined {
  const id = normalize(model)
  return MODEL_DIMENSIONS.find(preset => [preset.id, ...preset.aliases].some(alias => normalize(alias) === id))
}

export function dimensionGuidance(model: string, advertised?: EmbeddingModelOption): {
  options: readonly number[]; defaultDimension?: number; source: 'api' | 'catalog' | 'unknown'; preset?: ModelDimensionPreset
} {
  const preset = knownDimensions(model)
  if (advertised?.dimensions?.length) {
    const options = [...new Set([...(advertised.defaultDimension ? [advertised.defaultDimension] : []), ...advertised.dimensions])]
    return { options, defaultDimension: advertised.defaultDimension ?? (preset && options.includes(preset.defaultDimension) ? preset.defaultDimension : undefined), source: 'api', preset }
  }
  if (advertised?.defaultDimension) return { options: [advertised.defaultDimension], defaultDimension: advertised.defaultDimension, source: 'api', preset }
  return { options: preset?.options ?? [], defaultDimension: preset?.defaultDimension, source: preset ? 'catalog' : 'unknown', preset }
}

export function shouldSendDimensions(model: string, dimensions: number | undefined): boolean {
  const preset = knownDimensions(model)
  if (!preset || preset.requestDimensions === 'supported') return true
  // Full-width open models need no optional API parameter. A user-selected other width does.
  return dimensions !== undefined && dimensions !== preset.defaultDimension
}
