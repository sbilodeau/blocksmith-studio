<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NInput,
  NScrollbar,
  NSelect,
  NSpace,
  NTag,
  NText,
  NTooltip,
  useMessage
} from 'naive-ui'
import { encodePng } from '@shared/image'
import type { ModelRef, ReasoningLevel } from '@shared/ai/types'
import ModelPicker from './ModelPicker.vue'
import ProposalReview from './ProposalReview.vue'
import { useAiStore, type ChatItem } from '../../stores/ai'
import { useEditorStore } from '../../stores/editor'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Editor agent: one conversation per pack tab that persists from one texture to the next (PLAN 6.3). */
const props = defineProps<{ packId: string }>()
const emit = defineEmits<{ openSettings: [] }>()
const { t, te } = useI18n()
const ai = useAiStore()
const settings = useSettingsStore()
const editor = computed(() => useEditorStore(props.packId))
const message = useMessage()
const { showError } = useErrorMessage()

const session = computed(() => ai.session(props.packId, 'editor'))
const input = ref('')
const applying = ref<string | null>(null)
const scroller = ref<InstanceType<typeof NScrollbar> | null>(null)

/** Model for this tab: starts from the editor agent default, can be switched on the fly. */
const model = ref<ModelRef | undefined>(settings.settings.ai.agents.editor.model)
watch(
  () => settings.settings.ai.agents.editor.model,
  (m) => {
    if (!model.value) model.value = m
  }
)

/** Reasoning level for this tab: starts from the editor agent default, can be changed per request. */
const thinking = ref<ReasoningLevel>(settings.settings.ai.agents.editor.thinking)
watch(
  () => settings.settings.ai.agents.editor.thinking,
  (level) => (thinking.value = level)
)
/** Shown only for models that can reason (unknown capabilities: shown, the provider ignores it otherwise). */
const canThink = computed(() => ai.findModel(model.value)?.capabilities.thinking !== false)
const reasoningOptions = computed(() =>
  (['off', 'low', 'medium', 'high'] as const).map((v) => ({
    value: v,
    label: t(`ai.reasoning.${v}`)
  }))
)

const running = computed(() => !!session.value.runId)
const canSend = computed(
  () =>
    !!input.value.trim() &&
    !!model.value &&
    !!editor.value.image &&
    !!editor.value.path &&
    !running.value
)

async function send(): Promise<void> {
  if (!canSend.value || !model.value || !editor.value.image || !editor.value.path) return
  editor.value.commitFloating()
  const text = input.value.trim()
  input.value = ''
  historyIndex.value = null
  draft = ''
  try {
    await ai.sendEditor({
      packId: props.packId,
      message: text,
      model: model.value,
      texture: { path: editor.value.path, png: new Uint8Array(encodePng(editor.value.image)) },
      language: settings.settings.language,
      thinking: canThink.value ? thinking.value : 'off'
    })
  } catch (err) {
    showError(err)
  }
  scrollDown()
}

/** Up/Down recall earlier messages of this conversation, like a terminal. null = editing the draft. */
const historyIndex = ref<number | null>(null)
let draft = ''
const sentMessages = computed(() =>
  session.value.items.filter((i) => i.role === 'user').map((i) => i.text)
)

function recall(step: -1 | 1): boolean {
  const list = sentMessages.value
  if (!list.length) return false
  if (historyIndex.value === null) {
    if (step === 1) return false
    draft = input.value
    historyIndex.value = list.length - 1
  } else {
    const next = historyIndex.value + step
    if (next < 0) return true
    if (next >= list.length) {
      historyIndex.value = null
      input.value = draft
      return true
    }
    historyIndex.value = next
  }
  input.value = list[historyIndex.value] ?? ''
  return true
}

function onKeydown(e: KeyboardEvent): void {
  // Enter sends, Shift+Enter adds a line. Keep editor shortcuts from firing while typing.
  e.stopPropagation()
  if (e.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
    return
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey) {
    const el = e.target as HTMLTextAreaElement
    const before = el.value.slice(0, el.selectionStart ?? 0)
    const after = el.value.slice(el.selectionEnd ?? 0)
    // Only from the first line (Up) or the last line (Down), so moving inside a multi-line message still works.
    const atEdge = e.key === 'ArrowUp' ? !before.includes('\n') : !after.includes('\n')
    if (atEdge && recall(e.key === 'ArrowUp' ? -1 : 1)) {
      e.preventDefault()
      void nextTick(() => {
        const end = el.value.length
        el.setSelectionRange(end, end)
      })
    }
  }
}

function onInput(): void {
  // Typing leaves history browsing: the edited text becomes the new draft.
  historyIndex.value = null
}

async function apply(proposalId: string, stepIds: string[]): Promise<void> {
  applying.value = proposalId
  try {
    const result = await ai.applyProposal(props.packId, proposalId, stepIds)
    if (result.appliedStepIds.length) editor.value.applyAiResult(result.png)
    message.success(
      t('ai.proposal.applied', { count: result.appliedStepIds.length }) +
        (result.briefUpdated ? ` ${t('ai.proposal.briefUpdated')}` : '')
    )
  } catch (err) {
    showError(err)
  } finally {
    applying.value = null
  }
}

async function reject(proposalId: string): Promise<void> {
  try {
    await ai.rejectProposal(props.packId, proposalId)
  } catch (err) {
    showError(err)
  }
}

function errorLabel(e: NonNullable<ChatItem['error']>): string {
  return te(`errors.${e.code}`) ? t(`errors.${e.code}`, e.params ?? {}) : e.code
}

function scrollDown(): void {
  void nextTick(() => scroller.value?.scrollTo({ top: 1e9, behavior: 'smooth' }))
}

watch(() => {
  const items = session.value.items
  const last = items[items.length - 1]
  return [items.length, last?.text.length, last?.toolCalls.length, last?.proposalId]
}, scrollDown)

onMounted(async () => {
  try {
    if (!ai.providers.length) await ai.loadProviders()
    if (ai.hasUsableProvider && !ai.models.length) await ai.loadModels()
    if (!session.value.loaded) await ai.loadConversation(props.packId, 'editor')
  } catch (err) {
    showError(err)
  }
  scrollDown()
})
</script>

<template>
  <div class="agent" data-testid="editor-agent">
    <n-alert v-if="!ai.hasUsableProvider" type="info" :show-icon="false" class="setup">
      <p class="para">{{ t('ai.noProvider') }}</p>
      <n-button size="small" type="primary" @click="emit('openSettings')">{{
        t('ai.openSettings')
      }}</n-button>
    </n-alert>

    <model-picker v-model="model" size="tiny" />
    <n-space justify="space-between" align="center" :wrap="false" class="head">
      <n-tooltip v-if="canThink">
        <template #trigger>
          <span class="reasoning-row">
            <n-text depth="3" class="reasoning-label">{{ t('ai.thinking') }}</n-text>
            <n-select
              v-model:value="thinking"
              :options="reasoningOptions"
              size="tiny"
              :consistent-menu-width="false"
              class="reasoning"
              data-testid="agent-reasoning"
            />
          </span>
        </template>
        {{ t('ai.reasoning.tooltip') }}
      </n-tooltip>
      <span v-else />
      <n-tooltip>
        <template #trigger>
          <n-button
            size="tiny"
            quaternary
            :disabled="running || session.items.length === 0"
            data-testid="agent-clear"
            @click="ai.clearConversation(packId, 'editor').catch(showError)"
          >
            {{ t('ai.clear') }}
          </n-button>
        </template>
        {{ t('ai.clearHint') }}
      </n-tooltip>
    </n-space>

    <n-scrollbar ref="scroller" class="messages" data-testid="agent-messages">
      <n-empty
        v-if="session.items.length === 0"
        size="small"
        :description="t('ai.emptyEditor')"
        class="empty"
      />
      <div v-for="item in session.items" :key="item.id" class="msg" :class="item.role">
        <template v-if="item.role === 'user'">
          <div class="bubble user-bubble">{{ item.text }}</div>
        </template>
        <template v-else>
          <n-collapse v-if="item.thinking || item.toolCalls.length" class="details">
            <n-collapse-item v-if="item.thinking" :title="t('ai.thinkingTitle')" name="thinking">
              <pre class="thinking" data-testid="agent-thinking">{{ item.thinking }}</pre>
            </n-collapse-item>
            <n-collapse-item
              v-if="item.toolCalls.length"
              :title="t('ai.toolCallsTitle', { count: item.toolCalls.length })"
              name="tools"
            >
              <ul class="calls" data-testid="agent-tool-calls">
                <li v-for="tc in item.toolCalls" :key="tc.call.id">
                  <code class="call-name">{{ tc.call.name }}</code>
                  <code class="args">{{ JSON.stringify(tc.call.args) }}</code>
                  <n-text
                    v-if="tc.result"
                    :type="tc.result.ok ? 'success' : 'error'"
                    class="result"
                  >
                    {{ tc.result.summary }}
                  </n-text>
                </li>
              </ul>
            </n-collapse-item>
          </n-collapse>
          <div v-if="item.text" class="bubble" data-testid="agent-text">{{ item.text }}</div>
          <n-text v-if="item.streaming && !item.text" depth="3" class="working">{{
            t('ai.working')
          }}</n-text>
          <proposal-review
            v-if="item.proposalId && session.proposals[item.proposalId]"
            :proposal="session.proposals[item.proposalId]"
            :busy="applying === item.proposalId"
            @apply="(ids) => apply(item.proposalId!, ids)"
            @reject="reject(item.proposalId!)"
          />
          <n-text
            v-if="item.error"
            :type="item.error.code === 'ai.stopped' ? 'warning' : 'error'"
            class="error"
          >
            {{ errorLabel(item.error) }}
          </n-text>
          <n-tag
            v-if="item.usage"
            size="tiny"
            :bordered="false"
            class="usage"
            data-testid="agent-usage"
          >
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
      </div>
    </n-scrollbar>

    <div class="composer">
      <n-input
        v-model:value="input"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        :placeholder="t('ai.placeholder')"
        :disabled="!ai.hasUsableProvider"
        data-testid="agent-input"
        @keydown="onKeydown"
        @input="onInput"
      />
      <n-space justify="space-between" align="center">
        <n-text depth="3" class="hint">{{ t('ai.sendHint') }}</n-text>
        <n-button
          v-if="running"
          size="small"
          type="warning"
          data-testid="agent-stop"
          @click="ai.stop(packId, 'editor')"
        >
          {{ t('ai.stop') }}
        </n-button>
        <n-button
          v-else
          size="small"
          type="primary"
          :disabled="!canSend"
          data-testid="agent-send"
          @click="send"
        >
          {{ t('ai.send') }}
        </n-button>
      </n-space>
    </div>
  </div>
</template>

<style scoped>
.agent {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.setup .para {
  margin: 0 0 6px;
  font-size: 12px;
}
.reasoning-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.reasoning-label {
  font-size: 12px;
}
.reasoning {
  width: 100px;
}
.messages {
  flex: 1;
  min-height: 120px;
}
.empty {
  margin-top: 24px;
}
.msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 13px;
}
.msg.user {
  align-items: flex-end;
}
.bubble {
  white-space: pre-wrap;
  word-break: break-word;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(128, 128, 128, 0.1);
  max-width: 100%;
}
.user-bubble {
  background: rgba(24, 160, 88, 0.16);
}
.details :deep(.n-collapse-item__header) {
  font-size: 12px;
}
.thinking {
  white-space: pre-wrap;
  font-size: 11px;
  opacity: 0.75;
  margin: 0;
  max-height: 200px;
  overflow: auto;
}
.calls {
  margin: 0;
  padding-left: 14px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.call-name {
  font-weight: 600;
  margin-right: 4px;
}
.args {
  word-break: break-all;
  opacity: 0.8;
}
.result {
  display: block;
  font-size: 11px;
}
.working,
.hint {
  font-size: 11px;
}
.error {
  font-size: 12px;
}
.usage {
  align-self: flex-start;
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
