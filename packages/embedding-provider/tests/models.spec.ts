import { describe, expect, it } from 'vitest'
import { MODEL_DIMENSIONS } from '../src/model-dimensions'
import { dimensionGuidance, knownDimensions, shouldSendDimensions } from '../src/models'

describe('常用模型维度表', () => {
  it('名称唯一、维度合法，每项有来源和核对日期', () => {
    const names = new Set<string>()
    for (const model of MODEL_DIMENSIONS) {
      for (const name of [model.id, ...model.aliases]) {
        expect(names.has(name.toLowerCase()), name).toBe(false); names.add(name.toLowerCase())
      }
      expect(model.options).toContain(model.defaultDimension)
      expect(new Set(model.options).size).toBe(model.options.length)
      for (const value of model.options) {
        expect(Number.isInteger(value) && value > 0 && value <= 65_536).toBe(true)
        if (model.range) { expect(value).toBeGreaterThanOrEqual(model.range[0]); expect(value).toBeLessThanOrEqual(model.range[1]) }
      }
      if (model.kind === 'fixed') expect(model.options).toEqual([model.defaultDimension])
      expect(new URL(model.source.url).protocol).toBe('https:')
      expect(model.source.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  it('识别明确别名，不猜测微调和新版本', () => {
    expect(knownDimensions(' qwen/qwen3-embedding-4b ')?.defaultDimension).toBe(2560)
    expect(knownDimensions('Qwen3-Embedding-8B')?.defaultDimension).toBe(4096)
    expect(knownDimensions('models/gemini-embedding-001')?.defaultDimension).toBe(3072)
    for (const id of ['my-org/Qwen3-Embedding-8B', 'Qwen/Qwen3-Embedding-8B-GGUF', 'jina-embeddings-v30', 'text-embedding-3-small-custom', '']) expect(knownDimensions(id)).toBeUndefined()
  })
  it('接口覆盖表，缺少默认值时不猜接口列表外的值', () => {
    expect(dimensionGuidance('Qwen3-Embedding-8B', { id: 'Qwen3-Embedding-8B', dimensions: [1024, 512], defaultDimension: 512 })).toMatchObject({ source: 'api', defaultDimension: 512, options: [512, 1024] })
    expect(dimensionGuidance('Qwen3-Embedding-8B', { id: 'Qwen3-Embedding-8B', dimensions: [1024, 512] }).defaultDimension).toBeUndefined()
    expect(dimensionGuidance('Qwen3-Embedding-8B', { id: 'Qwen3-Embedding-8B', defaultDimension: 2048 })).toMatchObject({ source: 'api', defaultDimension: 2048, options: [2048] })
  })
  it('元数据缺席用表，未知模型留空', () => {
    expect(dimensionGuidance('bge-m3', { id: 'bge-m3' })).toMatchObject({ source: 'catalog', defaultDimension: 1024, options: [1024] })
    expect(dimensionGuidance('private-model')).toMatchObject({ source: 'unknown', defaultDimension: undefined, options: [] })
  })
  it('模型支持缩短不代表托管服务默认接受参数', () => {
    expect(shouldSendDimensions('Qwen3-Embedding-8B', 4096)).toBe(false)
    expect(shouldSendDimensions('Qwen3-Embedding-8B', 1024)).toBe(true)
    expect(shouldSendDimensions('bge-m3', 1024)).toBe(false)
    expect(shouldSendDimensions('text-embedding-3-large', 3072)).toBe(true)
    expect(shouldSendDimensions('text-embedding-ada-002', 1536)).toBe(false)
  })
})
