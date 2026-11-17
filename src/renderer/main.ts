import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createAppI18n } from './i18n'
import { createAppRouter } from './router'
import { useSettingsStore } from './stores/settings'
import { useUpdaterStore } from './stores/updater'
import { useJobsStore } from './stores/jobs'
import { useAiStore } from './stores/ai'
import './styles/base.css'

async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  const i18n = createAppI18n()
  const router = createAppRouter()
  app.use(pinia).use(i18n).use(router)

  const settings = useSettingsStore()
  await settings.load()
  await useUpdaterStore().init()
  useJobsStore().init()
  useAiStore().init()

  // The first route decides the window chrome (the pop-out preview has none): resolve it before mounting.
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
