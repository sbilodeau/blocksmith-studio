<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NH3,
  NPopconfirm,
  NPopselect,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NTag,
  NText
} from 'naive-ui'
import LoadingOverlay from '../components/common/LoadingOverlay.vue'
import type { ExportReport, PackKind, UpgradeReport } from '@shared/model/pack'
import { findVersion, latest, versionTable } from '@shared/versions'
import CategorySidebar from '../components/pack/CategorySidebar.vue'
import CategoryOverview from '../components/pack/CategoryOverview.vue'
import TextureGrid from '../components/pack/TextureGrid.vue'
import TextureEditor from '../components/editor/TextureEditor.vue'
import ExportDialog from '../components/pack/ExportDialog.vue'
import PlayInMinecraftDialog from '../components/pack/PlayInMinecraftDialog.vue'
import { useMinecraftStore } from '../stores/minecraft'
import ReportDialog from '../components/common/ReportDialog.vue'
import StyleBriefDrawer from '../components/ai/StyleBriefDrawer.vue'
import NavigationAgentPanel from '../components/ai/NavigationAgentPanel.vue'
import CreationAgentPanel from '../components/ai/CreationAgentPanel.vue'
import PackHistoryDrawer from '../components/pack/PackHistoryDrawer.vue'
import PackDoctorDrawer from '../components/pack/PackDoctorDrawer.vue'
import VanillaPrepare from '../components/vanilla/VanillaPrepare.vue'
import DataSidebar from '../components/data/DataSidebar.vue'
import DataList from '../components/data/DataList.vue'
import DataEditor from '../components/data/DataEditor.vue'
import { useDataStore } from '../stores/data'
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
const showPlay = ref(false)
const minecraft = useMinecraftStore()
const liveOn = computed(() => minecraft.isLive(props.packId))
watch(
  () => props.packId,
  (id) => void minecraft.loadStatus(id).catch(() => undefined),
  { immediate: true }
)
const showBrief = ref(false)
const showHistory = ref(false)
const showDoctor = ref(false)
const router = useRouter()
/**
 * The AI panel sits next to the overview (creation agent, whole pack) or the grid (navigation agent, selection),
 * not the editor (which has its own AI tab).
 */
const kind = computed<PackKind>(() => store.value.summary?.kind ?? 'resource')
/** What the tab shows: a data pack its data files, a resource pack its textures, a combined pack either. */
const section = computed(() =>
  kind.value === 'data' ? 'data' : kind.value === 'resource' ? 'textures' : store.value.section
)
const data = computed(() => useDataStore(props.packId))
const dataEditor = ref<InstanceType<typeof DataEditor> | null>(null)
const editingAny = computed(() =>
  section.value === 'data' ? data.value.editing !== null : store.value.editing !== null
)
const showAiPanel = computed(() => store.value.aiPanel && !editingAny.value)
/** The creation agent works on the whole pack (overview, or the data files); the navigation agent on the grid. */
const onOverview = computed(() => section.value === 'data' || store.value.category === null)

function switchSection(next: 'textures' | 'data'): void {
  const go = (): void => {
    store.value.section = next
  }
  if (dataEditor.value && section.value === 'data') dataEditor.value.guardUnsaved(go)
  else go()
}

const kindOptions = computed(() =>
  (['resource', 'data', 'combined'] as const).map((k) => ({ value: k, label: t(`packKind.${k}`) }))
)
async function changeKind(next: PackKind): Promise<void> {
  if (next === kind.value) return
  try {
    await store.value.setKind(next)
    if (next === 'combined') store.value.section = kind.value === 'data' ? 'data' : 'textures'
  } catch (err) {
    showError(err)
  }
}

watch(
  [section, () => props.packId],
  () => {
    const d = data.value
    if (section.value === 'data' && !d.loaded && !d.loading) d.load().catch(showError)
  },
  { immediate: true }
)
/** Set when a vanilla-based pack's vanilla textures are missing on this computer. */
const missingVanilla = ref<string | null>(null)
const vanilla = useVanillaStore()
const exportReports = ref<ExportReport[] | null>(null)

/** A newer Minecraft release than the pack's version: offered as an upgrade. */
const upgradeTarget = computed(() => {
  const current = store.value.summary
    ? findVersion(versionTable, store.value.summary.authoringVersion)
    : undefined
  const newest = latest(versionTable)
  return current && Date.parse(newest.releaseTime) > Date.parse(current.releaseTime)
    ? newest.id
    : null
})
const upgrading = ref(false)
const upgradeReport = ref<UpgradeReport | null>(null)
const showUpgradeReport = computed({
  get: () => upgradeReport.value !== null,
  set: (v: boolean) => {
    if (!v) upgradeReport.value = null
  }
})
const upgradeSummary = computed(() =>
  upgradeReport.value
    ? t('upgrade.summary', {
        from: upgradeReport.value.from,
        to: upgradeReport.value.to,
        count: upgradeReport.value.renamed
      })
    : ''
)
const upgradeItems = computed(() => [
  ...(upgradeReport.value?.obsolete ?? []).map((path) => ({ code: 'upgrade.obsolete', path })),
  ...(upgradeReport.value?.conflicts ?? []).map((path) => ({ code: 'upgrade.conflict', path }))
])
async function upgrade(): Promise<void> {
  if (!upgradeTarget.value) return
  upgrading.value = true
  try {
    upgradeReport.value = await store.value.upgrade(upgradeTarget.value)
  } catch (err) {
    showError(err)
  } finally {
    upgrading.value = false
  }
}
const showReport = computed({
  get: () => exportReports.value !== null,
  set: (v: boolean) => {
    if (!v) exportReports.value = null
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
  if (packId && packId !== props.packId) return
  store.value.load().catch(showError)
  if (data.value.loaded) data.value.load().catch(showError)
})
onBeforeUnmount(off)

const exportSummary = computed(() =>
  (exportReports.value ?? [])
    .map(
      (r) =>
        t('export.summary', {
          type: t(`export.packTypes.${r.packType}`),
          files: r.filesWritten,
          version: r.targetVersion,
          path: r.outputPath
        }) + (r.renamed ? ` ${t('export.renamedNote', { count: r.renamed }, r.renamed)}` : '')
    )
    .join('\n')
)
/** Warnings and skipped files; with several zips each line says which version it is about. */
const exportItems = computed(() => {
  const reports = exportReports.value ?? []
  const tag = (r: ExportReport, path?: string): string | undefined =>
    reports.length > 1 ? `[${r.targetVersion}]${path ? ` ${path}` : ''}` : path
  return reports.flatMap((r) => [
    ...r.warnings.map((w) => ({ code: w.code, path: tag(r, w.path) })),
    ...r.skipped.map((s) => ({ code: s.reason, path: tag(r, s.path) }))
  ])
})
</script>

<template>
  <div class="spin">
    <loading-overlay :show="store.loading && !store.loaded" />
    <div class="pack" data-testid="pack-view">
      <aside v-if="!editingAny" class="side">
        <n-radio-group
          v-if="kind === 'combined'"
          :value="section"
          size="small"
          class="sections"
          @update:value="switchSection"
        >
          <n-radio-button value="textures" data-testid="pack-section-textures">
            {{ t('pack.sectionTextures') }}
          </n-radio-button>
          <n-radio-button value="data" data-testid="pack-section-data">
            {{ t('pack.sectionData') }}
          </n-radio-button>
        </n-radio-group>
        <data-sidebar
          v-if="section === 'data'"
          :active="data.kind"
          :counts="data.counts"
          :changed="data.changedCount"
          @select="data.setKind"
        />
        <category-sidebar
          v-else
          :categories="store.categories"
          :active="store.category"
          :total="store.textures.length"
          :changed="store.changedCount"
          :pack-id="packId"
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
              <n-popselect
                :value="kind"
                :options="kindOptions"
                trigger="click"
                @update:value="changeKind"
              >
                <n-tag
                  size="small"
                  :bordered="false"
                  type="info"
                  class="kind"
                  data-testid="pack-kind"
                >
                  {{ t('packKind.change', { kind: t(`packKind.${kind}`) }) }}
                </n-tag>
              </n-popselect>
              <n-popconfirm v-if="upgradeTarget && !store.editing" @positive-click="upgrade">
                <template #trigger>
                  <n-button
                    size="tiny"
                    secondary
                    type="info"
                    :loading="upgrading"
                    data-testid="pack-upgrade"
                  >
                    {{ t('upgrade.button', { version: upgradeTarget }) }}
                  </n-button>
                </template>
                {{ t('upgrade.confirm', { version: upgradeTarget }) }}
              </n-popconfirm>
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
            <n-button size="small" data-testid="pack-doctor-open" @click="showDoctor = true">
              {{ t('doctor.title') }}
            </n-button>
            <n-button
              v-if="!editingAny"
              size="small"
              :type="store.aiPanel ? 'primary' : 'default'"
              :secondary="store.aiPanel"
              :data-testid="onOverview ? 'creation-toggle' : 'navigation-toggle'"
              @click="store.aiPanel = !store.aiPanel"
            >
              {{ onOverview ? t('ai.creationPanel') : t('ai.navigationPanel') }}
            </n-button>
            <n-button
              size="small"
              :type="liveOn ? 'success' : 'default'"
              :secondary="liveOn"
              data-testid="play-open"
              @click="showPlay = true"
            >
              {{ liveOn ? t('play.openLive') : t('play.open') }}
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
          <template v-else-if="section === 'data'">
            <data-editor v-if="data.editing" ref="dataEditor" :pack-id="packId" />
            <data-list v-else :pack-id="packId" :pack-name="store.summary?.name ?? ''" />
          </template>
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
        <creation-agent-panel
          v-if="onOverview"
          :pack-id="packId"
          @open-settings="router.push({ name: 'settings' })"
        />
        <navigation-agent-panel
          v-else
          :pack-id="packId"
          @open-settings="router.push({ name: 'settings' })"
        />
      </aside>
    </div>
    <style-brief-drawer v-model:show="showBrief" :pack-id="packId" />
    <pack-history-drawer v-model:show="showHistory" :pack-id="packId" />
    <pack-doctor-drawer v-model:show="showDoctor" :pack-id="packId" />
    <play-in-minecraft-dialog v-model:show="showPlay" :store="store" />
    <export-dialog
      v-model:show="showExport"
      :store="store"
      @exported="(r) => (exportReports = r)"
    />
    <report-dialog
      v-if="upgradeReport"
      v-model:show="showUpgradeReport"
      :title="t('upgrade.done')"
      :summary="upgradeSummary"
      :items="upgradeItems"
    />
    <report-dialog
      v-if="exportReports"
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
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.side .sidebar {
  flex: 1;
  min-height: 0;
  height: auto;
}
.sections {
  margin: 8px 8px 0;
  display: flex;
}
.sections :deep(.n-radio-button) {
  flex: 1;
  text-align: center;
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
.kind {
  cursor: pointer;
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
