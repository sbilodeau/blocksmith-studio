<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NBadge, NText } from 'naive-ui'
import type { DataKind } from '@shared/datapack'
import { DATA_SECTIONS } from '../../stores/data'

defineProps<{
  active: DataKind
  counts: Record<DataKind, { count: number; changed: number }>
  changed: number
}>()
const emit = defineEmits<{ select: [kind: DataKind] }>()
const { t } = useI18n()
</script>

<template>
  <nav class="sidebar" data-testid="data-sidebar">
    <button
      v-for="kind in DATA_SECTIONS"
      :key="kind"
      class="item"
      :class="{ active: active === kind }"
      :data-testid="`data-kind-${kind}`"
      @click="emit('select', kind)"
    >
      <span class="label">{{ t(`data.kinds.${kind}`) }}</span>
      <n-badge
        v-if="counts[kind].changed > 0"
        :value="counts[kind].changed"
        type="warning"
        :max="999"
      />
      <n-text depth="3" class="count">{{ counts[kind].count }}</n-text>
    </button>
    <n-text v-if="changed > 0" depth="3" class="footer">{{
      t('data.changedTotal', { count: changed }, changed)
    }}</n-text>
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
.footer {
  font-size: 12px;
  padding: 8px;
}
</style>
