<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NH3, NSpace, NTag, NText } from 'naive-ui'
import LoadingOverlay from '../components/common/LoadingOverlay.vue'
import type { ExportReport } from '@shared/model/pack'
import CategorySidebar from '../components/pack/CategorySidebar.vue'
import CategoryOverview from '../components/pack/CategoryOverview.vue'
import TextureGrid from '../components/pack/TextureGrid.vue'
import TextureEditor from '../components/editor/TextureEditor.vue'
import ExportDialog from '../components/pack/ExportDialog.vue'
import ReportDialog from '../components/common/ReportDialog.vue'
import StyleBriefDrawer from '../components/ai/StyleBriefDrawer.vue'
import NavigationAgentPanel from '../components/ai/NavigationAgentPanel.vue'
import PackHistoryDrawer from '../components/pack/PackHistoryDrawer.vue'
import VanillaPrepare from '../components/vanilla/VanillaPrepare.vue'
import { IpcError } from '../services/ipc'
import { useVanillaStore } from '../stores/vanilla'
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
const showBrief = ref(false)
const showHistory = ref(false)
const router = useRouter()
/** The navigation agent panel sits next to the grid (not the overview or the editor). */
const showAiPanel = computed(
  () => store.value.aiPanel && !store.value.editing && store.value.category !== null
)
/** Set when a vanilla-based pack's vanilla textures are missing on this computer. */
const missingVanilla = ref<string | null>(null)
const vanilla = useVanillaStore()
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
  await load()
}

async function load(): Promise<void> {
  const s = store.value
  missingVanilla.value = null
  try {
    await s.load()
    if (s.summary) tabs.rename(props.packId, s.summary.name)
  } catch (err) {
    if (err instanceof IpcError && err.appError.code === 'packs.vanillaNotReady') {
      missingVanilla.value = String(err.appError.params?.['version'] ?? '')
      await vanilla.refresh().catch(showError)
    } else {
      showError(err)
    }
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
        type: t(`export.packTypes.${exportReport.value.packType}`),
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
  <div class="spin">
    <loading-overlay :show="store.loading && !store.loaded" />
    <div class="pack" data-testid="pack-view">
      <aside v-if="!store.editing" class="side">
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
            <n-button size="small" data-testid="brief-open" @click="showBrief = true">
              {{ t('brief.open') }}
            </n-button>
            <n-button size="small" data-testid="pack-history-open" @click="showHistory = true">
              {{ t('history.title') }}
            </n-button>
            <n-button
              v-if="!store.editing && store.category !== null"
              size="small"
              :type="store.aiPanel ? 'primary' : 'default'"
              :secondary="store.aiPanel"
              data-testid="navigation-toggle"
              @click="store.aiPanel = !store.aiPanel"
            >
              {{ t('ai.navigationPanel') }}
            </n-button>
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
          <div v-if="missingVanilla" class="missing" data-testid="pack-vanilla-missing">
            <n-alert type="warning" :show-icon="false">
              {{ t('pack.vanillaMissing', { version: missingVanilla }) }}
            </n-alert>
            <vanilla-prepare :version-id="missingVanilla" @ready="load" />
          </div>
          <texture-editor v-else-if="store.editing" :pack-id="packId" />
          <category-overview
            v-else-if="store.category === null"
            :categories="store.categories"
            @open="store.openCategory"
          />
          <texture-grid v-else :pack-id="packId" />
        </div>
      </section>
      <aside v-if="showAiPanel" class="ai-side">
        <navigation-agent-panel
          :pack-id="packId"
          @open-settings="router.push({ name: 'settings' })"
        />
      </aside>
    </div>
    <style-brief-drawer v-model:show="showBrief" :pack-id="packId" />
    <pack-history-drawer v-model:show="showHistory" :pack-id="packId" />
    <export-dialog v-model:show="showExport" :store="store" @exported="(r) => (exportReport = r)" />
    <report-dialog
      v-if="exportReport"
      v-model:show="showReport"
      :title="t('export.done')"
      :summary="exportSummary"
      :items="exportItems"
    />
  </div>
</template>

<style scoped>
.spin {
  position: relative;
  height: 100%;
}
.pack {
  display: flex;
  height: 100%;
  min-height: 0;
  gap: 16px;
}
.ai-side {
  width: 340px;
  flex: none;
  border-left: 1px solid rgba(128, 128, 128, 0.2);
  padding-left: 12px;
  min-height: 0;
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
.missing {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
