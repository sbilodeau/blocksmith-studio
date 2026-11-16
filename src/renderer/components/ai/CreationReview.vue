<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCheckbox, NSpace, NTag, NText } from 'naive-ui'
import type { CreationProposal, PlanScope, ProposalStep } from '@shared/ai/types'
import PngThumb from './PngThumb.vue'
import JobProgressBar from '../common/JobProgressBar.vue'
import { useOpLabel } from '../../composables/useOpLabel'

/**
 * Review of a creation-agent plan (PLAN 6.3, M6): one checkbox per step. A texture step shows what it covers
 * (categories, folders, name pattern, number of textures) and a few representative textures before / after; brief
 * and pack name steps show their change; data file steps (write_json, M10) show the proposed file. Applying writes the
 * data files as one history entry, then one history entry per texture step, and can be stopped between steps.
 */
const props = withDefaults(
  defineProps<{
    proposal: CreationProposal
    /** Apply in progress. */
    busy?: boolean
    /** Stop was requested (the current step finishes). */
    stopping?: boolean
  }>(),
  { busy: false, stopping: false }
)
const emit = defineEmits<{
  apply: [stepIds: string[]]
  reject: []
  stop: []
}>()
const { t, te } = useI18n()
const opLabel = useOpLabel()

const kept = ref<Set<string>>(new Set())
watch(
  () => props.proposal.steps,
  (steps) => (kept.value = new Set(steps.map((s) => s.id))),
  { immediate: true }
)

const pending = computed(() => props.proposal.status === 'pending')
const textureSteps = computed(() =>
  props.proposal.steps.filter((s) => s.kind === 'mutate' && !s.json)
)
const keptTextureSteps = computed(() => textureSteps.value.filter((s) => kept.value.has(s.id)))
/** Texture writes if every kept step changes every texture it covers (upper bound shown on the button). */
const keptTextures = computed(() =>
  keptTextureSteps.value.reduce((n, s) => n + (s.scope?.count ?? 0), 0)
)
/** A kept step after an unticked texture step: its preview assumed the unticked one. */
const dependencyWarning = computed(() =>
  keptTextureSteps.value.some((s) => s.dependsOn.some((d) => !kept.value.has(d)))
)

function toggle(id: string, on: boolean): void {
  const next = new Set(kept.value)
  if (on) next.add(id)
  else next.delete(id)
  kept.value = next
}

function category(id: string): string {
  return te(`category.${id}`) ? t(`category.${id}`) : id
}

/** "Ores, Blocks · block/* · *_ore" */
function scopeLabel(scope: PlanScope): string {
  const parts: string[] = []
  if (scope.categories?.length) parts.push(scope.categories.map(category).join(', '))
  if (scope.folders?.length) parts.push(scope.folders.map((f) => `${f}/`).join(', '))
  if (scope.match) parts.push(scope.match)
  return parts.length ? parts.join(' · ') : t('ai.plan.wholePack')
}

function metaLabel(step: ProposalStep): string {
  const m = step.packMeta ?? {}
  return [
    m.name !== undefined ? t('ai.plan.metaName', { name: m.name }) : '',
    m.description !== undefined ? t('ai.plan.metaDescription', { description: m.description }) : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

function apply(): void {
  emit(
    'apply',
    props.proposal.steps.filter((s) => kept.value.has(s.id)).map((s) => s.id)
  )
}
</script>

<template>
  <div class="plan" data-testid="creation-review">
    <n-space justify="space-between" align="center">
      <n-text strong>{{
        t('ai.plan.title', { count: proposal.steps.length }, proposal.steps.length)
      }}</n-text>
      <n-tag
        v-if="!pending"
        size="tiny"
        :bordered="false"
        :type="proposal.status === 'rejected' ? 'default' : 'success'"
      >
        {{ t(`ai.proposal.status.${proposal.status}`) }}
      </n-tag>
    </n-space>

    <ol class="steps">
      <li
        v-for="step in proposal.steps"
        :key="step.id"
        class="step"
        :class="{ off: !kept.has(step.id) }"
        :data-testid="`plan-step-${step.tool}`"
      >
        <div class="head">
          <n-checkbox
            :checked="kept.has(step.id)"
            :disabled="!pending || busy"
            size="small"
            @update:checked="(on: boolean) => toggle(step.id, on)"
          />
          <span class="desc">{{ opLabel(step.description, step.tool) }}</span>
          <n-tag v-if="step.briefPatch" size="tiny" :bordered="false" type="info">
            {{ t('ai.proposal.brief') }}
          </n-tag>
          <n-tag v-else-if="step.packMeta" size="tiny" :bordered="false" type="info">
            {{ t('ai.plan.pack') }}
          </n-tag>
          <n-tag
            v-else-if="step.json"
            size="tiny"
            :bordered="false"
            :type="step.json.previous === null ? 'success' : 'warning'"
          >
            {{ step.json.previous === null ? t('ai.plan.newFile') : t('ai.plan.changedFile') }}
          </n-tag>
        </div>
        <details v-if="step.json" class="json" data-testid="plan-json">
          <summary>
            <n-text depth="2">{{ step.json.path }}</n-text>
            <n-text v-if="step.json.warnings" type="warning" class="json-warn">
              {{ t('ai.plan.jsonWarnings', { count: step.json.warnings }, step.json.warnings) }}
            </n-text>
          </summary>
          <pre>{{ step.json.text }}</pre>
        </details>
        <div v-if="step.scope" class="scope">
          <n-text depth="2">{{ scopeLabel(step.scope) }}</n-text>
          <n-text depth="3">{{
            t('ai.plan.textures', { count: step.scope.count }, step.scope.count)
          }}</n-text>
        </div>
        <n-text v-if="step.packMeta" depth="2" class="scope">{{ metaLabel(step) }}</n-text>
        <div v-if="step.samples?.length" class="samples">
          <span v-for="sample in step.samples" :key="sample.path" class="pair" :title="sample.path">
            <png-thumb :png="sample.beforePng" :size="28" />
            <png-thumb :png="sample.afterPng" :size="28" />
          </span>
        </div>
      </li>
    </ol>

    <n-alert v-if="pending && dependencyWarning" type="warning" :show-icon="false" class="warn">
      {{ t('ai.plan.dependencyWarning') }}
    </n-alert>
    <n-text v-if="pending && textureSteps.length" depth="3" class="hint">
      {{ t('ai.plan.checkpointHint') }}
    </n-text>

    <div v-if="busy" class="progress">
      <job-progress-bar kind="ai.plan.apply" />
      <job-progress-bar kind="bulk.apply" />
    </div>

    <n-space v-if="pending" justify="end" size="small">
      <n-button
        v-if="busy"
        size="small"
        :disabled="stopping"
        data-testid="plan-stop"
        @click="emit('stop')"
      >
        {{ stopping ? t('ai.plan.stopping') : t('ai.plan.stop') }}
      </n-button>
      <n-button v-else size="small" data-testid="plan-reject" @click="emit('reject')">
        {{ t('ai.proposal.reject') }}
      </n-button>
      <n-button
        size="small"
        type="primary"
        :loading="busy"
        :disabled="kept.size === 0"
        data-testid="plan-apply"
        @click="apply"
      >
        {{
          keptTextureSteps.length
            ? t(
                'ai.plan.apply',
                { steps: keptTextureSteps.length, textures: keptTextures },
                keptTextureSteps.length
              )
            : t('ai.plan.applyMemory')
        }}
      </n-button>
    </n-space>
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(24, 160, 88, 0.45);
  background: rgba(24, 160, 88, 0.06);
}
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.step.off .samples,
.step.off .json {
  margin: 4px 0 0 26px;
  font-size: 12px;
}
.json summary {
  cursor: pointer;
}
.json-warn {
  margin-left: 8px;
}
.json pre {
  margin: 4px 0 0;
  max-height: 220px;
  overflow: auto;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.1);
  font-size: 11px;
}
.scope {
  opacity: 0.4;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.desc {
  flex: 1;
  min-width: 0;
}
.scope {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-left: 24px;
  font-size: 11px;
}
.samples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 24px;
}
.pair {
  display: flex;
  gap: 2px;
}
.warn,
.hint {
  font-size: 11px;
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
