<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NText } from 'naive-ui'
import type { CustomItem } from '@shared/items/schema'

/** Placeholder of the item agent's chat (built in the AI part of M14): `apply` puts a definition in the form. */
defineProps<{ packId: string; item: CustomItem }>()
defineEmits<{ apply: [item: CustomItem] }>()
const { t } = useI18n()
</script>

<template>
  <div data-testid="item-agent">
    <n-text depth="3">{{ t('items.editor.aiPlaceholder') }}</n-text>
  </div>
</template>
