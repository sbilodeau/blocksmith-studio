<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NEmpty,
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  NText,
  NTooltip,
  useDialog
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
import { call } from '../../services/ipc'
import { useDataStore } from '../../stores/data'
import { useErrorMessage } from '../../composables/useErrorMessage'
import { useIssueMessage } from './issues'

const props = defineProps<{ packId: string }>()
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
const editorRef = ref<InstanceType<typeof CodeEditor> | null>(null)

const dirty = computed(() => text.value !== saved.value)
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
  if (!p || saving.value) return false
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
    <n-space justify="space-between" align="center" class="head" :wrap="false">
      <n-space align="center" :wrap="false">
        <n-button size="small" data-testid="data-back" @click="back">{{
          t('data.editor.back')
        }}</n-button>
        <div class="title">
          <n-text strong data-testid="data-name">{{ info?.id }}</n-text>
          <n-tag size="tiny" :type="statusTag.type" :bordered="false" data-testid="data-status">
            {{ statusTag.label }}
          </n-tag>
          <n-tag v-if="dirty" size="tiny" type="info" :bordered="false" data-testid="data-dirty">
            {{ t('editor.unsaved') }}
          </n-tag>
          <n-text depth="3" class="path">{{ path }}</n-text>
        </div>
      </n-space>
      <n-space align="center" :wrap="false">
        <n-button
          v-if="isJson"
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
        <n-button
          v-if="file?.vanillaText && text !== file.vanillaText"
          size="small"
          data-testid="data-vanilla-text"
          @click="revertText"
        >
          {{ t('data.editor.useVanilla') }}
        </n-button>
        <n-popconfirm v-if="file?.origin === 'pack'" @positive-click="removeFile">
          <template #trigger>
            <n-button size="small" data-testid="data-remove">
              {{ file?.vanillaText ? t('editor.revert') : t('data.editor.delete') }}
            </n-button>
          </template>
          {{ file?.vanillaText ? t('data.editor.revertConfirm') : t('data.editor.deleteConfirm') }}
        </n-popconfirm>
        <n-button
          size="small"
          type="primary"
          :disabled="!dirty"
          :loading="saving"
          data-testid="data-save"
          @click="save"
        >
          {{ t('editor.save') }}
        </n-button>
      </n-space>
    </n-space>

    <n-spin :show="loading" class="spin">
      <div class="panes">
        <div class="pane">
          <code-editor
            v-if="file"
            ref="editorRef"
            v-model:value="text"
            :mode="isJson ? 'json' : 'text'"
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
.title {
  display: flex;
  align-items: center;
  gap: 8px;
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
