<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NSelect, type SelectOption } from 'naive-ui'
import type { ModelInfo, ModelRef } from '@shared/ai/types'
import ModelLabel from './ModelLabel.vue'
import { useAiStore } from '../../stores/ai'

/** Model selector with capability badges; tool-capable models only, unless Settings shows all of them. */
const model = defineModel<ModelRef | undefined>({ required: true })
defineProps<{ size?: 'tiny' | 'small' | 'medium' }>()
const { t } = useI18n()
const ai = useAiStore()

const key = (r: ModelRef): string => `${r.providerId}::${r.modelId}`

const options = computed<SelectOption[]>(() =>
  ai.pickerModels.map((m) => ({
    value: key({ providerId: m.providerId, modelId: m.id }),
    label: m.label,
    model: m
  }))
)

const value = computed({
  get: () => (model.value ? key(model.value) : null),
  set: (v: string | null) => {
    if (!v) return
    const [providerId, modelId] = v.split('::')
    model.value = { providerId, modelId }
  }
})

function renderLabel(option: SelectOption): ReturnType<typeof h> {
  const m = (option as { model?: ModelInfo }).model
  return m ? h(ModelLabel, { model: m }) : h('span', String(option.label))
}
</script>

<template>
  <n-select
    v-model:value="value"
    :options="options"
    :render-label="renderLabel"
    :loading="ai.modelsLoading"
    :placeholder="t('ai.pickModel')"
    :input-props="{ 'aria-label': t('ai.pickModel') }"
    :size="size ?? 'small'"
    filterable
    data-testid="model-picker"
  />
</template>
