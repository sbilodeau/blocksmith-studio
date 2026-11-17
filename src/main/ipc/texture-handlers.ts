import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { handle } from './registry'
import type { HistoryService } from '../services/history'
import type { TextureEditService } from '../services/packs'
import { decodeGif, gifToStrip, GifErrorCode, MAX_GIF_BYTES } from '../services/packs/gif'
import { AppErrorException } from './registry'

export interface TextureHandlerDeps {
  textures: TextureEditService
  history: Pick<HistoryService, 'get' | 'undo' | 'redo'>
  /** Native open dialog for a .gif (null when cancelled). */
  openGif: () => Promise<string | null>
}

/** Texture editing and pack history channels. */
export function registerTextureHandlers({ textures, history, openGif }: TextureHandlerDeps): void {
  handle('texture.read', ({ packId, path }) => textures.read(packId, path))
  handle('texture.save', ({ packId, path, png, mcmeta, layers }) =>
    textures.save(packId, path, png, mcmeta, layers)
  )
  handle('texture.revert', ({ packId, path }) => textures.revert(packId, path))
  handle('texture.importGif', async ({ frameWidth, frameHeight }) => {
    const file = await openGif()
    if (!file) return null
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(file))
    } catch {
      throw new AppErrorException(GifErrorCode.invalid)
    }
    if (bytes.byteLength > MAX_GIF_BYTES) throw new AppErrorException(GifErrorCode.invalid)
    const strip = gifToStrip(decodeGif(bytes), frameWidth, frameHeight)
    return { name: basename(file), ...strip }
  })

  handle('history.get', ({ packId }) => history.get(packId))
  handle('history.undo', ({ packId }) => history.undo(packId))
  handle('history.redo', ({ packId }) => history.redo(packId))
}
