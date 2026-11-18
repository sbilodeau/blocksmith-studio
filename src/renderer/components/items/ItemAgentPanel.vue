<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NText } from 'naive-ui'
import { isItemProposal, type ModelRef, type ReasoningLevel } from '@shared/ai/types'
import type { CustomItem } from '@shared/items/schema'
import AgentChat from '../ai/AgentChat.vue'
import ItemReview from './ItemReview.vue'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Chat of the item page (M14): the item agent helps refine the open custom item. Each message carries the form's
 * definition (unsaved edits included); a proposed definition is reviewed here and goes into the form (unsaved) on
 * "Apply to form".
 */
const props = defineProps<{ packId: string; item: CustomItem }>()
const emit = defineEmits<{ apply: [item: CustomItem] }>()
const { t } = useI18n()
const router = useRouter()
const ai = useAiStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const name = computed(() => props.item.names?.['en_us'] || props.item.id)

function apply(proposalId: string, next: CustomItem): void {
  emit('apply', next)
  ai.decideItemProposal(props.packId, proposalId, 'applied')
}

async function send(request: {
  text: string
  model: ModelRef
  thinking: ReasoningLevel
}): Promise<void> {
  try {
    await ai.sendItem({
      packId: props.packId,
      id: props.item.id,
      item: props.item as unknown as Record<string, unknown>,
      message: request.text,
      model: request.model,
      language: settings.settings.language,
      thinking: request.thinking
    })
  } catch (err) {
    showError(err)
  }
}
</script>

<template>
  <div class="item-agent" data-testid="item-agent">
    <agent-chat
      :pack-id="packId"
      agent="item"
      :ready="true"
      :empty-text="t('itemAgent.empty')"
      @send="send"
      @open-settings="router.push({ name: 'settings' })"
    >
      <template #context>
        <n-text depth="2" class="context" data-testid="item-agent-context">
          {{ t('itemAgent.context', { name }) }}
        </n-text>
      </template>
      <template #proposal="{ proposal }">
        <item-review
          v-if="isItemProposal(proposal)"
          :proposal="proposal"
          :current-item="item"
          @apply="(next) => apply(proposal.id, next)"
          @discard="ai.decideItemProposal(packId, proposal.id, 'rejected')"
        />
      </template>
    </agent-chat>
  </div>
</template>

<style scoped>
.item-agent {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.item-agent > :deep(*) {
  flex: 1;
  min-height: 0;
}
.context {
  font-size: 12px;
}
</style>
