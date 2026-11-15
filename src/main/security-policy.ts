/** Pure security policy helpers (no Electron imports, unit-tested). */

/** Content Security Policy for the renderer. The renderer has no network access: all HTTP goes through main. */
export function buildCsp(isDev: boolean): string {
  const devServer = isDev ? ' ws://localhost:* http://localhost:*' : ''
  return [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-inline'" : ''}`,
    // Naive UI injects component styles at runtime (css-in-js), so inline styles are required.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: bs-asset:",
    "font-src 'self' data:",
    `connect-src 'self'${devServer}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

/** External links may only be opened in the system browser, and only over https. */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Only frames loaded from the app itself may call IPC: the packaged file:// renderer, or the
 * electron-vite dev server in development.
 */
export function isTrustedSender(frameUrl: string | undefined, devServerUrl?: string): boolean {
  if (!frameUrl) return false
  if (frameUrl.startsWith('file://')) return true
  if (devServerUrl) {
    try {
      return new URL(frameUrl).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }
  return false
}

/** Same-origin navigation (dev-server reloads) is allowed; everything else is blocked. */
export function isAllowedNavigation(currentUrl: string, targetUrl: string): boolean {
  try {
    if (!currentUrl) return false
    const current = new URL(currentUrl)
    const target = new URL(targetUrl)
    if (current.protocol === 'file:') return false
    return current.origin === target.origin
  } catch {
    return false
  }
}
