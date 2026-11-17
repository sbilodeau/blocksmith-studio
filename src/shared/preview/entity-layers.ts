import { z } from 'zod'
import { globToRegExp } from '../categories/glob'
import raw from '../../../resources/data/entity-layers.json'

/**
 * Which model layer of the Minecraft jar each entity texture is drawn on (resources/data/entity-layers.json,
 * names only, hand-maintained). The geometry itself is read from the user's jar (PLAN M3b).
 */
export const EntityLayerTableSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  /** Block entity layers drawn without the entity flip (chests, bells, pots): turned upright by the preview. */
  upright: z.array(z.string().regex(/^[a-z0-9_/]+#[a-z0-9_]+$/)).default([]),
  entries: z
    .array(
      z.strictObject({
        textures: z.array(z.string().startsWith('assets/')).min(1),
        layer: z.string().regex(/^[a-z0-9_/]+#[a-z0-9_]+$/)
      })
    )
    .min(1)
})

export type EntityLayerTable = z.infer<typeof EntityLayerTableSchema>

let compiled: Array<{ layer: string; patterns: RegExp[] }> | null = null

function load(): Array<{ layer: string; patterns: RegExp[] }> {
  if (!compiled) {
    const table = EntityLayerTableSchema.parse(raw)
    compiled = table.entries.map((e) => ({
      layer: e.layer,
      patterns: e.textures.map(globToRegExp)
    }))
  }
  return compiled
}

export function entityLayerTable(): EntityLayerTable {
  return EntityLayerTableSchema.parse(raw)
}

/** The jar layer a texture is drawn on (`axolotl_baby#main`), or undefined when the table has no entry. */
export function findEntityLayer(packPath: string): string | undefined {
  const path = packPath.replace(/\\/g, '/')
  return load().find((e) => e.patterns.some((p) => p.test(path)))?.layer
}

let upright: Set<string> | null = null

/** Whether the preview must turn this jar layer upright (a block entity drawn without the entity flip). */
export function isUprightLayer(layer: string): boolean {
  upright ??= new Set(EntityLayerTableSchema.parse(raw).upright)
  return upright.has(layer)
}
