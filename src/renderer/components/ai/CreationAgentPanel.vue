<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NText, useMessage } from 'naive-ui'
import type { CreationProposal, ModelRef, ReasoningLevel } from '@shared/ai/types'
import AgentChat from './AgentChat.vue'
import CreationReview from './CreationReview.vue'
import { useAiStore } from '../../stores/ai'
import { usePackStore } from '../../stores/pack'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Creation agent (PLAN 6.3, M6): one conversation per pack tab about the whole pack. It builds the style brief and
 * proposes category-by-category plans, reviewed step by step and applied one history entry per step.
 */
const props = defineProps<{ packId: string }>()
const emit = defineEmits<{ openSettings: [] }>()
const { t } = useI18n()
const ai = useAiStore()
const settings = useSettingsStore()
const pack = computed(() => usePackStore(props.packId))
const message = useMessage()
const { showError } = useErrorMessage()
const applying = ref<string | null>(null)
const stopping = ref(false)

const count = computed(() => pack.value.textures.length)
/** A data pack: the agent works on data files (list_data, read_json, write_json), not textures. */
const dataPack = computed(() => pack.value.summary?.kind === 'data')
/** An empty pack works from Minecraft's textures: the agent adds the ones it changes. */
const emptyBase = computed(() => pack.value.summary?.base === 'empty')
const ready = computed(() => dataPack.value || count.value > 0 || emptyBase.value)
const contextText = computed(() =>
  dataPack.value
    ? t('ai.creationDataContext')
    : emptyBase.value
      ? t('ai.creationEmptyBase', { count: count.value }, count.value)
      : count.value
        ? t('ai.creationContext', { count: count.value }, count.value)
        : t('ai.creationNoTextures')
)

async function send(request: {
  text: string
  model: ModelRef
  thinking: ReasoningLevel
}): Promise<void> {
  try {
    await ai.sendCreation({
      packId: props.packId,
      message: request.text,
      model: request.model,
      language: settings.settings.language,
      thinking: request.thinking
    })
  } catch (err) {
    showError(err)
  }
}

async function apply(proposalId: string, stepIds: string[]): Promise<void> {
  applying.value = proposalId
  stopping.value = false
  try {
    const result = await ai.applyCreation(props.packId, proposalId, stepIds)
    const parts = [
      result.texturesWritten === 0 &&
      (result.filesWritten > 0 || result.itemsWritten > 0) &&
      !result.stopped
        ? ''
        : result.stopped
          ? t('ai.plan.stoppedResult', { count: result.texturesWritten }, result.texturesWritten)
          : t('ai.plan.appliedResult', { count: result.texturesWritten }, result.texturesWritten),
      result.checkpoints > 0
        ? t('ai.plan.checkpoints', { count: result.checkpoints }, result.checkpoints)
        : '',
      result.filesWritten > 0
        ? t('ai.plan.filesWritten', { count: result.filesWritten }, result.filesWritten)
        : '',
      result.itemsWritten > 0
        ? t('ai.plan.itemsWritten', { count: result.itemsWritten }, result.itemsWritten)
        : '',
      result.briefUpdated ? t('ai.proposal.briefUpdated') : '',
      result.metaUpdated ? t('ai.plan.metaUpdated') : ''
    ]
    message.success(parts.filter(Boolean).join(' '))
  } catch (err) {
    showError(err)
  } finally {
    applying.value = null
    stopping.value = false
  }
}

async function stop(proposalId: string): Promise<void> {
  stopping.value = true
  try {
    await ai.stopCreationApply(proposalId)
  } catch (err) {
    showError(err)
  }
}

async function reject(proposalId: string): Promise<void> {
  try {
    await ai.rejectProposal(props.packId, proposalId, 'creation')
  } catch (err) {
    showError(err)
  }
}
</script>

<template>
  <div class="panel" data-testid="creation-agent">
    <agent-chat
      :pack-id="packId"
      agent="creation"
      :ready="ready"
      :empty-text="dataPack ? t('ai.emptyCreationData') : t('ai.emptyCreation')"
      @send="send"
      @open-settings="emit('openSettings')"
    >
      <template #context>
        <n-text
          :type="ready ? 'default' : 'warning'"
          depth="2"
          class="context"
          data-testid="creation-context"
        >
          {{ contextText }}
        </n-text>
      </template>
      <template #proposal="{ proposalId, proposal }">
        <creation-review
          :proposal="proposal as CreationProposal"
          :busy="applying === proposalId"
          :stopping="applying === proposalId && stopping"
          @apply="(ids) => apply(proposalId, ids)"
          @stop="stop(proposalId)"
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
.context {
  font-size: 12px;
}
</style>
