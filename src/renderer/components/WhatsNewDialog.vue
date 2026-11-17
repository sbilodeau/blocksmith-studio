<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { NButton, NModal, NSpace, NText } from 'naive-ui'
import MarkdownView from './common/MarkdownView.vue'
import { RELEASES_URL } from '../services/changelog'
import { call } from '../services/ipc'

/** Release notes in a dialog: before an update (from the update metadata) or after one (bundled changelog). */
defineProps<{ title: string; notes: string }>()
const show = defineModel<boolean>('show', { required: true })
const { t } = useI18n()

function openReleases(): void {
  void call('app.openExternal', { url: RELEASES_URL }).catch(() => undefined)
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="title"
    style="width: 640px; max-width: calc(100vw - 32px)"
    data-testid="whats-new-dialog"
  >
    <!-- Focusable so the notes can be scrolled from the keyboard. -->
    <div class="notes" role="region" tabindex="0" :aria-label="title">
      <markdown-view v-if="notes" :source="notes" data-testid="whats-new-notes" />
      <n-text v-else depth="3">{{ t('updater.noNotes') }}</n-text>
    </div>
    <template #footer>
      <n-space justify="end">
        <n-button quaternary data-testid="whats-new-releases" @click="openReleases">
          {{ t('updater.allReleases') }}
        </n-button>
        <n-button type="primary" data-testid="whats-new-close" @click="show = false">
          {{ t('common.close') }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.notes {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}
</style>
