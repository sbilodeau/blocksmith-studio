<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NBadge, NButton, NText } from 'naive-ui'
import type { CategorySummary } from '@shared/model/pack'
import { ALL_CATEGORIES } from '../../stores/pack'
import { useCategoryName } from './category-name'
import CategoryEditorDialog from './CategoryEditorDialog.vue'

const props = defineProps<{
  categories: CategorySummary[]
  active: string | null
  total: number
  changed: number
  /** Pack of the tab: enables the "Edit categories" button (category mapping editor). */
  packId?: string
}>()
const emit = defineEmits<{ select: [id: string | null] }>()
const { t } = useI18n()
const label = useCategoryName()
const showEditor = ref(false)
</script>

<template>
  <nav class="sidebar" data-testid="category-sidebar">
    <button
      class="item"
      :class="{ active: active === null }"
      data-testid="cat-overview"
      @click="emit('select', null)"
    >
      <span class="label">{{ t('pack.overview') }}</span>
    </button>
    <button
      class="item"
      :class="{ active: active === ALL_CATEGORIES }"
      data-testid="cat-all"
      @click="emit('select', ALL_CATEGORIES)"
    >
      <span class="label">{{ t('pack.allTextures') }}</span>
      <n-text depth="3" class="count">{{ total }}</n-text>
    </button>
    <div class="sep" />
    <button
      v-for="c in categories"
      :key="c.id"
      class="item"
      :class="{ active: active === c.id }"
      :data-testid="`cat-${c.id}`"
      @click="emit('select', c.id)"
    >
      <img v-if="c.iconUrl" :src="c.iconUrl" alt="" class="icon pixelated" />
      <span v-else class="icon" />
      <span class="label">{{ label(c) }}</span>
      <n-badge v-if="c.changedCount > 0" :value="c.changedCount" type="warning" :max="999" />
      <n-text depth="3" class="count">{{ c.count }}</n-text>
    </button>
    <n-button
      v-if="props.packId"
      size="tiny"
      quaternary
      class="edit"
      data-testid="edit-categories"
      @click="showEditor = true"
    >
      {{ t('categoriesEditor.open') }}
    </n-button>
    <n-text v-if="changed > 0" depth="3" class="footer">{{
      t('pack.changedTotal', { count: changed })
    }}</n-text>
    <category-editor-dialog v-if="props.packId" v-model:show="showEditor" :pack-id="props.packId" />
  </nav>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
}
.item:hover {
  background: rgba(128, 128, 128, 0.12);
}
.item.active {
  background: rgba(24, 160, 88, 0.16);
  font-weight: 600;
}
.icon {
  width: 20px;
  height: 20px;
  flex: none;
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sep {
  height: 1px;
  margin: 6px 0;
  background: rgba(128, 128, 128, 0.2);
}
.edit {
  align-self: flex-start;
  margin-top: 6px;
}
.footer {
  font-size: 12px;
  padding: 8px;
}
</style>
