import type { RgbaImage } from '@shared/image'
import type { EditorStore } from '../../stores/editor'

/** A pixel of the texture, in strip coordinates (every frame of an animated texture stacked). */
export interface StripPixel {
  x: number
  y: number
}

/**
 * What the 3D preview shows and where its input goes (M11). The docked preview reads the editor store directly;
 * the pop-out window gets the same state relayed through main and sends its input back.
 */
export interface PreviewSource {
  readonly packId: string
  /** Texture open in the editor, null when none. */
  readonly path: string | null
  /** The whole texture (the composite when the editor has layers). */
  readonly strip: RgbaImage | null
  readonly mcmeta: string | null
  /** Changes whenever the pixels change. */
  readonly revision: number
  /** Frame shown while an animation is being edited; null: the preview plays the animation. */
  readonly editingFrame: number | null
  /** Pixel hovered in the 2D canvas, highlighted on the model. */
  readonly hover2d: StripPixel | null
  /** The pixel hovered on the model (null when the pointer leaves it). */
  setHover3d(pixel: StripPixel | null): void
  /** Painting on the model with the editor's current tool (strip coordinates). */
  paintStart(pixel: StripPixel, secondary: boolean): void
  paintMove(pixel: StripPixel, connect: boolean): void
  paintEnd(): void
}

/** The docked preview's source: the pack tab's editor store. */
export function editorPreviewSource(editor: () => EditorStore): PreviewSource {
  return {
    get packId() {
      return editor().packId
    },
    get path() {
      return editor().path
    },
    get strip() {
      return editor().strip
    },
    get mcmeta() {
      return editor().mcmeta
    },
    get revision() {
      return editor().revision
    },
    get editingFrame() {
      const ed = editor()
      return ed.frames && !ed.playing ? ed.frameIndex : null
    },
    get hover2d() {
      const h = editor().linkedHover
      return h?.source === '2d' ? { x: h.x, y: h.y } : null
    },
    setHover3d(pixel) {
      const ed = editor()
      const current = ed.linkedHover
      if (!pixel) {
        if (current?.source === '3d') ed.linkedHover = null
        return
      }
      if (current?.source === '3d' && current.x === pixel.x && current.y === pixel.y) return
      ed.linkedHover = { ...pixel, source: '3d' }
    },
    paintStart(pixel, secondary) {
      editor().paintStart(pixel.x, pixel.y, secondary)
    },
    paintMove(pixel, connect) {
      editor().paintMove(pixel.x, pixel.y, connect)
    },
    paintEnd() {
      editor().paintEnd()
    }
  }
}
