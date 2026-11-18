<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NText } from 'naive-ui'
import type { CustomItem } from '@shared/items/schema'

/** Placeholder of the item explanation (built in the AI part of M14). */
defineProps<{ packId: string; item: CustomItem }>()
const { t } = useI18n()
</script>

<template>
  <div data-testid="item-explain">
    <n-text depth="3">{{ t('items.editor.aiPlaceholder') }}</n-text>
  </div>
</template>
