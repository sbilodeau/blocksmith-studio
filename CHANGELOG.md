# Changelog

All notable changes to this project are documented here. Versions follow CalVer `yy.ww.fix`
(ISO week-year, ISO week, fix number within the week).

## Unreleased

### M0 - Foundation and delivery pipeline

- Electron + Vue 3 + TypeScript app scaffold (electron-vite), Naive UI, Pinia, vue-router
- Security baseline: sandboxed renderer with context isolation, strict CSP, whitelisted and validated IPC,
  navigation/new-window/permission blocking
- App shell with tab bar and Settings screen: language (English default, French), theme (system, light, dark),
  automatic update checks, version and platform info
- English and French translations with a lint rule forbidding hard-coded UI text
- Settings persisted in the user data folder with atomic writes and corruption recovery
- Unit, integration, component (Vitest) and end-to-end (Playwright) tests
- Original pixel-art app icon (anvil forging a glowing block)
