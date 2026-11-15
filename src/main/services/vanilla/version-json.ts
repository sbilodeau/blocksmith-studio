import type { PackFormat } from '@shared/model/versions'

export interface JarVersionInfo {
  id: string
  resourcePack: PackFormat
  dataPack: PackFormat
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Parses a client jar's version.json. `pack_version` has two shapes (verified on real jars):
 * - up to 1.21.8:       `{ "resource": 46, "data": 61 }`
 * - since 1.21.9 (25w31a): `{ "resource_major": 97, "resource_minor": 1, "data_major": 121, "data_minor": 0 }`
 * Returns null when the content is not recognized.
 */
export function parseJarVersionJson(value: unknown): JarVersionInfo | null {
  if (!value || typeof value !== 'object') return null
  const json = value as { id?: unknown; pack_version?: unknown }
  if (typeof json.id !== 'string') return null
  const pv = json.pack_version as Record<string, unknown> | undefined
  if (!pv || typeof pv !== 'object') return null
  if (isInt(pv['resource_major']) && isInt(pv['data_major'])) {
    return {
      id: json.id,
      resourcePack: {
        major: pv['resource_major'],
        minor: isInt(pv['resource_minor']) ? pv['resource_minor'] : 0
      },
      dataPack: { major: pv['data_major'], minor: isInt(pv['data_minor']) ? pv['data_minor'] : 0 }
    }
  }
  if (isInt(pv['resource']) && isInt(pv['data'])) {
    return {
      id: json.id,
      resourcePack: { major: pv['resource'], minor: 0 },
      dataPack: { major: pv['data'], minor: 0 }
    }
  }
  return null
}
