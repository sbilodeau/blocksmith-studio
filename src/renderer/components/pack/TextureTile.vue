<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TextureEntry } from '@shared/model/pack'
import { TILE_CHROME } from './grid-layout'

const props = defineProps<{ texture: TextureEntry; size: number; selected: boolean }>()
const emit = defineEmits<{ pick: [mode: 'single' | 'toggle' | 'range']; open: [] }>()
const { t } = useI18n()

// Animated strips show their first frame (width-fit, top aligned); other textures are contained.
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  backgroundImage: `url("${props.texture.url}")`,
  backgroundSize: props.texture.animated ? '100% auto' : 'contain'
}))

function onClick(e: MouseEvent): void {
  emit('pick', e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')
}
</script>

<template>
  <div
    class="tile"
    :class="{ selected }"
    :title="texture.path"
    :style="{ width: `${size + TILE_CHROME.width}px`, height: `${size + TILE_CHROME.height}px` }"
    :data-testid="`tile-${texture.name}`"
    :data-path="texture.path"
    :data-status="texture.status"
    @click="onClick"
    @dblclick="emit('open')"
  >
    <div class="img pixelated" :style="style" />
    <div class="name">{{ texture.name }}</div>
    <span
      v-if="texture.status !== 'vanilla'"
      class="badge"
      :class="texture.status"
      :title="t(`pack.status.${texture.status}`)"
    />
    <span v-if="texture.animated" class="anim" :title="t('pack.animated')" />
  </div>
</template>

<style scoped>
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0 6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  /* Fixed size (set inline from the zoom): the virtual grid computes rows from it. */
  overflow: hidden;
  border: 2px solid transparent;
  box-sizing: border-box;
}
.tile:hover {
  background: rgba(128, 128, 128, 0.12);
}
.tile.selected {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.14);
}
.img {
  background-repeat: no-repeat;
  background-position: center top;
  image-rendering: pixelated;
  background-color: rgba(128, 128, 128, 0.08);
}
.name {
  font-size: 11px;
  line-height: 16px;
  height: 16px;
  max-width: 100%;
  padding: 0 4px;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.8);
}
.badge.modified {
  background: #f0a020;
}
.badge.added {
  background: #18a058;
}
.anim::before {
  content: '\25B6';
}
.anim {
  position: absolute;
  top: 2px;
  left: 6px;
  font-size: 10px;
  opacity: 0.6;
}
</style>
