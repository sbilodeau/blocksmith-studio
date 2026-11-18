import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { z } from 'zod'

/** One schema problem of the item form, located by its dotted field path ("weapon.attackDamage"). */
export interface ItemFormIssue {
  path: string
  message: string
}

type ParseResult = { success: true } | { success: false; error: z.ZodError }

/** Dotted path of a zod issue; the names refinement ("en_us" missing) points at the English name. */
function issuePath(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join('.')
  if (path === 'names' && issue.message === 'en_us') return 'names.en_us'
  return path
}

/** The item form's schema errors, as localized messages per field. */
export function useItemIssues(result: () => ParseResult | null): {
  issues: ComputedRef<ItemFormIssue[]>
  fieldError: (path: string, nested?: boolean) => string | undefined
} {
  const { t } = useI18n()

  function text(issue: z.core.$ZodIssue): string {
    if (issue.message === 'durability') return t('items.form.errors.stackDurability')
    if (issue.message === 'empty') return t('items.form.errors.recipeEmpty')
    if (issue.message === 'required' || issue.message === 'en_us') {
      return t('items.form.errors.required')
    }
    switch (issue.code) {
      case 'invalid_type':
        return t('items.form.errors.required')
      case 'too_small':
        if (issue.origin === 'string') return t('items.form.errors.required')
        if (issue.origin === 'array') {
          return t('items.form.errors.minItems', { min: Number(issue.minimum) })
        }
        return t('items.form.errors.min', { min: Number(issue.minimum) })
      case 'too_big':
        if (issue.origin === 'string') {
          return t('items.form.errors.maxLength', { max: Number(issue.maximum) })
        }
        if (issue.origin === 'array') {
          return t('items.form.errors.maxItems', { max: Number(issue.maximum) })
        }
        return t('items.form.errors.max', { max: Number(issue.maximum) })
      case 'invalid_format':
        return t('items.form.errors.format')
      case 'invalid_value':
        return t('items.form.errors.choice')
      case 'unrecognized_keys':
        return t('items.form.errors.unknownKeys', { keys: issue.keys.join(', ') })
      default:
        return t('items.form.errors.invalid')
    }
  }

  const issues = computed<ItemFormIssue[]>(() => {
    const r = result()
    if (!r || r.success) return []
    return r.error.issues.map((issue) => ({ path: issuePath(issue), message: text(issue) }))
  })

  /** The first error of a field (`nested`: or of something inside it, such as a recipe slot). */
  function fieldError(path: string, nested = false): string | undefined {
    return issues.value.find((i) => i.path === path || (nested && i.path.startsWith(`${path}.`)))
      ?.message
  }

  return { issues, fieldError }
}
