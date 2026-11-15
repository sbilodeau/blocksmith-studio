import { defineStore, getActivePinia } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  applyPatch,
  clampRect,
  clearRect,
  cloneImage,
  cropImage,
  decodePng,
  diffImages,
  encodePng,
  flipImage,
  imagesEqual,
  pasteImage,
  rotateImage,
  toHex,
  type FlipAxis,
  type Patch,
  type Rect,
  type RgbaImage,
  type Rgba,
  type RotateDirection
} from '@shared/image'
import type { TextureEntry } from '@shared/model/pack'
import type { HistoryState } from '@shared/model/history'
import { call } from '../services/ipc'

export type EditorTool = 'pencil' | 'eraser' | 'bucket' | 'eyedropper' | 'line' | 'rect' | 'select'

export const TRANSPARENT: Rgba = [0, 0, 0, 0]

/** One local (unsaved) edit, undoable in the editor. */
export interface LocalEdit {
  patch: Patch
  /** i18n key under editor.edit.* */
  label: string
  /** Set when the edit changed the image size (rotate on non-square); undo restores the whole image. */
  resize?: { before: RgbaImage; after: RgbaImage }
}

/** A lifted selection being moved or pasted, not yet written into the image. */
export interface FloatingSelection {
  image: RgbaImage
  x: number
  y: number
}

const MAX_RECENT = 16
const MAX_UNDO = 500

/** Clipboard shared by every editor in the window (copy in one pack, paste in another). */
const clipboard = shallowRef<RgbaImage | null>(null)

/**
 * Pixel editor state for one pack tab (`editor/<packId>`). The editor persists while the tab is open, even when the
 * user goes back to the grid and opens another texture.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useEditorStore(packId: string) {
  return defineStore(`editor/${packId}`, () => {
    const path = ref<string | null>(null)
    const entry = ref<TextureEntry | null>(null)
    /** Image as last saved (or loaded). */
    const saved = shallowRef<RgbaImage | null>(null)
    /** Working image, mutated in place; `revision` changes whenever its pixels change. */
    const image = shallowRef<RgbaImage | null>(null)
    const vanilla = shallowRef<RgbaImage | null>(null)
    const mcmeta = ref<string | null>(null)
    const origin = ref<'pack' | 'vanilla' | 'none'>('none')
    const revision = ref(0)
    const loading = ref(false)
    const saving = ref(false)

    const undoStack = shallowRef<LocalEdit[]>([])
    const redoStack = shallowRef<LocalEdit[]>([])

    const tool = ref<EditorTool>('pencil')
    const primary = ref<Rgba>([0, 0, 0, 255])
    const secondary = ref<Rgba>(TRANSPARENT)
    const fillShapes = ref(false)
    const bucketTolerance = ref(0)
    const bucketContiguous = ref(true)
    const mirrorX = ref(false)
    const mirrorY = ref(false)
    const showGrid = ref(true)
    const zoom = ref(0) // 0 = fit on next render
    const recentColors = ref<string[]>([])

    const selection = ref<Rect | null>(null)
    const floating = shallowRef<FloatingSelection | null>(null)
    /** Image before the floating selection was lifted/pasted (committed as one edit on drop). */
    let floatingBefore: RgbaImage | null = null

    /** Side-by-side compare with vanilla; `peekVanilla` shows vanilla in place while a key is held. */
    const compare = ref(false)
    const peekVanilla = ref(false)

    const packHistory = ref<HistoryState | null>(null)

    const dirty = computed(() => {
      void revision.value
      const img = image.value
      const base = saved.value
      if (!img || !base) return false
      if (floating.value) return true
      return img.width !== base.width || img.height !== base.height || !imagesEqual(img, base)
    })
    const canUndo = computed(() => undoStack.value.length > 0)
    const canRedo = computed(() => redoStack.value.length > 0)

    /** Frame height for animated strips (height multiple of width), else null. */
    const frameSize = computed(() => {
      const img = image.value
      if (!img || !(entry.value?.animated || mcmeta.value?.includes('animation'))) return null
      return img.height > img.width && img.height % img.width === 0 ? img.width : null
    })

    function touch(): void {
      revision.value++
    }

    async function open(texture: TextureEntry): Promise<void> {
      loading.value = true
      try {
        const data = await call('texture.read', { packId, path: texture.path })
        path.value = texture.path
        entry.value = texture
        origin.value = data.origin
        mcmeta.value = data.mcmeta
        const img = data.png ? decodePng(data.png) : null
        saved.value = img ? cloneImage(img) : null
        image.value = img
        vanilla.value = data.vanillaPng ? decodePng(data.vanillaPng) : null
        undoStack.value = []
        redoStack.value = []
        selection.value = null
        floating.value = null
        zoom.value = 0
        touch()
      } finally {
        loading.value = false
      }
    }

    function close(): void {
      path.value = null
      entry.value = null
      image.value = null
      saved.value = null
      vanilla.value = null
      undoStack.value = []
      redoStack.value = []
      selection.value = null
      floating.value = null
    }

    /** Records the change between `before` and the current image as one undoable edit. */
    function commit(before: RgbaImage, label: string): void {
      const img = image.value
      if (!img) return
      let edit: LocalEdit | null
      if (before.width !== img.width || before.height !== img.height) {
        edit = {
          label,
          patch: {
            rect: { x: 0, y: 0, width: 0, height: 0 },
            before: new Uint8ClampedArray(),
            after: new Uint8ClampedArray()
          },
          resize: { before, after: cloneImage(img) }
        }
      } else {
        const patch = diffImages(before, img)
        edit = patch ? { label, patch } : null
      }
      if (!edit) return
      undoStack.value = [...undoStack.value, edit].slice(-MAX_UNDO)
      redoStack.value = []
      touch()
    }

    /** Snapshot for a pending change; pass the result to commit() when the stroke ends. */
    function snapshot(): RgbaImage | null {
      return image.value ? cloneImage(image.value) : null
    }

    function undo(): void {
      commitFloating()
      const edit = undoStack.value[undoStack.value.length - 1]
      if (!edit || !image.value) return
      if (edit.resize) image.value = cloneImage(edit.resize.before)
      else applyPatch(image.value, edit.patch, 'undo')
      undoStack.value = undoStack.value.slice(0, -1)
      redoStack.value = [...redoStack.value, edit]
      selection.value = null
      touch()
    }

    function redo(): void {
      const edit = redoStack.value[redoStack.value.length - 1]
      if (!edit || !image.value) return
      if (edit.resize) image.value = cloneImage(edit.resize.after)
      else applyPatch(image.value, edit.patch, 'redo')
      redoStack.value = redoStack.value.slice(0, -1)
      undoStack.value = [...undoStack.value, edit]
      selection.value = null
      touch()
    }

    /** Sets the active color and remembers it in recent colors (palette clicks, eyedropper). */
    function useColor(color: Rgba, which: 'primary' | 'secondary' = 'primary'): void {
      setColor(color, which)
      rememberColor(color)
    }

    /** Sets the active color without touching recent colors (live updates while dragging in the picker). */
    function setColor(color: Rgba, which: 'primary' | 'secondary' = 'primary'): void {
      if (which === 'primary') primary.value = color
      else secondary.value = color
    }

    function rememberColor(color: Rgba): void {
      const hex = toHex(color)
      recentColors.value = [hex, ...recentColors.value.filter((c) => c !== hex)].slice(
        0,
        MAX_RECENT
      )
    }

    function swapColors(): void {
      const p = primary.value
      primary.value = secondary.value
      secondary.value = p
    }

    // ---------- selection ----------
    function selectAll(): void {
      commitFloating()
      const img = image.value
      if (img) selection.value = { x: 0, y: 0, width: img.width, height: img.height }
    }

    function deselect(): void {
      commitFloating()
      selection.value = null
    }

    /** Lifts the selected pixels into a floating selection (leaving transparency) so they can be moved. */
    function liftSelection(): void {
      const img = image.value
      const sel = selection.value && img ? clampRect(img, selection.value) : null
      if (!img || !sel || floating.value) return
      floatingBefore = cloneImage(img)
      floating.value = { image: cropImage(img, sel), x: sel.x, y: sel.y }
      clearRect(img, sel)
      touch()
    }

    function moveFloating(x: number, y: number): void {
      const f = floating.value
      if (!f) return
      floating.value = { ...f, x, y }
      selection.value = { x, y, width: f.image.width, height: f.image.height }
      touch()
    }

    /** Writes the floating selection into the image as one edit. */
    function commitFloating(label = 'move'): void {
      const f = floating.value
      const img = image.value
      if (!f || !img) return
      const before = floatingBefore ?? cloneImage(img)
      pasteImage(img, f.image, f.x, f.y, { blend: true })
      floating.value = null
      floatingBefore = null
      commit(before, label)
    }

    function copy(): boolean {
      const img = image.value
      const sel = selection.value && img ? clampRect(img, selection.value) : null
      if (!img) return false
      if (floating.value) clipboard.value = cloneImage(floating.value.image)
      else
        clipboard.value = cropImage(
          img,
          sel ?? { x: 0, y: 0, width: img.width, height: img.height }
        )
      return true
    }

    function cut(): void {
      if (!selection.value || !copy()) return
      deleteSelection()
    }

    function paste(): void {
      const img = image.value
      const clip = clipboard.value
      if (!img || !clip) return
      commitFloating()
      const at = selection.value ?? { x: 0, y: 0 }
      floatingBefore = cloneImage(img)
      floating.value = { image: cloneImage(clip), x: at.x, y: at.y }
      selection.value = { x: at.x, y: at.y, width: clip.width, height: clip.height }
      tool.value = 'select'
      touch()
    }

    function deleteSelection(): void {
      const img = image.value
      if (!img) return
      if (floating.value) {
        floating.value = null
        if (floatingBefore) commit(floatingBefore, 'delete')
        floatingBefore = null
        selection.value = null
        return
      }
      const sel = selection.value ? clampRect(img, selection.value) : null
      if (!sel) return
      const before = cloneImage(img)
      clearRect(img, sel)
      commit(before, 'delete')
    }

    // ---------- transforms (selection if any, else whole image) ----------
    function transform(label: string, fn: (img: RgbaImage) => RgbaImage): void {
      const img = image.value
      if (!img) return
      commitFloating()
      const sel = selection.value ? clampRect(img, selection.value) : null
      const before = cloneImage(img)
      if (sel && !(sel.width === img.width && sel.height === img.height)) {
        const part = fn(cropImage(img, sel))
        clearRect(img, sel)
        pasteImage(img, part, sel.x, sel.y)
        selection.value = { x: sel.x, y: sel.y, width: part.width, height: part.height }
      } else {
        image.value = fn(img)
        if (sel)
          selection.value = { x: 0, y: 0, width: image.value.width, height: image.value.height }
      }
      commit(before, label)
    }

    function rotate(direction: RotateDirection): void {
      transform(direction === 'clockwise' ? 'rotateCw' : 'rotateCcw', (img) =>
        rotateImage(img, 90, direction)
      )
    }

    function flip(axis: FlipAxis): void {
      transform(axis === 'horizontal' ? 'flipH' : 'flipV', (img) => flipImage(img, axis))
    }

    // ---------- persistence ----------
    async function save(): Promise<TextureEntry | null> {
      const img = image.value
      const p = path.value
      if (!img || !p) return null
      commitFloating()
      saving.value = true
      try {
        const updated = await call('texture.save', {
          packId,
          path: p,
          png: new Uint8Array(encodePng(img))
        })
        saved.value = cloneImage(img)
        entry.value = updated
        origin.value = updated.status === 'vanilla' ? 'vanilla' : 'pack'
        touch()
        await refreshHistory()
        return updated
      } finally {
        saving.value = false
      }
    }

    async function revertToVanilla(): Promise<void> {
      const p = path.value
      if (!p) return
      const updated = await call('texture.revert', { packId, path: p })
      await open(updated)
      await refreshHistory()
    }

    async function refreshHistory(): Promise<void> {
      packHistory.value = await call('history.get', { packId })
    }

    async function undoSaved(): Promise<void> {
      packHistory.value = await call('history.undo', { packId })
      if (entry.value) await reloadCurrent()
    }

    async function redoSaved(): Promise<void> {
      packHistory.value = await call('history.redo', { packId })
      if (entry.value) await reloadCurrent()
    }

    async function reloadCurrent(): Promise<void> {
      if (!entry.value) return
      await open(entry.value)
    }

    return {
      packId,
      path,
      entry,
      saved,
      image,
      vanilla,
      mcmeta,
      origin,
      revision,
      loading,
      saving,
      undoStack,
      redoStack,
      tool,
      primary,
      secondary,
      fillShapes,
      bucketTolerance,
      bucketContiguous,
      mirrorX,
      mirrorY,
      showGrid,
      zoom,
      recentColors,
      selection,
      floating,
      compare,
      peekVanilla,
      packHistory,
      dirty,
      canUndo,
      canRedo,
      frameSize,
      touch,
      open,
      close,
      commit,
      snapshot,
      undo,
      redo,
      useColor,
      setColor,
      rememberColor,
      swapColors,
      selectAll,
      deselect,
      liftSelection,
      moveFloating,
      commitFloating,
      copy,
      cut,
      paste,
      deleteSelection,
      rotate,
      flip,
      save,
      revertToVanilla,
      refreshHistory,
      undoSaved,
      redoSaved
    }
  })()
}

export type EditorStore = ReturnType<typeof useEditorStore>

export function disposeEditorStore(packId: string): void {
  const pinia = getActivePinia()
  if (!pinia) return
  const id = `editor/${packId}`
  const store = (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.get(id)
  store?.$dispose()
  delete pinia.state.value[id]
}
