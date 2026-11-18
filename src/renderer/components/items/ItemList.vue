<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NEmpty, NSpace, NTag, NText } from 'naive-ui'
import { packAssetUrl } from '@shared/assets'
import type { ItemSummary } from '@shared/model/items'
import ItemIcon from './ItemIcon.vue'
import NewItemDialog from './NewItemDialog.vue'
import { itemDisplayName, useItemsStore } from '../../stores/items'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * The Items section (PLAN M14): the pack's custom items with their icon, name and kind. Creating one needs a
 * combined pack: on another kind the list explains why and offers to switch.
 */
const props = defineProps<{ packId: string; combined: boolean; changingKind?: boolean }>()
const emit = defineEmits<{ 'make-combined': [] }>()
const { t, locale } = useI18n()
const { showError } = useErrorMessage()
const store = computed(() => useItemsStore(props.packId))
const showNew = ref(false)

function icon(item: ItemSummary): string | undefined {
  return item.hasTexture
    ? packAssetUrl(props.packId, item.texture, String(store.value.revision))
    : undefined
}

function open(item: ItemSummary): void {
  store.value.open(item.id).catch(showError)
}
</script>

<template>
  <div class="item-list" data-testid="item-list">
    <n-space justify="space-between" align="center" class="tools" :wrap="false">
      <n-text depth="3" class="count">{{
        t('items.list.count', { count: store.items.length }, store.items.length)
      }}</n-text>
      <n-button
        v-if="combined"
        size="small"
        type="primary"
        data-testid="items-new"
        @click="showNew = true"
      >
        {{ t('items.new.open') }}
      </n-button>
    </n-space>

    <n-alert
      v-if="!combined"
      type="info"
      :title="t('items.list.needsCombinedTitle')"
      class="notice"
      data-testid="items-needs-combined"
    >
      <p class="text">{{ t('items.list.needsCombined') }}</p>
      <n-button
        size="small"
        type="primary"
        :loading="changingKind"
        data-testid="items-make-combined"
        @click="emit('make-combined')"
      >
        {{ t('items.list.makeCombined') }}
      </n-button>
    </n-alert>

    <n-alert
      v-if="store.invalid.length"
      type="warning"
      :show-icon="false"
      class="notice"
      data-testid="items-invalid"
    >
      {{ t('items.list.invalid', { count: store.invalid.length }, store.invalid.length) }}
      <ul class="invalid">
        <li v-for="path in store.invalid" :key="path">
          <n-text code>{{ path }}</n-text>
        </li>
      </ul>
    </n-alert>

    <div v-if="store.items.length" class="grid">
      <button
        v-for="item in store.items"
        :key="item.id"
        class="card"
        :data-testid="`item-row-${item.id}`"
        @click="open(item)"
      >
        <item-icon :url="icon(item)" :size="40" />
        <span class="info">
          <span class="name">{{ itemDisplayName(item.names, locale) }}</span>
          <n-text depth="3" class="id">{{ `${item.namespace}:${item.id}` }}</n-text>
        </span>
        <n-tag size="tiny" :bordered="false" type="info">{{ t(`items.kinds.${item.kind}`) }}</n-tag>
        <n-tag v-if="!item.hasTexture" size="tiny" :bordered="false" type="warning">
          {{ t('items.list.noTexture') }}
        </n-tag>
      </button>
    </div>
    <n-empty
      v-else-if="!store.loading"
      class="empty"
      :description="combined ? t('items.list.empty') : t('items.list.emptyNotCombined')"
      data-testid="items-empty"
    />
    <new-item-dialog v-if="combined" v-model:show="showNew" :pack-id="packId" />
  </div>
</template>

<style scoped>
.item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.tools {
  flex: none;
}
.count {
  font-size: 12px;
}
.notice {
  max-width: 720px;
}
.text {
  margin: 0 0 8px;
}
.invalid {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.card:hover {
  background: rgba(128, 128, 128, 0.08);
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id {
  font-size: 11px;
  font-family: var(--n-font-family-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  margin-top: 48px;
}
</style>
