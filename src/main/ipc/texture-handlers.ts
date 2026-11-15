import { handle } from './registry'
import type { HistoryService } from '../services/history'
import type { TextureEditService } from '../services/packs'

export interface TextureHandlerDeps {
  textures: TextureEditService
  history: Pick<HistoryService, 'get' | 'undo' | 'redo'>
}

/** Texture editing and pack history channels. */
export function registerTextureHandlers({ textures, history }: TextureHandlerDeps): void {
  handle('texture.read', ({ packId, path }) => textures.read(packId, path))
  handle('texture.save', ({ packId, path, png }) => textures.save(packId, path, png))
  handle('texture.revert', ({ packId, path }) => textures.revert(packId, path))

  handle('history.get', ({ packId }) => history.get(packId))
  handle('history.undo', ({ packId }) => history.undo(packId))
  handle('history.redo', ({ packId }) => history.redo(packId))
}
