<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { NButton, NTabs, NTab } from 'naive-ui'
import { useTabsStore, HOME_TAB_ID } from '../stores/tabs'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const tabs = useTabsStore()

function onSelect(id: string): void {
  tabs.activate(id)
  if (id === HOME_TAB_ID) void router.push({ name: 'home' })
  else void router.push({ name: 'pack', params: { packId: id } })
}

function onClose(id: string): void {
  const wasActive = tabs.activeId === id
  tabs.close(id)
  if (wasActive) onSelect(tabs.activeId)
}

function openSettings(): void {
  void router.push({ name: 'settings' })
}
</script>

<template>
  <div class="header">
    <div class="brand" data-testid="app-name">{{ t('app.name') }}</div>
    <n-tabs
      class="tabs"
      type="card"
      size="small"
      :value="route.name === 'settings' ? undefined : tabs.activeId"
      @update:value="onSelect"
      @close="onClose"
    >
      <n-tab
        v-for="tab in tabs.tabs"
        :key="tab.id"
        :name="tab.id"
        :closable="tab.closable"
        :data-testid="`tab-${tab.id}`"
      >
        {{ tab.labelKey ? t(tab.labelKey) : tab.label }}
      </n-tab>
    </n-tabs>
    <n-button
      quaternary
      size="small"
      data-testid="open-settings"
      :type="route.name === 'settings' ? 'primary' : 'default'"
      @click="openSettings"
    >
      {{ t('nav.settings') }}
    </n-button>
  </div>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
}
.brand {
  font-weight: 600;
  white-space: nowrap;
}
.tabs {
  flex: 1;
  min-width: 0;
}
</style>
