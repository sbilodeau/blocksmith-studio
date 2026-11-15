<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NProgress, NSpace, NTable, NTag, NText, useMessage } from 'naive-ui'
import type { EvalProgress, EvalReport, ModelRef } from '@shared/ai/types'
import ModelPicker from './ModelPicker.vue'
import { call } from '../../services/ipc'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Settings > AI > "Test this model": sends the FR/EN evaluation phrases to a model and shows how often it picks the
 * right tools in each language (PLAN 6.8). Uses the provider's tokens, so the quick test is the default.
 */
const { t } = useI18n()
const ai = useAiStore()
const settings = useSettingsStore()
const message = useMessage()
const { showError } = useErrorMessage()

const model = ref<ModelRef | undefined>(settings.settings.ai.agents.editor.model)
const running = ref(false)
const progress = ref<EvalProgress | null>(null)
const report = ref<EvalReport | null>(null)

const off = window.blocksmith.on('ai.eval.progress', (p) => (progress.value = p))
onBeforeUnmount(off)

const percent = computed(() =>
  progress.value ? Math.round((progress.value.done / progress.value.total) * 100) : 0
)

async function run(quick: boolean): Promise<void> {
  if (!model.value) return
  running.value = true
  progress.value = null
  report.value = null
  try {
    report.value = await call('ai.eval.run', { model: { ...model.value }, quick })
  } catch (err) {
    showError(err)
  } finally {
    running.value = false
  }
}

async function stop(): Promise<void> {
  await call('ai.eval.stop').catch(showError)
}

async function copyReport(): Promise<void> {
  if (!report.value) return
  await navigator.clipboard.writeText(report.value.markdown)
  message.success(t('ai.eval.copied'))
}
</script>

<template>
  <div class="model-test" data-testid="model-test">
    <n-text strong>{{ t('ai.eval.title') }}</n-text>
    <n-text depth="3" class="hint">{{ t('ai.eval.hint') }}</n-text>
    <n-space align="center" :wrap="false">
      <model-picker v-model="model" size="small" class="picker" />
      <template v-if="!running">
        <n-button
          size="small"
          :disabled="!model || !ai.hasUsableProvider"
          data-testid="model-test-quick"
          @click="run(true)"
        >
          {{ t('ai.eval.quick') }}
        </n-button>
        <n-button
          size="small"
          :disabled="!model || !ai.hasUsableProvider"
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
    <n-text v-if="running && progress" depth="3" class="hint">
      {{ t('ai.eval.progress', { done: progress.done, total: progress.total }) }}
    </n-text>

    <div v-if="report" class="report" data-testid="model-test-report">
      <n-alert :type="report.ok ? 'success' : 'warning'" :show-icon="false">
        {{
          report.stopped
            ? t('ai.eval.stopped')
            : report.ok
              ? t('ai.eval.good', { rate: report.overall.rate })
              : report.overall.rate < 90
                ? t('ai.eval.weak', { rate: report.overall.rate })
                : t('ai.eval.weakGap', { gap: report.gap })
        }}
      </n-alert>
      <n-table size="small" :bordered="false" :single-line="false">
        <tbody>
          <tr>
            <td>{{ t('ai.eval.overall') }}</td>
            <td>{{ report.overall.passed }} / {{ report.overall.total }}</td>
            <td data-testid="model-test-rate">{{ report.overall.rate }} %</td>
          </tr>
          <tr>
            <td>{{ t('ai.eval.french') }}</td>
            <td>{{ report.fr.passed }} / {{ report.fr.total }}</td>
            <td>{{ report.fr.rate }} %</td>
          </tr>
          <tr>
            <td>{{ t('ai.eval.english') }}</td>
            <td>{{ report.en.passed }} / {{ report.en.total }}</td>
            <td>{{ report.en.rate }} %</td>
          </tr>
        </tbody>
      </n-table>
      <n-text depth="3" class="hint">
        {{
          t('ai.eval.stats', {
            latency: report.avgLatencyMs,
            input: report.inputTokens,
            output: report.outputTokens
          })
        }}
      </n-text>
      <details v-if="report.failures.length" class="failures">
        <summary>{{ t('ai.eval.failures', { count: report.failures.length }) }}</summary>
        <ul>
          <li v-for="f in report.failures" :key="`${f.caseId}-${f.language}`">
            <n-tag size="tiny" :bordered="false">{{ f.language.toUpperCase() }}</n-tag>
            <span class="phrase">{{ f.phrase }}</span>
            <code class="calls">{{ f.error ?? (f.calls || t('ai.eval.noCall')) }}</code>
          </li>
        </ul>
      </details>
      <n-button size="tiny" quaternary @click="copyReport">{{ t('ai.eval.copy') }}</n-button>
    </div>
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
  width: 300px;
}
.hint {
  font-size: 12px;
}
.report {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
