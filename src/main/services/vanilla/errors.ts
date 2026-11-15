/**
 * Error with an i18n code (`errors.<code>`) raised by code that must not import Electron, such as the
 * extraction worker. The store converts it to an AppErrorException before it crosses IPC.
 */
export class VanillaError extends Error {
  constructor(
    public readonly code: string,
    public readonly params?: Record<string, string | number>
  ) {
    super(code)
    this.name = 'VanillaError'
  }
}

/** Error codes thrown by the vanilla services (renderer i18n keys: `errors.<code>`). */
export const VanillaErrorCode = {
  versionUnknown: 'vanilla.versionUnknown',
  downloadNotAllowed: 'vanilla.downloadNotAllowed',
  downloadFailed: 'vanilla.downloadFailed',
  checksumMismatch: 'vanilla.checksumMismatch',
  invalidJar: 'vanilla.invalidJar',
  jarVersionMismatch: 'vanilla.jarVersionMismatch',
  extractFailed: 'vanilla.extractFailed',
  noVersionsFound: 'minecraft.noVersionsFound'
} as const
