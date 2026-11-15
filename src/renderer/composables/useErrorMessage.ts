import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { IpcError } from '../services/ipc'

/** Turns an IpcError (typed AppError from main) into a localized toast. */
export function useErrorMessage(): {
  errorText: (err: unknown) => string
  showError: (err: unknown) => void
} {
  const { t, te } = useI18n()
  const message = useMessage()

  function errorText(err: unknown): string {
    if (err instanceof IpcError) {
      const key = `errors.${err.appError.code}`
      return te(key)
        ? t(key, err.appError.params ?? {})
        : t('errors.withCode', { code: err.appError.code })
    }
    console.error(err)
    return t('errors.unexpected')
  }

  function showError(err: unknown): void {
    message.error(errorText(err), { duration: 6000 })
  }

  return { errorText, showError }
}
