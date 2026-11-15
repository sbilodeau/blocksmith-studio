export type PreviewCategory = 'entity' | 'item' | 'block' | 'flat'

/** Preview kind decided by the texture folder: textures/entity, textures/item, textures/block, else flat. */
export function previewCategory(path: string): PreviewCategory {
  const m = /^assets\/[^/]+\/textures\/(entity|item|block)\//.exec(path)
  return m ? (m[1] as PreviewCategory) : 'flat'
}
