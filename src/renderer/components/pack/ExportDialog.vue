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
const emit = defineEmits<{ exported: [reports: ExportReport[]] }>()

const { t } = useI18n()
const { showError } = useErrorMessage()
/** Target versions (one zip each). */
const targets = ref<string[]>([])
const exporting = ref(false)
/** Export option: also mark the pack compatible with newer versions (snapshots). Remembered per pack tab. */
const acceptNewer = computed({
  get: () => props.store.exportAcceptNewer,
  set: (v: boolean) => props.store.setExportAcceptNewer(v)
})

const authoring = computed(() => props.store.summary?.authoringVersion ?? null)
// The targets the exporter supports, all checked against real game jars (tests/real-jar): newer snapshots, the
// pack's version, and the other releases of the support window (texture paths migrated).
const options = computed<SelectOption[]>(() => {
  const version = authoring.value ? findVersion(versionTable, authoring.value) : undefined
  if (!version) return []
  return exportTargets(versionTable, version).map((v) => ({
    value: v.id,
    label: isSnapshot(v)
      ? t('export.snapshotLabel', { version: v.id })
      : v.id === version.id
        ? t('export.packVersionLabel', { version: v.id })
        : v.id
  }))
})

/** The last export settings (export profile), else the pack's version. */
function preselect(): void {
  const available = new Set(options.value.map((o) => o.value as string))
  const profile = props.store.summary?.exportProfile
  const remembered = (profile?.targets ?? []).filter((v) => available.has(v))
  targets.value = remembered.length ? remembered : authoring.value ? [authoring.value] : []
  if (profile) acceptNewer.value = profile.acceptNewer
}
watch(show, (open) => {
  if (open) preselect()
})
// The pack may still be loading when the dialog opens (after a previous export, for example).
watch(options, () => {
  if (show.value && targets.value.length === 0) preselect()
})

async function run(): Promise<void> {
  const [first, ...rest] = targets.value
  if (!first) return
  exporting.value = true
  try {
    const reports = rest.length
      ? await props.store.exportMany(targets.value, { acceptNewer: acceptNewer.value })
      : await props.store
          .exportPack(first, { acceptNewer: acceptNewer.value })
          .then((r) => (r ? [r] : null))
    if (reports) {
      show.value = false
      emit('exported', reports)
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
        <n-select
          v-model:value="targets"
          multiple
          filterable
          :options="options"
          data-testid="export-target"
        />
      </n-form-item>
      <n-form-item :show-label="false" :feedback="t('export.acceptNewerHint')">
        <n-checkbox v-model:checked="acceptNewer" data-testid="export-accept-newer">
          {{ t('export.acceptNewer') }}
        </n-checkbox>
      </n-form-item>
    </n-form>
    <!-- Data pack export (packType 'data') is built and tested but hidden until data pack editing (M10). -->
    <n-alert type="info" :show-icon="false">
      {{ t('export.changedOnly') }} {{ t('export.installHint') }}
    </n-alert>
    <template #footer>
      <n-space justify="space-between" align="center">
        <job-progress-bar v-if="exporting" kind="pack.export" />
        <span v-else />
        <n-space>
          <n-button :disabled="exporting" @click="show = false">{{ t('common.cancel') }}</n-button>
          <n-button
            type="primary"
            :loading="exporting"
            :disabled="targets.length === 0"
            data-testid="export-run"
            @click="run"
          >
            {{
              targets.length > 1 ? t('export.runMany', { count: targets.length }) : t('export.run')
            }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>
