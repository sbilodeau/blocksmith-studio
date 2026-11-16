<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCheckbox, NSpace, NTag, NText } from 'naive-ui'
import type { ProposalStep } from '@shared/ai/types'
import type { BulkItem } from '@shared/model/bulk'
import PngThumb from '../ai/PngThumb.vue'
import { useOpLabel } from '../../composables/useOpLabel'

/**
 * Review of a bulk change (manual bulk action or navigation-agent plan): before / after of every texture that
 * changes, each with its own checkbox, plus the plan's steps when an agent made it. Nothing is written until
 * "Apply" (one undoable history entry).
 */
const props = withDefaults(
  defineProps<{
    items: BulkItem[]
    /** Agent plans: the steps, each with a checkbox. */
    steps?: ProposalStep[]
    status?: 'pending' | 'applied' | 'partially-applied' | 'rejected'
    busy?: boolean
    unchanged?: number
    failed?: Array<{ path: string; error: string }>
    /** Thumbnail size in px (smaller in the side panel). */
    size?: number
  }>(),
  { steps: undefined, status: 'pending', busy: false, unchanged: 0, failed: () => [], size: 48 }
)
const emit = defineEmits<{
  apply: [selection: { stepIds: string[]; paths: string[] }]
  reject: []
}>()
const { t } = useI18n()
const opLabel = useOpLabel()

/** Tiles rendered at first (more on demand: big selections stay responsive). */
const PAGE = 120
const shown = ref(PAGE)
const keptPaths = ref<Set<string>>(new Set())
const keptSteps = ref<Set<string>>(new Set())
watch(
  () => [props.items, props.steps] as const,
  () => {
    keptPaths.value = new Set(props.items.map((i) => i.path))
    keptSteps.value = new Set((props.steps ?? []).map((s) => s.id))
    shown.value = PAGE
  },
  { immediate: true }
)

const pending = computed(() => props.status === 'pending')
const visible = computed(() => props.items.slice(0, shown.value))
const mutateSteps = computed(() => (props.steps ?? []).filter((s) => s.kind === 'mutate'))
const allStepsKept = computed(() => (props.steps ?? []).every((s) => keptSteps.value.has(s.id)))

function togglePath(path: string, on: boolean): void {
  const next = new Set(keptPaths.value)
  if (on) next.add(path)
  else next.delete(path)
  keptPaths.value = next
}

function toggleStep(id: string, on: boolean): void {
  const next = new Set(keptSteps.value)
  if (on) next.add(id)
  else next.delete(id)
  keptSteps.value = next
}

function setAll(on: boolean): void {
  keptPaths.value = new Set(on ? props.items.map((i) => i.path) : [])
}

const canApply = computed(
  () =>
    (keptPaths.value.size > 0 &&
      (!props.steps || mutateSteps.value.some((s) => keptSteps.value.has(s.id)))) ||
    (props.steps ?? []).some((s) => s.kind === 'memory' && keptSteps.value.has(s.id))
)

function apply(): void {
  emit('apply', {
    stepIds: (props.steps ?? []).filter((s) => keptSteps.value.has(s.id)).map((s) => s.id),
    paths: props.items.filter((i) => keptPaths.value.has(i.path)).map((i) => i.path)
  })
}
</script>

<template>
  <div class="bulk-review" data-testid="bulk-review">
    <n-space justify="space-between" align="center">
      <n-text strong>{{ t('bulk.review.title', { count: items.length }, items.length) }}</n-text>
      <n-tag
        v-if="!pending"
        size="tiny"
        :bordered="false"
        :type="status === 'rejected' ? 'default' : 'success'"
      >
        {{ t(`ai.proposal.status.${status}`) }}
      </n-tag>
    </n-space>

    <ol v-if="steps?.length" class="steps">
      <li v-for="step in steps" :key="step.id" :data-testid="`bulk-step-${step.tool}`">
        <n-checkbox
          :checked="keptSteps.has(step.id)"
          :disabled="!pending"
          size="small"
          @update:checked="(on: boolean) => toggleStep(step.id, on)"
        />
        <span class="desc">{{ opLabel(step.description, step.tool) }}</span>
        <n-tag v-if="step.kind === 'memory'" size="tiny" :bordered="false" type="info">{{
          t('ai.proposal.brief')
        }}</n-tag>
        <n-text v-else-if="step.targets" depth="3" class="targets">{{
          t('bulk.review.targets', { count: step.targets.length }, step.targets.length)
        }}</n-text>
      </li>
    </ol>
    <n-alert
      v-if="steps && pending && !allStepsKept"
      type="warning"
      :show-icon="false"
      class="warn"
    >
      {{ t('bulk.review.previewAllSteps') }}
    </n-alert>

    <n-space v-if="pending && items.length > 1" size="small" align="center">
      <n-button size="tiny" quaternary data-testid="bulk-all" @click="setAll(true)">{{
        t('grid.selectAll')
      }}</n-button>
      <n-button size="tiny" quaternary data-testid="bulk-none" @click="setAll(false)">{{
        t('bulk.review.none')
      }}</n-button>
      <n-text depth="3" class="count">{{
        t('bulk.review.kept', { kept: keptPaths.size, total: items.length })
      }}</n-text>
      <n-text depth="3" class="count">{{ t('bulk.review.legend') }}</n-text>
    </n-space>

    <div class="tiles" :style="{ '--thumb': `${size}px` }">
      <div
        v-for="item in visible"
        :key="item.path"
        class="tile"
        :class="{ off: !keptPaths.has(item.path) }"
        :title="item.path"
        :data-testid="`bulk-item-${item.name}`"
        @click="pending && togglePath(item.path, !keptPaths.has(item.path))"
      >
        <!-- Display only: the whole tile toggles. -->
        <n-checkbox
          :checked="keptPaths.has(item.path)"
          :disabled="!pending"
          :focusable="false"
          size="small"
          class="check"
        />
        <span class="pair">
          <png-thumb :png="item.beforePng" :size="size" />
          <png-thumb :png="item.afterPng" :size="size" />
        </span>
        <span class="name">{{ item.name }}</span>
      </div>
    </div>
    <n-button v-if="items.length > shown" size="tiny" quaternary @click="shown += PAGE">
      {{ t('bulk.review.more', { count: items.length - shown }) }}
    </n-button>

    <n-text v-if="unchanged > 0" depth="3" class="count">
      {{ t('bulk.review.unchanged', { count: unchanged }, unchanged) }}
    </n-text>
    <n-text
      v-if="failed.length"
      depth="3"
      class="count"
      :title="failed.map((f) => `${f.path}: ${f.error}`).join('\n')"
    >
      {{ t('bulk.review.failed', { count: failed.length }, failed.length) }}
    </n-text>

    <n-space v-if="pending" justify="end" size="small">
      <n-button size="small" :disabled="busy" data-testid="bulk-reject" @click="emit('reject')">
        {{ t('ai.proposal.reject') }}
      </n-button>
      <n-button
        size="small"
        type="primary"
        :loading="busy"
        :disabled="!canApply"
        data-testid="bulk-apply"
        @click="apply"
      >
        {{ t('bulk.review.apply', { count: keptPaths.size }, keptPaths.size) }}
      </n-button>
    </n-space>
  </div>
</template>

<style scoped>
.bulk-review {
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
.targets,
.count {
  font-size: 11px;
}
.warn {
  font-size: 12px;
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
}
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 6px;
  cursor: pointer;
  width: calc(var(--thumb) * 2 + 14px);
}
.tile:hover {
  background: rgba(128, 128, 128, 0.12);
}
.tile.off .pair {
  opacity: 0.35;
}
.check {
  pointer-events: none;
  position: absolute;
  top: 2px;
  left: 2px;
  z-index: 1;
}
.pair {
  display: flex;
  gap: 4px;
}
.name {
  font-size: 11px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
