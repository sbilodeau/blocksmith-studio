<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadio,
  NRadioGroup,
  NSelect,
  NSpace,
  NTag,
  type SelectOption
} from 'naive-ui'
import type { PackBase, PackSummary } from '@shared/model/pack'
import VanillaPrepare from '../vanilla/VanillaPrepare.vue'
import { useVanillaStore } from '../../stores/vanilla'
import { usePacksStore } from '../../stores/packs'
import { useErrorMessage } from '../../composables/useErrorMessage'

const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ created: [pack: PackSummary] }>()

const { t } = useI18n()
const vanilla = useVanillaStore()
const packs = usePacksStore()
const { showError } = useErrorMessage()

const name = ref('')
const description = ref('')
const base = ref<PackBase>('vanilla')
const version = ref<string | null>(null)
const creating = ref(false)

const versionOptions = computed<SelectOption[]>(() =>
  vanilla.versions.map((v) => ({
    value: v.versionId,
    label: v.isLatest ? `${v.versionId} (${t('vanilla.latest')})` : v.versionId,
    state: v.state
  }))
)
const selected = computed(() => (version.value ? vanilla.find(version.value) : undefined))
const needsVanilla = computed(() => base.value === 'vanilla' && selected.value?.state !== 'ready')
const canCreate = computed(
  () => name.value.trim().length > 0 && !!version.value && !needsVanilla.value
)

watch(show, async (open) => {
  if (!open) return
  name.value = ''
  description.value = ''
  base.value = 'vanilla'
  try {
    if (!vanilla.loaded) await vanilla.refresh()
  } catch (err) {
    showError(err)
  }
  version.value = vanilla.latest?.versionId ?? null
})

async function create(): Promise<void> {
  if (!version.value) return
  creating.value = true
  try {
    const pack = await packs.create({
      name: name.value.trim(),
      description: description.value,
      base: base.value,
      authoringVersion: version.value
    })
    show.value = false
    emit('created', pack)
  } catch (err) {
    showError(err)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('newPack.title')"
    style="width: 560px"
    :mask-closable="!creating"
    data-testid="new-pack-dialog"
  >
    <n-form label-placement="top" @submit.prevent="create">
      <n-form-item :label="t('newPack.name')" required>
        <n-input
          v-model:value="name"
          :maxlength="64"
          :placeholder="t('newPack.namePlaceholder')"
          data-testid="new-pack-name"
        />
      </n-form-item>
      <n-form-item :label="t('newPack.description')">
        <n-input
          v-model:value="description"
          type="textarea"
          :maxlength="512"
          :autosize="{ minRows: 2, maxRows: 4 }"
          data-testid="new-pack-description"
        />
      </n-form-item>
      <n-form-item :label="t('newPack.base')">
        <n-radio-group v-model:value="base">
          <n-space vertical>
            <n-radio value="vanilla" data-testid="new-pack-base-vanilla">{{
              t('newPack.baseVanilla')
            }}</n-radio>
            <n-radio value="empty" data-testid="new-pack-base-empty">{{
              t('newPack.baseEmpty')
            }}</n-radio>
          </n-space>
        </n-radio-group>
      </n-form-item>
      <n-form-item :label="t('newPack.version')" :feedback="t('newPack.versionHint')">
        <n-select
          v-model:value="version"
          :options="versionOptions"
          data-testid="new-pack-version"
          :render-label="
            (o: SelectOption) => [
              String(o.label),
              ' ',
              o.state === 'ready' ? '' : `· ${t(`vanilla.state.${String(o.state)}`)}`
            ]
          "
        />
      </n-form-item>
      <vanilla-prepare v-if="needsVanilla && version" :version-id="version" />
    </n-form>
    <template #footer>
      <n-space justify="space-between" align="center">
        <n-tag v-if="needsVanilla" size="small" type="warning" :bordered="false">
          {{ t('newPack.vanillaRequired') }}
        </n-tag>
        <span v-else />
        <n-space>
          <n-button :disabled="creating" @click="show = false">{{ t('common.cancel') }}</n-button>
          <n-button
            type="primary"
            :loading="creating"
            :disabled="!canCreate"
            data-testid="new-pack-create"
            @click="create"
          >
            {{ t('newPack.create') }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>
