<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NEmpty,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSlider,
  NSpace,
  NText,
  NButton
} from 'naive-ui'
import TextureTile from './TextureTile.vue'
import { usePackStore, type StatusFilter } from '../../stores/pack'

const props = defineProps<{ packId: string }>()
// The grid edits its pack's view state (search, filter, zoom) directly in the per-pack store.
const store = computed(() => usePackStore(props.packId))
const { t } = useI18n()

const filters: StatusFilter[] = ['all', 'changed', 'vanilla']

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    store.value.selectAll()
  } else if (e.key === 'Escape') {
    store.value.clearSelection()
  } else if (e.key === 'Enter' && store.value.selection.size > 0) {
    // Open the first selected texture (in grid order) in the editor.
    const first = store.value.visible.find((tex) => store.value.selection.has(tex.path))
    if (first) store.value.openEditor(first.path)
  }
}
</script>

<template>
  <div class="grid-view" data-testid="texture-grid-view">
    <n-space align="center" class="toolbar" :wrap="true">
      <n-input
        v-model:value="store.search"
        clearable
        size="small"
        :placeholder="t('grid.search')"
        style="width: 220px"
        data-testid="grid-search"
      />
      <n-radio-group v-model:value="store.statusFilter" size="small" data-testid="grid-status">
        <n-radio-button v-for="f in filters" :key="f" :value="f" :data-testid="`grid-status-${f}`">
          {{ t(`grid.filter.${f}`) }}
        </n-radio-button>
      </n-radio-group>
      <n-space align="center" size="small" class="zoom">
        <n-text depth="3">{{ t('grid.zoom') }}</n-text>
        <n-slider v-model:value="store.zoom" :min="32" :max="160" :step="16" style="width: 120px" />
      </n-space>
      <n-text depth="3" class="count" data-testid="grid-count">
        {{ t('grid.count', { shown: store.visible.length, total: store.textures.length }) }}
      </n-text>
    </n-space>

    <div v-if="store.selection.size > 0" class="selection" data-testid="selection-bar">
      <n-text>{{
        t('grid.selected', { count: store.selection.size }, store.selection.size)
      }}</n-text>
      <n-button size="tiny" quaternary @click="store.selectAll()">{{
        t('grid.selectAll')
      }}</n-button>
      <n-button size="tiny" quaternary @click="store.clearSelection()">{{
        t('grid.clearSelection')
      }}</n-button>
    </div>

    <div class="scroll" tabindex="0" data-testid="texture-grid" @keydown="onKeydown">
      <n-empty v-if="store.visible.length === 0" :description="t('grid.empty')" class="empty" />
      <div v-else class="tiles">
        <texture-tile
          v-for="tex in store.visible"
          :key="tex.path"
          :texture="tex"
          :size="store.zoom"
          :selected="store.selection.has(tex.path)"
          @pick="(mode) => store.select(tex.path, mode)"
          @open="store.openEditor(tex.path)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.toolbar {
  padding: 0 0 8px;
}
.count {
  font-size: 12px;
}
.selection {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  margin-bottom: 6px;
  border-radius: 6px;
  background: rgba(24, 160, 88, 0.12);
  font-size: 13px;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  outline: none;
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-content: flex-start;
}
.empty {
  margin-top: 48px;
}
</style>
