<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NButton, NEmpty, NH2, NInput, NSpace, NSpin, NText, useDialog } from 'naive-ui'
import type { PackSummary } from '@shared/model/pack'
import PackCard from '../components/packs/PackCard.vue'
import NewPackDialog from '../components/packs/NewPackDialog.vue'
import ReportDialog from '../components/common/ReportDialog.vue'
import JobProgressBar from '../components/common/JobProgressBar.vue'
import { usePacksStore } from '../stores/packs'
import { useTabsStore } from '../stores/tabs'
import { useErrorMessage } from '../composables/useErrorMessage'

const { t } = useI18n()
const router = useRouter()
const packs = usePacksStore()
const tabs = useTabsStore()
const dialog = useDialog()
const { showError } = useErrorMessage()

const showNew = ref(false)
const importing = ref(false)
const filter = ref('')
const report = ref<{
  title: string
  summary: string
  items: Array<{ code: string; path?: string }>
} | null>(null)
const showReport = computed({
  get: () => report.value !== null,
  set: (v: boolean) => {
    if (!v) report.value = null
  }
})

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q ? packs.packs.filter((p) => p.name.toLowerCase().includes(q)) : packs.packs
})

function open(pack: PackSummary): void {
  tabs.openPack(pack.id, pack.name)
  void router.push({ name: 'pack', params: { packId: pack.id } })
}

async function importZip(): Promise<void> {
  importing.value = true
  try {
    const result = await packs.importZip()
    if (result) {
      report.value = {
        title: t('import.title'),
        summary: t('import.summary', {
          name: result.pack.name,
          files: result.filesImported,
          identical: result.identicalToVanilla
        }),
        items: result.warnings
      }
    }
  } catch (err) {
    showError(err)
  } finally {
    importing.value = false
  }
}

function confirmDelete(pack: PackSummary): void {
  dialog.warning({
    title: t('packs.deleteTitle'),
    content: t('packs.deleteConfirm', { name: pack.name }),
    positiveText: t('packs.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        if (tabs.tabs.some((tab) => tab.id === pack.id)) tabs.close(pack.id)
        await packs.remove(pack.id)
      } catch (err) {
        showError(err)
      }
    }
  })
}

async function reveal(pack: PackSummary): Promise<void> {
  try {
    await packs.reveal(pack.id)
  } catch (err) {
    showError(err)
  }
}

async function changeWorkspace(): Promise<void> {
  try {
    await packs.chooseWorkspace()
  } catch (err) {
    showError(err)
  }
}

onMounted(() => {
  packs.init()
  packs.refresh().catch(showError)
})
</script>

<template>
  <div class="home">
    <n-space justify="space-between" align="center" class="top">
      <n-h2 class="title">{{ t('home.title') }}</n-h2>
      <n-space align="center">
        <job-progress-bar v-if="importing" kind="packs.import" />
        <n-button :loading="importing" data-testid="import-pack" @click="importZip">
          {{ t('home.importPack') }}
        </n-button>
        <n-button type="primary" data-testid="new-pack" @click="showNew = true">
          {{ t('home.newPack') }}
        </n-button>
      </n-space>
    </n-space>

    <n-space align="center" size="small" class="workspace">
      <n-text depth="3">{{ t('home.workspace') }}</n-text>
      <n-text code data-testid="workspace-path">{{ packs.workspacePath }}</n-text>
      <n-button text size="tiny" type="primary" @click="changeWorkspace">{{
        t('home.changeWorkspace')
      }}</n-button>
    </n-space>

    <n-input
      v-if="packs.packs.length > 6"
      v-model:value="filter"
      clearable
      :placeholder="t('home.filter')"
      class="filter"
    />

    <n-spin :show="packs.loading && packs.packs.length === 0">
      <n-empty
        v-if="!packs.loading && packs.packs.length === 0"
        :description="t('home.empty')"
        size="large"
        class="empty"
        data-testid="home-empty"
      >
        <template #extra>
          <p class="hint">{{ t('home.emptyHint') }}</p>
        </template>
      </n-empty>
      <div v-else class="grid" data-testid="pack-list">
        <pack-card
          v-for="pack in filtered"
          :key="pack.id"
          :pack="pack"
          @open="open(pack)"
          @reveal="reveal(pack)"
          @delete="confirmDelete(pack)"
        />
      </div>
    </n-spin>

    <new-pack-dialog v-model:show="showNew" @created="open" />
    <report-dialog
      v-if="report"
      v-model:show="showReport"
      :title="report.title"
      :summary="report.summary"
      :items="report.items"
    />
  </div>
</template>

<style scoped>
.home {
  max-width: 1100px;
  margin: 0 auto;
}
.title {
  margin: 0;
}
.workspace {
  margin: 4px 0 16px;
  font-size: 12px;
}
.filter {
  max-width: 320px;
  margin-bottom: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.empty {
  margin-top: 64px;
}
.hint {
  opacity: 0.7;
  margin: 0;
}
</style>
