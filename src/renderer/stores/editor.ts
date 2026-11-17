import { defineStore, getActivePinia } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  applyPatch,
  clampRect,
  clearRect,
  cloneImage,
  compositeLayers,
  createImage,
  cropImage,
  decodePng,
  diffImages,
  encodePng,
  flipImage,
  imagesEqual,
  overlayDiff,
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
import {
  MAX_FRAMES,
  animationFromDelays,
  defaultAnimation,
  insertFrame,
  joinFrames,
  moveFrame as moveFrameMeta,
  parseMcmeta,
  removeFrame,
  serializeMcmeta,
  setFrameTime,
  splitFrames,
  stripFrameHeight,
  type AnimationMeta,
  type McmetaDoc
} from '@shared/animation'
import type { TextureEntry } from '@shared/model/pack'
import { MAX_LAYERS, type TextureLayers } from '@shared/model/layers'
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
  /** Animation frame the patch applies to (undo shows that frame again). */
  frame?: number
  /** Layer the patch applies to (undo selects that layer again). */
  layer?: number
  /** Frame or animation change (add, delete, move frames, timing...): undo restores the whole state. */
  structure?: { before: AnimationState; after: AnimationState }
}

/** Frames, animation settings, layers and current frame / layer, as captured around a structural edit. */
export interface AnimationState {
  frames: RgbaImage[] | null
  image: RgbaImage
  meta: McmetaDoc | null
  frameIndex: number
  layers: EditorLayer[] | null
  activeLayer: number
}

/** One editor layer (M11). Layers are optional and only for still textures; the pack keeps the composite. */
export interface EditorLayer {
  name: string
  image: RgbaImage
  visible: boolean
  /** Percent (0..100). */
  opacity: number
}

function cloneLayer(layer: EditorLayer): EditorLayer {
  return { ...layer, image: cloneImage(layer.image) }
}

/** Successive opacity changes of one layer within this delay are one undo step (slider drags). */
const COALESCE_MS = 800

/** Largest strip the editor builds (texture.save refuses taller images). */
const MAX_STRIP_HEIGHT = 4096

const NO_PATCH: Patch = {
  rect: { x: 0, y: 0, width: 0, height: 0 },
  before: new Uint8ClampedArray(),
  after: new Uint8ClampedArray()
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
    /** Image as last saved (or loaded); the whole strip for animated textures. */
    const saved = shallowRef<RgbaImage | null>(null)
    /**
     * Working image, mutated in place; `revision` changes whenever its pixels change. For an animated texture this
     * is the CURRENT FRAME (every tool then stays inside it); `strip` is the whole texture.
     */
    const image = shallowRef<RgbaImage | null>(null)
    const vanilla = shallowRef<RgbaImage | null>(null)
    /** Frames of an animated texture (vertical strip of full-width frames), else null. */
    const frames = shallowRef<RgbaImage[] | null>(null)
    const frameIndex = ref(0)
    /** Parsed .png.mcmeta (the whole file); the timeline edits its animation. */
    const meta = shallowRef<McmetaDoc | null>(null)
    /** .mcmeta text as loaded or last saved (normalized), and where the loaded file came from. */
    const savedMcmeta = ref<string | null>(null)
    const mcmetaOrigin = ref<'pack' | 'vanilla' | 'none'>('none')
    /** Timeline: previous frame shown faintly over the current one; animation playing (timeline and 3D). */
    const onionSkin = ref(false)
    const playing = ref(false)
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

    /** 3D preview panel visibility (kept while the tab is open). */
    const show3d = ref(false)
    /** Pixel hovered in the 2D canvas or on the 3D model, highlighted in the other view. */
    const linkedHover = ref<{ x: number; y: number; source: '2d' | '3d' } | null>(null)

    /**
     * Layers of a still texture, bottom first, or null (no layers). When set, `image` is the ACTIVE layer's image
     * (tools paint into it) and `view` / `strip` are the composite of the visible layers.
     */
    const layers = shallowRef<EditorLayer[] | null>(null)
    const activeLayer = ref(0)
    /** Layers as loaded or last saved (dirty check), and whether the pack has a layers file. */
    let savedLayers: EditorLayer[] | null = null
    let layersOnDisk = false
    /** The saved layers no longer matched the texture (it changed since): they were not loaded. */
    const layersStale = ref(false)

    /** Composite of the visible layers (or the image when there are no layers). */
    const view = computed<RgbaImage | null>(() => {
      void revision.value
      const l = layers.value
      const img = image.value
      if (!l || !img) return img
      return compositeLayers(l, img.width, img.height)
    })

    /** The whole texture: the frames stacked for an animated texture, else the image. */
    const strip = computed<RgbaImage | null>(() => {
      void revision.value
      const f = frames.value
      return f ? joinFrames(f) : view.value
    })
    const frameCount = computed(() => frames.value?.length ?? 0)
    /** Pixel row of the current frame in the strip (hover coordinates are shared with the 3D view in strip space). */
    const frameOffset = computed(() =>
      frames.value ? frameIndex.value * frames.value[0]!.height : 0
    )
    /** Current .png.mcmeta text (null when the texture has none). */
    const mcmeta = computed<string | null>(() => {
      void revision.value
      const f = frames.value
      return serializeMcmeta(
        meta.value,
        f ? { width: f[0]!.width, height: f[0]!.height, count: f.length } : undefined
      )
    })
    const animation = computed<AnimationMeta | null>(() => meta.value?.animation ?? null)
    /** Another frame fits (frame count and texture height limits). */
    const canAddFrame = computed(() => {
      const f = frames.value
      return !!f && f.length < MAX_FRAMES && (f.length + 1) * f[0]!.height <= MAX_STRIP_HEIGHT
    })
    /** Vanilla texture as compared with the image: the same frame of vanilla's strip when it has one. */
    const vanillaView = computed<RgbaImage | null>(() => {
      const v = vanilla.value
      const f = frames.value
      if (!v || !f) return v
      const fh = f[0]!.height
      if (v.width !== f[0]!.width || v.height % fh !== 0) return v
      const i = frameIndex.value % (v.height / fh)
      return cropImage(v, { x: 0, y: i * fh, width: v.width, height: fh })
    })

    const dirty = computed(() => {
      void revision.value
      const img = strip.value
      const base = saved.value
      if (!img || !base) return false
      if (floating.value) return true
      if (mcmeta.value !== savedMcmeta.value) return true
      if (layersChanged()) return true
      return img.width !== base.width || img.height !== base.height || !imagesEqual(img, base)
    })
    const canUndo = computed(() => undoStack.value.length > 0)
    const canRedo = computed(() => redoStack.value.length > 0)

    function touch(): void {
      revision.value++
    }

    /** Layers differ from the saved ones (pixels, names, visibility, opacity, order, active layer). */
    function layersChanged(): boolean {
      const l = layers.value
      const s = savedLayers
      if (!l || !s) return !!l !== !!s
      if (l.length !== s.length) return true
      return l.some(
        (layer, i) =>
          layer.name !== s[i]!.name ||
          layer.visible !== s[i]!.visible ||
          layer.opacity !== s[i]!.opacity ||
          !imagesEqual(layer.image, s[i]!.image)
      )
    }

    /** Replaces the working image (and the current frame of an animated texture, or the active layer). */
    function setImage(img: RgbaImage): void {
      image.value = img
      const f = frames.value
      if (f) f[frameIndex.value] = img
      const l = layers.value
      if (l) l[activeLayer.value] = { ...l[activeLayer.value]!, image: img }
    }

    /** Splits `img` into frames when the animation describes a vertical strip, else edits it whole. */
    function loadFrames(img: RgbaImage | null, index = 0): void {
      const fh = img ? stripFrameHeight(meta.value?.animation ?? null, img) : null
      if (img && fh && img.height / fh <= MAX_FRAMES) {
        frames.value = splitFrames(img, fh)
        frameIndex.value = Math.min(index, frames.value.length - 1)
        image.value = frames.value[frameIndex.value]!
      } else {
        frames.value = null
        frameIndex.value = 0
        image.value = img
      }
    }

    async function open(texture: TextureEntry): Promise<void> {
      loading.value = true
      try {
        const data = await call('texture.read', { packId, path: texture.path })
        path.value = texture.path
        entry.value = texture
        origin.value = data.origin
        meta.value = parseMcmeta(data.mcmeta)
        mcmetaOrigin.value = data.mcmetaOrigin
        const img = data.png ? decodePng(data.png) : null
        saved.value = img ? cloneImage(img) : null
        loadFrames(img)
        loadLayers(data.layers, img)
        playing.value = false
        vanilla.value = data.vanillaPng ? decodePng(data.vanillaPng) : null
        undoStack.value = []
        redoStack.value = []
        selection.value = null
        floating.value = null
        zoom.value = 0
        touch()
        savedMcmeta.value = mcmeta.value
      } finally {
        loading.value = false
      }
    }

    /** Uses the saved layers when their composite still is the texture; otherwise ignores them (stale). */
    function loadLayers(data: TextureLayers | null, img: RgbaImage | null): void {
      layers.value = null
      activeLayer.value = 0
      savedLayers = null
      layersOnDisk = !!data
      layersStale.value = false
      if (!data || !img) return
      let loaded: EditorLayer[] | null
      try {
        loaded = data.items.map((l) => ({
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          image: decodePng(l.png)
        }))
      } catch {
        loaded = null
      }
      const fits =
        !!loaded &&
        !frames.value &&
        loaded.every((l) => l.image.width === img.width && l.image.height === img.height) &&
        imagesEqual(compositeLayers(loaded, img.width, img.height), img)
      if (!fits || !loaded) {
        layersStale.value = true
        return
      }
      layers.value = loaded
      activeLayer.value = Math.min(data.active, loaded.length - 1)
      image.value = loaded[activeLayer.value]!.image
      savedLayers = loaded.map(cloneLayer)
    }

    function close(): void {
      path.value = null
      entry.value = null
      image.value = null
      saved.value = null
      vanilla.value = null
      frames.value = null
      meta.value = null
      layers.value = null
      activeLayer.value = 0
      savedLayers = null
      layersOnDisk = false
      layersStale.value = false
      playing.value = false
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
        edit = { label, patch: NO_PATCH, resize: { before, after: cloneImage(img) } }
      } else {
        const patch = diffImages(before, img)
        edit = patch ? { label, patch } : null
      }
      if (!edit) return
      if (frames.value) edit.frame = frameIndex.value
      if (layers.value) edit.layer = activeLayer.value
      push(edit)
    }

    function push(edit: LocalEdit): void {
      undoStack.value = [...undoStack.value, edit].slice(-MAX_UNDO)
      redoStack.value = []
      touch()
    }

    // ---------- animation (structural edits are undone as a whole) ----------
    function captureState(): AnimationState {
      return {
        frames: frames.value ? frames.value.map(cloneImage) : null,
        image: cloneImage(image.value!),
        meta: meta.value,
        frameIndex: frameIndex.value,
        layers: layers.value ? layers.value.map(cloneLayer) : null,
        activeLayer: activeLayer.value
      }
    }

    function restoreState(state: AnimationState): void {
      meta.value = state.meta
      if (state.frames) {
        frames.value = state.frames.map(cloneImage)
        frameIndex.value = Math.min(state.frameIndex, frames.value.length - 1)
        image.value = frames.value[frameIndex.value]!
      } else {
        frames.value = null
        frameIndex.value = 0
        image.value = cloneImage(state.image)
      }
      if (state.layers) {
        layers.value = state.layers.map(cloneLayer)
        activeLayer.value = Math.min(state.activeLayer, layers.value.length - 1)
        image.value = layers.value[activeLayer.value]!.image
      } else {
        layers.value = null
        activeLayer.value = 0
      }
      selection.value = null
    }

    /** Last structural edit that later changes may merge into (opacity slider drags). */
    let coalesce: { key: string; at: number; edit: LocalEdit } | null = null

    /**
     * Runs a frame / animation / layer change and records it as one undoable edit. With `coalesceKey`, a change
     * made shortly after one with the same key updates that edit instead of adding another.
     */
    function structural(label: string, change: () => void, coalesceKey?: string): void {
      if (!image.value) return
      commitFloating()
      playing.value = false
      const now = Date.now()
      const top = undoStack.value[undoStack.value.length - 1]
      const merge =
        coalesceKey &&
        coalesce?.key === coalesceKey &&
        coalesce.edit === top &&
        now - coalesce.at < COALESCE_MS
      const before = merge ? top!.structure!.before : captureState()
      change()
      selection.value = null
      const edit: LocalEdit = {
        label,
        patch: NO_PATCH,
        structure: { before, after: captureState() }
      }
      if (merge) {
        undoStack.value = [...undoStack.value.slice(0, -1), edit]
        redoStack.value = []
        touch()
      } else push(edit)
      coalesce = coalesceKey ? { key: coalesceKey, at: now, edit } : null
    }

    function currentAnimation(): AnimationMeta {
      return meta.value?.animation ?? defaultAnimation()
    }

    function setAnimation(anim: AnimationMeta | null): void {
      const rest = meta.value?.rest ?? {}
      meta.value = anim || Object.keys(rest).length ? { animation: anim, rest } : null
    }

    function showFrame(index: number): void {
      const f = frames.value
      if (!f) return
      frameIndex.value = Math.max(0, Math.min(index, f.length - 1))
      image.value = f[frameIndex.value]!
    }

    function selectFrame(index: number): void {
      const f = frames.value
      if (!f || index < 0 || index >= f.length || index === frameIndex.value) return
      commitFloating()
      selection.value = null
      showFrame(index)
      touch()
    }

    /** Inserts a frame after the current one: blank, or a copy of the current frame. */
    function addFrame(copy: boolean): void {
      if (!canAddFrame.value) return
      structural(copy ? 'frameDuplicate' : 'frameAdd', () => {
        const f = [...frames.value!]
        const at = frameIndex.value + 1
        const img = copy ? cloneImage(f[frameIndex.value]!) : createImage(f[0]!.width, f[0]!.height)
        f.splice(at, 0, img)
        frames.value = f
        setAnimation(insertFrame(currentAnimation(), at, copy ? frameIndex.value : undefined))
        showFrame(at)
      })
    }

    function deleteFrame(): void {
      if (frameCount.value < 2) return
      structural('frameDelete', () => {
        const f = [...frames.value!]
        const at = frameIndex.value
        f.splice(at, 1)
        frames.value = f
        setAnimation(removeFrame(currentAnimation(), at))
        showFrame(Math.min(at, f.length - 1))
      })
    }

    /** Moves the current frame to strip position `to`. */
    function moveFrame(to: number): void {
      const from = frameIndex.value
      const count = frameCount.value
      if (!count || to < 0 || to >= count || to === from) return
      structural('frameMove', () => {
        const f = [...frames.value!]
        const [moved] = f.splice(from, 1)
        f.splice(to, 0, moved!)
        frames.value = f
        setAnimation(moveFrameMeta(currentAnimation(), from, to, count))
        showFrame(to)
      })
    }

    function setFrametime(ticks: number): void {
      if (!frames.value || ticks < 1 || ticks === currentAnimation().frametime) return
      structural('frameTiming', () => setAnimation({ ...currentAnimation(), frametime: ticks }))
    }

    function setInterpolate(on: boolean): void {
      if (!frames.value || on === currentAnimation().interpolate) return
      structural('frameTiming', () => setAnimation({ ...currentAnimation(), interpolate: on }))
    }

    /** Own duration of frame `index` in ticks, or null to use the frametime. */
    function setFrameDuration(index: number, ticks: number | null): void {
      const count = frameCount.value
      if (!count) return
      const next = setFrameTime(currentAnimation(), index, ticks, count)
      if (JSON.stringify(next.frames) === JSON.stringify(currentAnimation().frames)) return
      structural('frameTiming', () => setAnimation(next))
    }

    /** Turns a still texture into a one-frame animation (frames are then added in the timeline). */
    function animate(): void {
      if (frames.value || layers.value || !image.value) return
      structural('animate', () => {
        frames.value = [image.value!]
        frameIndex.value = 0
        setAnimation(currentAnimation())
      })
    }

    /** Back to a still texture: keeps the current frame and drops the animation section. */
    function removeAnimation(): void {
      if (!frames.value) return
      structural('unanimate', () => {
        const keep = image.value!
        frames.value = null
        frameIndex.value = 0
        image.value = keep
        setAnimation(null)
      })
    }

    /** Replaces the frames with imported ones (a strip of the current frame size) and their delays. */
    function importFrames(png: Uint8Array, delaysMs: readonly number[]): void {
      const img = image.value
      if (!img) return
      const strip = decodePng(png)
      const fh = frames.value?.[0]?.height ?? img.height
      if (strip.width !== img.width || strip.height % fh !== 0) return
      structural('importGif', () => {
        frames.value = splitFrames(strip, fh)
        setAnimation(
          animationFromDelays(delaysMs.slice(0, frames.value.length), currentAnimation())
        )
        showFrame(0)
      })
    }

    /** Snapshot for a pending change; pass the result to commit() when the stroke ends. */
    function snapshot(): RgbaImage | null {
      return image.value ? cloneImage(image.value) : null
    }

    /** Shows the frame / selects the layer an edit belongs to before undoing / redoing it. */
    function showEditFrame(edit: LocalEdit): void {
      if (edit.frame !== undefined && frames.value && edit.frame < frames.value.length)
        showFrame(edit.frame)
      const l = layers.value
      if (edit.layer !== undefined && l && edit.layer < l.length) {
        activeLayer.value = edit.layer
        image.value = l[edit.layer]!.image
      }
    }

    function undo(): void {
      commitFloating()
      const edit = undoStack.value[undoStack.value.length - 1]
      if (!edit || !image.value) return
      playing.value = false
      if (edit.structure) restoreState(edit.structure.before)
      else {
        showEditFrame(edit)
        if (edit.resize) setImage(cloneImage(edit.resize.before))
        else applyPatch(image.value, edit.patch, 'undo')
      }
      undoStack.value = undoStack.value.slice(0, -1)
      redoStack.value = [...redoStack.value, edit]
      selection.value = null
      touch()
    }

    function redo(): void {
      const edit = redoStack.value[redoStack.value.length - 1]
      if (!edit || !image.value) return
      playing.value = false
      if (edit.structure) restoreState(edit.structure.after)
      else {
        showEditFrame(edit)
        if (edit.resize) setImage(cloneImage(edit.resize.after))
        else applyPatch(image.value!, edit.patch, 'redo')
      }
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
        const out = fn(img)
        // Every frame of an animation (and every layer) has the same size: a turn of a non-square one is refused.
        if (
          (frames.value || layers.value) &&
          (out.width !== img.width || out.height !== img.height)
        )
          return
        setImage(out)
        if (sel) selection.value = { x: 0, y: 0, width: out.width, height: out.height }
      }
      commit(before, label)
    }

    /**
     * Puts an applied AI proposal (the whole texture, every frame for an animation) into the editor as ONE undoable
     * edit (the user saves normally). With layers, the changes become a new top layer named `layerName`.
     */
    function applyAiResult(png: Uint8Array, layerName = 'AI'): void {
      const img = image.value
      if (!img) return
      const out = decodePng(png)
      const f = frames.value
      if (f) {
        const fh = f[0]!.height
        if (out.width !== f[0]!.width || out.height % fh !== 0) return
        structural('ai', () => {
          frames.value = splitFrames(out, fh)
          showFrame(frameIndex.value)
        })
        return
      }
      const l = layers.value
      if (l) {
        // The AI saw the composite: its changes go into a new top layer, or flatten when they erase pixels.
        const current = view.value!
        const overlay = overlayDiff(current, out)
        structural('ai', () => {
          if (overlay && l.length < MAX_LAYERS) {
            layers.value = [...l, { name: layerName, image: overlay, visible: true, opacity: 100 }]
            activeLayer.value = l.length
            image.value = overlay
          } else {
            layers.value = null
            activeLayer.value = 0
            image.value = out
          }
        })
        return
      }
      commitFloating()
      const before = cloneImage(img)
      image.value = out
      selection.value = null
      commit(before, 'ai')
    }

    // ---------- layers (still textures only) ----------
    /** Selects the layer tools paint into (not an undoable edit). */
    function selectLayer(index: number): void {
      const l = layers.value
      if (!l || index < 0 || index >= l.length || index === activeLayer.value) return
      commitFloating()
      activeLayer.value = index
      image.value = l[index]!.image
      touch()
    }

    function useLayers(next: EditorLayer[], active: number): void {
      layers.value = next
      activeLayer.value = Math.max(0, Math.min(active, next.length - 1))
      image.value = next[activeLayer.value]!.image
    }

    /**
     * Adds an empty layer above the active one. Without layers, the texture first becomes the bottom layer
     * `baseName`.
     */
    function addLayer(name: string, baseName: string): void {
      const img = image.value
      if (!img || frames.value || (layers.value?.length ?? 1) >= MAX_LAYERS) return
      structural('layerAdd', () => {
        const l = layers.value
          ? [...layers.value]
          : [{ name: baseName, image: img, visible: true, opacity: 100 }]
        const at = (layers.value ? activeLayer.value : 0) + 1
        l.splice(at, 0, {
          name,
          image: createImage(img.width, img.height),
          visible: true,
          opacity: 100
        })
        useLayers(l, at)
      })
    }

    function duplicateLayer(name: string): void {
      const l = layers.value
      if (!l || l.length >= MAX_LAYERS) return
      structural('layerDuplicate', () => {
        const next = [...l]
        const at = activeLayer.value + 1
        next.splice(at, 0, { ...cloneLayer(l[activeLayer.value]!), name })
        useLayers(next, at)
      })
    }

    function deleteLayer(): void {
      const l = layers.value
      if (!l || l.length < 2) return
      structural('layerDelete', () => {
        const next = l.filter((_, i) => i !== activeLayer.value)
        useLayers(next, activeLayer.value - 1)
      })
    }

    /** Moves the active layer up (+1, towards the top) or down (-1). */
    function moveLayer(step: 1 | -1): void {
      const l = layers.value
      const from = activeLayer.value
      const to = from + step
      if (!l || to < 0 || to >= l.length) return
      structural('layerMove', () => {
        const next = [...l]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved!)
        useLayers(next, to)
      })
    }

    function updateLayer(
      index: number,
      label: string,
      patch: Partial<Pick<EditorLayer, 'name' | 'visible' | 'opacity'>>,
      coalesceKey?: string
    ): void {
      const l = layers.value
      const layer = l?.[index]
      if (!l || !layer) return
      if (Object.entries(patch).every(([k, v]) => layer[k as keyof EditorLayer] === v)) return
      structural(
        label,
        () => {
          const next = [...l]
          next[index] = { ...layer, ...patch }
          useLayers(next, activeLayer.value)
        },
        coalesceKey
      )
    }

    function setLayerVisible(index: number, visible: boolean): void {
      updateLayer(index, 'layerVisibility', { visible })
    }

    function setLayerOpacity(index: number, opacity: number): void {
      const value = Math.max(0, Math.min(100, Math.round(opacity)))
      updateLayer(index, 'layerOpacity', { opacity: value }, `opacity:${index}`)
    }

    function renameLayer(index: number, name: string): void {
      const trimmed = name.trim().slice(0, 40)
      if (trimmed) updateLayer(index, 'layerRename', { name: trimmed })
    }

    /** Merges the active layer into the one below (with its opacity and visibility). */
    function mergeDown(): void {
      const l = layers.value
      const i = activeLayer.value
      if (!l || i < 1) return
      structural('layerMerge', () => {
        const below = l[i - 1]!
        const top = l[i]!
        const merged = compositeLayers(
          [{ image: below.image, visible: true, opacity: 100 }, top],
          below.image.width,
          below.image.height
        )
        const next = [...l]
        next.splice(i - 1, 2, { ...below, image: merged })
        useLayers(next, i - 1)
      })
    }

    /** Back to a single image: the composite of the visible layers (hidden layers are dropped). */
    function flattenLayers(): void {
      if (!layers.value) return
      structural('layerFlatten', () => {
        const flat = cloneImage(view.value!)
        layers.value = null
        activeLayer.value = 0
        image.value = flat
      })
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
      const p = path.value
      if (!image.value || !p) return null
      commitFloating()
      playing.value = false
      const img = strip.value!
      const text = mcmeta.value
      // Minecraft only reads the .mcmeta from the pack that provides the PNG: a .mcmeta loaded from vanilla is
      // written into the pack with the PNG, a removed one is deleted.
      const metaArg =
        text !== null
          ? text !== savedMcmeta.value || mcmetaOrigin.value !== 'pack'
            ? text
            : undefined
          : mcmetaOrigin.value === 'pack'
            ? null
            : undefined
      const l = layers.value
      const layersArg: TextureLayers | null | undefined = l
        ? {
            active: activeLayer.value,
            items: l.map((layer) => ({
              name: layer.name,
              visible: layer.visible,
              opacity: layer.opacity,
              png: new Uint8Array(encodePng(layer.image))
            }))
          }
        : layersOnDisk
          ? null
          : undefined
      saving.value = true
      try {
        const updated = await call('texture.save', {
          packId,
          path: p,
          png: new Uint8Array(encodePng(img)),
          ...(metaArg !== undefined ? { mcmeta: metaArg } : {}),
          ...(layersArg !== undefined ? { layers: layersArg } : {})
        })
        saved.value = cloneImage(img)
        savedMcmeta.value = text
        savedLayers = l ? l.map(cloneLayer) : null
        layersOnDisk = !!l
        layersStale.value = false
        entry.value = updated
        origin.value = updated.status === 'vanilla' ? 'vanilla' : 'pack'
        if (metaArg !== undefined) {
          mcmetaOrigin.value = (await call('texture.read', { packId, path: p })).mcmetaOrigin
        }
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
      vanillaView,
      mcmeta,
      meta,
      animation,
      frames,
      frameIndex,
      frameCount,
      frameOffset,
      canAddFrame,
      strip,
      onionSkin,
      playing,
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
      show3d,
      linkedHover,
      layers,
      activeLayer,
      layersStale,
      view,
      dirty,
      canUndo,
      canRedo,
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
      selectFrame,
      addFrame,
      deleteFrame,
      moveFrame,
      setFrametime,
      setInterpolate,
      setFrameDuration,
      animate,
      removeAnimation,
      importFrames,
      applyAiResult,
      selectLayer,
      addLayer,
      duplicateLayer,
      deleteLayer,
      moveLayer,
      setLayerVisible,
      setLayerOpacity,
      renameLayer,
      mergeDown,
      flattenLayers,
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
