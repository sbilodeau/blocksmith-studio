import { defineStore, getActivePinia } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'
import type { PopoutInput, PopoutState } from '@shared/model/popout'
import { call } from '../services/ipc'
import { useEditorStore } from './editor'

/**
 * Pop-out 3D preview of one pack tab (M11), `popout/<packId>`. While it is open, the editor's texture state is
 * pushed to the pop-out window through main (pixels only when they changed, at most once per animation frame), and
 * the pop-out's hover and painting input is applied to the editor as if it came from the docked preview.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePopoutStore(packId: string) {
  return defineStore(`popout/${packId}`, () => {
    const editor = useEditorStore(packId)
    /** A pop-out window is open for this tab. */
    const open = ref(false)

    let raf = 0
    let pixelsDirty = true
    let lastSignature = ''

    function state(withImage: boolean): PopoutState {
      const img = editor.strip
      const hover = editor.linkedHover?.source === '2d' ? editor.linkedHover : null
      return {
        path: img ? editor.path : null,
        ...(withImage && img
          ? { image: { width: img.width, height: img.height, rgba: new Uint8Array(img.data) } }
          : {}),
        mcmeta: editor.mcmeta,
        editingFrame: editor.frames && !editor.playing ? editor.frameIndex : null,
        hover: hover ? { x: hover.x, y: hover.y } : null
      }
    }

    async function push(): Promise<void> {
      if (!open.value) return
      const withImage = pixelsDirty
      const next = state(withImage)
      const signature = JSON.stringify({ ...next, image: undefined })
      if (!withImage && signature === lastSignature) return
      pixelsDirty = false
      lastSignature = signature
      try {
        if (!(await call('preview.popout.push', { packId, state: next }))) open.value = false
      } catch {
        open.value = false
      }
    }

    /** Pushes on the next animation frame; `pixels` also sends the image. */
    function schedule(pixels: boolean): void {
      if (pixels) pixelsDirty = true
      if (!open.value || raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        void push()
      })
    }

    watch(
      () => [editor.revision, editor.path],
      () => schedule(true)
    )
    watch(
      () => [editor.mcmeta, editor.frameIndex, editor.playing, editor.linkedHover],
      () => schedule(false)
    )

    function onInput(input: PopoutInput): void {
      switch (input.kind) {
        case 'ready':
          lastSignature = ''
          schedule(true)
          break
        case 'hover':
          editor.linkedHover = { x: input.x, y: input.y, source: '3d' }
          break
        case 'hoverEnd':
          if (editor.linkedHover?.source === '3d') editor.linkedHover = null
          break
        case 'paintStart':
          editor.paintStart(input.x, input.y, input.secondary)
          break
        case 'paintMove':
          editor.paintMove(input.x, input.y, input.connect)
          break
        case 'paintEnd':
          editor.paintEnd()
          break
      }
    }

    const offInput = window.blocksmith.on('preview.popout.input', (payload) => {
      if (payload.packId !== packId) return
      // 'ready' can arrive before popOut() resolves: the window loads while main answers.
      if (payload.input.kind === 'ready') open.value = true
      if (open.value) onInput(payload.input)
    })
    const offClosed = window.blocksmith.on('preview.popout.closed', (payload) => {
      if (payload.packId !== packId) return
      open.value = false
      editor.paintEnd()
      if (editor.linkedHover?.source === '3d') editor.linkedHover = null
    })
    onScopeDispose(() => {
      offInput()
      offClosed()
      if (raf) cancelAnimationFrame(raf)
    })

    /** Opens the pop-out (or focuses it); the window asks for the state once it is ready. */
    async function popOut(title: string): Promise<void> {
      await call('preview.popout.open', { packId, title })
      open.value = true
      pixelsDirty = true
    }

    /** Closes the pop-out window. */
    async function dock(): Promise<void> {
      open.value = false
      await call('preview.popout.close', { packId })
    }

    return { open, popOut, dock, onInput }
  })()
}

/** Closes the tab's pop-out window and drops its store (the pack tab was closed). */
export function disposePopoutStore(packId: string): void {
  const pinia = getActivePinia()
  if (!pinia) return
  const id = `popout/${packId}`
  const store = (
    pinia as unknown as {
      _s: Map<string, { open: boolean; dock(): Promise<void>; $dispose(): void }>
    }
  )._s.get(id)
  if (!store) return
  if (store.open) void store.dock().catch(() => undefined)
  store.$dispose()
  delete pinia.state.value[id]
}
