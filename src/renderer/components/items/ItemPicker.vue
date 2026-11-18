<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NEmpty, NInput, NModal, NSpin, NTag, NText } from 'naive-ui'
import { packAssetUrl, vanillaAssetUrl } from '@shared/assets'
import ItemIcon from './ItemIcon.vue'
import { useItemsStore, type PickerExtra } from '../../stores/items'
import { useErrorMessage } from '../../composables/useErrorMessage'

/**
 * Searchable list of the vanilla items of the pack's version (English name, id, icon), plus item #tags when
 * `tags` is set (recipe ingredients, repair item). Custom items are not offered as ingredients: Minecraft matches
 * ingredients by item id only, so a custom item would stand for its base item. `extra` adds entries on top (the
 * pack's own items, as texture sources of a new item).
 */
const show = defineModel<boolean>('show', { required: true })
const props = defineProps<{
  packId: string
  title?: string
  tags?: boolean
  extra?: PickerExtra[]
}>()
const emit = defineEmits<{ pick: [id: string, icon: string | undefined] }>()
const { t } = useI18n()
const { showError } = useErrorMessage()
const store = computed(() => useItemsStore(props.packId))
const search = ref('')
const loading = ref(false)
/** Rows shown at once: the catalog has over a thousand items. */
const LIMIT = 150

watch(
  show,
  async (open) => {
    if (!open) return
    search.value = ''
    if (store.value.catalog) return
    loading.value = true
    try {
      await store.value.loadCatalog()
    } catch (err) {
      showError(err)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

interface Row {
  id: string
  name?: string
  icon?: string
  url?: string
  tag: boolean
  extra: boolean
}

const rows = computed<Row[]>(() => {
  const catalog = store.value.catalog
  const all: Row[] = [
    ...(props.extra ?? []).map((e) => ({
      ...e,
      url: e.icon ? packAssetUrl(props.packId, e.icon, String(store.value.revision)) : undefined,
      tag: false,
      extra: true
    })),
    ...(catalog?.items ?? []).map((i) => ({
      ...i,
      url: i.icon ? vanillaAssetUrl(catalog!.version, i.icon) : undefined,
      tag: false,
      extra: false
    })),
    ...(props.tags ? (catalog?.tags ?? []) : []).map((id) => ({ id, tag: true, extra: false }))
  ]
  const q = search.value.trim().toLowerCase()
  const match = q
    ? all.filter((r) => r.id.includes(q) || (r.name ?? '').toLowerCase().includes(q))
    : all
  return match.slice(0, LIMIT)
})

function pick(row: Row): void {
  emit('pick', row.id, row.icon)
  show.value = false
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="title ?? t('items.picker.title')"
    style="width: 520px"
    data-testid="item-picker"
  >
    <n-input
      v-model:value="search"
      clearable
      :placeholder="tags ? t('items.picker.searchTags') : t('items.picker.search')"
      data-testid="item-picker-search"
    />
    <n-spin :show="loading">
      <div class="rows">
        <button
          v-for="row in rows"
          :key="row.id"
          class="row"
          :data-testid="`item-picker-row-${row.id}`"
          @click="pick(row)"
        >
          <item-icon :url="row.url" />
          <span class="name">{{ row.name ?? (row.tag ? t('items.picker.tag') : row.id) }}</span>
          <n-tag v-if="row.extra" size="tiny" :bordered="false" type="success">
            {{ t('items.picker.packItem') }}
          </n-tag>
          <n-text depth="3" class="id">{{ row.id }}</n-text>
        </button>
        <n-empty v-if="!loading && rows.length === 0" :description="t('items.picker.none')" />
      </div>
    </n-spin>
    <n-text depth="3" class="hint">{{
      tags ? t('items.picker.ingredientHint') : t('items.picker.hint')
    }}</n-text>
  </n-modal>
</template>

<style scoped>
.rows {
  margin-top: 8px;
  height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.row:hover {
  background: rgba(128, 128, 128, 0.12);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.id {
  font-family: var(--n-font-family-mono, monospace);
  font-size: 11px;
}
.hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
}
</style>
