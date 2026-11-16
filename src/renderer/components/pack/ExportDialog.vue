<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NModal,
  NSelect,
  NSpace,
  type SelectOption
} from 'naive-ui'
import type { ExportReport } from '@shared/model/pack'
import { exportTargets, findVersion, isSnapshot, versionTable } from '@shared/versions'
import JobProgressBar from '../common/JobProgressBar.vue'
import type { PackStore } from '../../stores/pack'
import { useErrorMessage } from '../../composables/useErrorMessage'

const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{ store: PackStore }>()
const emit = defineEmits<{ exported: [report: ExportReport] }>()

const { t } = useI18n()
const { showError } = useErrorMessage()
const target = ref<string | null>(null)
const exporting = ref(false)
/** Export option: also mark the pack compatible with newer versions (snapshots). Remembered per pack tab. */
const acceptNewer = computed({
  get: () => props.store.exportAcceptNewer,
  set: (v: boolean) => props.store.setExportAcceptNewer(v)
})

const authoring = computed(() => props.store.summary?.authoringVersion ?? null)
// Only the targets that export correctly and are checked against real game jars (tests/real-jar): the pack's
// authoring version and newer snapshots. Other releases arrive with the migration tables (M7).
const options = computed<SelectOption[]>(() => {
  const version = authoring.value ? findVersion(versionTable, authoring.value) : undefined
  if (!version) return []
  return exportTargets(versionTable, version).map((v) => ({
    value: v.id,
    label: isSnapshot(v) ? t('export.snapshotLabel', { version: v.id }) : v.id
  }))
})

watch(show, (open) => {
  if (!open) return
  target.value = authoring.value
})

async function run(): Promise<void> {
  if (!target.value) return
  exporting.value = true
  try {
    const report = await props.store.exportPack(target.value, { acceptNewer: acceptNewer.value })
    if (report) {
      show.value = false
      emit('exported', report)
    }
  } catch (err) {
    showError(err)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('export.title')"
    style="width: 480px"
    :mask-closable="!exporting"
    data-testid="export-dialog"
  >
    <n-form label-placement="top">
      <n-form-item :label="t('export.target')" :feedback="t('export.targetHint')">
        <n-select v-model:value="target" :options="options" data-testid="export-target" />
      </n-form-item>
      <n-form-item :show-label="false" :feedback="t('export.acceptNewerHint')">
        <n-checkbox v-model:checked="acceptNewer" data-testid="export-accept-newer">
          {{ t('export.acceptNewer') }}
        </n-checkbox>
      </n-form-item>
    </n-form>
    <n-alert type="info" :show-icon="false">{{ t('export.changedOnly') }}</n-alert>
    <template #footer>
      <n-space justify="space-between" align="center">
        <job-progress-bar v-if="exporting" kind="pack.export" />
        <span v-else />
        <n-space>
          <n-button :disabled="exporting" @click="show = false">{{ t('common.cancel') }}</n-button>
          <n-button
            type="primary"
            :loading="exporting"
            :disabled="!target"
            data-testid="export-run"
            @click="run"
          >
            {{ t('export.run') }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>
