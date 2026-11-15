<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCheckbox, NSpace, NTag, NText } from 'naive-ui'
import type { Proposal, ProposalStep } from '@shared/ai/types'
import PngThumb from './PngThumb.vue'

/**
 * The AI's plan, shown before anything changes. Every step is described in the UI language; the user keeps or
 * unchecks steps, then applies the selection (or rejects everything).
 */
const props = defineProps<{ proposal: Proposal; busy?: boolean }>()
const emit = defineEmits<{ apply: [stepIds: string[]]; reject: [] }>()
const { t, te } = useI18n()

const accepted = ref<Set<string>>(new Set())
watch(
  () => props.proposal.id,
  () => (accepted.value = new Set(props.proposal.steps.map((s) => s.id))),
  { immediate: true }
)

const pending = computed(() => props.proposal.status === 'pending')

function label(step: ProposalStep): string {
  const key = step.description.key
  return te(key) ? t(key, step.description.params) : `${step.tool}(${JSON.stringify(step.args)})`
}

function toggle(id: string, on: boolean): void {
  const next = new Set(accepted.value)
  if (on) next.add(id)
  else next.delete(id)
  accepted.value = next
}

/** Kept steps that depend on an unchecked step: they will be replayed without it, so the result may differ. */
const brokenDependencies = computed(
  () =>
    props.proposal.steps.filter(
      (s) => accepted.value.has(s.id) && s.dependsOn.some((d) => !accepted.value.has(d))
    ).length
)

const finalPreview = computed(() => {
  const mutate = props.proposal.steps.filter((s) => s.previewPng)
  return mutate.length ? mutate[mutate.length - 1].previewPng : undefined
})
</script>

<template>
  <div class="proposal" data-testid="proposal-review">
    <n-space justify="space-between" align="center">
      <n-text strong>{{ t('ai.proposal.title', { count: proposal.steps.length }) }}</n-text>
      <n-tag
        v-if="!pending"
        size="tiny"
        :bordered="false"
        :type="proposal.status === 'rejected' ? 'default' : 'success'"
      >
        {{ t(`ai.proposal.status.${proposal.status}`) }}
      </n-tag>
    </n-space>

    <div class="compare">
      <div class="col">
        <png-thumb :png="proposal.basePng" :size="72" />
        <n-text depth="3" class="cap">{{ t('ai.proposal.before') }}</n-text>
      </div>
      <div v-if="finalPreview" class="col">
        <png-thumb :png="finalPreview" :size="72" />
        <n-text depth="3" class="cap">{{ t('ai.proposal.after') }}</n-text>
      </div>
    </div>

    <ol class="steps">
      <li v-for="step in proposal.steps" :key="step.id" :data-testid="`proposal-step-${step.tool}`">
        <n-checkbox
          :checked="accepted.has(step.id)"
          :disabled="!pending"
          size="small"
          @update:checked="(on: boolean) => toggle(step.id, on)"
        />
        <png-thumb v-if="step.previewPng" :png="step.previewPng" :size="32" />
        <span class="desc">{{ label(step) }}</span>
        <n-tag v-if="step.kind === 'memory'" size="tiny" :bordered="false" type="info">{{
          t('ai.proposal.brief')
        }}</n-tag>
      </li>
    </ol>

    <n-alert
      v-if="pending && brokenDependencies > 0"
      type="warning"
      :show-icon="false"
      class="warn"
    >
      {{ t('ai.proposal.dependencyWarning', { count: brokenDependencies }) }}
    </n-alert>

    <n-space v-if="pending" justify="end" size="small">
      <n-button size="small" :disabled="busy" data-testid="proposal-reject" @click="emit('reject')">
        {{ t('ai.proposal.reject') }}
      </n-button>
      <n-button
        size="small"
        type="primary"
        :loading="busy"
        :disabled="accepted.size === 0"
        data-testid="proposal-apply"
        @click="
          emit(
            'apply',
            proposal.steps.filter((s) => accepted.has(s.id)).map((s) => s.id)
          )
        "
      >
        {{
          accepted.size === proposal.steps.length
            ? t('ai.proposal.applyAll')
            : t('ai.proposal.applySome', { count: accepted.size, total: proposal.steps.length })
        }}
      </n-button>
    </n-space>
  </div>
</template>

<style scoped>
.proposal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(24, 160, 88, 0.45);
  background: rgba(24, 160, 88, 0.06);
}
.compare {
  display: flex;
  gap: 12px;
}
.col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.cap {
  font-size: 11px;
}
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.desc {
  flex: 1;
  min-width: 0;
}
.warn {
  font-size: 12px;
}
</style>
