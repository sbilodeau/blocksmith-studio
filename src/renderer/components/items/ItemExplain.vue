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
import type { CustomItem } from '@shared/items/schema'
import ModelPicker from '../ai/ModelPicker.vue'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * "Explain" side panel of the item page (M14): the AI describes in plain words, in the UI language, what the open
 * custom item is in game (how to get it, its stats compared with its base item, its effects, its recipe, the base item
 * caveat). Main gathers the context; nothing is ever written.
 */
const props = defineProps<{ packId: string; item: CustomItem }>()
const { t, te } = useI18n()
const router = useRouter()
const ai = useAiStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const session = computed(() => ai.session(props.packId, 'itemExplain'))
const answer = computed(() => session.value.items.find((i) => i.role === 'assistant'))
const running = computed(() => session.value.runId !== null || !!answer.value?.streaming)

/** The item agent's default model, else the creation agent's, else any model offered by the picker. */
const model = ref<ModelRef | undefined>(
  settings.settings.ai.agents.item.model ?? settings.settings.ai.agents.creation.model
)
function pickDefault(): void {
  if (model.value) return
  const first = ai.pickerModels[0]
  if (first) model.value = { providerId: first.providerId, modelId: first.id }
}
watch(() => ai.pickerModels.length, pickDefault)

/** What the shown explanation was about, to flag edits made since. */
const explained = ref<{ id: string; json: string } | null>(null)
const currentJson = computed(() => JSON.stringify(props.item))
const stale = computed(
  () =>
    !!answer.value &&
    !running.value &&
    explained.value?.id === props.item.id &&
    explained.value.json !== currentJson.value
)

async function explain(): Promise<void> {
  if (!model.value) return
  explained.value = { id: props.item.id, json: currentJson.value }
  try {
    await ai.explainItem({
      packId: props.packId,
      id: props.item.id,
      item: props.item as unknown as Record<string, unknown>,
      model: model.value,
      language: settings.settings.language,
      thinking: settings.settings.ai.agents.item.thinking
    })
  } catch (err) {
    showError(err)
  }
}

async function stop(): Promise<void> {
  await ai.stop(props.packId, 'itemExplain').catch(() => undefined)
}

/** Another item: the explanation was about the previous one (a new one costs a request: the user asks for it). */
watch(
  () => props.item.id,
  async (id, previous) => {
    if (id === previous || explained.value?.id === id) return
    await stop()
    session.value.items = []
    explained.value = null
  }
)

/** Models may reply with Markdown despite the instructions: keep the text, drop the markup. */
const shownText = computed(() =>
  (answer.value?.text ?? '')
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
  // Opening the panel asks for the explanation (unless this item's is already there).
  if (ai.hasUsableProvider && (!answer.value || explained.value?.id !== props.item.id)) {
    await explain()
  }
})
</script>

<template>
  <div class="explain" data-testid="item-explain">
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
          data-testid="item-explain-run"
          @click="explain"
        >
          {{ answer ? t('itemAgent.explain.again') : t('itemAgent.explain.run') }}
        </n-button>
        <n-button v-else size="small" data-testid="item-explain-stop" @click="stop">
          {{ t('ai.stop') }}
        </n-button>
      </n-space>
      <n-text depth="3" class="hint">{{ t('itemAgent.explain.hint') }}</n-text>

      <n-scrollbar class="body" data-a11y-scroll>
        <n-alert
          v-if="stale"
          type="warning"
          :show-icon="false"
          class="stale"
          data-testid="item-explain-stale"
        >
          {{ t('itemAgent.explain.stale') }}
        </n-alert>
        <template v-if="answer">
          <n-collapse v-if="answer.thinking" class="details">
            <n-collapse-item :title="t('ai.thinkingTitle')" name="thinking">
              <pre class="thinking">{{ answer.thinking }}</pre>
            </n-collapse-item>
          </n-collapse>
          <div v-if="shownText" class="text" data-testid="item-explain-text">{{ shownText }}</div>
          <n-text v-else-if="answer.streaming" depth="3">{{
            t('itemAgent.explain.working')
          }}</n-text>
          <n-text
            v-if="answer.error"
            :type="answer.error.code === 'ai.stopped' ? 'warning' : 'error'"
            class="error"
            data-testid="item-explain-error"
          >
            {{ errorLabel(answer.error) }}
          </n-text>
          <n-tag v-if="answer.usage" size="tiny" :bordered="false" class="usage">
            {{
              t('ai.usage', {
                input: answer.usage.inputTokens ?? 0,
                output: answer.usage.outputTokens ?? 0
              })
            }}
            <template v-if="answer.usage.costUsd !== undefined">{{
              t('ai.usageCost', { cost: answer.usage.costUsd.toFixed(4) })
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
