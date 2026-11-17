<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NForm,
  NFormItem,
  NModal,
  NSelect,
  NSpace,
  type SelectOption
} from 'naive-ui'
import type { ExportPackType, ExportReport } from '@shared/model/pack'
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
const kind = computed(() => props.store.summary?.kind ?? 'resource')
/** Zips to write per version: a combined pack can write both (one resource pack, one data pack). */
const packTypes = ref<ExportPackType[]>(['resource'])
function defaultTypes(): ExportPackType[] {
  if (kind.value === 'data') return ['data']
  if (kind.value === 'resource') return ['resource']
  const remembered = props.store.summary?.exportProfile?.packTypes
  return remembered?.length ? [...remembered] : ['resource', 'data']
}
const hint = computed(() =>
  [
    t('export.changedOnly'),
    packTypes.value.includes('resource') ? t('export.installHint') : '',
    packTypes.value.includes('data') ? t('export.installHintData') : ''
  ]
    .filter(Boolean)
    .join(' ')
)
const zipCount = computed(() => targets.value.length * packTypes.value.length)
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
  packTypes.value = defaultTypes()
}
watch(show, (open) => {
  if (open) preselect()
})
// The pack may still be loading when the dialog opens (after a previous export, for example).
watch(options, () => {
  if (show.value && targets.value.length === 0) preselect()
})

async function run(): Promise<void> {
  const [first] = targets.value
  const types = packTypes.value
  if (!first || types.length === 0) return
  exporting.value = true
  try {
    const reports =
      zipCount.value > 1
        ? await props.store.exportMany(targets.value, {
            acceptNewer: acceptNewer.value,
            packTypes: types
          })
        : await props.store
            .exportPack(first, { acceptNewer: acceptNewer.value, packType: types[0] })
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
      <n-form-item
        v-if="kind === 'combined'"
        :label="t('export.packType')"
        :feedback="t('export.packTypeHint')"
      >
        <n-checkbox-group v-model:value="packTypes">
          <n-space>
            <n-checkbox value="resource" data-testid="export-type-resource">
              {{ t('export.packTypes.resource') }}
            </n-checkbox>
            <n-checkbox value="data" data-testid="export-type-data">
              {{ t('export.packTypes.data') }}
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
      </n-form-item>
    </n-form>
    <n-alert type="info" :show-icon="false">{{ hint }}</n-alert>
    <template #footer>
      <n-space justify="space-between" align="center">
        <job-progress-bar v-if="exporting" kind="pack.export" />
        <span v-else />
        <n-space>
          <n-button :disabled="exporting" @click="show = false">{{ t('common.cancel') }}</n-button>
          <n-button
            type="primary"
            :loading="exporting"
            :disabled="targets.length === 0 || packTypes.length === 0"
            data-testid="export-run"
            @click="run"
          >
            {{ zipCount > 1 ? t('export.runMany', { count: zipCount }) : t('export.run') }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>
