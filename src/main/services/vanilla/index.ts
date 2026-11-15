/**
 * Production wiring of the vanilla store (Electron net.fetch, extraction worker thread). Tests import store.ts
 * and the other modules directly with injected dependencies.
 */
import { homedir } from 'node:os'
import { net } from 'electron'
import extractWorkerPath from './extract-worker?modulePath'
import { createMojangClient } from './mojang'
import { createVanillaStore, type VanillaStoreDeps, type VanillaStoreImpl } from './store'
import { createWorkerExtractor } from './worker-runner'

export { createVanillaStore, toAppErrorException } from './store'
export type { VanillaStoreDeps, VanillaStoreImpl } from './store'
export { VanillaError, VanillaErrorCode } from './errors'

/** Default dependencies for createVanillaStore. Call after `app.whenReady()` (net.fetch needs it). */
export function createDefaultVanillaStoreDeps(options: {
  userDataDir: string
  getMinecraftPaths: () => readonly string[]
}): VanillaStoreDeps {
  return {
    userDataDir: options.userDataDir,
    getMinecraftPaths: options.getMinecraftPaths,
    detectEnv: { platform: process.platform, homedir: homedir(), env: process.env },
    mojang: createMojangClient({ fetch: (url) => net.fetch(url) }),
    extract: createWorkerExtractor(extractWorkerPath)
  }
}

/** Convenience: the store with its production dependencies. */
export function createDefaultVanillaStore(options: {
  userDataDir: string
  getMinecraftPaths: () => readonly string[]
}): VanillaStoreImpl {
  return createVanillaStore(createDefaultVanillaStoreDeps(options))
}
