<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCollapse, NCollapseItem, NSpace, NTag, NText } from 'naive-ui'
import { CustomItemSchema, type CustomItem } from '@shared/items/schema'
import { itemChangesBetween, type ItemValue } from '@shared/ai/item-changes'
import type { ItemDefinitionProposal } from '@shared/ai/types'

/**
 * An item-agent proposal (M14): the fields it changes (names, stats, effects, recipe) as a readable list, and the whole
 * new definition. "Apply to form" puts the definition in the item form, unsaved; the user saves it there.
 */
const props = defineProps<{
  proposal: ItemDefinitionProposal
  /** The form's definition now (to warn when it changed since the request). */
  currentItem: Record<string, unknown> | CustomItem
}>()
const emit = defineEmits<{ apply: [item: CustomItem]; discard: [] }>()
const { t } = useI18n()

/** Defaults filled in, so "not set" and the default value do not show as a change. */
function normalized(value: unknown): unknown {
  const r = CustomItemSchema.safeParse(value)
  return r.success ? r.data : value
}

const changes = computed(() =>
  itemChangesBetween(normalized(props.proposal.before), props.proposal.after)
)
const renamed = computed(() => props.proposal.after.id !== props.proposal.itemId)
const definition = computed(() => JSON.stringify(props.proposal.after, null, 2))
const outdated = computed(
  () =>
    props.proposal.status === 'pending' &&
    JSON.stringify(normalized(props.currentItem)) !==
      JSON.stringify(normalized(props.proposal.before))
)

function shown(value: ItemValue): string {
  if (value === null) return t('itemAgent.unset')
  if (typeof value === 'boolean') return value ? t('itemAgent.yes') : t('itemAgent.no')
  return String(value)
}
</script>

<template>
  <div class="review" data-testid="item-proposal">
    <n-space align="center" size="small">
      <n-text strong>{{ t('itemAgent.proposal') }}</n-text>
      <n-tag v-if="renamed" size="tiny" type="info" :bordered="false">
        {{ t('itemAgent.renamed', { id: proposal.after.id }) }}
      </n-tag>
    </n-space>
    <n-alert
      v-if="proposal.unknownIds.length"
      type="warning"
      :show-icon="false"
      class="note"
      data-testid="item-proposal-unknown"
    >
      {{ t('itemAgent.unknownIds', { ids: proposal.unknownIds.join(', ') }) }}
    </n-alert>
    <ul v-if="changes.length" class="changes" data-testid="item-proposal-changes">
      <li v-for="(c, i) in changes" :key="i" class="change">
        <span class="label">{{ t(`itemAgent.fields.${c.field}`, c.params ?? {}) }}</span>
        <span class="values">
          <span class="before">{{ shown(c.before) }}</span>
          <span class="arrow" aria-hidden="true" />
          <span class="after">{{ shown(c.after) }}</span>
        </span>
      </li>
    </ul>
    <n-text v-else depth="3" class="note">{{ t('itemAgent.noChanges') }}</n-text>
    <n-collapse>
      <n-collapse-item :title="t('itemAgent.wholeDefinition')" name="definition">
        <pre class="definition">{{ definition }}</pre>
      </n-collapse-item>
    </n-collapse>
    <n-alert v-if="outdated" type="warning" :show-icon="false" class="note">
      {{ t('itemAgent.outdated') }}
    </n-alert>
    <n-space v-if="proposal.status === 'pending'" size="small">
      <n-button
        size="small"
        type="primary"
        data-testid="item-proposal-apply"
        @click="emit('apply', proposal.after)"
      >
        {{ t('itemAgent.apply') }}
      </n-button>
      <n-button size="small" data-testid="item-proposal-discard" @click="emit('discard')">
        {{ t('itemAgent.discard') }}
      </n-button>
    </n-space>
    <n-text
      v-else
      depth="3"
      :type="proposal.status === 'applied' ? 'success' : 'default'"
      class="note"
      data-testid="item-proposal-status"
    >
      {{ proposal.status === 'applied' ? t('itemAgent.applied') : t('itemAgent.discarded') }}
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
.changes {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.change {
  display: flex;
  flex-direction: column;
}
.label {
  font-weight: 600;
}
.values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  word-break: break-word;
}
.arrow::before {
  content: '\2192';
}
.before {
  opacity: 0.6;
  text-decoration: line-through;
}
.definition {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
.note {
  font-size: 12px;
}
</style>
