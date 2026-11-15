import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UpdaterStatus } from '@shared/model/updater'

/** Localized one-line description of the current update status. */
export function useUpdaterMessage(status: Ref<UpdaterStatus>): ComputedRef<string> {
  const { t, te } = useI18n()
  return computed((): string => {
    const s = status.value
    switch (s.state) {
      case 'disabled':
        return s.reason === 'dev' ? t('updater.disabledDev') : t('updater.disabledUnsupported')
      case 'idle':
        return t('updater.idle')
      case 'checking':
        return t('updater.checking')
      case 'not-available':
        return t('updater.notAvailable', { version: s.currentVersion })
      case 'available':
        return t('updater.available', { version: s.version })
      case 'downloading':
        return t('updater.downloading', { version: s.version, percent: Math.round(s.percent) })
      case 'downloaded':
        return s.mode === 'auto'
          ? t('updater.downloadedAuto', { version: s.version })
          : t('updater.downloadedManual', { version: s.version })
      case 'error':
        return t('updater.error', {
          reason: te(`errors.${s.code}`) ? t(`errors.${s.code}`) : s.code
        })
      default:
        return ''
    }
  })
}
