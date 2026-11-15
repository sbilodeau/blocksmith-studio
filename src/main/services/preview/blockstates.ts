import { normalizeResourceId } from './models'

/** One model reference of a blockstate file. */
export interface BlockstateModelRef {
  /** Normalized model id, e.g. "minecraft:block/oak_log". */
  model: string
  /** True when the variant rotates the model (x or y not 0). The preview does not apply these rotations. */
  rotated: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refsOf(value: unknown, out: BlockstateModelRef[]): void {
  const list = Array.isArray(value) ? value : [value]
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry['model'] !== 'string' || entry['model'] === '') continue
    const x = typeof entry['x'] === 'number' ? entry['x'] : 0
    const y = typeof entry['y'] === 'number' ? entry['y'] : 0
    out.push({
      model: normalizeResourceId(entry['model']),
      rotated: x % 360 !== 0 || y % 360 !== 0
    })
  }
}

/**
 * Every model a blockstate file references, in file order: each `variants` entry (weighted arrays flattened) or
 * each `multipart` `apply`. Invalid content yields an empty list.
 */
export function blockstateModels(json: unknown): BlockstateModelRef[] {
  const out: BlockstateModelRef[] = []
  if (!isRecord(json)) return out
  const variants = json['variants']
  if (isRecord(variants)) {
    for (const value of Object.values(variants)) refsOf(value, out)
  }
  const multipart = json['multipart']
  if (Array.isArray(multipart)) {
    for (const part of multipart) if (isRecord(part)) refsOf(part['apply'], out)
  }
  return out
}
