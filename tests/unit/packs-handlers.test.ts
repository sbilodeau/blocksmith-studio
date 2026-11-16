import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackService } from '../../src/main/services/packs'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn)
}))

const { registerPackHandlers } = await import('../../src/main/ipc/pack-handlers')

function fakeService(): PackService {
  return {
    workspaceRoot: vi.fn(() => '/ws'),
    packsDir: vi.fn(() => '/ws/packs'),
    setWorkspace: vi.fn(async (p: string) => p),
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 'new' }) as never),
    get: vi.fn(async () => ({ id: 'p' }) as never),
    locate: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined),
    textures: vi.fn(async () => []),
    categories: vi.fn(async () => []),
    importZip: vi.fn(async () => ({ filesImported: 1 }) as never),
    exportFileName: vi.fn(async () => 'p-26.3.zip'),
    exportPack: vi.fn(async () => ({ filesWritten: 2 }) as never),
    updateMeta: vi.fn(async () => ({}) as never),
    catalog: vi.fn(async () => []),
    exportMany: vi.fn(async () => []),
    saveExportProfile: vi.fn(async () => undefined),
    upgrade: vi.fn(async () => ({}) as never),
    doctor: vi.fn(async () => ({ issues: [], targets: [], files: 0 }))
  }
}

describe('registerPackHandlers', () => {
  let packs: PackService
  const dialogs = {
    chooseFolder: vi.fn(async (): Promise<string | null> => '/chosen'),
    openZip: vi.fn(async (): Promise<string | null> => '/a.zip'),
    saveZip: vi.fn(async (): Promise<string | null> => '/out.zip')
  }

  beforeEach(() => {
    handlers.clear()
    packs = fakeService()
    registerPackHandlers({ packs, dialogs })
  })

  it('registers every pack channel', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'workspace.get',
        'workspace.choose',
        'packs.list',
        'packs.create',
        'packs.import',
        'packs.delete',
        'packs.reveal',
        'pack.get',
        'pack.textures',
        'pack.categories',
        'pack.export',
        'pack.exportMany',
        'pack.upgrade',
        'pack.doctor'
      ].sort()
    )
  })

  it('workspace.get / workspace.choose', async () => {
    expect(await handlers.get('workspace.get')!(undefined)).toEqual({ path: '/ws' })
    expect(await handlers.get('workspace.choose')!(undefined)).toEqual({ path: '/chosen' })
    expect(dialogs.chooseFolder).toHaveBeenCalledWith('/ws')
    expect(packs.setWorkspace).toHaveBeenCalledWith('/chosen')
    dialogs.chooseFolder.mockResolvedValueOnce(null)
    expect(await handlers.get('workspace.choose')!(undefined)).toBeNull()
  })

  it('packs.import opens a zip picker and returns null when cancelled', async () => {
    expect(await handlers.get('packs.import')!(undefined)).toEqual({ filesImported: 1 })
    expect(packs.importZip).toHaveBeenCalledWith('/a.zip')
    dialogs.openZip.mockResolvedValueOnce(null)
    expect(await handlers.get('packs.import')!(undefined)).toBeNull()
  })

  it('pack.export validates the target, then asks where to save', async () => {
    const input = { packId: 'p', targetVersion: '26.3' }
    expect(await handlers.get('pack.export')!(input)).toEqual({ filesWritten: 2 })
    expect(dialogs.saveZip).toHaveBeenCalledWith('p-26.3.zip')
    expect(packs.exportPack).toHaveBeenCalledWith('p', '26.3', '/out.zip', {
      acceptNewer: undefined
    })

    await handlers.get('pack.export')!({ ...input, packType: 'data' })
    expect(packs.exportFileName).toHaveBeenLastCalledWith('p', '26.3', 'data')
    expect(packs.exportPack).toHaveBeenLastCalledWith('p', '26.3', '/out.zip', {
      acceptNewer: undefined,
      packType: 'data'
    })

    dialogs.saveZip.mockResolvedValueOnce(null)
    expect(await handlers.get('pack.export')!(input)).toBeNull()

    vi.mocked(packs.exportFileName).mockRejectedValueOnce(new Error('export.targetNotSupported'))
    dialogs.saveZip.mockClear()
    await expect(handlers.get('pack.export')!(input)).rejects.toThrow()
    expect(dialogs.saveZip).not.toHaveBeenCalled()
  })

  it('pack.exportMany validates, asks for a folder, exports and remembers the profile', async () => {
    const input = { packId: 'p', targetVersions: ['26.3', '1.21.4'], acceptNewer: true }
    dialogs.chooseFolder.mockResolvedValueOnce('/out')
    await handlers.get('pack.exportMany')!(input)
    expect(packs.exportFileName).toHaveBeenCalledWith('p', '1.21.4', undefined)
    expect(packs.exportMany).toHaveBeenCalledWith('p', ['26.3', '1.21.4'], '/out', {
      acceptNewer: true,
      packType: undefined
    })
    expect(packs.saveExportProfile).toHaveBeenCalledWith('p', {
      targets: ['26.3', '1.21.4'],
      acceptNewer: true
    })
    dialogs.chooseFolder.mockResolvedValueOnce(null)
    expect(await handlers.get('pack.exportMany')!(input)).toBeNull()
  })

  it('forwards the simple pack channels', async () => {
    await handlers.get('packs.list')!(undefined)
    await handlers.get('packs.create')!({ name: 'n', base: 'empty', authoringVersion: '26.3' })
    await handlers.get('packs.delete')!({ packId: 'p' })
    await handlers.get('packs.reveal')!({ packId: 'p' })
    await handlers.get('pack.get')!({ packId: 'p' })
    await handlers.get('pack.textures')!({ packId: 'p' })
    await handlers.get('pack.categories')!({ packId: 'p' })
    expect(packs.list).toHaveBeenCalled()
    expect(packs.create).toHaveBeenCalledWith({
      name: 'n',
      base: 'empty',
      authoringVersion: '26.3'
    })
    expect(packs.delete).toHaveBeenCalledWith('p')
    expect(packs.reveal).toHaveBeenCalledWith('p')
    expect(packs.get).toHaveBeenCalledWith('p')
    expect(packs.textures).toHaveBeenCalledWith('p')
    expect(packs.categories).toHaveBeenCalledWith('p')
  })
})
