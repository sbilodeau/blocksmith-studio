<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDrawer, NDrawerContent, NEmpty, NSpace, NText } from 'naive-ui'
import type { HistoryState } from '@shared/model/history'
import { call } from '../../services/ipc'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * The pack's saved history (journal) from the grid: every save, revert, bulk change and applied AI plan, with
 * Undo / Redo. The editor has the same list in its history panel.
 */
const props = defineProps<{ packId: string }>()
const show = defineModel<boolean>('show', { required: true })
const { t, te, d } = useI18n()
const { showError } = useErrorMessage()
const state = ref<HistoryState | null>(null)
const busy = ref(false)

async function refresh(): Promise<void> {
  try {
    state.value = await call('history.get', { packId: props.packId })
  } catch (err) {
    showError(err)
  }
}

async function run(channel: 'history.undo' | 'history.redo'): Promise<void> {
  busy.value = true
  try {
    state.value = await call(channel, { packId: props.packId })
  } catch (err) {
    showError(err)
  } finally {
    busy.value = false
  }
}

function label(key: string, params?: Record<string, string | number>): string {
  const count = typeof params?.['count'] === 'number' ? params['count'] : undefined
  if (!te(`history.label.${key}`)) return key
  return count === undefined
    ? t(`history.label.${key}`, params ?? {})
    : t(`history.label.${key}`, params ?? {}, count)
}

watch(show, (open) => open && refresh(), { immediate: true })
const off = window.blocksmith.on('packs.changed', ({ packId }) => {
  if (show.value && (!packId || packId === props.packId)) void refresh()
})
onBeforeUnmount(off)
</script>

<template>
  <n-drawer v-model:show="show" :width="360" placement="right">
    <n-drawer-content :title="t('history.title')" closable>
      <div class="history" data-testid="pack-history">
        <n-space size="small">
          <n-button
            size="small"
            :disabled="!state?.canUndo || busy"
            data-testid="pack-undo"
            @click="run('history.undo')"
          >
            {{ t('editor.undo') }}
          </n-button>
          <n-button
            size="small"
            :disabled="!state?.canRedo || busy"
            data-testid="pack-redo"
            @click="run('history.redo')"
          >
            {{ t('editor.redo') }}
          </n-button>
        </n-space>
        <n-empty v-if="!state?.entries.length" size="small" :description="t('history.empty')" />
        <ol v-else class="list">
          <li
            v-for="entry in [...state.entries].reverse()"
            :key="entry.id"
            :class="{ undone: !entry.applied }"
          >
            <span>{{ label(entry.label.key, entry.label.params) }}</span>
            <n-text depth="3" class="when">{{ d(new Date(entry.at), 'time') }}</n-text>
          </li>
        </ol>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.undone {
  opacity: 0.45;
  text-decoration: line-through;
}
.when {
  display: block;
  font-size: 11px;
}
</style>
