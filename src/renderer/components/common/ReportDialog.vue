<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NModal, NScrollbar, NText } from 'naive-ui'

/** Shows a summary line plus warnings/skipped files after an import or export. */
const show = defineModel<boolean>('show', { required: true })
defineProps<{
  title: string
  summary: string
  items: Array<{ code: string; path?: string }>
}>()
const { t, te } = useI18n()

function label(code: string): string {
  return te(`warnings.${code}`) ? t(`warnings.${code}`) : code
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="title"
    style="width: 600px"
    data-testid="report-dialog"
  >
    <n-alert type="success" :show-icon="false" class="summary">{{ summary }}</n-alert>
    <template v-if="items.length">
      <n-text strong>{{ t('report.warnings', { count: items.length }) }}</n-text>
      <n-scrollbar style="max-height: 260px" class="list">
        <ul>
          <li v-for="(item, i) in items" :key="i">
            {{ label(item.code) }}
            <n-text v-if="item.path" code class="path">{{ item.path }}</n-text>
          </li>
        </ul>
      </n-scrollbar>
    </template>
    <template #footer>
      <n-button type="primary" @click="show = false">{{ t('common.close') }}</n-button>
    </template>
  </n-modal>
</template>

<style scoped>
.summary {
  margin-bottom: 12px;
}
.list ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.path {
  font-size: 12px;
  margin-left: 6px;
}
</style>
