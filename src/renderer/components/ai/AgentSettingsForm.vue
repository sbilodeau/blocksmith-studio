<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NForm, NFormItem, NInputNumber, NSelect, NSpace, NText } from 'naive-ui'
import type { AgentKind, ImageMode, ModelRef, ReasoningLevel } from '@shared/ai/types'
import ModelPicker from './ModelPicker.vue'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Defaults for one agent: model, thinking, round-trip budget and image mode (PLAN 7.3). */
const props = defineProps<{ agent: AgentKind; hideTitle?: boolean }>()
const { t } = useI18n()
const aiStore = useAiStore()
const settingsStore = useSettingsStore()
const { showError } = useErrorMessage()

const current = computed(() => settingsStore.settings.ai.agents[props.agent])

function patch(values: {
  model?: ModelRef
  thinking?: ReasoningLevel
  maxIterations?: number
  imageMode?: ImageMode
}): void {
  settingsStore.update({ aiAgents: { [props.agent]: values } }).catch(showError)
}

const model = computed<ModelRef | undefined>({
  get: () => current.value.model,
  set: (m) => patch({ model: m })
})

const imageModes = computed(() =>
  (['vision+grid', 'grid', 'image'] as const).map((v) => ({
    value: v,
    label: t(`ai.imageModes.${v}`)
  }))
)

const reasoningLevels = computed(() =>
  (['off', 'low', 'medium', 'high'] as const).map((v) => ({
    value: v,
    label: t(`ai.reasoning.${v}`)
  }))
)

function onThinking(v: ReasoningLevel): void {
  patch({ thinking: v })
}
function onIterations(v: number | null): void {
  if (v) patch({ maxIterations: v })
}
function onImageMode(v: ImageMode): void {
  patch({ imageMode: v })
}
function refresh(): void {
  aiStore.loadModels(true).catch(showError)
}
</script>

<template>
  <div :data-testid="`agent-settings-${agent}`">
    <n-space justify="space-between" align="center">
      <n-text v-if="!hideTitle" strong>{{ t(`ai.agents.${agent}`) }}</n-text>
      <span v-else />
      <n-button
        size="tiny"
        quaternary
        :loading="aiStore.modelsLoading"
        :disabled="!aiStore.hasUsableProvider"
        @click="refresh"
      >
        {{ t('ai.refreshModels') }}
      </n-button>
    </n-space>
    <n-form label-placement="left" label-width="170" size="small" class="form">
      <n-form-item :label="t('ai.defaultModel')">
        <model-picker v-model="model" />
      </n-form-item>
      <n-form-item :label="t('ai.thinking')" :feedback="t('ai.thinkingHint')">
        <n-select
          :value="current.thinking"
          :options="reasoningLevels"
          style="width: 180px"
          data-testid="agent-settings-reasoning"
          @update:value="onThinking"
        />
      </n-form-item>
      <n-form-item :label="t('ai.maxIterations')" :feedback="t('ai.maxIterationsHint')">
        <n-input-number
          :value="current.maxIterations"
          :min="1"
          :max="20"
          style="width: 120px"
          @update:value="onIterations"
        />
      </n-form-item>
      <n-form-item :label="t('ai.imageMode')">
        <n-select
          :value="current.imageMode"
          :options="imageModes"
          style="width: 220px"
          @update:value="onImageMode"
        />
      </n-form-item>
    </n-form>
  </div>
</template>

<style scoped>
.form {
  margin-top: 8px;
}
</style>
