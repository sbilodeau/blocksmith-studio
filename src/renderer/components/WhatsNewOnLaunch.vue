<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import WhatsNewDialog from './WhatsNewDialog.vue'
import { changelogNotes } from '../services/changelog'
import { call } from '../services/ipc'

/** After an update, shows once what changed since the version that ran before (from the bundled changelog). */
const { t } = useI18n()
const show = ref(false)
const version = ref('')
const notes = ref('')

onMounted(async () => {
  const whatsNew = await call('app.whatsNew').catch(() => null)
  if (!whatsNew) return
  const text = changelogNotes(whatsNew.previousVersion, whatsNew.version)
  if (!text) return
  version.value = whatsNew.version
  notes.value = text
  show.value = true
})
</script>

<template>
  <whats-new-dialog
    v-model:show="show"
    :title="t('updater.updatedTo', { version })"
    :notes="notes"
  />
</template>
