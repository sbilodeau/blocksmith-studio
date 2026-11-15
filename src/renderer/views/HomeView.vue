<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NSpace, NTooltip, NH2 } from 'naive-ui'

const { t } = useI18n()
</script>

<template>
  <div class="home">
    <n-h2>{{ t('home.title') }}</n-h2>
    <n-empty :description="t('home.empty')" size="large" data-testid="home-empty">
      <template #extra>
        <p class="hint">{{ t('home.emptyHint') }}</p>
        <n-space justify="center">
          <n-tooltip>
            <template #trigger>
              <n-button type="primary" disabled>{{ t('home.newPack') }}</n-button>
            </template>
            {{ t('home.comingSoon') }}
          </n-tooltip>
          <n-tooltip>
            <template #trigger>
              <n-button disabled>{{ t('home.importPack') }}</n-button>
            </template>
            {{ t('home.comingSoon') }}
          </n-tooltip>
        </n-space>
      </template>
    </n-empty>
  </div>
</template>

<style scoped>
.home {
  max-width: 960px;
  margin: 0 auto;
}
.hint {
  opacity: 0.7;
  margin: 0 0 12px;
}
</style>
