<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NEllipsis, NSpace, NTag, NText } from 'naive-ui'
import type { PackSummary } from '@shared/model/pack'

defineProps<{ pack: PackSummary }>()
const emit = defineEmits<{ open: []; reveal: []; delete: [] }>()
const { t, d } = useI18n()
</script>

<template>
  <n-card
    size="small"
    hoverable
    class="card"
    :data-testid="`pack-card-${pack.id}`"
    @dblclick="emit('open')"
  >
    <div class="row">
      <img v-if="pack.iconUrl" :src="pack.iconUrl" class="icon pixelated" alt="" />
      <div v-else class="icon placeholder" />
      <div class="info">
        <n-ellipsis class="name">{{ pack.name }}</n-ellipsis>
        <n-ellipsis :line-clamp="2" class="desc">
          <n-text depth="3">{{ pack.description || t('packs.noDescription') }}</n-text>
        </n-ellipsis>
        <n-space size="small" class="tags">
          <n-tag size="tiny" :bordered="false">{{
            t('packs.minecraft', { version: pack.authoringVersion })
          }}</n-tag>
          <n-tag
            size="tiny"
            :bordered="false"
            :type="pack.changedCount > 0 ? 'warning' : 'default'"
          >
            {{ t('packs.changed', { count: pack.changedCount }, pack.changedCount) }}
          </n-tag>
        </n-space>
        <n-text depth="3" class="date">{{
          t('packs.updated', { date: d(new Date(pack.updatedAt), 'short') })
        }}</n-text>
      </div>
    </div>
    <template #action>
      <n-space justify="end" size="small">
        <n-button size="small" quaternary @click="emit('reveal')">{{ t('packs.reveal') }}</n-button>
        <n-button
          size="small"
          quaternary
          type="error"
          :data-testid="`pack-delete-${pack.id}`"
          @click="emit('delete')"
        >
          {{ t('packs.delete') }}
        </n-button>
        <n-button
          size="small"
          type="primary"
          :data-testid="`pack-open-${pack.id}`"
          @click="emit('open')"
        >
          {{ t('packs.open') }}
        </n-button>
      </n-space>
    </template>
  </n-card>
</template>

<style scoped>
.row {
  display: flex;
  gap: 12px;
}
.icon {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  flex: none;
}
.placeholder {
  background: repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%) 50% / 16px 16px;
}
.info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.name {
  font-weight: 600;
}
.desc {
  font-size: 13px;
}
.date {
  font-size: 12px;
}
</style>
