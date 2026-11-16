<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { encodePng } from '@shared/image'
import type { ModelRef, Proposal, ReasoningLevel } from '@shared/ai/types'
import AgentChat from './AgentChat.vue'
import ProposalReview from './ProposalReview.vue'
import { useAiStore } from '../../stores/ai'
import { useEditorStore } from '../../stores/editor'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Editor agent: one conversation per pack tab that persists from one texture to the next (PLAN 6.3). */
const props = defineProps<{ packId: string }>()
const emit = defineEmits<{ openSettings: [] }>()
const { t } = useI18n()
const ai = useAiStore()
const settings = useSettingsStore()
const editor = computed(() => useEditorStore(props.packId))
const message = useMessage()
const { showError } = useErrorMessage()
const applying = ref<string | null>(null)

const ready = computed(() => !!editor.value.image && !!editor.value.path)

async function send(request: {
  text: string
  model: ModelRef
  thinking: ReasoningLevel
}): Promise<void> {
  if (!editor.value.image || !editor.value.path) return
  editor.value.commitFloating()
  try {
    await ai.sendEditor({
      packId: props.packId,
      message: request.text,
      model: request.model,
      texture: {
        path: editor.value.path,
        // The whole texture (every frame of an animation) with the frame being edited.
        png: new Uint8Array(encodePng(editor.value.strip!)),
        ...(editor.value.frames
          ? {
              animation: {
                frameHeight: editor.value.frames[0]!.height,
                frame: editor.value.frameIndex
              }
            }
          : {})
      },
      language: settings.settings.language,
      thinking: request.thinking
    })
  } catch (err) {
    showError(err)
  }
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
</script>

<template>
  <div class="panel" data-testid="editor-agent">
    <agent-chat
      :pack-id="packId"
      agent="editor"
      :ready="ready"
      :empty-text="t('ai.emptyEditor')"
      @send="send"
      @open-settings="emit('openSettings')"
    >
      <template #proposal="{ proposalId, proposal }">
        <proposal-review
          :proposal="proposal as Proposal"
          :busy="applying === proposalId"
          @apply="(ids: string[]) => apply(proposalId, ids)"
          @reject="reject(proposalId)"
        />
      </template>
    </agent-chat>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  min-height: 0;
}
</style>
