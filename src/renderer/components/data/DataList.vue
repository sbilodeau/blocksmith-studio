<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NDataTable,
  NEmpty,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NTag,
  NText,
  type DataTableColumns
} from 'naive-ui'
import type { DataEntry } from '@shared/model/data'
import NewDataDialog from './NewDataDialog.vue'
import { useDataStore } from '../../stores/data'

const props = defineProps<{ packId: string; packName: string }>()
const { t } = useI18n()
const store = computed(() => useDataStore(props.packId))
const showNew = ref(false)

const statusType = (s: DataEntry['status']): 'default' | 'success' | 'warning' =>
  s === 'vanilla' ? 'default' : s === 'added' ? 'success' : 'warning'

const columns = computed<DataTableColumns<DataEntry>>(() => [
  {
    key: 'id',
    title: t('data.list.id'),
    ellipsis: { tooltip: true },
    render: (row) => h('span', { class: 'id' }, row.kind === 'tag' ? `#${row.id}` : row.id)
  },
  ...(store.value.kind === 'tag'
    ? [{ key: 'registry', title: t('data.list.registry'), width: 140 }]
    : []),
  {
    key: 'status',
    title: t('data.list.status'),
    width: 110,
    render: (row) =>
      h(
        NTag,
        { size: 'tiny', bordered: false, type: statusType(row.status) },
        { default: () => t(`pack.status.${row.status}`) }
      )
  }
])

function rowProps(row: DataEntry): Record<string, unknown> {
  return {
    style: 'cursor: pointer',
    'data-testid': `data-row-${row.id}`,
    onClick: () => store.value.open(row.path)
  }
}
</script>

<template>
  <div class="data-list" data-testid="data-list">
    <n-space justify="space-between" align="center" class="tools" :wrap="false">
      <n-space align="center" :wrap="false">
        <n-input
          v-model:value="store.search"
          size="small"
          clearable
          :placeholder="t('data.list.search')"
          style="width: 240px"
          data-testid="data-search"
        />
        <n-radio-group v-model:value="store.statusFilter" size="small">
          <n-radio-button value="all">{{ t('grid.filter.all') }}</n-radio-button>
          <n-radio-button value="changed" data-testid="data-filter-changed">
            {{ t('grid.filter.changed') }}
          </n-radio-button>
          <n-radio-button value="vanilla">{{ t('grid.filter.vanilla') }}</n-radio-button>
        </n-radio-group>
        <n-text depth="3" class="count">{{
          t('data.list.count', { count: store.visible.length }, store.visible.length)
        }}</n-text>
      </n-space>
      <n-button size="small" type="primary" data-testid="data-new" @click="showNew = true">
        {{ t('data.new.open') }}
      </n-button>
    </n-space>
    <n-alert
      v-if="!store.vanillaData"
      type="warning"
      :show-icon="false"
      class="notice"
      data-testid="data-no-vanilla"
    >
      {{ t('data.list.noVanilla') }}
    </n-alert>
    <n-data-table
      v-if="store.visible.length > 0"
      class="table"
      size="small"
      :columns="columns"
      :data="store.visible"
      :row-key="(row: DataEntry) => row.path"
      :row-props="rowProps"
      virtual-scroll
      flex-height
      :bordered="false"
    />
    <n-empty v-else class="empty" :description="t('data.list.empty')" />
    <new-data-dialog v-model:show="showNew" :pack-id="packId" :pack-name="packName" />
  </div>
</template>

<style scoped>
.data-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.tools {
  flex: none;
}
.count {
  font-size: 12px;
  white-space: nowrap;
}
.table {
  flex: 1;
  min-height: 0;
}
.table :deep(.id) {
  font-family: var(--n-font-family-mono, monospace);
  font-size: 12px;
}
.empty {
  margin-top: 48px;
}
</style>
