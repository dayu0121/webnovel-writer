/* @webnovel/drafting —— 行为规格见 docs/book-format.md(单一真源);本包只放实现 */
export const pkg = '@webnovel/drafting'

export { loadDraftContext, type DraftContext } from './context'
export {
  importAuthorDraft,
  listDrafts,
  selectDraft,
  writeDraft,
  type DraftInfo,
  type ImportAuthorDraftInput,
  type ImportAuthorDraftResult,
  type WriteDraftInput,
  type WriteDraftResult,
} from './write'
