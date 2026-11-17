import { handle } from './registry'
import type { PopoutManager, PreviewService } from '../services/preview'

export interface PreviewHandlerDeps {
  preview: Pick<PreviewService, 'preview'>
  popouts: PopoutManager
}

/** 3D preview channels: the model to show for the texture open in the editor, and the pop-out window relay. */
export function registerPreviewHandlers({ preview, popouts }: PreviewHandlerDeps): void {
  handle('texture.preview', ({ packId, path }) => preview.preview(packId, path))
  handle('preview.popout.open', ({ packId, title }, event) => {
    popouts.open(packId, title, event.sender)
  })
  handle('preview.popout.close', ({ packId }, event) => {
    popouts.close(packId, event.sender)
  })
  handle('preview.popout.push', ({ packId, state }, event) =>
    popouts.push(packId, state, event.sender)
  )
  handle('preview.popout.input', ({ packId, input }, event) =>
    popouts.input(packId, input, event.sender)
  )
}
