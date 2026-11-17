<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NH2,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NText
} from 'naive-ui'
import { LANGUAGES, THEMES, type Language, type Theme } from '@shared/model/settings'
import type { AppInfo } from '@shared/ipc/contract'
import UpdateActions from '../components/UpdateActions.vue'
import MinecraftSettings from '../components/vanilla/MinecraftSettings.vue'
import AiSettings from '../components/ai/AiSettings.vue'
import { useSettingsStore } from '../stores/settings'
import { useUpdaterStore } from '../stores/updater'
import { useUpdaterMessage } from '../composables/useUpdaterMessage'
import { call } from '../services/ipc'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const updater = useUpdaterStore()
const { status } = storeToRefs(updater)
const updateMessage = useUpdaterMessage(status)
const info = ref<AppInfo | null>(null)

// Language names are shown in their own language, so they come from a shared key, not the current locale.
const languageOptions = computed(() =>
  LANGUAGES.map((lang) => ({ value: lang, label: t(`languages.${lang}`) }))
)
const checking = computed(() => status.value.state === 'checking')
const canCheck = computed(() => status.value.state !== 'disabled')

function setLanguage(language: Language): void {
  void settingsStore.update({ language })
}
function setTheme(theme: Theme): void {
  void settingsStore.update({ theme })
}
function setAutoCheck(autoCheck: boolean): void {
  void settingsStore.update({ updates: { autoCheck } })
}

onMounted(async () => {
  info.value = await call('app.getInfo')
})
</script>

<template>
  <div class="settings">
    <n-h2>{{ t('settings.title') }}</n-h2>
    <n-space vertical size="large">
      <n-card :title="t('settings.general')" size="small">
        <n-form label-placement="left" label-width="160">
          <n-form-item :label="t('settings.language')" :feedback="t('settings.languageHint')">
            <n-select
              data-testid="language-select"
              style="max-width: 240px"
              :value="settingsStore.settings.language"
              :options="languageOptions"
              @update:value="setLanguage"
            />
          </n-form-item>
          <n-form-item :label="t('settings.theme')">
            <n-radio-group
              :value="settingsStore.settings.theme"
              data-testid="theme-group"
              @update:value="setTheme"
            >
              <n-radio-button
                v-for="th in THEMES"
                :key="th"
                :value="th"
                :data-testid="`theme-${th}`"
              >
                {{ t(`settings.themes.${th}`) }}
              </n-radio-button>
            </n-radio-group>
          </n-form-item>
        </n-form>
      </n-card>

      <minecraft-settings />

      <ai-settings />

      <n-card :title="t('settings.updates')" size="small">
        <n-form label-placement="left" label-width="160">
          <n-form-item :label="t('settings.currentVersion')">
            <n-text code data-testid="app-version">{{ info?.version }}</n-text>
          </n-form-item>
          <n-form-item :label="t('settings.autoCheck')">
            <n-switch
              :value="settingsStore.settings.updates.autoCheck"
              :aria-label="t('settings.autoCheck')"
              data-testid="auto-check"
              @update:value="setAutoCheck"
            />
          </n-form-item>
          <n-form-item>
            <n-space vertical>
              <n-text data-testid="update-status">{{ updateMessage }}</n-text>
              <n-space align="center">
                <n-button
                  size="small"
                  :loading="checking"
                  :disabled="!canCheck"
                  data-testid="update-check"
                  @click="updater.check()"
                >
                  {{ t('settings.checkNow') }}
                </n-button>
                <update-actions />
              </n-space>
            </n-space>
          </n-form-item>
        </n-form>
      </n-card>

      <n-card :title="t('settings.about')" size="small">
        <n-descriptions v-if="info" :column="2" label-placement="left" size="small">
          <n-descriptions-item :label="t('settings.platform')">
            {{ info.platform }} ({{ info.arch }})
          </n-descriptions-item>
          <n-descriptions-item :label="t('settings.electron')">{{
            info.electron
          }}</n-descriptions-item>
          <n-descriptions-item :label="t('settings.chrome')">{{ info.chrome }}</n-descriptions-item>
          <n-descriptions-item :label="t('settings.node')">{{ info.node }}</n-descriptions-item>
        </n-descriptions>
      </n-card>
    </n-space>
  </div>
</template>

<style scoped>
.settings {
  max-width: 820px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
  padding-bottom: 24px;
  box-sizing: border-box;
}
</style>
