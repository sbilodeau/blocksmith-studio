import { defineStore, getActivePinia } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import {
  applyPatch,
  clampRect,
  clearRect,
  cloneImage,
  createImage,
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
  /** Frame or animation change (add, delete, move frames, timing...): undo restores the whole state. */
  structure?: { before: AnimationState; after: AnimationState }
}

/** Frames, animation settings and current frame, as captured around a structural edit. */
export interface AnimationState {
  frames: RgbaImage[] | null
  image: RgbaImage
  meta: McmetaDoc | null
  frameIndex: number
}

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

    /** The whole texture: the frames stacked for an animated texture, else the image. */
    const strip = computed<RgbaImage | null>(() => {
      void revision.value
      const f = frames.value
      return f ? joinFrames(f) : image.value
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
      return img.width !== base.width || img.height !== base.height || !imagesEqual(img, base)
    })
    const canUndo = computed(() => undoStack.value.length > 0)
    const canRedo = computed(() => redoStack.value.length > 0)

    function touch(): void {
      revision.value++
    }

    /** Replaces the working image (and the current frame of an animated texture). */
    function setImage(img: RgbaImage): void {
      image.value = img
      const f = frames.value
      if (f) f[frameIndex.value] = img
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

    function close(): void {
      path.value = null
      entry.value = null
      image.value = null
      saved.value = null
      vanilla.value = null
      frames.value = null
      meta.value = null
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
        frameIndex: frameIndex.value
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
      selection.value = null
    }

    /** Runs a frame / animation change and records it as one undoable edit. */
    function structural(label: string, change: () => void): void {
      if (!image.value) return
      commitFloating()
      playing.value = false
      const before = captureState()
      change()
      selection.value = null
      push({ label, patch: NO_PATCH, structure: { before, after: captureState() } })
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
      if (frames.value || !image.value) return
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

    /** Shows the frame an edit belongs to before undoing / redoing it. */
    function showEditFrame(edit: LocalEdit): void {
      if (edit.frame !== undefined && frames.value && edit.frame < frames.value.length)
        showFrame(edit.frame)
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
        // Every frame of an animation has the same size: a turn of a non-square frame is refused.
        if (frames.value && (out.width !== img.width || out.height !== img.height)) return
        setImage(out)
        if (sel) selection.value = { x: 0, y: 0, width: out.width, height: out.height }
      }
      commit(before, label)
    }

    /**
     * Puts an applied AI proposal (the whole texture, every frame for an animation) into the editor as ONE undoable
     * edit (the user saves normally).
     */
    function applyAiResult(png: Uint8Array): void {
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
      commitFloating()
      const before = cloneImage(img)
      image.value = out
      selection.value = null
      commit(before, 'ai')
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
      saving.value = true
      try {
        const updated = await call('texture.save', {
          packId,
          path: p,
          png: new Uint8Array(encodePng(img)),
          ...(metaArg !== undefined ? { mcmeta: metaArg } : {})
        })
        saved.value = cloneImage(img)
        savedMcmeta.value = text
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
