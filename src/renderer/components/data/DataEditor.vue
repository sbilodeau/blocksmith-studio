<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NDropdown,
  NEmpty,
  NSpin,
  NTab,
  NTabs,
  NTag,
  NText,
  NTooltip,
  useDialog,
  type DropdownOption
} from 'naive-ui'
import type { Diagnostic } from '@codemirror/lint'
import {
  checkDataText,
  formatJson,
  lineOf,
  parseDataPath,
  type LocatedIssue
} from '@shared/datapack'
import type { DataFileData } from '@shared/model/data'
import CodeEditor from './CodeEditor.vue'
import DataExplain from './DataExplain.vue'
import DataAgentPanel from './DataAgentPanel.vue'
import { call } from '../../services/ipc'
import { useDataStore } from '../../stores/data'
import { useErrorMessage } from '../../composables/useErrorMessage'
import { useIssueMessage } from './issues'

const props = defineProps<{ packId: string }>()
const emit = defineEmits<{ 'open-item': [id: string] }>()
const { t } = useI18n()
const dialog = useDialog()
const { showError } = useErrorMessage()
const issueMessage = useIssueMessage()
const store = computed(() => useDataStore(props.packId))
const path = computed(() => store.value.editing)
const info = computed(() => (path.value ? parseDataPath(path.value) : null))

const file = ref<DataFileData | null>(null)
const text = ref('')
const saved = ref('')
const loading = ref(false)
const saving = ref(false)
const compare = ref(false)
/** The AI side panel and its tab: the data agent's chat, or the explanation of the file. */
const aiTab = ref<'chat' | 'explain' | null>(null)
const explainSeen = ref(false)
watch(aiTab, (tab) => {
  if (tab === 'explain') explainSeen.value = true
})
const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null)

const dirty = computed(() => text.value !== saved.value)
/** Generated from a custom item (M14): the item is edited instead, its save rewrites this file. */
const generatedBy = computed(() => file.value?.generatedBy ?? null)
const readOnly = computed(() => generatedBy.value !== null)
const isJson = computed(() => !!info.value && !info.value.text)
const status = computed(() => (path.value ? store.value.entry(path.value)?.status : undefined))

/** Checked a moment after typing stops (large loot tables take a few ms). */
const checked = ref<ReturnType<typeof checkDataText>>({ issues: [], errors: 0, warnings: 0 })
let timer: ReturnType<typeof setTimeout> | undefined
function runCheck(): void {
  const i = info.value
  checked.value = i
    ? checkDataText(text.value, i.kind, store.value.context, i.registry)
    : { issues: [], errors: 0, warnings: 0 }
}
watch(text, () => {
  clearTimeout(timer)
  timer = setTimeout(runCheck, 150)
})
watch(() => store.value.context, runCheck)

const diagnostics = computed<Diagnostic[]>(() =>
  checked.value.issues.map((issue) => ({
    from: issue.from,
    to: issue.to,
    severity: issue.severity,
    message: issueMessage(issue)
  }))
)

const completions = computed(() => {
  const ids = store.value.ids
  const registry = info.value?.registry === 'block' ? 'block' : 'item'
  const tags = Object.entries(ids.tags).flatMap(([r, list]) =>
    r === registry ? list.map((id) => `#${id}`) : []
  )
  return [...(registry === 'block' ? ids.blocks : ids.items), ...tags]
})

async function load(): Promise<void> {
  const p = path.value
  if (!p) return
  loading.value = true
  compare.value = false
  try {
    const data = await call('data.read', { packId: props.packId, path: p })
    if (path.value !== p) return
    file.value = data
    text.value = data.text ?? ''
    saved.value = text.value
    runCheck()
  } catch (err) {
    showError(err)
  } finally {
    loading.value = false
  }
}
watch(path, load, { immediate: true })

async function save(): Promise<boolean> {
  const p = path.value
  if (!p || saving.value || readOnly.value) return false
  saving.value = true
  try {
    await store.value.save(p, text.value)
    saved.value = text.value
    // Equal to vanilla: the pack's copy was removed, the editor now shows vanilla's file.
    file.value = await call('data.read', { packId: props.packId, path: p })
    return true
  } catch (err) {
    showError(err)
    return false
  } finally {
    saving.value = false
  }
}

function format(): void {
  if (checked.value.value !== undefined) text.value = formatJson(checked.value.value)
}

function revertText(): void {
  if (file.value?.vanillaText !== null && file.value?.vanillaText !== undefined) {
    text.value = file.value.vanillaText
  }
}

/** Removes the pack's file (an override goes back to vanilla, an added file is deleted). */
async function removeFile(): Promise<void> {
  const p = path.value
  if (!p) return
  try {
    await store.value.remove(p)
    if (store.value.editing === p) await load()
  } catch (err) {
    showError(err)
  }
}

/** Less frequent actions, in the "More" menu (keeps the toolbar on one line). */
const moreOptions = computed<DropdownOption[]>(() => [
  ...(file.value?.vanillaText && text.value !== file.value.vanillaText
    ? [{ key: 'vanilla', label: t('data.editor.useVanilla') }]
    : []),
  ...(file.value?.origin === 'pack'
    ? [
        {
          key: 'remove',
          label: file.value.vanillaText ? t('editor.revert') : t('data.editor.delete')
        }
      ]
    : [])
])

function onMore(key: string): void {
  if (key === 'vanilla') revertText()
  if (key !== 'remove') return
  const revert = !!file.value?.vanillaText
  dialog.warning({
    title: revert ? t('editor.revert') : t('data.editor.delete'),
    content: revert ? t('data.editor.revertConfirm') : t('data.editor.deleteConfirm'),
    positiveText: revert ? t('editor.revert') : t('data.editor.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => removeFile()
  })
}

/** The data agent's proposal goes into the editor, unsaved (the user saves it). */
function applyProposal(next: string): void {
  if (readOnly.value) return
  text.value = next
}

/** Runs `action` after asking what to do with unsaved changes (save, discard or cancel). */
function guardUnsaved(action: () => void): void {
  if (!dirty.value) {
    action()
    return
  }
  const d = dialog.warning({
    title: t('editor.unsavedTitle'),
    content: t('editor.unsavedBody', { name: info.value?.name ?? '' }),
    positiveText: t('editor.save'),
    negativeText: t('editor.discard'),
    closable: true,
    onPositiveClick: async () => {
      d.loading = true
      if (await save()) action()
    },
    onNegativeClick: () => action()
  })
}

function back(): void {
  guardUnsaved(() => store.value.close())
}

function reveal(issue: LocatedIssue): void {
  editorRef.value?.reveal(issue.from)
}

const statusTag = computed(() => {
  const s = status.value ?? 'added'
  return {
    type: s === 'vanilla' ? 'default' : s === 'added' ? 'success' : 'warning',
    label: t(`pack.status.${s}`)
  } as const
})
const summary = computed(() => {
  const { errors, warnings } = checked.value
  if (!isJson.value) return t('data.editor.textFile')
  if (errors === 0 && warnings === 0) return t('data.editor.noProblems')
  return [
    errors ? t('data.editor.errors', { count: errors }, errors) : '',
    warnings ? t('data.editor.warnings', { count: warnings }, warnings) : ''
  ]
    .filter(Boolean)
    .join(', ')
})

defineExpose({ guardUnsaved })
</script>

<template>
  <div class="data-editor" data-testid="data-editor">
    <div class="head">
      <div class="head-left">
        <n-button size="small" data-testid="data-back" @click="back">{{
          t('data.editor.back')
        }}</n-button>
        <div class="title">
          <n-text strong class="name" data-testid="data-name">{{ info?.id }}</n-text>
          <n-tag size="tiny" :type="statusTag.type" :bordered="false" data-testid="data-status">
            {{ statusTag.label }}
          </n-tag>
          <n-tag v-if="dirty" size="tiny" type="info" :bordered="false" data-testid="data-dirty">
            {{ t('editor.unsaved') }}
          </n-tag>
          <n-text depth="3" class="path">{{ path }}</n-text>
        </div>
      </div>
      <div class="head-right">
        <n-button
          v-if="isJson && !readOnly"
          size="small"
          :disabled="checked.value === undefined"
          data-testid="data-format"
          @click="format"
        >
          {{ t('data.editor.format') }}
        </n-button>
        <n-tooltip v-if="file?.vanillaText">
          <template #trigger>
            <n-button
              size="small"
              :type="compare ? 'primary' : 'default'"
              data-testid="data-compare"
              @click="compare = !compare"
            >
              {{ t('editor.compare') }}
            </n-button>
          </template>
          {{ t('data.editor.compareHint') }}
        </n-tooltip>
        <n-tooltip v-if="file && !readOnly">
          <template #trigger>
            <n-button
              size="small"
              :type="aiTab ? 'primary' : 'default'"
              data-testid="data-ai-open"
              @click="aiTab = aiTab ? null : 'chat'"
            >
              {{ t('data.agent.button') }}
            </n-button>
          </template>
          {{ t('data.agent.buttonHint') }}
        </n-tooltip>
        <n-dropdown
          v-if="moreOptions.length && !readOnly"
          trigger="click"
          :options="moreOptions"
          @select="onMore"
        >
          <n-button size="small" data-testid="data-more">{{ t('data.editor.more') }}</n-button>
        </n-dropdown>
        <n-button
          v-if="!readOnly"
          size="small"
          type="primary"
          :disabled="!dirty"
          :loading="saving"
          data-testid="data-save"
          @click="save"
        >
          {{ t('editor.save') }}
        </n-button>
      </div>
    </div>

    <n-alert
      v-if="generatedBy"
      type="info"
      :show-icon="false"
      class="generated"
      data-testid="data-generated"
    >
      <div class="generated-row">
        <span>{{ t('items.generated.notice', { id: generatedBy }) }}</span>
        <n-button
          size="small"
          type="primary"
          data-testid="data-open-item"
          @click="emit('open-item', generatedBy)"
        >
          {{ t('items.generated.openItem') }}
        </n-button>
      </div>
    </n-alert>

    <n-spin :show="loading" class="spin">
      <div class="panes">
        <div class="pane">
          <code-editor
            v-if="file"
            ref="editorRef"
            v-model:value="text"
            :mode="isJson ? 'json' : 'text'"
            :read-only="readOnly"
            :diagnostics="diagnostics"
            :completions="completions"
            @save="save"
          />
          <n-empty v-else :description="t('data.editor.missing')" />
        </div>
        <div v-if="compare && file?.vanillaText" class="pane" data-testid="data-vanilla">
          <n-text depth="3" class="pane-label">{{ t('data.editor.vanilla') }}</n-text>
          <code-editor :value="file.vanillaText" mode="json" read-only />
        </div>
        <div v-if="aiTab && file && path" class="ai-pane" data-testid="data-ai">
          <n-tabs v-model:value="aiTab" type="line" size="small" class="ai-tabs">
            <n-tab name="chat" :tab="t('data.agent.chatTab')" />
            <n-tab name="explain" :tab="t('data.agent.explainTab')" />
            <template #suffix>
              <n-button size="tiny" quaternary data-testid="data-ai-close" @click="aiTab = null">
                {{ t('common.close') }}
              </n-button>
            </template>
          </n-tabs>
          <div class="ai-body">
            <data-agent-panel
              v-show="aiTab === 'chat'"
              :pack-id="packId"
              :path="path"
              :text="text"
              @apply="applyProposal"
            />
            <!-- Mounted the first time its tab opens (opening it asks for an explanation), then kept. -->
            <data-explain
              v-if="explainSeen"
              v-show="aiTab === 'explain'"
              :pack-id="packId"
              :path="path"
              :text="text"
            />
          </div>
        </div>
      </div>
    </n-spin>

    <div class="issues" data-testid="data-issues">
      <n-text
        :type="checked.errors ? 'error' : checked.warnings ? 'warning' : 'success'"
        class="summary"
        data-testid="data-summary"
      >
        {{ summary }}
      </n-text>
      <button
        v-for="(issue, i) in checked.issues.slice(0, 50)"
        :key="i"
        class="issue"
        :class="issue.severity"
        :data-testid="`data-issue-${i}`"
        @click="reveal(issue)"
      >
        <span class="line">{{ t('data.editor.line', { line: lineOf(text, issue.from) }) }}</span>
        <span>{{ issueMessage(issue) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.data-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.path {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spin {
  flex: 1;
  min-height: 0;
}
.generated {
  flex: none;
}
.generated-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.spin :deep(.n-spin-content) {
  height: 100%;
}
.panes {
  display: flex;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pane > :last-child {
  flex: 1;
}
.ai-pane {
  flex: none;
  width: 360px;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid rgba(128, 128, 128, 0.2);
  padding-left: 8px;
  display: flex;
  flex-direction: column;
}
.ai-tabs {
  flex: none;
}
.ai-body {
  flex: 1;
  min-height: 0;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
}
.ai-body > * {
  flex: 1;
  min-height: 0;
}
.pane-label {
  font-size: 12px;
  margin-bottom: 4px;
}
.issues {
  flex: none;
  max-height: 140px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.summary {
  font-weight: 600;
}
.issue {
  display: flex;
  gap: 8px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 2px 4px;
  border-radius: 4px;
  cursor: pointer;
}
.issue:hover {
  background: rgba(128, 128, 128, 0.12);
}
.issue.error .line {
  color: #d03050;
}
.issue.warning .line {
  color: #f0a020;
}
.line {
  flex: none;
  font-variant-numeric: tabular-nums;
}
</style>
