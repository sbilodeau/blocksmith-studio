<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NText, useMessage } from 'naive-ui'
import type { BulkProposal, ModelRef, ReasoningLevel } from '@shared/ai/types'
import AgentChat from './AgentChat.vue'
import BulkReview from '../bulk/BulkReview.vue'
import { useAiStore } from '../../stores/ai'
import { usePackStore } from '../../stores/pack'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Navigation agent (PLAN 6.3, M5): one conversation per pack tab about the textures selected in the grid.
 * Its plans change many textures at once and are reviewed texture by texture before anything is written.
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

/** The selection in pack order (the order of the list the agent sees). */
const paths = computed(() =>
  pack.value.textures.filter((tex) => pack.value.selection.has(tex.path)).map((tex) => tex.path)
)

async function send(request: {
  text: string
  model: ModelRef
  thinking: ReasoningLevel
}): Promise<void> {
  try {
    await ai.sendNavigation({
      packId: props.packId,
      message: request.text,
      model: request.model,
      paths: paths.value,
      language: settings.settings.language,
      thinking: request.thinking
    })
  } catch (err) {
    showError(err)
  }
}

async function apply(
  proposalId: string,
  selection: { stepIds: string[]; paths: string[] }
): Promise<void> {
  applying.value = proposalId
  try {
    const result = await ai.applyNavigation(
      props.packId,
      proposalId,
      selection.stepIds,
      selection.paths
    )
    message.success(
      t('bulk.applied', { count: result.applied }, result.applied) +
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
    await ai.rejectProposal(props.packId, proposalId, 'navigation')
  } catch (err) {
    showError(err)
  }
}
</script>

<template>
  <div class="panel" data-testid="navigation-agent">
    <agent-chat
      :pack-id="packId"
      agent="navigation"
      :ready="paths.length > 0"
      :empty-text="t('ai.emptyNavigation')"
      @send="send"
      @open-settings="emit('openSettings')"
    >
      <template #context>
        <n-text
          :type="paths.length ? 'default' : 'warning'"
          depth="2"
          class="context"
          data-testid="navigation-selection"
        >
          {{
            paths.length
              ? t('ai.navigationSelection', { count: paths.length }, paths.length)
              : t('ai.navigationNoSelection')
          }}
        </n-text>
      </template>
      <template #proposal="{ proposalId, proposal }">
        <bulk-review
          :items="(proposal as BulkProposal).items"
          :steps="(proposal as BulkProposal).steps"
          :status="proposal.status"
          :busy="applying === proposalId"
          :size="32"
          @apply="(sel) => apply(proposalId, sel)"
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
