import { useI18n } from 'vue-i18n'
import type { DataIssue } from '@shared/datapack'

/** Localized message of a data file issue (`data.issue.<code>`; type names and syntax errors translated too). */
export function useIssueMessage(): (issue: DataIssue) => string {
  const { t, te } = useI18n()
  return (issue) => {
    const params: Record<string, string | number> = { ...(issue.params ?? {}) }
    if (typeof params['expected'] === 'string')
      params['expected'] = t(`data.type.${params['expected']}`)
    if (issue.code === 'syntax' && typeof params['error'] === 'string') {
      const key = `data.syntax.${params['error']}`
      params['error'] = te(key) ? t(key) : params['error']
    }
    const key = `data.issue.${issue.code}`
    return te(key) ? t(key, params) : t('data.issue.invalid', params)
  }
}
