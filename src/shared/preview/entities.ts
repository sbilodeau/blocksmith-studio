import type { EntityDefinition } from '../model/preview'
import { globToRegExp } from '../categories/glob'
import { EntityDefinitionSchema } from './entity-schema'
import armorStand from '../../../resources/data/entity-models/armor_stand.json'
import cat from '../../../resources/data/entity-models/cat.json'
import chicken from '../../../resources/data/entity-models/chicken.json'
import cow from '../../../resources/data/entity-models/cow.json'
import creeper from '../../../resources/data/entity-models/creeper.json'
import drowned from '../../../resources/data/entity-models/drowned.json'
import enderman from '../../../resources/data/entity-models/enderman.json'
import humanoidArmor from '../../../resources/data/entity-models/humanoid_armor.json'
import humanoidLeggings from '../../../resources/data/entity-models/humanoid_leggings.json'
import pig from '../../../resources/data/entity-models/pig.json'
import playerSlim from '../../../resources/data/entity-models/player_slim.json'
import playerWide from '../../../resources/data/entity-models/player_wide.json'
import sheep from '../../../resources/data/entity-models/sheep.json'
import sheepWool from '../../../resources/data/entity-models/sheep_wool.json'
import skeleton from '../../../resources/data/entity-models/skeleton.json'
import skeletonOverlay from '../../../resources/data/entity-models/skeleton_overlay.json'
import spider from '../../../resources/data/entity-models/spider.json'
import villager from '../../../resources/data/entity-models/villager.json'
import wolf from '../../../resources/data/entity-models/wolf.json'
import zombie from '../../../resources/data/entity-models/zombie.json'

/**
 * Built-in entity geometry definitions (resources/data/entity-models/*.json), authored for Blocksmith Studio
 * under MIT. Format and conventions: docs/entity-models.md.
 *
 * The JSON files are imported statically (not with import.meta.glob) so the same module works unchanged in the
 * main process, the renderer, Vitest and tsc. A unit test checks that every file of the folder is listed here.
 */
const RAW_DEFINITIONS: Record<string, unknown> = {
  'armor_stand.json': armorStand,
  'cat.json': cat,
  'chicken.json': chicken,
  'cow.json': cow,
  'creeper.json': creeper,
  'drowned.json': drowned,
  'enderman.json': enderman,
  'humanoid_armor.json': humanoidArmor,
  'humanoid_leggings.json': humanoidLeggings,
  'pig.json': pig,
  'player_slim.json': playerSlim,
  'player_wide.json': playerWide,
  'sheep.json': sheep,
  'sheep_wool.json': sheepWool,
  'skeleton.json': skeleton,
  'skeleton_overlay.json': skeletonOverlay,
  'spider.json': spider,
  'villager.json': villager,
  'wolf.json': wolf,
  'zombie.json': zombie
}

interface CompiledDefinition {
  definition: EntityDefinition
  patterns: RegExp[]
}

let compiled: CompiledDefinition[] | undefined

/** Validates every file once (throws with the file name on a malformed definition). */
function load(): CompiledDefinition[] {
  if (compiled) return compiled
  const ids = new Set<string>()
  compiled = Object.entries(RAW_DEFINITIONS).map(([file, raw]) => {
    const result = EntityDefinitionSchema.safeParse(raw)
    if (!result.success) {
      throw new Error(`Invalid entity model ${file}: ${result.error.message}`)
    }
    const definition = result.data
    if (file !== `${definition.id}.json`) {
      throw new Error(`Entity model ${file} must be named after its id "${definition.id}"`)
    }
    if (ids.has(definition.id)) throw new Error(`Duplicate entity model id "${definition.id}"`)
    ids.add(definition.id)
    return { definition, patterns: definition.textures.map(globToRegExp) }
  })
  return compiled
}

/** All built-in definitions, sorted by id. */
export function entityDefinitions(): EntityDefinition[] {
  return load().map((c) => c.definition)
}

/** First definition whose `textures` globs match the pack path, if any. */
export function findEntityDefinition(packPath: string): EntityDefinition | undefined {
  const path = packPath.replace(/\\/g, '/')
  return load().find((c) => c.patterns.some((p) => p.test(path)))?.definition
}
