<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NText,
  type DataTableColumns
} from 'naive-ui'
import type { ModelCapabilities, ModelInfo } from '@shared/ai/types'
import type { ModelOverride } from '@shared/model/settings'
import ModelLabel from './ModelLabel.vue'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Settings > AI > Models: every listed model with its capabilities and price, the user's corrections
 * (capabilities a provider reports wrong, their own price) and the $ / $$ / $$$ limits (PLAN 7.2-7.4).
 */
const { t } = useI18n()
const ai = useAiStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const search = ref('')
/** '' = every provider. */
const providerFilter = ref('')

const tiers = computed(() => settings.settings.ai.costTiers)
const overrides = computed(() => settings.settings.ai.modelOverrides)

const providerOptions = computed(() => [
  { value: '', label: t('ai.models.allProviders') },
  ...ai.providers.map((p) => ({ value: p.id, label: p.label }))
])

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return ai.models.filter(
    (m) =>
      (!providerFilter.value || m.providerId === providerFilter.value) &&
      (!q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
  )
})

function price(m: ModelInfo): string {
  if (!m.pricing) return t('ai.models.noPrice')
  return t('ai.models.price', { input: m.pricing.inPerMTok, output: m.pricing.outPerMTok })
}

const columns = computed<DataTableColumns<ModelInfo>>(() => [
  {
    title: t('ai.models.model'),
    key: 'id',
    // The name shrinks with an ellipsis; capability and cost tags stay visible.
    render: (m) => h('div', { class: 'model-cell' }, [h(ModelLabel, { model: m })])
  },
  {
    title: t('ai.models.provider'),
    key: 'providerId',
    width: 130,
    render: (m) => ai.providers.find((p) => p.id === m.providerId)?.label ?? m.providerId
  },
  { title: t('ai.models.pricePerM'), key: 'pricing', width: 170, render: (m) => price(m) },
  {
    title: '',
    key: 'actions',
    width: 90,
    render: (m) =>
      h(
        NButton,
        {
          size: 'tiny',
          quaternary: true,
          'data-testid': `model-adjust-${m.id}`,
          onClick: () => openEditor(m)
        },
        { default: () => t('ai.models.adjust') }
      )
  }
])

function patchSettings(patch: Parameters<typeof settings.update>[0]): Promise<void> {
  return settings
    .update(patch)
    .then(() => ai.loadModels())
    .catch(showError)
}

function onTier(which: 'low' | 'high', v: number | null): void {
  if (v === null) return
  const next = { ...tiers.value, [which]: v }
  if (next.low > next.high) return
  void patchSettings({ aiCostTiers: next })
}

function onShowAll(v: boolean): void {
  void patchSettings({ aiShowAllModels: v })
}

// ---------- override dialog ----------
type Tri = 'auto' | 'yes' | 'no'
const CAPS = ['vision', 'tools', 'thinking'] as const

const editing = ref<ModelInfo | null>(null)
const caps = ref<Record<(typeof CAPS)[number], Tri>>({
  vision: 'auto',
  tools: 'auto',
  thinking: 'auto'
})
const priceIn = ref<number | null>(null)
const priceOut = ref<number | null>(null)

const triOptions = computed(() => [
  { value: 'auto', label: t('ai.models.auto') },
  { value: 'yes', label: t('ai.models.yes') },
  { value: 'no', label: t('ai.models.no') }
])

function findOverride(m: ModelInfo): ModelOverride | undefined {
  return overrides.value.find((o) => o.providerId === m.providerId && o.modelId === m.id)
}

function openEditor(m: ModelInfo): void {
  const o = findOverride(m)
  for (const c of CAPS) {
    const v = o?.capabilities?.[c]
    caps.value[c] = v === undefined ? 'auto' : v ? 'yes' : 'no'
  }
  priceIn.value = o?.pricing?.inPerMTok ?? null
  priceOut.value = o?.pricing?.outPerMTok ?? null
  editing.value = m
}

const priceIncomplete = computed(() => (priceIn.value === null) !== (priceOut.value === null))

async function saveOverride(reset = false): Promise<void> {
  const m = editing.value
  if (!m) return
  const capabilities: ModelCapabilities = {}
  if (!reset) {
    for (const c of CAPS) if (caps.value[c] !== 'auto') capabilities[c] = caps.value[c] === 'yes'
  }
  const pricing =
    !reset && priceIn.value !== null && priceOut.value !== null
      ? { inPerMTok: priceIn.value, outPerMTok: priceOut.value }
      : undefined
  await patchSettings({
    aiModelOverride: {
      providerId: m.providerId,
      modelId: m.id,
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
      ...(pricing ? { pricing } : {})
    }
  })
  editing.value = null
}
</script>

<template>
  <div class="model-settings" data-testid="model-settings">
    <n-text strong>{{ t('ai.models.title') }}</n-text>
    <n-text depth="3" class="hint">{{ t('ai.models.hint') }}</n-text>

    <n-space align="center" size="small">
      <n-text>{{ t('ai.models.tiers') }}</n-text>
      <n-input-number
        :value="tiers.low"
        :min="0"
        :max="tiers.high"
        :step="0.5"
        size="small"
        style="width: 110px"
        data-testid="tier-low"
        @update:value="(v: number | null) => onTier('low', v)"
      >
      </n-input-number>
      <n-input-number
        :value="tiers.high"
        :min="tiers.low"
        :max="1000"
        :step="1"
        size="small"
        style="width: 110px"
        data-testid="tier-high"
        @update:value="(v: number | null) => onTier('high', v)"
      >
      </n-input-number>
    </n-space>
    <n-text depth="3" class="hint">
      {{ t('ai.models.tiersHint', { low: tiers.low, high: tiers.high }) }}
    </n-text>

    <n-space align="center" size="small">
      <n-switch
        :value="settings.settings.ai.showAllModels"
        size="small"
        data-testid="show-all-models"
        @update:value="onShowAll"
      />
      <n-text>{{ t('ai.models.showAll') }}</n-text>
    </n-space>

    <n-space align="center" size="small">
      <n-input
        v-model:value="search"
        size="small"
        clearable
        :placeholder="t('ai.models.search')"
        style="width: 240px"
        data-testid="model-search"
      />
      <n-select
        v-model:value="providerFilter"
        :options="providerOptions"
        size="small"
        style="width: 180px"
      />
    </n-space>
    <n-data-table
      size="small"
      :columns="columns"
      :data="rows"
      :row-key="(m: ModelInfo) => `${m.providerId}::${m.id}`"
      :pagination="{ pageSize: 8 }"
      table-layout="fixed"
      :loading="ai.modelsLoading"
      data-testid="model-table"
    />

    <n-modal
      :show="editing !== null"
      preset="card"
      style="width: 460px"
      :title="editing ? t('ai.models.adjustTitle', { model: editing.id }) : ''"
      @update:show="(v: boolean) => !v && (editing = null)"
    >
      <n-form label-placement="left" label-width="150" size="small">
        <n-form-item v-for="c in CAPS" :key="c" :label="t(`ai.cap.${c}`)">
          <n-select
            v-model:value="caps[c]"
            :options="triOptions"
            style="width: 160px"
            :data-testid="`override-${c}`"
          />
        </n-form-item>
        <n-form-item
          :label="t('ai.models.yourPrice')"
          :feedback="priceIncomplete ? t('ai.models.priceBoth') : t('ai.models.yourPriceHint')"
          :validation-status="priceIncomplete ? 'error' : undefined"
        >
          <n-space size="small" :wrap="false">
            <n-input-number
              v-model:value="priceIn"
              :min="0"
              :max="10000"
              :placeholder="t('ai.models.in')"
              size="small"
              style="width: 110px"
              data-testid="override-price-in"
            />
            <n-input-number
              v-model:value="priceOut"
              :min="0"
              :max="10000"
              :placeholder="t('ai.models.out')"
              size="small"
              style="width: 110px"
              data-testid="override-price-out"
            />
          </n-space>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button size="small" quaternary @click="saveOverride(true)">
            {{ t('ai.models.reset') }}
          </n-button>
          <n-button
            size="small"
            type="primary"
            :disabled="priceIncomplete"
            data-testid="override-save"
            @click="saveOverride()"
          >
            {{ t('common.save') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.model-settings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
.hint {
  font-size: 12px;
}
.model-settings :deep(.model-cell) {
  display: flex;
  min-width: 0;
  overflow: hidden;
}
</style>
