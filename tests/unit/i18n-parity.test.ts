import { describe, expect, it } from 'vitest'
import en from '@shared/locales/en.json'
import fr from '@shared/locales/fr.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('locale files', () => {
  const flatEn = flatten(en as Tree)
  const flatFr = flatten(fr as Tree)

  it('have exactly the same keys in English and French', () => {
    expect(Object.keys(flatFr).sort()).toEqual(Object.keys(flatEn).sort())
  })

  it('use the same placeholders in both languages', () => {
    for (const key of Object.keys(flatEn)) {
      expect(placeholders(flatFr[key] ?? ''), key).toEqual(placeholders(flatEn[key]))
    }
  })

  it('have no empty strings', () => {
    for (const [key, value] of [...Object.entries(flatEn), ...Object.entries(flatFr)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })
})
