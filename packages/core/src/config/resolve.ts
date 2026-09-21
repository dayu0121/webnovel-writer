/**
 * 插件配置服务·最小解析(D50 四层作用域的前两层:默认插件→作者 profile)。
 * 整项覆盖、不做字段级合并;每项生效值可判来源。
 */

export interface Layer {
  readonly name: string
  readonly values: Readonly<Record<string, unknown>>
}

export interface ResolvedItem<T = unknown> {
  readonly key: string
  readonly value: T
  readonly fromLayer: string
}

/** 整项覆盖式解析:后者整项覆盖前者,绝不做字段级合并(D50)。 */
export function resolveLayers(layers: readonly Layer[]): ReadonlyArray<ResolvedItem> {
  const out = new Map<string, ResolvedItem>()
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values)) {
      out.set(key, { key, value, fromLayer: layer.name })
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh-Hans-CN'))
}
