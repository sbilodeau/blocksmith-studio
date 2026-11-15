import { describe, expect, it } from 'vitest'
import {
  buildCsp,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isTrustedSender
} from '../../src/main/security-policy'

describe('security policy', () => {
  it('production CSP forbids inline scripts and remote connections', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self';")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("connect-src 'self';")
    expect(csp).toContain("object-src 'none'")
  })

  it('dev CSP only adds the local dev server', () => {
    const csp = buildCsp(true)
    expect(csp).toContain('ws://localhost:*')
    expect(csp).not.toMatch(/https?:\/\/(?!localhost)/)
  })

  it('opens only https links externally', () => {
    expect(isAllowedExternalUrl('https://github.com')).toBe(true)
    expect(isAllowedExternalUrl('http://github.com')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/Windows')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('trusts only the packaged renderer or the dev server for IPC', () => {
    expect(isTrustedSender('file:///app/out/renderer/index.html')).toBe(true)
    expect(isTrustedSender('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isTrustedSender('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender('https://evil.example/', undefined)).toBe(false)
    expect(isTrustedSender(undefined)).toBe(false)
  })

  it('blocks navigation away from the app', () => {
    expect(isAllowedNavigation('http://localhost:5173/#/', 'http://localhost:5173/#/x')).toBe(true)
    expect(isAllowedNavigation('http://localhost:5173/', 'https://evil.example/')).toBe(false)
    expect(isAllowedNavigation('file:///app/index.html', 'file:///etc/passwd')).toBe(false)
  })
})
