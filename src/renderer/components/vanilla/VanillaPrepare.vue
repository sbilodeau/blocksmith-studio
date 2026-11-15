<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NCheckbox, NSpace } from 'naive-ui'
import JobProgressBar from '../common/JobProgressBar.vue'
import { useVanillaStore } from '../../stores/vanilla'
import { useSettingsStore } from '../../stores/settings'
import { useErrorMessage } from '../../composables/useErrorMessage'

/** Explains how the vanilla assets of one version will be obtained, and prepares them on demand. */
const props = defineProps<{ versionId: string }>()
const emit = defineEmits<{ ready: [] }>()

const { t } = useI18n()
const vanilla = useVanillaStore()
const settings = useSettingsStore()
const { showError } = useErrorMessage()

const availability = computed(() => vanilla.find(props.versionId))
const busy = computed(() => vanilla.preparing === props.versionId)
const needsConsent = computed(
  () => availability.value?.state === 'downloadable' && !settings.settings.allowMojangDownload
)

async function prepare(): Promise<void> {
  try {
    await vanilla.prepare(props.versionId)
    emit('ready')
  } catch (err) {
    showError(err)
  }
}

function setConsent(value: boolean): void {
  void settings.update({ allowMojangDownload: value })
}
</script>

<template>
  <div
    v-if="availability && availability.state !== 'ready'"
    class="prepare"
    data-testid="vanilla-prepare"
  >
    <n-alert :type="availability.state === 'local' ? 'info' : 'warning'" :show-icon="false">
      <template v-if="availability.state === 'local'">
        {{ t('vanilla.foundLocal', { version: versionId }) }}
      </template>
      <template v-else>
        <p class="para">{{ t('vanilla.notInstalled', { version: versionId }) }}</p>
        <n-checkbox
          :checked="settings.settings.allowMojangDownload"
          data-testid="mojang-consent"
          @update:checked="setConsent"
        >
          {{ t('vanilla.allowDownload') }}
        </n-checkbox>
      </template>
    </n-alert>
    <n-space align="center">
      <n-button
        type="primary"
        size="small"
        :loading="busy"
        :disabled="needsConsent"
        data-testid="vanilla-prepare-button"
        @click="prepare"
      >
        {{ availability.state === 'local' ? t('vanilla.extract') : t('vanilla.download') }}
      </n-button>
      <job-progress-bar v-if="busy" kind="vanilla.prepare" />
    </n-space>
  </div>
</template>

<style scoped>
.prepare {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.para {
  margin: 0 0 6px;
}
</style>
