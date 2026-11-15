import type { BlocksmithApi } from '../shared/ipc/contract'

declare global {
  interface Window {
    blocksmith: BlocksmithApi
  }
}

export {}
