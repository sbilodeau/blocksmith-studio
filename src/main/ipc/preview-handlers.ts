import { handle } from './registry'
import type { PreviewService } from '../services/preview'

export interface PreviewHandlerDeps {
  preview: Pick<PreviewService, 'preview'>
}

/** 3D preview channel: the model to show for the texture open in the editor. */
export function registerPreviewHandlers({ preview }: PreviewHandlerDeps): void {
  handle('texture.preview', ({ packId, path }) => preview.preview(packId, path))
}
