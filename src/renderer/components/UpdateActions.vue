<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { NButton, NProgress, NSpace } from 'naive-ui'
import { useUpdaterStore } from '../stores/updater'

const { t } = useI18n()
const updater = useUpdaterStore()
const { status } = storeToRefs(updater)
</script>

<template>
  <n-space align="center" size="small">
    <n-button
      v-if="status.state === 'available'"
      size="small"
      type="primary"
      data-testid="update-download"
      @click="updater.download()"
    >
      {{ t('updater.download') }}
    </n-button>
    <n-progress
      v-if="status.state === 'downloading'"
      type="line"
      style="width: 160px"
      :percentage="Math.round(status.percent)"
    />
    <n-button
      v-if="status.state === 'downloaded'"
      size="small"
      type="primary"
      data-testid="update-install"
      @click="updater.install()"
    >
      {{ status.mode === 'auto' ? t('updater.restart') : t('updater.openInstaller') }}
    </n-button>
  </n-space>
</template>
