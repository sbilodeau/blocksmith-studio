<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
import BulkDialog from '../bulk/BulkDialog.vue'
import MergeDialog from '../merge/MergeDialog.vue'
import { usePackStore, type StatusFilter } from '../../stores/pack'

const props = defineProps<{ packId: string }>()
// The grid edits its pack's view state (search, filter, zoom) directly in the per-pack store.
const store = computed(() => usePackStore(props.packId))
const { t } = useI18n()

const filters: StatusFilter[] = ['all', 'changed', 'vanilla']
const showBulk = ref(false)
const showSend = ref(false)
/** Selected textures in pack order (bulk actions and the navigation agent use this order). */
const selectedPaths = computed(() =>
  store.value.textures.filter((tex) => store.value.selection.has(tex.path)).map((tex) => tex.path)
)
/** Send to pack: only the pack's own files (unchanged vanilla textures are not copied). */
const sendPaths = computed(() =>
  store.value.textures
    .filter((tex) => store.value.selection.has(tex.path) && tex.status !== 'vanilla')
    .map((tex) => tex.path)
)

// The editor replaces the grid: keep its scroll position, and on return show the last edited tile
// (the editor's previous / next buttons may have moved to a texture further down).
const scroller = ref<HTMLElement | null>(null)
onMounted(async () => {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTop = store.value.gridScroll
  const last = store.value.lastEdited
  if (last) {
    const tile = el.querySelector<HTMLElement>(`[data-path="${CSS.escape(last)}"]`)
    tile?.scrollIntoView({ block: 'nearest' })
    store.value.lastEdited = null
  }
})
onBeforeUnmount(() => {
  if (scroller.value) store.value.gridScroll = scroller.value.scrollTop
})

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

    <!-- The bar's row is always reserved so selecting a tile never moves the grid (a double-click stays on it). -->
    <div class="selection-slot">
      <div v-if="store.selection.size > 0" class="selection" data-testid="selection-bar">
        <n-text class="selected-count">{{
          t('grid.selected', { count: store.selection.size }, store.selection.size)
        }}</n-text>
        <n-button size="tiny" quaternary @click="store.selectAll()">{{
          t('grid.selectAll')
        }}</n-button>
        <n-button size="tiny" quaternary @click="store.clearSelection()">{{
          t('grid.clearSelection')
        }}</n-button>
        <span class="spacer" />
        <n-button size="tiny" data-testid="selection-bulk" @click="showBulk = true">{{
          t('bulk.open')
        }}</n-button>
        <n-button
          size="tiny"
          :disabled="sendPaths.length === 0"
          :title="sendPaths.length === 0 ? t('merge.sendNothing') : undefined"
          data-testid="selection-send"
          @click="showSend = true"
        >
          {{ t('merge.send') }}
        </n-button>
        <n-button
          size="tiny"
          :type="store.aiPanel ? 'primary' : 'default'"
          data-testid="selection-ai"
          @click="store.aiPanel = true"
        >
          {{ t('ai.askSelection') }}
        </n-button>
      </div>
    </div>
    <bulk-dialog v-model:show="showBulk" :pack-id="packId" :paths="selectedPaths" />
    <merge-dialog v-model:show="showSend" mode="send" :source-pack-id="packId" :paths="sendPaths" />

    <div ref="scroller" class="scroll" tabindex="0" data-testid="texture-grid" @keydown="onKeydown">
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
.selection-slot {
  flex-shrink: 0;
  height: 30px;
  margin-bottom: 6px;
}
/* One line at any width: labels shrink with an ellipsis instead of wrapping. */
.selection {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  box-sizing: border-box;
  padding: 0 8px;
  overflow: hidden;
  white-space: nowrap;
  border-radius: 6px;
  background: rgba(24, 160, 88, 0.12);
  font-size: 13px;
}
.selected-count {
  flex-shrink: 0;
}
.selection :deep(.n-button) {
  flex-shrink: 1;
  min-width: 0;
}
.selection :deep(.n-button__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
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
