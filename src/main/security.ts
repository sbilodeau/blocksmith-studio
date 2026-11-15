import { app, session, shell, type WebContents } from 'electron'

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

const EXTERNAL_URL_ALLOWLIST = [/^https:\/\//]

export function isAllowedExternalUrl(url: string): boolean {
  return EXTERNAL_URL_ALLOWLIST.some((re) => re.test(url))
}

/** Applies session-wide protections: CSP header and denial of all permission requests. */
export function hardenSession(isDev: boolean): void {
  const ses = session.defaultSession
  const csp = buildCsp(isDev)

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })

  // The app needs no camera, mic, notifications, geolocation, etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}

/** Blocks navigation, new windows and webviews for every web contents created by the app. */
export function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      const current = contents.getURL()
      // Allow dev-server reloads of the same origin only.
      if (current && new URL(url).origin === new URL(current).origin) return
      event.preventDefault()
    })

    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
