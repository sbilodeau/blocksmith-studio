<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { NButton, NButtonGroup, NSelect, NSpace, NSwitch, NTag, NText, NTooltip } from 'naive-ui'
import { decodePng, type RgbaImage } from '@shared/image'
import type { PreviewModel } from '@shared/model/preview'
import { entityFitsTexture } from '@shared/preview/entities'
import {
  buildBlock,
  buildEntity,
  buildFlat,
  buildItem,
  disposeObject,
  makeDataTexture,
  setFrame,
  updateDataTexture,
  type EntityRig,
  type ShadingMode,
  type TextureSlot
} from './builders'
import { parseAnimation, frameAt, type AnimationInfo } from './animation'
import type { PreviewSource, StripPixel } from './source'
import { call } from '../../services/ipc'

/**
 * Live 3D preview of the texture open in the editor (PLAN 3.4). `source` is the editor store (docked panel) or
 * the state relayed to the pop-out window (`popout`).
 */
const props = defineProps<{
  source: PreviewSource
  popout?: boolean
  /** A view only (item page): no painting on the model, no pop-out. */
  readonly?: boolean
}>()
const emit = defineEmits<{ popout: [] }>()
const { t } = useI18n()
const source = computed(() => props.source)

const host = ref<HTMLDivElement | null>(null)
const rawModel = shallowRef<PreviewModel | null>(null)
const FLAT: PreviewModel = { kind: 'flat' }
/** The model to draw: an entity whose UV layout does not fit the texture's size is shown flat instead. */
const model = computed<PreviewModel | null>(() => {
  const m = rawModel.value
  const img = source.value.strip
  if (m?.kind === 'entity' && img) {
    // Animated textures are strips: compare one frame.
    const frameHeight = parseAnimation(source.value.mcmeta, img)?.frameHeight ?? img.height
    if (!entityFitsTexture(m.definition, img.width, frameHeight)) return FLAT
  }
  return m
})
const loadingModel = ref(false)
const failed = ref(false)

const shading = ref<ShadingMode>('game')
const background = ref<'dark' | 'light' | 'checker' | 'sky'>('dark')
const autoRotate = ref(false)
const walk = ref(false)
const showFloor = ref(false)
/** Paint mode: left-drag paints on the model with the editor's tool, right-drag orbits. */
const painting = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let root: THREE.Object3D | null = null
let floor: THREE.GridHelper | null = null
let rig: EntityRig | null = null
let resizeObserver: ResizeObserver | null = null
let raf = 0
let needsRender = true
let visible = true
const clock = new THREE.Clock()

/** Texture slots: the edited texture (live) plus other textures the block model uses (loaded once). */
let editedSlot: TextureSlot | null = null
const otherSlots = new Map<string, TextureSlot>()
let animation: AnimationInfo | null = null

const backgrounds = {
  dark: 'linear-gradient(#2b2f3a, #16181e)',
  light: 'linear-gradient(#ffffff, #dfe3ea)',
  checker: 'repeating-conic-gradient(#d0d0d0 0% 25%, #f4f4f4 0% 50%) 50% / 24px 24px',
  sky: 'linear-gradient(#78a7ff, #c4dcff)'
}

const backgroundOptions = computed(() =>
  (['dark', 'light', 'checker', 'sky'] as const).map((b) => ({
    value: b,
    label: t(`preview.background.${b}`)
  }))
)

/** Entity textures shown flat because no built-in model covers them (or the layout does not fit). */
const noEntityModel = computed(
  () => model.value?.kind === 'flat' && (source.value.path ?? '').includes('/textures/entity/')
)
const kindLabel = computed(() => (model.value ? t(`preview.kind.${model.value.kind}`) : ''))
const canWalk = computed(
  () => model.value?.kind === 'entity' && (model.value.definition.animation ?? 'none') !== 'none'
)

// ---------- scene ----------
function init(): void {
  if (!host.value) return
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.value.appendChild(renderer.domElement)
  renderer.domElement.setAttribute('data-testid', 'preview3d-canvas')

  scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(30, 50, 40)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xffffff, 0.6)
  fill.position.set(-40, 10, -30)
  scene.add(fill)

  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.addEventListener('change', () => (needsRender = true))
  applyMouseButtons()

  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointercancel', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', () => source.value.setHover3d(null))

  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(host.value)
  resize()
  loop()
}

function resize(): void {
  if (!renderer || !camera || !host.value) return
  const { clientWidth: w, clientHeight: h } = host.value
  if (w === 0 || h === 0) return
  renderer.setSize(w, h, false)
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  needsRender = true
}

function loop(): void {
  raf = requestAnimationFrame(loop)
  if (!renderer || !scene || !camera || !controls || !visible) return
  clock.getDelta()
  const elapsed = clock.elapsedTime
  controls.autoRotate = autoRotate.value
  controls.autoRotateSpeed = 2
  controls.update()
  if (walk.value && rig) {
    animateWalk(rig, elapsed)
    needsRender = true
  }
  if (animation && editedSlot) {
    // In the editor the 3D view shows the frame being edited, and plays the animation when asked.
    const frame = source.value.editingFrame ?? frameAt(animation, elapsed * 1000)
    setFrame(editedSlot.texture, frame, editedSlot.frameHeight, editedSlot.image.height)
    needsRender = true
  }
  if (needsRender || autoRotate.value) {
    renderer.render(scene, camera)
    needsRender = false
  }
}

function animateWalk(r: EntityRig, time: number): void {
  const swing = Math.sin(time * 6) * 0.6
  const set = (role: string, angle: number): void => {
    const part = r.roles.get(role)
    if (!part) return
    const rest = part.userData['rest'] as THREE.Euler
    part.rotation.x = rest.x + angle
  }
  set('rightArm', swing)
  set('leftArm', -swing)
  set('rightLeg', -swing)
  set('leftLeg', swing)
  set('frontRightLeg', swing)
  set('backLeftLeg', swing)
  set('frontLeftLeg', -swing)
  set('backRightLeg', -swing)
}

function resetPose(): void {
  if (!rig) return
  for (const part of rig.roles.values()) part.rotation.copy(part.userData['rest'] as THREE.Euler)
  needsRender = true
}

// ---------- model ----------
async function loadModel(): Promise<void> {
  const path = source.value.path
  if (!path) return
  loadingModel.value = true
  failed.value = false
  try {
    rawModel.value = await call('texture.preview', { packId: source.value.packId, path })
    await loadOtherTextures()
    rebuild()
    // A flat texture is a single plane: show it facing the camera, not at the 3/4 angle.
    view(model.value?.kind === 'flat' ? 'front' : 'iso')
  } catch (err) {
    console.error(err)
    failed.value = true
  } finally {
    loadingModel.value = false
  }
}

async function loadOtherTextures(): Promise<void> {
  for (const slot of otherSlots.values()) slot.texture.dispose()
  otherSlots.clear()
  const m = model.value
  if (m?.kind !== 'block') return
  const paths = new Set<string>()
  for (const el of m.elements) for (const f of Object.values(el.faces)) if (f) paths.add(f.texture)
  paths.delete(source.value.path ?? '')
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        const data = await call('texture.read', { packId: source.value.packId, path: p })
        if (!data.png) return
        const img = decodePng(data.png)
        const anim = parseAnimation(data.mcmeta, img)
        otherSlots.set(p, {
          image: img,
          texture: makeDataTexture(img, anim?.frameHeight ?? img.height),
          frameHeight: anim?.frameHeight ?? img.height
        })
      } catch {
        // Missing textures simply leave those faces out.
      }
    })
  )
}

function makeEditedSlot(img: RgbaImage): TextureSlot {
  animation = parseAnimation(source.value.mcmeta, img)
  const frameHeight = animation?.frameHeight ?? img.height
  return { image: img, texture: makeDataTexture(img, frameHeight), frameHeight }
}

function rebuild(): void {
  if (!scene) return
  if (root) {
    scene.remove(root)
    disposeObject(root)
    root = null
  }
  rig = null
  const img = source.value.strip
  const m = model.value
  if (!img || !m) return
  editedSlot?.texture.dispose()
  editedSlot = makeEditedSlot(img)
  const slots = new Map(otherSlots)
  if (source.value.path) slots.set(source.value.path, editedSlot)

  if (m.kind === 'block') root = buildBlock(m, slots, shading.value)
  else if (m.kind === 'item') root = buildItem(editedSlot, shading.value)
  else if (m.kind === 'entity') {
    rig = buildEntity(m.definition, editedSlot, shading.value)
    root = rig.group
    // Center entities vertically on their mid-height.
    const box = new THREE.Box3().setFromObject(root)
    root.position.y = -(box.min.y + box.max.y) / 2
  } else root = buildFlat(editedSlot)
  scene.add(root)
  updateFloor()
  needsRender = true
}

function updateFloor(): void {
  if (!scene) return
  if (floor) {
    scene.remove(floor)
    floor.dispose()
    floor = null
  }
  if (!showFloor.value || !root) return
  const box = new THREE.Box3().setFromObject(root)
  floor = new THREE.GridHelper(64, 16, 0x888888, 0x555555)
  floor.position.y = box.min.y - 0.01
  scene.add(floor)
  needsRender = true
}

/** Preset camera views around the model. */
function view(name: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'): void {
  if (!camera || !controls || !root) return
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const dist = Math.max(size.x, size.y, size.z) * 3.1 + 8
  const dirs: Record<typeof name, [number, number, number]> = {
    front: [0, 0, 1],
    back: [0, 0, -1],
    left: [1, 0, 0],
    right: [-1, 0, 0],
    top: [0, 1, 0.0001],
    bottom: [0, -1, 0.0001],
    iso: [0.8, 0.6, 1]
  }
  const d = new THREE.Vector3(...dirs[name]).normalize().multiplyScalar(dist)
  controls.target.copy(center)
  camera.position.copy(center).add(d)
  camera.lookAt(center)
  controls.update()
  needsRender = true
}

// ---------- live updates and hover link ----------
function applyEdits(): void {
  const img = source.value.strip
  if (!img || !editedSlot) return
  const hover = source.value.hover2d ?? undefined
  if (!updateDataTexture(editedSlot.texture, img, hover)) {
    rebuild() // size changed (rotate on a non-square texture)
    return
  }
  // Items depend on the alpha mask for their side walls.
  if (model.value?.kind === 'item') rebuild()
  needsRender = true
}

const raycaster = new THREE.Raycaster()
/** The texture pixel under the pointer on the edited texture's faces (strip coordinates), or null. */
function pickPixel(e: PointerEvent): StripPixel | null {
  if (!renderer || !camera || !root || !editedSlot) return null
  const r = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1
  )
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster
    .intersectObject(root, true)
    .find(
      (h) =>
        (h.object.userData['textureObject'] as THREE.Texture | undefined) === editedSlot?.texture &&
        h.uv
    )
  if (!hit?.uv) return null
  const tex = editedSlot.texture
  const u = hit.uv.x * tex.repeat.x + tex.offset.x
  const v = hit.uv.y * tex.repeat.y + tex.offset.y
  return {
    x: Math.min(editedSlot.image.width - 1, Math.max(0, Math.floor(u * editedSlot.image.width))),
    y: Math.min(editedSlot.image.height - 1, Math.max(0, Math.floor(v * editedSlot.image.height)))
  }
}

// ---------- painting on the model ----------
/** Stroke in progress: the last painted pixel. */
let stroke: StripPixel | null = null

/** In paint mode the left button paints: orbit moves to the right button, zoom stays on the wheel. */
function applyMouseButtons(): void {
  if (!controls) return
  controls.mouseButtons = painting.value
    ? { LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
}

function onPointerDown(e: PointerEvent): void {
  if (!painting.value || e.button !== 0) return
  const pixel = pickPixel(e)
  if (!pixel) return
  stroke = pixel
  source.value.paintStart(pixel, e.shiftKey)
}

function onPointerMove(e: PointerEvent): void {
  const pixel = pickPixel(e)
  source.value.setHover3d(pixel)
  if (!stroke || !pixel) return
  // Neighboring pixels are joined by a line; a jump (another face of the model) starts a new segment.
  const near = Math.max(Math.abs(pixel.x - stroke.x), Math.abs(pixel.y - stroke.y)) <= 3
  source.value.paintMove(pixel, near)
  stroke = pixel
}

function onPointerUp(): void {
  if (!stroke) return
  stroke = null
  source.value.paintEnd()
}

watch(() => source.value.path, loadModel)
watch(() => source.value.revision, applyEdits)
// Timing edits (frametime, frame order) change the playback without changing the image size.
watch(
  () => source.value.mcmeta,
  () => {
    const img = source.value.strip
    if (img && editedSlot) animation = parseAnimation(source.value.mcmeta, img)
  }
)
watch(() => {
  const h = source.value.hover2d
  return h ? `${h.x},${h.y}` : ''
}, applyEdits)
watch(painting, () => {
  onPointerUp()
  applyMouseButtons()
})
watch(shading, rebuild)
watch(showFloor, updateFloor)
watch(walk, (on) => {
  if (!on) resetPose()
})

function onVisibility(): void {
  visible = !document.hidden
  needsRender = true
}

onMounted(() => {
  init()
  void loadModel()
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  document.removeEventListener('visibilitychange', onVisibility)
  resizeObserver?.disconnect()
  if (root) disposeObject(root)
  editedSlot?.texture.dispose()
  for (const slot of otherSlots.values()) slot.texture.dispose()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  onPointerUp()
  source.value.setHover3d(null)
})
</script>

<template>
  <div class="preview" data-testid="preview3d">
    <div class="bar">
      <n-space size="small" align="center" :wrap="true">
        <n-text depth="3" class="kind" data-testid="preview3d-kind">{{ kindLabel }}</n-text>
        <n-tooltip v-if="model?.kind === 'entity' && model.source === 'jar'">
          <template #trigger>
            <n-tag size="tiny" :bordered="false" type="success" data-testid="preview3d-from-game">
              {{ t('preview.fromGame') }}
            </n-tag>
          </template>
          {{ t('preview.fromGameHint') }}
        </n-tooltip>
        <n-button-group size="tiny">
          <n-button
            v-for="v in ['front', 'back', 'left', 'right', 'top', 'iso'] as const"
            :key="v"
            @click="view(v)"
          >
            {{ t(`preview.view.${v}`) }}
          </n-button>
        </n-button-group>
        <n-tooltip v-if="!readonly">
          <template #trigger>
            <n-button
              size="tiny"
              :type="painting ? 'primary' : 'default'"
              :aria-pressed="painting"
              data-testid="preview3d-paint"
              @click="painting = !painting"
            >
              {{ t('preview.paint') }}
            </n-button>
          </template>
          {{ t('preview.paintHint') }}
        </n-tooltip>
        <n-tooltip v-if="!popout && !readonly">
          <template #trigger>
            <n-button size="tiny" data-testid="preview3d-popout" @click="emit('popout')">
              {{ t('preview.popOut') }}
            </n-button>
          </template>
          {{ t('preview.popOutHint') }}
        </n-tooltip>
      </n-space>
    </div>
    <div
      ref="host"
      class="host"
      :class="{ painting }"
      :style="{ background: backgrounds[background] }"
    >
      <div v-if="loadingModel || failed" class="note">
        <n-text depth="3">{{ failed ? t('preview.failed') : t('preview.loading') }}</n-text>
      </div>
      <div v-else-if="noEntityModel" class="banner" data-testid="preview3d-no-model">
        <n-text depth="2">{{ t('preview.noEntityModel') }}</n-text>
      </div>
    </div>
    <div class="bar">
      <n-space size="small" align="center" :wrap="true">
        <n-tooltip>
          <template #trigger>
            <n-switch
              v-model:value="autoRotate"
              size="small"
              :aria-label="t('preview.autoRotate')"
              data-testid="preview3d-rotate"
            />
          </template>
          {{ t('preview.autoRotate') }}
        </n-tooltip>
        <n-text depth="3" class="label">{{ t('preview.autoRotate') }}</n-text>
        <template v-if="canWalk">
          <n-switch
            v-model:value="walk"
            size="small"
            :aria-label="t('preview.walk')"
            data-testid="preview3d-walk"
          />
          <n-text depth="3" class="label">{{ t('preview.walk') }}</n-text>
        </template>
        <n-switch v-model:value="showFloor" size="small" :aria-label="t('preview.floor')" />
        <n-text depth="3" class="label">{{ t('preview.floor') }}</n-text>
        <n-select
          v-model:value="shading"
          size="tiny"
          style="width: 110px"
          :options="[
            { value: 'game', label: t('preview.shading.game') },
            { value: 'studio', label: t('preview.shading.studio') }
          ]"
        />
        <n-select
          v-model:value="background"
          size="tiny"
          style="width: 100px"
          :options="backgroundOptions"
        />
      </n-space>
    </div>
  </div>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 4px;
}
.bar {
  flex: none;
}
.kind,
.label {
  font-size: 11px;
}
.host {
  position: relative;
  flex: 1;
  min-height: 120px;
  border-radius: 6px;
  overflow: hidden;
}
.host :deep(canvas) {
  display: block;
  cursor: grab;
}
.host.painting :deep(canvas) {
  cursor: crosshair;
}
.banner {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.banner :deep(.n-text) {
  color: #e8e8e8;
}
.note {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
</style>
