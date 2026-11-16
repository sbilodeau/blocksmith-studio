import { useI18n } from 'vue-i18n'

/**
 * Localized text of an operation description (`ops.*` key + params, from a tool's `describe()`). Enum values
 * (clockwise, horizontal, inside...) are translated through `ops.value.*`. Unknown keys fall back to `fallback`.
 */
export function useOpLabel(): (
  description: { key: string; params: Record<string, string | number> },
  fallback?: string
) => string {
  const { t, te } = useI18n()
  return (description, fallback) => {
    if (!te(description.key)) return fallback ?? description.key
    const params: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(description.params)) {
      params[k] = typeof v === 'string' && te(`ops.value.${v}`) ? t(`ops.value.${v}`) : v
    }
    return t(description.key, params)
  }
}
