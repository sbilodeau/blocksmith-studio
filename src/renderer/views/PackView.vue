<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NH3, NSpace, NSpin, NTag, NText } from 'naive-ui'
import type { ExportReport } from '@shared/model/pack'
import CategorySidebar from '../components/pack/CategorySidebar.vue'
import CategoryOverview from '../components/pack/CategoryOverview.vue'
import TextureGrid from '../components/pack/TextureGrid.vue'
import ExportDialog from '../components/pack/ExportDialog.vue'
import ReportDialog from '../components/common/ReportDialog.vue'
import { usePackStore } from '../stores/pack'
import { usePacksStore } from '../stores/packs'
import { useTabsStore } from '../stores/tabs'
import { useErrorMessage } from '../composables/useErrorMessage'

const props = defineProps<{ packId: string }>()
const { t } = useI18n()
const tabs = useTabsStore()
const packs = usePacksStore()
const { showError } = useErrorMessage()

// The same view instance is reused across pack tabs; each pack has its own store (state survives tab switches).
const store = computed(() => usePackStore(props.packId))
const showExport = ref(false)
const exportReport = ref<ExportReport | null>(null)
const showReport = computed({
  get: () => exportReport.value !== null,
  set: (v: boolean) => {
    if (!v) exportReport.value = null
  }
})

async function ensureLoaded(): Promise<void> {
  const s = store.value
  if (!tabs.tabs.some((tab) => tab.id === props.packId)) {
    tabs.openPack(props.packId, packs.find(props.packId)?.name ?? props.packId)
  }
  tabs.activate(props.packId)
  if (s.loaded || s.loading) return
  try {
    await s.load()
    if (s.summary) tabs.rename(props.packId, s.summary.name)
  } catch (err) {
    showError(err)
  }
}

watch(() => props.packId, ensureLoaded, { immediate: true })

const off = window.blocksmith.on('packs.changed', ({ packId }) => {
  if (!packId || packId === props.packId) store.value.load().catch(showError)
})
onBeforeUnmount(off)

const exportSummary = computed(() =>
  exportReport.value
    ? t('export.summary', {
        files: exportReport.value.filesWritten,
        version: exportReport.value.targetVersion,
        path: exportReport.value.outputPath
      })
    : ''
)
const exportItems = computed(() => [
  ...(exportReport.value?.warnings ?? []),
  ...(exportReport.value?.skipped.map((s) => ({ code: s.reason, path: s.path })) ?? [])
])
</script>

<template>
  <n-spin :show="store.loading && !store.loaded" class="spin">
    <div class="pack" data-testid="pack-view">
      <aside class="side">
        <category-sidebar
          :categories="store.categories"
          :active="store.category"
          :total="store.textures.length"
          :changed="store.changedCount"
          @select="store.openCategory"
        />
      </aside>
      <section class="main">
        <n-space justify="space-between" align="center" class="head">
          <div class="title">
            <n-h3 class="name" data-testid="pack-name">{{ store.summary?.name }}</n-h3>
            <n-space size="small" align="center">
              <n-tag size="small" :bordered="false">
                {{ t('packs.minecraft', { version: store.summary?.authoringVersion ?? '' }) }}
              </n-tag>
              <n-text depth="3" class="desc">{{ store.summary?.description }}</n-text>
            </n-space>
          </div>
          <n-space>
            <n-button size="small" @click="packs.reveal(packId).catch(showError)">{{
              t('packs.reveal')
            }}</n-button>
            <n-button
              size="small"
              type="primary"
              data-testid="export-open"
              @click="showExport = true"
            >
              {{ t('export.open') }}
            </n-button>
          </n-space>
        </n-space>
        <div class="body">
          <category-overview
            v-if="store.category === null"
            :categories="store.categories"
            @open="store.openCategory"
          />
          <texture-grid v-else :pack-id="packId" />
        </div>
      </section>
    </div>
    <export-dialog v-model:show="showExport" :store="store" @exported="(r) => (exportReport = r)" />
    <report-dialog
      v-if="exportReport"
      v-model:show="showReport"
      :title="t('export.done')"
      :summary="exportSummary"
      :items="exportItems"
    />
  </n-spin>
</template>

<style scoped>
.spin,
.spin :deep(.n-spin-content) {
  height: 100%;
}
.pack {
  display: flex;
  height: 100%;
  min-height: 0;
  gap: 16px;
}
.side {
  width: 240px;
  flex: none;
  border-right: 1px solid rgba(128, 128, 128, 0.2);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  margin-bottom: 12px;
}
.name {
  margin: 0;
}
.desc {
  font-size: 12px;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
