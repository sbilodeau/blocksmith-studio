<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NColorPicker,
  NInput,
  NInputNumber,
  NModal,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSlider,
  NSpace,
  NText,
  useMessage
} from 'naive-ui'
import type { BulkOperation } from '@shared/bulk/operations'
import type { BulkPreview } from '@shared/model/bulk'
import { MAX_BULK_OPERATIONS } from '@shared/model/bulk'
import BulkReview from './BulkReview.vue'
import { call } from '../../services/ipc'
import { useJobsStore } from '../../stores/jobs'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Manual bulk action on the grid selection, without AI (PLAN M5): choose one or more color or transform
 * operations, preview them on every selected texture (worker thread), keep or untick textures, then apply as
 * one undoable change.
 */
const props = defineProps<{ packId: string; paths: string[] }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ applied: [count: number] }>()
const { t } = useI18n()
const message = useMessage()
const jobs = useJobsStore()
const { showError } = useErrorMessage()

type OpKind =
  | 'hue_shift'
  | 'saturation'
  | 'brightness'
  | 'replace_color'
  | 'apply_palette'
  | 'outline'
  | 'flip'
  | 'rotate'

/** Editable form of one operation (sliders in percent; converted to tool args on preview). */
interface OpForm {
  kind: OpKind
  degrees: number
  percent: number
  from: string
  to: string
  tolerance: number
  palette: string
  color: string
  mode: 'inside' | 'outside'
  axis: 'horizontal' | 'vertical'
  turn: 90 | 180 | 270
  direction: 'clockwise' | 'counterclockwise'
}

function newOp(kind: OpKind = 'hue_shift'): OpForm {
  return {
    kind,
    degrees: 30,
    percent: kind === 'brightness' ? 10 : 20,
    from: '#7F7F7FFF',
    to: '#C04040FF',
    tolerance: 0,
    palette: '',
    color: '#000000FF',
    mode: 'outside',
    axis: 'horizontal',
    turn: 90,
    direction: 'clockwise'
  }
}

const KINDS: OpKind[] = [
  'hue_shift',
  'saturation',
  'brightness',
  'replace_color',
  'apply_palette',
  'outline',
  'flip',
  'rotate'
]
const kindOptions = computed(() => KINDS.map((k) => ({ value: k, label: t(`bulk.op.${k}`) })))

const ops = ref<OpForm[]>([newOp()])
const preview = ref<BulkPreview | null>(null)
const computing = ref(false)
const applying = ref(false)

watch(show, (open) => {
  if (open) {
    ops.value = [newOp()]
    preview.value = null
  } else if (preview.value) {
    void call('bulk.discard', { previewId: preview.value.id }).catch(() => undefined)
    preview.value = null
  }
})

function setKind(op: OpForm, kind: OpKind): void {
  Object.assign(op, newOp(kind))
}

/** "#rrggbb" / "#rrggbbaa" lowercased (the color picker gives upper case). */
function hex(v: string): string {
  return v.toLowerCase()
}

function paletteOf(text: string): string[] {
  return (text.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?/g) ?? []).map(hex)
}

function toOperation(op: OpForm): BulkOperation {
  switch (op.kind) {
    case 'hue_shift':
      return { tool: 'hue_shift', args: { degrees: op.degrees } }
    case 'saturation':
    case 'brightness':
      return { tool: op.kind, args: { delta: op.percent / 100 } }
    case 'replace_color':
      return {
        tool: 'replace_color',
        args: { from: hex(op.from), to: hex(op.to), tolerance: op.tolerance }
      }
    case 'apply_palette':
      return { tool: 'apply_palette', args: { palette: paletteOf(op.palette) } }
    case 'outline':
      return { tool: 'outline', args: { color: hex(op.color), mode: op.mode } }
    case 'flip':
      return { tool: 'flip', args: { axis: op.axis } }
    case 'rotate':
      return { tool: 'rotate', args: { degrees: op.turn, direction: op.direction } }
  }
}

const invalid = computed(() =>
  ops.value.some((op) => op.kind === 'apply_palette' && paletteOf(op.palette).length === 0)
)

async function usePaletteFromBrief(op: OpForm): Promise<void> {
  try {
    const brief = await call('brief.get', { packId: props.packId })
    op.palette = brief.palette.map((p) => p.hex).join(' ')
    if (!op.palette) message.info(t('bulk.noBriefPalette'))
  } catch (err) {
    showError(err)
  }
}

async function runPreview(): Promise<void> {
  computing.value = true
  try {
    preview.value = await call('bulk.preview', {
      packId: props.packId,
      paths: [...props.paths],
      operations: ops.value.map(toOperation)
    })
  } catch (err) {
    showError(err)
  } finally {
    computing.value = false
    jobs.clear('bulk.preview')
  }
}

function back(): void {
  if (preview.value)
    void call('bulk.discard', { previewId: preview.value.id }).catch(() => undefined)
  preview.value = null
}

async function apply(selection: { paths: string[] }): Promise<void> {
  if (!preview.value) return
  applying.value = true
  try {
    const result = await call('bulk.apply', {
      previewId: preview.value.id,
      paths: [...selection.paths]
    })
    preview.value = null
    show.value = false
    message.success(t('bulk.applied', { count: result.applied }, result.applied))
    emit('applied', result.applied)
  } catch (err) {
    showError(err)
  } finally {
    applying.value = false
    jobs.clear('bulk.apply')
  }
}

const progress = computed(() => jobs.percent('bulk.preview'))
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="t('bulk.title', { count: paths.length }, paths.length)"
    style="width: min(860px, 94vw)"
    :mask-closable="!computing && !applying"
    data-testid="bulk-dialog"
  >
    <div v-if="!preview" class="form">
      <n-text depth="3" class="hint">{{ t('bulk.hint') }}</n-text>
      <div v-for="(op, i) in ops" :key="i" class="op" :data-testid="`bulk-op-${i}`">
        <n-space align="center" :wrap="false" size="small">
          <n-text depth="3" class="num">{{ i + 1 }}</n-text>
          <n-select
            :value="op.kind"
            :options="kindOptions"
            size="small"
            style="width: 220px"
            data-testid="bulk-op-kind"
            @update:value="(k: OpKind) => setKind(op, k)"
          />
          <n-button v-if="ops.length > 1" size="tiny" quaternary @click="ops.splice(i, 1)">
            {{ t('bulk.remove') }}
          </n-button>
        </n-space>

        <div class="params">
          <template v-if="op.kind === 'hue_shift'">
            <n-slider
              v-model:value="op.degrees"
              :min="-180"
              :max="180"
              :step="5"
              class="slider"
              :aria-label="t(`bulk.op.${op.kind}`)"
            />
            <n-input-number
              v-model:value="op.degrees"
              :min="-180"
              :max="180"
              :input-props="{ 'aria-label': t(`bulk.op.${op.kind}`) }"
              size="small"
              class="num-in"
            >
              <template #suffix>{{ t('bulk.degreeUnit') }}</template>
            </n-input-number>
          </template>
          <template v-else-if="op.kind === 'saturation' || op.kind === 'brightness'">
            <n-slider
              v-model:value="op.percent"
              :min="-100"
              :max="100"
              :step="5"
              class="slider"
              :aria-label="t(`bulk.op.${op.kind}`)"
            />
            <n-input-number
              v-model:value="op.percent"
              :min="-100"
              :max="100"
              :input-props="{ 'aria-label': t(`bulk.op.${op.kind}`) }"
              size="small"
              class="num-in"
            >
              <template #suffix>%</template>
            </n-input-number>
          </template>
          <template v-else-if="op.kind === 'replace_color'">
            <n-text depth="3">{{ t('bulk.from') }}</n-text>
            <n-color-picker v-model:value="op.from" :modes="['hex']" size="small" class="color" />
            <n-text depth="3">{{ t('bulk.to') }}</n-text>
            <n-color-picker v-model:value="op.to" :modes="['hex']" size="small" class="color" />
            <n-text depth="3">{{ t('bulk.tolerance') }}</n-text>
            <n-input-number
              v-model:value="op.tolerance"
              :min="0"
              :max="255"
              size="small"
              class="num-in"
            />
          </template>
          <template v-else-if="op.kind === 'apply_palette'">
            <n-input
              v-model:value="op.palette"
              size="small"
              :placeholder="t('bulk.palettePlaceholder')"
              class="palette"
              data-testid="bulk-palette"
            />
            <n-button size="small" @click="usePaletteFromBrief(op)">{{
              t('bulk.fromBrief')
            }}</n-button>
          </template>
          <template v-else-if="op.kind === 'outline'">
            <n-color-picker v-model:value="op.color" :modes="['hex']" size="small" class="color" />
            <n-radio-group v-model:value="op.mode" size="small">
              <n-radio-button value="outside">{{ t('ops.value.outside') }}</n-radio-button>
              <n-radio-button value="inside">{{ t('ops.value.inside') }}</n-radio-button>
            </n-radio-group>
          </template>
          <template v-else-if="op.kind === 'flip'">
            <n-radio-group v-model:value="op.axis" size="small">
              <n-radio-button value="horizontal">{{ t('ops.value.horizontal') }}</n-radio-button>
              <n-radio-button value="vertical">{{ t('ops.value.vertical') }}</n-radio-button>
            </n-radio-group>
          </template>
          <template v-else-if="op.kind === 'rotate'">
            <n-radio-group v-model:value="op.turn" size="small">
              <n-radio-button :value="90">{{ t('bulk.degrees', { n: 90 }) }}</n-radio-button>
              <n-radio-button :value="180">{{ t('bulk.degrees', { n: 180 }) }}</n-radio-button>
              <n-radio-button :value="270">{{ t('bulk.degrees', { n: 270 }) }}</n-radio-button>
            </n-radio-group>
            <n-radio-group v-model:value="op.direction" size="small">
              <n-radio-button value="clockwise">{{ t('ops.value.clockwise') }}</n-radio-button>
              <n-radio-button value="counterclockwise">{{
                t('ops.value.counterclockwise')
              }}</n-radio-button>
            </n-radio-group>
          </template>
        </div>
      </div>
      <n-button
        v-if="ops.length < MAX_BULK_OPERATIONS"
        size="small"
        dashed
        data-testid="bulk-add-op"
        @click="ops.push(newOp())"
      >
        {{ t('bulk.addOperation') }}
      </n-button>
      <n-alert
        v-if="ops.some((o) => o.kind === 'flip' || o.kind === 'rotate')"
        type="info"
        :show-icon="false"
        class="hint"
      >
        {{ t('bulk.transformNote') }}
      </n-alert>
      <n-progress
        v-if="computing"
        type="line"
        :percentage="progress ?? 0"
        :show-indicator="false"
        processing
      />
      <n-space justify="end">
        <n-button size="small" :disabled="computing" @click="show = false">{{
          t('common.cancel')
        }}</n-button>
        <n-button
          size="small"
          type="primary"
          :loading="computing"
          :disabled="invalid"
          data-testid="bulk-preview"
          @click="runPreview"
        >
          {{ t('bulk.preview') }}
        </n-button>
      </n-space>
    </div>

    <div v-else class="review">
      <n-alert v-if="preview.items.length === 0" type="info" :show-icon="false">
        {{ t('bulk.nothingChanges') }}
      </n-alert>
      <bulk-review
        v-else
        :items="preview.items"
        :unchanged="preview.unchanged.length"
        :failed="preview.failed"
        :busy="applying"
        :size="56"
        @apply="apply"
        @reject="show = false"
      />
      <n-button size="small" quaternary :disabled="applying" data-testid="bulk-back" @click="back">
        {{ t('bulk.back') }}
      </n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.form,
.review {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  font-size: 12px;
}
.op {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
}
.num {
  width: 14px;
}
.params {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-left: 22px;
}
.slider {
  width: 260px;
}
.num-in {
  width: 110px;
}
.color {
  width: 130px;
}
.palette {
  width: 360px;
}
</style>
