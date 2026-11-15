import type { EntityDefinition } from '../model/preview'

/**
 * Built-in entity geometry definitions (resources/data/entity-models/*.json), authored for Blocksmith Studio
 * under MIT. CONTRACT STUB: implemented in the entity-definitions work stream (M2b).
 */
export function entityDefinitions(): EntityDefinition[] {
  return []
}

/** First definition whose `textures` globs match the pack path, if any. */
export function findEntityDefinition(packPath: string): EntityDefinition | undefined {
  return entityDefinitions().find((d) => d.textures.includes(packPath))
}
