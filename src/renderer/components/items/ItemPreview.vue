<script setup lang="ts">
import { reactive, shallowRef, watch } from 'vue'
import { decodePng, type RgbaImage } from '@shared/image'
import Preview3d from '../preview3d/Preview3D.vue'
import type { PreviewSource } from '../preview3d/source'
import { call } from '../../services/ipc'

/**
 * Read-only 3D preview of a custom item's texture (item page). The texture is read again whenever `revision`
 * changes (a save, a pixel editor save, an undo).
 */
const props = defineProps<{ packId: string; path: string; revision: number }>()

const strip = shallowRef<RgbaImage | null>(null)
const state = reactive({ mcmeta: null as string | null, revision: 0 })

async function load(): Promise<void> {
  const path = props.path
  try {
    const data = await call('texture.read', { packId: props.packId, path })
    if (path !== props.path) return
    strip.value = data.png ? decodePng(data.png) : null
    state.mcmeta = data.mcmeta
  } catch {
    strip.value = null
  }
  state.revision++
}
watch(() => [props.path, props.revision], load, { immediate: true })

const source: PreviewSource = {
  get packId() {
    return props.packId
  },
  get path() {
    return strip.value ? props.path : null
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
  editingFrame: null,
  hover2d: null,
  setHover3d: () => undefined,
  paintStart: () => undefined,
  paintMove: () => undefined,
  paintEnd: () => undefined
}
</script>

<template>
  <div class="item-preview" data-testid="item-preview">
    <preview3d :key="path" :source="source" readonly class="view" />
  </div>
</template>

<style scoped>
.item-preview {
  height: 300px;
  display: flex;
  flex-direction: column;
}
.view {
  flex: 1;
  min-height: 0;
}
</style>
