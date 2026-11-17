<script setup lang="ts">
import { computed, h, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NProgress,
  NSelect,
  NSpace,
  NTable,
  NTag,
  NText,
  useMessage,
  type SelectOption
} from 'naive-ui'
import type { EvalProgress, EvalReport, ModelInfo, ModelRef } from '@shared/ai/types'
import {
  comparisonMarkdown,
  formatCost,
  missedRequests,
  rankReports
} from '@shared/ai/eval-compare'
import ModelLabel from './ModelLabel.vue'
import { call } from '../../services/ipc'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Settings > AI > "Test models": sends the FR/EN evaluation phrases to one or more models, one after the other,
 * and shows how often each picks the right tools in each language (PLAN 6.8), side by side when there are
 * several (PLAN M4). Uses the providers' tokens, so the quick test is the default.
 */
const { t } = useI18n()
const ai = useAiStore()
const settings = useSettingsStore()
const message = useMessage()
const { showError } = useErrorMessage()

const key = (r: ModelRef): string => `${r.providerId}::${r.modelId}`
const fromKey = (k: string): ModelRef => {
  const [providerId, modelId] = k.split('::') as [string, string]
  return { providerId, modelId }
}

const initial = settings.settings.ai.agents.editor.model
const selected = ref<string[]>(initial ? [key(initial)] : [])
const running = ref(false)
const stopping = ref(false)
const current = ref<{ index: number; count: number; label: string } | null>(null)
const progress = ref<EvalProgress | null>(null)
const reports = ref<EvalReport[]>([])

const off = window.blocksmith.on('ai.eval.progress', (p) => (progress.value = p))
onBeforeUnmount(off)

const options = computed<SelectOption[]>(() =>
  ai.pickerModels.map((m) => ({
    value: key({ providerId: m.providerId, modelId: m.id }),
    label: m.label,
    model: m
  }))
)

function renderLabel(option: SelectOption): ReturnType<typeof h> {
  const m = (option as { model?: ModelInfo }).model
  return m ? h(ModelLabel, { model: m }) : h('span', String(option.label))
}

const percent = computed(() => {
  if (!current.value) return 0
  const inModel = progress.value ? progress.value.done / progress.value.total : 0
  return Math.round(((current.value.index + inModel) / current.value.count) * 100)
})

const single = computed(() => (reports.value.length === 1 ? reports.value[0]! : null))
const ranked = computed(() => rankReports(reports.value))
const missed = computed(() => missedRequests(reports.value))

async function run(quick: boolean): Promise<void> {
  const models = selected.value.map(fromKey)
  if (models.length === 0) return
  running.value = true
  stopping.value = false
  reports.value = []
  try {
    for (const [index, model] of models.entries()) {
      if (stopping.value) break
      current.value = { index, count: models.length, label: `${model.providerId}/${model.modelId}` }
      progress.value = null
      reports.value.push(await call('ai.eval.run', { model: { ...model }, quick }))
    }
  } catch (err) {
    showError(err)
  } finally {
    running.value = false
    current.value = null
  }
}

async function stop(): Promise<void> {
  stopping.value = true
  await call('ai.eval.stop').catch(showError)
}

function verdict(r: EvalReport): string {
  if (r.stopped) return t('ai.eval.stopped')
  if (r.ok) return t('ai.eval.good', { rate: r.overall.rate })
  return r.overall.rate < 90
    ? t('ai.eval.weak', { rate: r.overall.rate })
    : t('ai.eval.weakGap', { gap: r.gap })
}

async function copyReport(): Promise<void> {
  if (reports.value.length === 0) return
  const text = single.value
    ? single.value.markdown
    : [comparisonMarkdown(reports.value), ...reports.value.map((r) => r.markdown)].join('\n')
  await navigator.clipboard.writeText(text)
  message.success(t('ai.eval.copied'))
}
</script>

<template>
  <div class="model-test" data-testid="model-test">
    <n-text strong>{{ t('ai.eval.title') }}</n-text>
    <n-text depth="3" class="hint">{{ t('ai.eval.hint') }}</n-text>
    <n-space align="center" :wrap="false">
      <n-select
        v-model:value="selected"
        multiple
        filterable
        :max-tag-count="2"
        :options="options"
        :render-label="renderLabel"
        :loading="ai.modelsLoading"
        :placeholder="t('ai.eval.pickModels')"
        :input-props="{ 'aria-label': t('ai.eval.pickModels') }"
        size="small"
        class="picker"
        data-testid="model-test-models"
      />
      <template v-if="!running">
        <n-button
          size="small"
          :disabled="selected.length === 0 || !ai.hasUsableProvider"
          data-testid="model-test-quick"
          @click="run(true)"
        >
          {{ t('ai.eval.quick') }}
        </n-button>
        <n-button
          size="small"
          :disabled="selected.length === 0 || !ai.hasUsableProvider"
          data-testid="model-test-full"
          @click="run(false)"
        >
          {{ t('ai.eval.full') }}
        </n-button>
      </template>
      <n-button v-else size="small" type="warning" data-testid="model-test-stop" @click="stop">
        {{ t('ai.stop') }}
      </n-button>
    </n-space>

    <n-progress
      v-if="running"
      type="line"
      :percentage="percent"
      :show-indicator="false"
      processing
      data-testid="model-test-progress"
    />
    <n-text v-if="running && current" depth="3" class="hint">
      {{
        current.count > 1
          ? t('ai.eval.progressModel', {
              index: current.index + 1,
              count: current.count,
              model: current.label,
              done: progress?.done ?? 0,
              total: progress?.total ?? '?'
            })
          : t('ai.eval.progress', { done: progress?.done ?? 0, total: progress?.total ?? '?' })
      }}
    </n-text>

    <!-- One model: verdict, scores per language and missed requests. -->
    <div v-if="single" class="report" data-testid="model-test-report">
      <n-alert :type="single.ok ? 'success' : 'warning'" :show-icon="false">
        {{ verdict(single) }}
      </n-alert>
      <n-table size="small" :bordered="false" :single-line="false">
        <tbody>
          <tr>
            <td>{{ t('ai.eval.overall') }}</td>
            <td>{{ single.overall.passed }} / {{ single.overall.total }}</td>
            <td data-testid="model-test-rate">{{ single.overall.rate }} %</td>
          </tr>
          <tr>
            <td>{{ t('ai.eval.french') }}</td>
            <td>{{ single.fr.passed }} / {{ single.fr.total }}</td>
            <td>{{ single.fr.rate }} %</td>
          </tr>
          <tr>
            <td>{{ t('ai.eval.english') }}</td>
            <td>{{ single.en.passed }} / {{ single.en.total }}</td>
            <td>{{ single.en.rate }} %</td>
          </tr>
        </tbody>
      </n-table>
      <n-text depth="3" class="hint">
        {{
          t('ai.eval.stats', {
            latency: single.avgLatencyMs,
            input: single.inputTokens,
            output: single.outputTokens
          })
        }}
        <template v-if="single.costUsd !== undefined">{{
          t('ai.eval.cost', { cost: formatCost(single.costUsd) })
        }}</template>
      </n-text>
      <details v-if="single.failures.length" class="failures">
        <summary>{{ t('ai.eval.failures', { count: single.failures.length }) }}</summary>
        <ul>
          <li v-for="f in single.failures" :key="`${f.caseId}-${f.language}`">
            <n-tag size="tiny" :bordered="false">{{ f.language.toUpperCase() }}</n-tag>
            <span class="phrase">{{ f.phrase }}</span>
            <code class="calls">{{ f.error ?? (f.calls || t('ai.eval.noCall')) }}</code>
          </li>
        </ul>
      </details>
    </div>

    <!-- Several models: ranked side by side. -->
    <div v-else-if="reports.length > 1" class="report" data-testid="model-test-compare">
      <n-table size="small" :bordered="false" :single-line="false">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ t('ai.models.model') }}</th>
            <th>{{ t('ai.eval.overall') }}</th>
            <th>{{ t('ai.eval.frShort') }}</th>
            <th>{{ t('ai.eval.enShort') }}</th>
            <th>{{ t('ai.eval.gap') }}</th>
            <th>{{ t('ai.eval.latency') }}</th>
            <th>{{ t('ai.eval.costHeader') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ranked" :key="row.label" :data-testid="`compare-row-${row.rank}`">
            <td>{{ row.rank }}</td>
            <td class="model-cell">
              {{ row.label }}
              <n-tag
                size="tiny"
                :bordered="false"
                :type="row.report.stopped ? 'default' : row.report.ok ? 'success' : 'warning'"
              >
                {{
                  row.report.stopped
                    ? t('ai.eval.verdictStopped')
                    : row.report.ok
                      ? t('ai.eval.verdictPass')
                      : t('ai.eval.verdictWeak')
                }}
              </n-tag>
            </td>
            <td>{{ row.report.overall.rate }} %</td>
            <td>{{ row.report.fr.rate }} %</td>
            <td>{{ row.report.en.rate }} %</td>
            <td>{{ row.report.gap }}</td>
            <td>{{ t('ai.eval.ms', { ms: row.report.avgLatencyMs }) }}</td>
            <td>{{ formatCost(row.report.costUsd) }}</td>
          </tr>
        </tbody>
      </n-table>
      <details v-if="missed.length" class="failures">
        <summary>{{ t('ai.eval.failures', { count: missed.length }) }}</summary>
        <ul>
          <li v-for="m in missed" :key="m.key">
            <span class="phrase">{{ m.key }}</span>
            <code class="calls">{{ m.missedBy.join(', ') }}</code>
          </li>
        </ul>
      </details>
      <n-text depth="3" class="hint">{{ t('ai.eval.compareHint') }}</n-text>
    </div>
    <n-button v-if="reports.length && !running" size="tiny" quaternary @click="copyReport">
      {{ t('ai.eval.copy') }}
    </n-button>
  </div>
</template>

<style scoped>
.model-test {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.2);
}
.picker {
  width: 360px;
}
.hint {
  font-size: 12px;
}
.report {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.model-cell {
  word-break: break-all;
}
.failures {
  font-size: 12px;
}
.failures ul {
  margin: 4px 0 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.phrase {
  margin: 0 6px;
}
.calls {
  opacity: 0.75;
  word-break: break-all;
}
</style>
