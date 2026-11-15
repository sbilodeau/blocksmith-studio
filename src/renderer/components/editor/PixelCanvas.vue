<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  drawLine,
  drawRect,
  fillRect,
  floodFill,
  getPixel,
  inBounds,
  linePoints,
  setPixel,
  type Point,
  type Rect,
  type RgbaImage,
  type Rgba
} from '@shared/image'
import { TRANSPARENT, useEditorStore } from '../../stores/editor'
import { ZOOM_LEVELS, mirrorTransforms, nextZoom, normalizeRect, rectContains } from './geometry'

const props = defineProps<{
  packId: string
  readonly?: boolean
  source?: 'image' | 'vanilla'
}>()
// Components resolve the per-pack editor store themselves (state is edited in the store, not via props).
const editor = computed(() => useEditorStore(props.packId))
const emit = defineEmits<{ hover: [info: { x: number; y: number; color: Rgba } | null] }>()

const host = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const offset = ref({ x: 0, y: 0 })
const size = ref({ width: 0, height: 0 })
const hover = ref<Point | null>(null)
const spaceDown = ref(false)

/** Live shape preview for line/rect tools. */
const preview = ref<{ from: Point; to: Point } | null>(null)

let srcCanvas: HTMLCanvasElement | null = null
let floatCanvas: HTMLCanvasElement | null = null
let raf = 0
let resizeObserver: ResizeObserver | null = null

const displayed = computed<RgbaImage | null>(() => {
  void editor.value.revision
  if (props.source === 'vanilla' || editor.value.peekVanilla) return editor.value.vanilla
  return editor.value.image
})

// The read-only vanilla pane keeps its own zoom so the two compare panes do not fight over it.
const localZoom = ref(0)
const zoom = computed({
  get: () => (props.readonly ? localZoom.value : editor.value.zoom),
  set: (z: number) => {
    if (props.readonly) localZoom.value = z
    else editor.value.zoom = z
  }
})

// ---------- rendering ----------
function imageToCanvas(img: RgbaImage, target: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = target ?? document.createElement('canvas')
  if (c.width !== img.width || c.height !== img.height) {
    c.width = img.width
    c.height = img.height
  }
  const ctx = c.getContext('2d')!
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return c
}

function fit(): void {
  const img = displayed.value
  if (!img || size.value.width === 0) return
  // Animated strips fit one frame and start at the top; scroll (wheel) to move along the strip.
  const frame = editor.value.frameSize
  const fitHeight = frame ?? img.height
  const fitZoom = Math.max(
    1,
    Math.floor(Math.min((size.value.width - 48) / img.width, (size.value.height - 48) / fitHeight))
  )
  zoom.value = ZOOM_LEVELS.filter((z) => z <= fitZoom).pop() ?? 1
  center()
  if (frame) offset.value = { ...offset.value, y: 24 }
}

function center(): void {
  const img = displayed.value
  if (!img) return
  offset.value = {
    x: Math.round((size.value.width - img.width * zoom.value) / 2),
    y: Math.round((size.value.height - img.height * zoom.value) / 2)
  }
}

function schedule(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    render()
  })
}

function render(): void {
  const c = canvas.value
  const img = displayed.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const { width, height } = size.value
  if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (!img) return
  if (zoom.value === 0) fit()

  const z = zoom.value
  const { x: ox, y: oy } = offset.value
  const w = img.width * z
  const h = img.height * z

  // Checkerboard behind transparent pixels.
  const cell = 8
  ctx.save()
  ctx.beginPath()
  ctx.rect(ox, oy, w, h)
  ctx.clip()
  ctx.fillStyle = '#d8d8d8'
  ctx.fillRect(ox, oy, w, h)
  ctx.fillStyle = '#f4f4f4'
  for (let y = 0; y < h; y += cell) {
    for (let x = (y / cell) % 2 === 0 ? 0 : cell; x < w; x += cell * 2)
      ctx.fillRect(ox + x, oy + y, cell, cell)
  }
  ctx.restore()

  ctx.imageSmoothingEnabled = false
  srcCanvas = imageToCanvas(img, srcCanvas)
  ctx.drawImage(srcCanvas, ox, oy, w, h)

  const f = editor.value.floating
  if (f && !props.readonly && displayed.value === editor.value.image) {
    floatCanvas = imageToCanvas(f.image, floatCanvas)
    ctx.drawImage(floatCanvas, ox + f.x * z, oy + f.y * z, f.image.width * z, f.image.height * z)
  }

  // Shape preview.
  if (preview.value && !props.readonly) {
    ctx.fillStyle = cssColor(editor.value.primary, 0.75)
    for (const p of previewPoints(preview.value.from, preview.value.to, img)) {
      ctx.fillRect(ox + p.x * z, oy + p.y * z, z, z)
    }
  }

  // Pixel grid (only when pixels are big enough), stronger every 16 px.
  if (editor.value.showGrid && z >= 6) {
    ctx.lineWidth = 1 / dpr
    for (let x = 0; x <= img.width; x++) {
      ctx.strokeStyle = x % 16 === 0 ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.moveTo(ox + x * z + 0.5 / dpr, oy)
      ctx.lineTo(ox + x * z + 0.5 / dpr, oy + h)
      ctx.stroke()
    }
    for (let y = 0; y <= img.height; y++) {
      ctx.strokeStyle = y % 16 === 0 ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.moveTo(ox, oy + y * z + 0.5 / dpr)
      ctx.lineTo(ox + w, oy + y * z + 0.5 / dpr)
      ctx.stroke()
    }
  }

  // Animation frame guides.
  const frame = editor.value.frameSize
  if (frame) {
    ctx.strokeStyle = 'rgba(220, 60, 60, 0.9)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    for (let y = frame; y < img.height; y += frame) {
      ctx.beginPath()
      ctx.moveTo(ox, oy + y * z)
      ctx.lineTo(ox + w, oy + y * z)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // Selection marquee.
  const sel = editor.value.selection
  if (sel && !props.readonly) {
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#000'
    ctx.strokeRect(
      ox + sel.x * z + 0.5,
      oy + sel.y * z + 0.5,
      sel.width * z - 1,
      sel.height * z - 1
    )
    ctx.lineDashOffset = 4
    ctx.strokeStyle = '#fff'
    ctx.strokeRect(
      ox + sel.x * z + 0.5,
      oy + sel.y * z + 0.5,
      sel.width * z - 1,
      sel.height * z - 1
    )
    ctx.lineDashOffset = 0
    ctx.setLineDash([])
  }

  // Pixel hovered on the 3D preview.
  const linked = editor.value.linkedHover
  if (linked?.source === '3d' && inBounds(img, linked.x, linked.y)) {
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ff2fb3'
    ctx.strokeRect(ox + linked.x * z + 1, oy + linked.y * z + 1, z - 2, z - 2)
  }

  // Hovered pixel.
  if (hover.value && !props.readonly && inBounds(img, hover.value.x, hover.value.y)) {
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.strokeRect(ox + hover.value.x * z + 0.5, oy + hover.value.y * z + 0.5, z - 1, z - 1)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.strokeRect(ox + hover.value.x * z - 0.5, oy + hover.value.y * z - 0.5, z + 1, z + 1)
  }
}

function cssColor(c: Rgba, alphaScale = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${((c[3] / 255) * alphaScale).toFixed(3)})`
}

function previewPoints(from: Point, to: Point, img: RgbaImage): Point[] {
  const transforms = mirrorTransforms(
    img.width,
    img.height,
    editor.value.mirrorX,
    editor.value.mirrorY
  )
  const out: Point[] = []
  for (const t of transforms) {
    const a = t(from)
    const b = t(to)
    if (editor.value.tool === 'line') out.push(...linePoints(a, b))
    else {
      const r = normalizeRect(a, b)
      if (editor.value.fillShapes) {
        for (let y = r.y; y < r.y + r.height; y++)
          for (let x = r.x; x < r.x + r.width; x++) out.push({ x, y })
      } else {
        out.push(...linePoints({ x: r.x, y: r.y }, { x: r.x + r.width - 1, y: r.y }))
        out.push(
          ...linePoints(
            { x: r.x, y: r.y + r.height - 1 },
            { x: r.x + r.width - 1, y: r.y + r.height - 1 }
          )
        )
        out.push(...linePoints({ x: r.x, y: r.y }, { x: r.x, y: r.y + r.height - 1 }))
        out.push(
          ...linePoints(
            { x: r.x + r.width - 1, y: r.y },
            { x: r.x + r.width - 1, y: r.y + r.height - 1 }
          )
        )
      }
    }
  }
  return out
}

// ---------- input ----------
type Gesture =
  | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { kind: 'stroke'; before: RgbaImage; last: Point; color: Rgba }
  | { kind: 'shape'; from: Point; color: Rgba }
  | { kind: 'select'; anchor: Point }
  | { kind: 'move'; dx: number; dy: number }
let gesture: Gesture | null = null

function toPixel(e: PointerEvent | WheelEvent): Point {
  const r = canvas.value!.getBoundingClientRect()
  return {
    x: Math.floor((e.clientX - r.left - offset.value.x) / zoom.value),
    y: Math.floor((e.clientY - r.top - offset.value.y) / zoom.value)
  }
}

function paintAt(img: RgbaImage, p: Point, color: Rgba): void {
  for (const t of mirrorTransforms(
    img.width,
    img.height,
    editor.value.mirrorX,
    editor.value.mirrorY
  )) {
    const q = t(p)
    setPixel(img, q.x, q.y, color)
  }
}

function onPointerDown(e: PointerEvent): void {
  const img = editor.value.image
  canvas.value?.setPointerCapture(e.pointerId)
  if (e.button === 1 || spaceDown.value || props.readonly) {
    gesture = {
      kind: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      ox: offset.value.x,
      oy: offset.value.y
    }
    return
  }
  if (!img || editor.value.peekVanilla) return
  const p = toPixel(e)
  const secondary = e.button === 2
  const color =
    editor.value.tool === 'eraser'
      ? TRANSPARENT
      : secondary
        ? editor.value.secondary
        : editor.value.primary
  const ed = editor.value

  switch (ed.tool) {
    case 'pencil':
    case 'eraser': {
      ed.commitFloating()
      const before = ed.snapshot()!
      paintAt(img, p, color)
      gesture = { kind: 'stroke', before, last: p, color }
      ed.touch()
      break
    }
    case 'bucket': {
      if (!inBounds(img, p.x, p.y)) return
      ed.commitFloating()
      const before = ed.snapshot()!
      floodFill(img, p.x, p.y, color, {
        tolerance: ed.bucketTolerance,
        contiguous: ed.bucketContiguous
      })
      ed.commit(before, 'fill')
      break
    }
    case 'eyedropper':
      if (inBounds(img, p.x, p.y))
        ed.useColor(getPixel(img, p.x, p.y), secondary ? 'secondary' : 'primary')
      break
    case 'line':
    case 'rect':
      ed.commitFloating()
      gesture = { kind: 'shape', from: p, color }
      preview.value = { from: p, to: p }
      break
    case 'select': {
      const sel = ed.selection
      if (sel && rectContains(sel, p)) {
        ed.liftSelection()
        const f = ed.floating
        if (f) gesture = { kind: 'move', dx: p.x - f.x, dy: p.y - f.y }
      } else {
        ed.deselect()
        gesture = { kind: 'select', anchor: p }
        ed.selection = { x: p.x, y: p.y, width: 1, height: 1 }
      }
      break
    }
  }
  schedule()
}

function onPointerMove(e: PointerEvent): void {
  const img = editor.value.image
  const p = toPixel(e)
  const changed = !hover.value || hover.value.x !== p.x || hover.value.y !== p.y
  hover.value = p
  if (changed) {
    const shown = displayed.value
    const inside = !!shown && inBounds(shown, p.x, p.y)
    emit('hover', inside && shown ? { x: p.x, y: p.y, color: getPixel(shown, p.x, p.y) } : null)
    // Publish the hovered pixel so the 3D preview can highlight it.
    if (!props.readonly) editor.value.linkedHover = inside ? { x: p.x, y: p.y, source: '2d' } : null
  }
  if (!gesture) {
    if (changed) schedule()
    return
  }
  switch (gesture.kind) {
    case 'pan':
      offset.value = {
        x: gesture.ox + e.clientX - gesture.startX,
        y: gesture.oy + e.clientY - gesture.startY
      }
      break
    case 'stroke':
      if (img && changed) {
        for (const q of linePoints(gesture.last, p)) paintAt(img, q, gesture.color)
        gesture.last = p
        editor.value.touch()
      }
      break
    case 'shape':
      preview.value = { from: gesture.from, to: p }
      break
    case 'select':
      editor.value.selection = clampToImage(normalizeRect(gesture.anchor, p))
      break
    case 'move':
      editor.value.moveFloating(p.x - gesture.dx, p.y - gesture.dy)
      break
  }
  schedule()
}

function clampToImage(r: Rect): Rect {
  const img = editor.value.image
  if (!img) return r
  const x = Math.max(0, r.x)
  const y = Math.max(0, r.y)
  return {
    x,
    y,
    width: Math.max(1, Math.min(img.width, r.x + r.width) - x),
    height: Math.max(1, Math.min(img.height, r.y + r.height) - y)
  }
}

function onPointerUp(e: PointerEvent): void {
  canvas.value?.releasePointerCapture(e.pointerId)
  const g = gesture
  gesture = null
  const ed = editor.value
  const img = ed.image
  if (!g || !img) return
  if (g.kind === 'stroke') ed.commit(g.before, ed.tool === 'eraser' ? 'erase' : 'draw')
  if (g.kind === 'shape' && preview.value) {
    const before = ed.snapshot()!
    const { from, to } = preview.value
    for (const t of mirrorTransforms(img.width, img.height, ed.mirrorX, ed.mirrorY)) {
      const a = t(from)
      const b = t(to)
      if (ed.tool === 'line') drawLine(img, a, b, g.color)
      else if (ed.fillShapes) fillRect(img, normalizeRect(a, b), g.color)
      else drawRect(img, normalizeRect(a, b), g.color)
    }
    preview.value = null
    ed.commit(before, ed.tool === 'line' ? 'line' : 'rect')
  }
  schedule()
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const img = displayed.value
  if (!img) return
  // Plain wheel / two-finger scroll pans; Ctrl/Cmd + wheel (and trackpad pinch, reported as ctrlKey) zooms.
  if (!e.ctrlKey && !e.metaKey) {
    const dx = e.shiftKey ? e.deltaY : e.deltaX
    const dy = e.shiftKey ? 0 : e.deltaY
    offset.value = { x: Math.round(offset.value.x - dx), y: Math.round(offset.value.y - dy) }
    schedule()
    return
  }
  const before = zoom.value
  const after = nextZoom(before, e.deltaY < 0 ? 1 : -1)
  if (after === before) return
  // Keep the pixel under the cursor in place.
  const r = canvas.value!.getBoundingClientRect()
  const cx = e.clientX - r.left
  const cy = e.clientY - r.top
  offset.value = {
    x: Math.round(cx - ((cx - offset.value.x) / before) * after),
    y: Math.round(cy - ((cy - offset.value.y) / before) * after)
  }
  zoom.value = after
  schedule()
}

function onLeave(): void {
  hover.value = null
  emit('hover', null)
  if (!props.readonly && editor.value.linkedHover?.source === '2d') editor.value.linkedHover = null
  schedule()
}

function onKey(e: KeyboardEvent): void {
  if (e.code === 'Space') spaceDown.value = e.type === 'keydown'
}

function zoomBy(step: 1 | -1): void {
  const before = zoom.value
  const after = nextZoom(before, step)
  const cx = size.value.width / 2
  const cy = size.value.height / 2
  offset.value = {
    x: Math.round(cx - ((cx - offset.value.x) / before) * after),
    y: Math.round(cy - ((cy - offset.value.y) / before) * after)
  }
  zoom.value = after
  schedule()
}

defineExpose({ fit, zoomBy })

watch(
  () => [
    editor.value.revision,
    editor.value.showGrid,
    editor.value.selection,
    editor.value.peekVanilla,
    editor.value.floating,
    zoom.value,
    props.source,
    editor.value.linkedHover
  ],
  schedule
)
watch(
  () => editor.value.path,
  () => {
    zoom.value = 0
    schedule()
  }
)
// The vanilla pane follows texture changes of the main pane.
watch(
  () => [editor.value.vanilla, editor.value.frameSize],
  () => {
    if (props.readonly) {
      localZoom.value = 0
      schedule()
    }
  }
)

onMounted(() => {
  resizeObserver = new ResizeObserver(([entryRect]) => {
    const { width, height } = entryRect.contentRect
    const changed =
      Math.abs(width - size.value.width) > 1 || Math.abs(height - size.value.height) > 1
    size.value = { width, height }
    // Refit when the view size changes (window resize, compare split) so the texture stays visible.
    if (changed || zoom.value === 0) fit()
    schedule()
  })
  if (host.value) resizeObserver.observe(host.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKey)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div ref="host" class="host" :class="{ panning: spaceDown }" data-testid="pixel-canvas-host">
    <canvas
      ref="canvas"
      class="canvas"
      :data-testid="source === 'vanilla' ? 'vanilla-canvas' : 'pixel-canvas'"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onLeave"
      @wheel="onWheel"
      @contextmenu.prevent
    />
  </div>
</template>

<style scoped>
.host {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgba(128, 128, 128, 0.08);
  border-radius: 6px;
}
.host.panning {
  cursor: grab;
}
.canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: crosshair;
}
</style>
