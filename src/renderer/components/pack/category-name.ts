import { useI18n } from 'vue-i18n'

/** What a category name is made of: a custom category's plain-text label, else a built-in's i18n key. */
export interface NamedCategory {
  id: string
  i18nKey?: string
  label?: string
}

/** Display name of a category: its label (custom), else its translated key (built-in), else its id. */
export function useCategoryName(): (category: NamedCategory) => string {
  const { t, te } = useI18n()
  return (c) => {
    if (c.label) return c.label
    const key = c.i18nKey ?? `category.${c.id}`
    return te(key) ? t(key) : c.id
  }
}
