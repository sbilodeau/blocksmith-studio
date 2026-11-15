import { handle } from './registry'
import type { PackService } from '../services/packs'

/** Native dialogs, injected so the handlers stay testable (wrap Electron's `dialog` in main). */
export interface PackDialogs {
  /** Folder picker for the workspace; resolves the absolute path or null when cancelled. */
  chooseFolder(defaultPath: string): Promise<string | null>
  /** Open dialog filtered on .zip; null when cancelled. */
  openZip(): Promise<string | null>
  /** Save dialog for a .zip with a default file name; null when cancelled. */
  saveZip(defaultFileName: string): Promise<string | null>
}

export interface PackHandlerDeps {
  packs: PackService
  dialogs: PackDialogs
}

export function registerPackHandlers({ packs, dialogs }: PackHandlerDeps): void {
  handle('workspace.get', () => ({ path: packs.workspaceRoot() }))

  handle('workspace.choose', async () => {
    const chosen = await dialogs.chooseFolder(packs.workspaceRoot())
    if (!chosen) return null
    return { path: await packs.setWorkspace(chosen) }
  })

  handle('packs.list', () => packs.list())
  handle('packs.create', (input) => packs.create(input))

  handle('packs.import', async () => {
    const zipPath = await dialogs.openZip()
    if (!zipPath) return null
    return packs.importZip(zipPath)
  })

  handle('packs.delete', ({ packId }) => packs.delete(packId))
  handle('packs.reveal', ({ packId }) => packs.reveal(packId))

  handle('pack.get', ({ packId }) => packs.get(packId))
  handle('pack.textures', ({ packId }) => packs.textures(packId))
  handle('pack.categories', ({ packId }) => packs.categories(packId))

  handle('pack.export', async ({ packId, targetVersion }) => {
    // Validates the target before showing the dialog.
    const fileName = await packs.exportFileName(packId, targetVersion)
    const outputPath = await dialogs.saveZip(fileName)
    if (!outputPath) return null
    return packs.exportPack(packId, targetVersion, outputPath)
  })
}
