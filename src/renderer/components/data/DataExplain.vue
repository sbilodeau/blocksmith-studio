<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NScrollbar,
  NSpace,
  NTag,
  NText
} from 'naive-ui'
import type { ModelRef } from '@shared/ai/types'
import ModelPicker from '../ai/ModelPicker.vue'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * "Explain" side panel of the data editor (PLAN M10): the AI describes in plain words, in the UI language, what the
 * open data file does in game and what it changes compared with vanilla's. Main gathers the context the model needs
 * (vanilla's file, the computed changes, the checks, the tags the file uses, item names); nothing is ever written.
 */
const props = defineProps<{ packId: string; path: string; text: string }>()
const { t, te } = useI18n()
const router = useRouter()
const ai = useAiStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const session = computed(() => ai.session(props.packId, 'explain'))
const item = computed(() => session.value.items.find((i) => i.role === 'assistant'))
const running = computed(() => session.value.runId !== null || !!item.value?.streaming)

/** Starts from the creation agent's model (the pack-level agent), then any model offered by the picker. */
const model = ref<ModelRef | undefined>(settings.settings.ai.agents.creation.model)
function pickDefault(): void {
  if (model.value) return
  const first = ai.pickerModels[0]
  if (first) model.value = { providerId: first.providerId, modelId: first.id }
}
watch(() => ai.pickerModels.length, pickDefault)

/** What the shown explanation was about, to flag edits made since. */
const explained = ref<{ path: string; text: string } | null>(null)
const stale = computed(
  () =>
    !!item.value &&
    !running.value &&
    explained.value?.path === props.path &&
    explained.value.text !== props.text
)

async function explain(): Promise<void> {
  if (!model.value) return
  explained.value = { path: props.path, text: props.text }
  try {
    await ai.explainData({
      packId: props.packId,
      path: props.path,
      text: props.text,
      model: model.value,
      language: settings.settings.language,
      thinking: settings.settings.ai.agents.creation.thinking
    })
  } catch (err) {
    showError(err)
  }
}

async function stop(): Promise<void> {
  await ai.stop(props.packId, 'explain').catch(() => undefined)
}

/** Another file: the explanation was about the previous one (a new one costs a request: the user asks for it). */
watch(
  () => props.path,
  async () => {
    await stop()
    session.value.items = []
    explained.value = null
  }
)

/** Models may reply with Markdown despite the instructions: keep the text, drop the markup. */
const shownText = computed(() =>
  (item.value?.text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .trim()
)

function errorLabel(e: { code: string; params?: Record<string, string | number> }): string {
  return te(`errors.${e.code}`) ? t(`errors.${e.code}`, e.params ?? {}) : e.code
}

onMounted(async () => {
  try {
    if (!ai.providers.length) await ai.loadProviders()
    if (ai.hasUsableProvider && !ai.models.length) await ai.loadModels()
  } catch (err) {
    showError(err)
  }
  pickDefault()
  // Opening the panel asks for the explanation (unless this file's is already there).
  if (ai.hasUsableProvider && (!item.value || explained.value?.path !== props.path)) {
    await explain()
  }
})
</script>

<template>
  <div class="explain" data-testid="data-explain">
    <n-alert v-if="!ai.hasUsableProvider" type="info" :show-icon="false">
      <p class="para">{{ t('ai.noProvider') }}</p>
      <n-button size="small" type="primary" @click="router.push({ name: 'settings' })">
        {{ t('ai.openSettings') }}
      </n-button>
    </n-alert>

    <template v-else>
      <model-picker v-model="model" size="tiny" />
      <n-space :wrap="false" size="small">
        <n-button
          v-if="!running"
          size="small"
          type="primary"
          :disabled="!model"
          data-testid="data-explain-run"
          @click="explain"
        >
          {{ item ? t('data.explain.again') : t('data.explain.run') }}
        </n-button>
        <n-button v-else size="small" data-testid="data-explain-stop" @click="stop">
          {{ t('ai.stop') }}
        </n-button>
      </n-space>
      <n-text depth="3" class="hint">{{ t('data.explain.hint') }}</n-text>

      <n-scrollbar class="body">
        <n-alert
          v-if="stale"
          type="warning"
          :show-icon="false"
          class="stale"
          data-testid="data-explain-stale"
        >
          {{ t('data.explain.stale') }}
        </n-alert>
        <template v-if="item">
          <n-collapse v-if="item.thinking" class="details">
            <n-collapse-item :title="t('ai.thinkingTitle')" name="thinking">
              <pre class="thinking">{{ item.thinking }}</pre>
            </n-collapse-item>
          </n-collapse>
          <div v-if="shownText" class="text" data-testid="data-explain-text">{{ shownText }}</div>
          <n-text v-else-if="item.streaming" depth="3">{{ t('data.explain.working') }}</n-text>
          <n-text
            v-if="item.error"
            :type="item.error.code === 'ai.stopped' ? 'warning' : 'error'"
            class="error"
            data-testid="data-explain-error"
          >
            {{ errorLabel(item.error) }}
          </n-text>
          <n-tag v-if="item.usage" size="tiny" :bordered="false" class="usage">
            {{
              t('ai.usage', {
                input: item.usage.inputTokens ?? 0,
                output: item.usage.outputTokens ?? 0
              })
            }}
            <template v-if="item.usage.costUsd !== undefined">{{
              t('ai.usageCost', { cost: item.usage.costUsd.toFixed(4) })
            }}</template>
          </n-tag>
        </template>
      </n-scrollbar>
    </template>
  </div>
</template>

<style scoped>
.explain {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
}
.para {
  margin: 0 0 8px;
}
.hint {
  font-size: 12px;
}
.body {
  flex: 1;
  min-height: 0;
}
.stale {
  margin-bottom: 8px;
  font-size: 12px;
}
.text {
  white-space: pre-wrap;
  line-height: 1.5;
  font-size: 13px;
}
.thinking {
  white-space: pre-wrap;
  font-size: 12px;
  margin: 0;
  opacity: 0.8;
}
.error {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}
.usage {
  margin-top: 8px;
}
</style>
