<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCollapse, NCollapseItem, NSpace, NTag, NText } from 'naive-ui'
import { formatChanges, jsonChanges } from '@shared/datapack'
import type { DataFileProposal } from '@shared/ai/types'

/**
 * A data-agent proposal (M10): the changes it makes to the open file and the whole new text. "Apply to editor" puts
 * the text in the editor, unsaved; the user saves it there.
 */
const props = defineProps<{ proposal: DataFileProposal; currentText: string }>()
const emit = defineEmits<{ apply: [text: string]; discard: [] }>()
const { t } = useI18n()

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Path-by-path changes from the text the agent started from (JSON files). */
const changes = computed(() => {
  const before = parse(props.proposal.before)
  const after = parse(props.proposal.after)
  if (before === undefined || after === undefined) return ''
  return formatChanges(jsonChanges(before, after, 20))
})
/** The editor changed since the request: applying replaces those edits. */
const outdated = computed(
  () => props.proposal.status === 'pending' && props.currentText !== props.proposal.before
)
</script>

<template>
  <div class="review" data-testid="data-proposal">
    <n-space align="center" size="small">
      <n-text strong>{{ t('data.agent.proposal') }}</n-text>
      <n-tag v-if="proposal.warnings" size="tiny" type="warning" :bordered="false">
        {{ t('ai.plan.jsonWarnings', { count: proposal.warnings }, proposal.warnings) }}
      </n-tag>
    </n-space>
    <pre v-if="changes" class="changes" data-testid="data-proposal-changes">{{ changes }}</pre>
    <n-collapse>
      <n-collapse-item :title="t('data.agent.wholeFile')" name="file">
        <pre class="file">{{ proposal.after }}</pre>
      </n-collapse-item>
    </n-collapse>
    <n-alert v-if="outdated" type="warning" :show-icon="false" class="outdated">
      {{ t('data.agent.outdated') }}
    </n-alert>
    <n-space v-if="proposal.status === 'pending'" size="small">
      <n-button
        size="small"
        type="primary"
        data-testid="data-proposal-apply"
        @click="emit('apply', proposal.after)"
      >
        {{ t('data.agent.apply') }}
      </n-button>
      <n-button size="small" data-testid="data-proposal-discard" @click="emit('discard')">
        {{ t('data.agent.discard') }}
      </n-button>
    </n-space>
    <n-text
      v-else
      depth="3"
      :type="proposal.status === 'applied' ? 'success' : 'default'"
      class="status"
      data-testid="data-proposal-status"
    >
      {{ proposal.status === 'applied' ? t('data.agent.applied') : t('data.agent.discarded') }}
    </n-text>
  </div>
</template>

<style scoped>
.review {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 8px;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
}
.changes,
.file {
  margin: 0;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
.file {
  max-height: 240px;
  overflow: auto;
}
.outdated {
  font-size: 12px;
}
.status {
  font-size: 12px;
}
</style>
