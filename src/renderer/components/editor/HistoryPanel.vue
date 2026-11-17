<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NSpace, NText } from 'naive-ui'
import { useEditorStore } from '../../stores/editor'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Unsaved edits of the open texture (local undo) and the pack's saved history (journal). */
const props = defineProps<{ packId: string }>()
// Components resolve the per-pack editor store themselves (state is edited in the store, not via props).
const editor = computed(() => useEditorStore(props.packId))
const { t, te, d } = useI18n()
const { showError } = useErrorMessage()

function historyLabel(key: string, params?: Record<string, string | number>): string {
  return te(`history.label.${key}`) ? t(`history.label.${key}`, params ?? {}) : key
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (err) {
    showError(err)
  }
}

onMounted(() => {
  editor.value.refreshHistory().catch(() => undefined)
})
</script>

<template>
  <div class="history" data-testid="history-panel">
    <n-space justify="space-between" align="center">
      <n-text strong class="title">{{ t('editor.unsavedEdits') }}</n-text>
      <n-space size="small">
        <n-button size="tiny" :disabled="!editor.canUndo" data-testid="undo" @click="editor.undo()">
          {{ t('editor.undo') }}
        </n-button>
        <n-button size="tiny" :disabled="!editor.canRedo" data-testid="redo" @click="editor.redo()">
          {{ t('editor.redo') }}
        </n-button>
      </n-space>
    </n-space>
    <div
      class="scroll"
      style="max-height: 140px"
      tabindex="0"
      :aria-label="t('editor.unsavedEdits')"
    >
      <ol class="list" data-testid="local-history">
        <li v-for="(edit, i) in [...editor.undoStack].reverse()" :key="`u${i}`">
          {{ t(`editor.edit.${edit.label}`) }}
        </li>
        <li v-for="(edit, i) in [...editor.redoStack].reverse()" :key="`r${i}`" class="undone">
          {{ t(`editor.edit.${edit.label}`) }}
        </li>
      </ol>
      <n-text v-if="!editor.undoStack.length && !editor.redoStack.length" depth="3" class="empty">
        {{ t('editor.noEdits') }}
      </n-text>
    </div>

    <n-space justify="space-between" align="center" class="saved-head">
      <n-text strong class="title">{{ t('editor.savedHistory') }}</n-text>
      <n-space size="small">
        <n-button
          size="tiny"
          :disabled="!editor.packHistory?.canUndo || editor.dirty"
          data-testid="undo-saved"
          @click="run(editor.undoSaved)"
        >
          {{ t('editor.undo') }}
        </n-button>
        <n-button
          size="tiny"
          :disabled="!editor.packHistory?.canRedo || editor.dirty"
          data-testid="redo-saved"
          @click="run(editor.redoSaved)"
        >
          {{ t('editor.redo') }}
        </n-button>
      </n-space>
    </n-space>
    <div
      class="scroll"
      style="max-height: 160px"
      tabindex="0"
      :aria-label="t('editor.savedHistory')"
    >
      <n-empty
        v-if="!editor.packHistory?.entries.length"
        size="small"
        :description="t('editor.noSavedHistory')"
      />
      <ol v-else class="list" data-testid="saved-history">
        <li
          v-for="entry in editor.packHistory.entries"
          :key="entry.id"
          :class="{ undone: !entry.applied }"
        >
          <span>{{ historyLabel(entry.label.key, entry.label.params) }}</span>
          <n-text depth="3" class="when">{{ d(new Date(entry.at), 'time') }}</n-text>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.scroll {
  overflow-y: auto;
  border-radius: 4px;
}
.scroll:focus-visible {
  outline: 2px solid #13904f;
  outline-offset: 1px;
}
.history {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.title {
  font-size: 12px;
}
.saved-head {
  margin-top: 8px;
}
.list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
}
.list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.undone {
  opacity: 0.45;
  text-decoration: line-through;
}
.when {
  font-size: 11px;
}
.empty {
  font-size: 12px;
}
</style>
