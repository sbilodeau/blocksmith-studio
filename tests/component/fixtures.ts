import type { CategorySummary, PackSummary, TextureEntry, TextureStatus } from '@shared/model/pack'
import type { VanillaAvailability } from '@shared/model/vanilla'

export function pack(overrides: Partial<PackSummary> = {}): PackSummary {
  return {
    id: 'fire',
    name: 'Fire pack',
    description: 'Everything burns',
    authoringVersion: '26.3',
    base: 'vanilla',
    folder: '/ws/packs/fire-pack',
    changedCount: 3,
    updatedAt: '2026-11-15T12:00:00.000Z',
    ...overrides
  }
}

export function texture(path: string, status: TextureStatus, categories: string[]): TextureEntry {
  const parts = path.split('/')
  const file = parts[parts.length - 1]
  return {
    path,
    namespace: 'minecraft',
    folder: parts.slice(3, -1).join('/'),
    name: file.replace(/\.png$/, ''),
    width: 16,
    height: 16,
    animated: false,
    status,
    categories,
    url: `bs-asset://pack/fire/${path}`
  }
}

export const TEXTURES: TextureEntry[] = [
  texture('assets/minecraft/textures/block/stone.png', 'modified', ['blocks']),
  texture('assets/minecraft/textures/block/dirt.png', 'vanilla', ['blocks']),
  texture('assets/minecraft/textures/block/diamond_ore.png', 'vanilla', ['blocks', 'ores']),
  texture('assets/minecraft/textures/item/diamond_sword.png', 'added', ['weapons']),
  texture('assets/minecraft/textures/item/iron_pickaxe.png', 'vanilla', ['tools'])
]

export const CATEGORIES: CategorySummary[] = [
  { id: 'blocks', i18nKey: 'category.blocks', count: 3, changedCount: 1 },
  { id: 'ores', i18nKey: 'category.ores', count: 1, changedCount: 0 },
  { id: 'tools', i18nKey: 'category.tools', count: 1, changedCount: 0 },
  { id: 'weapons', i18nKey: 'category.weapons', count: 1, changedCount: 1 }
]

export const VERSIONS: VanillaAvailability[] = [
  { versionId: '26.3', releaseTime: '2026-09-15', state: 'ready', isLatest: true },
  {
    versionId: '26.2',
    releaseTime: '2026-06-16',
    state: 'local',
    isLatest: false,
    jarPath: '/mc/26.2.jar'
  },
  { versionId: '1.21.4', releaseTime: '2024-12-03', state: 'downloadable', isLatest: false }
]
