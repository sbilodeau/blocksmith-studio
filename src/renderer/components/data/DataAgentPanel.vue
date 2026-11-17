<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NText } from 'naive-ui'
import { isDataFileProposal, type ModelRef, type ReasoningLevel } from '@shared/ai/types'
import { parseDataPath } from '@shared/datapack'
import AgentChat from '../ai/AgentChat.vue'
import DataFileReview from './DataFileReview.vue'
import { useAiStore } from '../../stores/ai'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Chat of the data editor (M10): the data agent helps refine the open file. Each message carries the editor's text;
 * a proposed file is reviewed here and goes into the editor (unsaved) on "Apply to editor".
 */
const props = defineProps<{ packId: string; path: string; text: string }>()
const emit = defineEmits<{ apply: [text: string] }>()
const { t } = useI18n()
const router = useRouter()
const ai = useAiStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const id = computed(() => parseDataPath(props.path)?.id ?? props.path)

function apply(proposalId: string, next: string): void {
  emit('apply', next)
  ai.decideDataProposal(props.packId, proposalId, 'applied')
}

async function send(request: {
  text: string
  model: ModelRef
  thinking: ReasoningLevel
}): Promise<void> {
  try {
    await ai.sendData({
      packId: props.packId,
      message: request.text,
      model: request.model,
      path: props.path,
      text: props.text,
      language: settings.settings.language,
      thinking: request.thinking
    })
  } catch (err) {
    showError(err)
  }
}
</script>

<template>
  <div class="data-agent" data-testid="data-agent">
    <agent-chat
      :pack-id="packId"
      agent="data"
      :ready="true"
      :empty-text="t('data.agent.empty')"
      @send="send"
      @open-settings="router.push({ name: 'settings' })"
    >
      <template #context>
        <n-text depth="2" class="context" data-testid="data-agent-file">
          {{ t('data.agent.context', { id }) }}
        </n-text>
      </template>
      <template #proposal="{ proposal }">
        <data-file-review
          v-if="isDataFileProposal(proposal)"
          :proposal="proposal"
          :current-text="text"
          @apply="(next) => apply(proposal.id, next)"
          @discard="ai.decideDataProposal(packId, proposal.id, 'rejected')"
        />
      </template>
    </agent-chat>
  </div>
</template>

<style scoped>
.data-agent {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.data-agent > :deep(*) {
  flex: 1;
  min-height: 0;
}
.context {
  font-size: 12px;
}
</style>
