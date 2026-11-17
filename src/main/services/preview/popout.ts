import type { PopoutInput, PopoutState } from '@shared/model/popout'

/** The parts of a WebContents the manager uses (an Electron WebContents in the app, a fake in tests). */
export interface PopoutContents {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/** The parts of a BrowserWindow the manager uses. */
export interface PopoutWindow {
  readonly webContents: PopoutContents
  isDestroyed(): boolean
  focus(): void
  close(): void
  setTitle(title: string): void
  /** Called once when the window is closed (by the user or by close()). */
  onClosed(listener: () => void): void
}

export interface PopoutManagerDeps {
  createWindow(packId: string, title: string): PopoutWindow
}

export interface PopoutManager {
  /** Opens the pop-out of `packId` owned by `owner`, or focuses (and retitles) the one already open. */
  open(packId: string, title: string, owner: PopoutContents): void
  /** Closes the pop-out of `packId` when `sender` owns it. */
  close(packId: string, sender: PopoutContents): void
  /** Relays the editor state to the pop-out; false when `sender` has no pop-out open for the pack. */
  push(packId: string, state: PopoutState, sender: PopoutContents): boolean
  /** Relays pop-out input to the window that opened it; false when `sender` is not that pop-out. */
  input(packId: string, input: PopoutInput, sender: PopoutContents): boolean
  /** Closes every pop-out (the owner window is gone). */
  closeAll(): void
}

interface Entry {
  window: PopoutWindow
  owner: PopoutContents
}

/**
 * Pop-out 3D preview windows (PLAN M11), at most one per pack. Main never interprets the state: it relays it
 * between the editor window that opened a pop-out and that pop-out, and refuses any other sender.
 */
export function createPopoutManager(deps: PopoutManagerDeps): PopoutManager {
  const entries = new Map<string, Entry>()

  function live(packId: string): Entry | undefined {
    const entry = entries.get(packId)
    if (entry && entry.window.isDestroyed()) {
      entries.delete(packId)
      return undefined
    }
    return entry
  }

  return {
    open(packId, title, owner) {
      const existing = live(packId)
      if (existing) {
        existing.owner = owner
        existing.window.setTitle(title)
        existing.window.focus()
        return
      }
      const window = deps.createWindow(packId, title)
      const entry: Entry = { window, owner }
      entries.set(packId, entry)
      window.onClosed(() => {
        if (entries.get(packId) === entry) entries.delete(packId)
        if (!entry.owner.isDestroyed()) entry.owner.send('preview.popout.closed', { packId })
      })
    },

    close(packId, sender) {
      const entry = live(packId)
      if (entry && entry.owner.id === sender.id) entry.window.close()
    },

    push(packId, state, sender) {
      const entry = live(packId)
      if (!entry || entry.owner.id !== sender.id) return false
      const target = entry.window.webContents
      if (target.isDestroyed()) return false
      target.send('preview.popout.state', { packId, state })
      return true
    },

    input(packId, input, sender) {
      const entry = live(packId)
      if (!entry || entry.window.webContents.id !== sender.id || entry.owner.isDestroyed())
        return false
      entry.owner.send('preview.popout.input', { packId, input })
      return true
    },

    closeAll() {
      for (const entry of [...entries.values()])
        if (!entry.window.isDestroyed()) entry.window.close()
      entries.clear()
    }
  }
}
