import { app, session, shell, type WebContents } from 'electron'
import { buildCsp, isAllowedExternalUrl, isAllowedNavigation } from './security-policy'

export { buildCsp, isAllowedExternalUrl }

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
      if (!isAllowedNavigation(contents.getURL(), url)) event.preventDefault()
    })

    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
