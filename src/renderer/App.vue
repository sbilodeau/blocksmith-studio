<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NLayout,
  NLayoutHeader,
  NLayoutContent,
  darkTheme,
  useOsTheme,
  enUS,
  frFR,
  dateEnUS,
  dateFrFR
} from 'naive-ui'
import AppHeader from './components/AppHeader.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import { useSettingsStore } from './stores/settings'

const settingsStore = useSettingsStore()
const { locale } = useI18n()
const osTheme = useOsTheme()

const isDark = computed(() => {
  const pref = settingsStore.settings.theme
  return pref === 'dark' || (pref === 'system' && osTheme.value === 'dark')
})
const theme = computed(() => (isDark.value ? darkTheme : null))
const naiveLocale = computed(() => (settingsStore.settings.language === 'fr' ? frFR : enUS))
const naiveDateLocale = computed(() =>
  settingsStore.settings.language === 'fr' ? dateFrFR : dateEnUS
)

watch(
  () => settingsStore.settings.language,
  (lang) => {
    locale.value = lang
    document.documentElement.lang = lang
  },
  { immediate: true }
)
</script>

<template>
  <n-config-provider
    :theme="theme"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    class="app-root"
  >
    <n-message-provider>
      <n-dialog-provider>
        <n-layout class="app-layout">
          <n-layout-header bordered>
            <app-header />
          </n-layout-header>
          <update-banner />
          <n-layout-content
            class="app-content"
            content-style="padding: 16px 24px; height: 100%; box-sizing: border-box;"
          >
            <router-view />
          </n-layout-content>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app-root,
.app-layout {
  height: 100%;
}
.app-layout {
  display: flex;
  flex-direction: column;
}
.app-content {
  flex: 1;
  min-height: 0;
}
</style>
