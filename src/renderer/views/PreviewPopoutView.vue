<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { NText } from 'naive-ui'
import type { RgbaImage } from '@shared/image'
import type { PopoutInput, PopoutState } from '@shared/model/popout'
import Preview3d from '../components/preview3d/Preview3D.vue'
import type { PreviewSource, StripPixel } from '../components/preview3d/source'
import { call } from '../services/ipc'

/**
 * The pop-out 3D preview window (M11): shows the texture open in one pack tab's editor, with the state relayed by
 * main, and sends hover and painting input back to that editor.
 */
const props = defineProps<{ packId: string }>()
const { t } = useI18n()

const strip = shallowRef<RgbaImage | null>(null)
const state = reactive({
  path: null as string | null,
  mcmeta: null as string | null,
  revision: 0,
  editingFrame: null as number | null,
  hover2d: null as StripPixel | null
})

function send(input: PopoutInput): void {
  void call('preview.popout.input', { packId: props.packId, input }).catch(() => undefined)
}

let lastHover = ''
const source: PreviewSource = {
  get packId() {
    return props.packId
  },
  get path() {
    return state.path
  },
  get strip() {
    return strip.value
  },
  get mcmeta() {
    return state.mcmeta
  },
  get revision() {
    return state.revision
  },
  get editingFrame() {
    return state.editingFrame
  },
  get hover2d() {
    return state.hover2d
  },
  setHover3d(pixel) {
    const key = pixel ? `${pixel.x},${pixel.y}` : ''
    if (key === lastHover) return
    lastHover = key
    send(pixel ? { kind: 'hover', ...pixel } : { kind: 'hoverEnd' })
  },
  paintStart(pixel, secondary) {
    send({ kind: 'paintStart', ...pixel, secondary })
  },
  paintMove(pixel, connect) {
    send({ kind: 'paintMove', ...pixel, connect })
  },
  paintEnd() {
    send({ kind: 'paintEnd' })
  }
}

function apply(next: PopoutState): void {
  if (next.image) {
    const { width, height, rgba } = next.image
    strip.value = {
      width,
      height,
      data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength)
    }
    state.revision++
  }
  if (!next.path) strip.value = null
  state.path = next.path
  state.mcmeta = next.mcmeta
  state.editingFrame = next.editingFrame
  state.hover2d = next.hover
}

let off: (() => void) | null = null
onMounted(() => {
  off = window.blocksmith.on('preview.popout.state', (payload) => {
    if (payload.packId === props.packId) apply(payload.state)
  })
  send({ kind: 'ready' })
})
onBeforeUnmount(() => off?.())
</script>

<template>
  <div class="popout" data-testid="preview3d-popout-window">
    <n-text v-if="!state.path" depth="3" class="empty" data-testid="popout-empty">
      {{ t('preview.popoutEmpty') }}
    </n-text>
    <template v-else>
      <n-text depth="3" class="path" data-testid="popout-path">{{ state.path }}</n-text>
      <preview3d :key="state.path" :source="source" popout class="view" />
    </template>
  </div>
</template>

<style scoped>
.popout {
  height: 100%;
  box-sizing: border-box;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.view {
  flex: 1;
  min-height: 0;
}
.empty {
  margin: auto;
}
</style>
