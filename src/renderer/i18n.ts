import { createI18n, type I18n } from 'vue-i18n'
import en from '@shared/locales/en.json'
import fr from '@shared/locales/fr.json'
import type { Language } from '@shared/model/settings'

export type MessageSchema = typeof en

export const messages = { en, fr } satisfies Record<Language, MessageSchema>

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AppI18n = I18n<typeof messages, {}, {}, Language, false>

/** Default language is English; the user switches to French in Settings. */
export function createAppI18n(locale: Language = 'en'): AppI18n {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages,
    datetimeFormats: {
      en: {
        short: { year: 'numeric', month: 'short', day: 'numeric' },
        time: { hour: '2-digit', minute: '2-digit' }
      },
      fr: {
        short: { year: 'numeric', month: 'short', day: 'numeric' },
        time: { hour: '2-digit', minute: '2-digit' }
      }
    }
  })
}
