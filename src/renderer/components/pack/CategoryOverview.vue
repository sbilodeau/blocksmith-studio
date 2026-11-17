<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NCard, NText } from 'naive-ui'
import type { CategorySummary } from '@shared/model/pack'
import { useCategoryName } from './category-name'

/** Navigator: one card per category with its preview, texture count and modified count. */
defineProps<{ categories: CategorySummary[] }>()
const emit = defineEmits<{ open: [id: string] }>()
const { t } = useI18n()
const categoryName = useCategoryName()
</script>

<template>
  <div class="overview" data-testid="category-overview">
    <n-card
      v-for="c in categories"
      :key="c.id"
      size="small"
      hoverable
      class="card"
      role="button"
      tabindex="0"
      :data-testid="`overview-${c.id}`"
      @click="emit('open', c.id)"
      @keydown.enter.prevent="emit('open', c.id)"
      @keydown.space.prevent="emit('open', c.id)"
    >
      <div class="preview">
        <img v-if="c.iconUrl" :src="c.iconUrl" alt="" class="pixelated" />
      </div>
      <div class="name">{{ categoryName(c) }}</div>
      <div class="meta">
        <n-text depth="3">{{ t('pack.textureCount', { count: c.count }, c.count) }}</n-text>
        <n-text v-if="c.changedCount > 0" type="warning">
          {{ t('pack.modifiedCount', { count: c.changedCount }) }}
        </n-text>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.overview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}
.card {
  cursor: pointer;
  text-align: center;
}
.card:focus-visible {
  outline: 2px solid #13904f;
  outline-offset: 2px;
}
.preview {
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview img {
  width: 80px;
  height: 80px;
  object-fit: contain;
}
.name {
  font-weight: 600;
  margin-top: 6px;
}
.meta {
  font-size: 12px;
  display: flex;
  justify-content: center;
  gap: 8px;
}
</style>
