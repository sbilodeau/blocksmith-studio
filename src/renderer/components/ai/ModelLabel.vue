<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NTooltip } from 'naive-ui'
import type { ModelInfo } from '@shared/ai/types'

/** Model name with capability badges (vision, tools, thinking) and the $ / $$ / $$$ cost tier when known. */
const props = defineProps<{ model: ModelInfo; compact?: boolean }>()
const { t } = useI18n()

const costTooltip = computed(() => {
  const p = props.model.pricing
  if (!p) return t('ai.cost.unknown')
  return t('ai.cost.tooltip', {
    input: p.inPerMTok,
    output: p.outPerMTok,
    source: t(`ai.cost.source.${p.source}`)
  })
})
</script>

<template>
  <span class="model">
    <span class="name">{{ model.label }}</span>
    <n-tooltip v-if="model.capabilities.vision">
      <template #trigger>
        <n-tag size="tiny" :bordered="false" type="info">{{ t('ai.cap.visionShort') }}</n-tag>
      </template>
      {{ t('ai.cap.vision') }}
    </n-tooltip>
    <n-tooltip v-if="model.capabilities.tools">
      <template #trigger>
        <n-tag size="tiny" :bordered="false" type="success">{{ t('ai.cap.toolsShort') }}</n-tag>
      </template>
      {{ t('ai.cap.tools') }}
    </n-tooltip>
    <n-tooltip v-if="model.capabilities.thinking">
      <template #trigger>
        <n-tag size="tiny" :bordered="false" type="warning">{{ t('ai.cap.thinkingShort') }}</n-tag>
      </template>
      {{ t('ai.cap.thinking') }}
    </n-tooltip>
    <n-tooltip v-if="model.costTier">
      <template #trigger>
        <n-tag size="tiny" :bordered="false">{{ '$'.repeat(model.costTier) }}</n-tag>
      </template>
      {{ costTooltip }}
    </n-tooltip>
  </span>
</template>

<style scoped>
.model {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
