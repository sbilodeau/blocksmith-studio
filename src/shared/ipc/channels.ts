/**
 * IPC channel names. Kept free of runtime dependencies so the sandboxed preload can import it cheaply.
 * Every channel the renderer may use MUST be listed here; the preload rejects anything else.
 */

/** Request/response channels (renderer -> main, via ipcRenderer.invoke). */
export const INVOKE_CHANNELS = [
  'app.getInfo',
  'app.openExternal',
  'settings.get',
  'settings.update',
  'updater.getStatus',
  'updater.check',
  'updater.download',
  'updater.install',
  // Minecraft installs and vanilla assets
  'minecraft.detect',
  'minecraft.addPath',
  'vanilla.availability',
  'vanilla.prepare',
  // Workspace and packs
  'workspace.get',
  'workspace.choose',
  'packs.list',
  'packs.create',
  'packs.import',
  'packs.delete',
  'packs.reveal',
  'pack.get',
  'pack.textures',
  'pack.categories',
  'pack.export',
  'pack.exportMany',
  'pack.upgrade',
  'pack.doctor',
  'pack.setKind',
  // Category mapping editor (M11): "All packs" mapping and "This pack" rules
  'categories.get',
  'categories.save',
  'categories.reset',
  'pack.categoryOverrides',
  'pack.setCategoryOverrides',
  // Data pack files (M10)
  'data.list',
  'data.read',
  'data.save',
  'data.create',
  'data.delete',
  // Texture editing and pack history
  'texture.read',
  'texture.save',
  'texture.revert',
  'texture.importGif',
  'history.get',
  'history.undo',
  'history.redo',
  'texture.preview',
  'preview.popout.open',
  'preview.popout.close',
  'preview.popout.push',
  'preview.popout.input',
  // AI providers, models and agents
  'ai.providers.list',
  'ai.providers.save',
  'ai.providers.delete',
  'ai.providers.setKey',
  'ai.providers.test',
  'ai.models.list',
  'ai.agent.send',
  'ai.agent.stop',
  'ai.agent.conversation',
  'ai.agent.clear',
  'ai.proposal.apply',
  'ai.proposal.reject',
  'ai.navigation.send',
  'ai.navigation.apply',
  'ai.creation.send',
  'ai.creation.apply',
  'ai.creation.stopApply',
  'ai.data.send',
  'ai.data.explain',
  'bulk.preview',
  'bulk.apply',
  'bulk.discard',
  'merge.preview',
  'merge.apply',
  'merge.discard',
  'brief.get',
  'brief.update',
  'ai.eval.run',
  'ai.eval.stop'
] as const

/** Event channels (main -> renderer, via webContents.send). */
export const EVENT_CHANNELS = [
  'settings.changed',
  'updater.status',
  'job.progress',
  'packs.changed',
  'ai.event',
  'ai.eval.progress',
  'preview.popout.state',
  'preview.popout.input',
  'preview.popout.closed'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value)
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value)
}
