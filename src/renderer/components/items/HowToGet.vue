<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NText, useMessage } from 'naive-ui'
import type { CustomItem } from '@shared/items/schema'
import { LATEST_ITEM_FORMAT, itemFormatFor } from '@shared/items/formats'
import { functionCommand, giveCommand } from '@shared/items/generate'
import { findVersion, versionTable } from '@shared/versions'

/**
 * "How to get it" on the item page: the `/function` command (runs the generated give function) and the full
 * `/give` command for the pack's Minecraft version, with copy buttons.
 */
const props = defineProps<{ item: CustomItem; version: string; dirty: boolean }>()
const { t } = useI18n()
const message = useMessage()

const format = computed(() => {
  const v = findVersion(versionTable, props.version)
  return v ? itemFormatFor(v) : LATEST_ITEM_FORMAT
})
const fn = computed(() => functionCommand(props.item))
const give = computed(() => giveCommand(props.item, format.value))

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    message.success(t('items.howTo.copied'))
  } catch {
    message.error(t('items.howTo.copyFailed'))
  }
}
</script>

<template>
  <div class="how-to" data-testid="item-how-to">
    <n-text depth="3" class="hint">{{ t('items.howTo.cheats') }}</n-text>
    <div class="command">
      <n-text depth="3" class="label">{{ t('items.howTo.function') }}</n-text>
      <div class="row">
        <code class="code" data-testid="item-how-to-function">{{ fn }}</code>
        <n-button size="tiny" data-testid="item-how-to-copy-function" @click="copy(fn)">
          {{ t('items.howTo.copy') }}
        </n-button>
      </div>
      <n-text v-if="dirty" depth="3" class="hint" data-testid="item-how-to-unsaved">
        {{ t('items.howTo.unsaved') }}
      </n-text>
    </div>
    <div class="command">
      <n-text depth="3" class="label">{{ t('items.howTo.give') }}</n-text>
      <div class="row">
        <code class="code give" data-testid="item-how-to-give">{{ give }}</code>
        <n-button size="tiny" data-testid="item-how-to-copy-give" @click="copy(give)">
          {{ t('items.howTo.copy') }}
        </n-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.how-to {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  font-size: 12px;
}
.label {
  font-size: 12px;
  display: block;
  margin-bottom: 2px;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.code {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.12);
  word-break: break-all;
  user-select: all;
}
.give {
  max-height: 96px;
  overflow-y: auto;
}
</style>
