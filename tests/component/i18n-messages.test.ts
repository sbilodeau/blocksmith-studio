import { describe, expect, it } from 'vitest'
import { createAppI18n } from '@renderer/i18n'
import en from '@shared/locales/en.json'

/** Every message of both locales compiles (plural forms, placeholders): a broken one only fails at runtime. */
function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  )
}

describe('locale messages', () => {
  for (const locale of ['en', 'fr'] as const) {
    it(`all ${locale} messages compile`, () => {
      const i18n = createAppI18n()
      i18n.global.locale.value = locale
      const broken: string[] = []
      for (const key of keys(en)) {
        try {
          i18n.global.t(key, {}, 2)
        } catch (err) {
          broken.push(`${key}: ${(err as Error).message}`)
        }
      }
      expect(broken).toEqual([])
    })
  }
})
