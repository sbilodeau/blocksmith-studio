import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  GameDir,
  InstallResult,
  MinecraftTarget,
  PackMinecraftStatus
} from '@shared/model/minecraft'
import { call } from '../services/ipc'

/** Install in Minecraft and live mode (M13): game folders and each pack's destination and live status. */
export const useMinecraftStore = defineStore('minecraft', () => {
  const gameDirs = ref<GameDir[]>([])
  const statuses = ref<Record<string, PackMinecraftStatus>>({})
  let listening = false

  function listen(): void {
    if (listening) return
    listening = true
    window.blocksmith.on('pack.minecraft.status', ({ packId, status }) => {
      statuses.value = { ...statuses.value, [packId]: status }
    })
  }

  function setStatus(packId: string, status: PackMinecraftStatus): PackMinecraftStatus {
    statuses.value = { ...statuses.value, [packId]: status }
    return status
  }

  async function loadGameDirs(): Promise<GameDir[]> {
    gameDirs.value = await call('minecraft.gameDirs')
    return gameDirs.value
  }

  /** Folder picker; returns the added folder (null when cancelled). */
  async function addGameDir(): Promise<GameDir | null> {
    const added = await call('minecraft.addGameDir')
    if (added) await loadGameDirs()
    return added
  }

  async function loadStatus(packId: string): Promise<PackMinecraftStatus> {
    listen()
    return setStatus(packId, await call('pack.minecraft.get', { packId }))
  }

  async function install(target: MinecraftTarget): Promise<InstallResult> {
    const result = await call('pack.minecraft.install', target)
    await loadStatus(target.packId)
    return result
  }

  async function startLive(target: MinecraftTarget): Promise<PackMinecraftStatus> {
    listen()
    return setStatus(target.packId, await call('pack.minecraft.live', { ...target, on: true }))
  }

  async function stopLive(packId: string): Promise<PackMinecraftStatus> {
    return setStatus(packId, await call('pack.minecraft.live', { packId, on: false }))
  }

  async function reveal(packId: string): Promise<void> {
    await call('pack.minecraft.reveal', { packId })
  }

  function isLive(packId: string): boolean {
    const live = statuses.value[packId]?.live
    return live !== undefined && live.state !== 'off'
  }

  return {
    gameDirs,
    statuses,
    loadGameDirs,
    addGameDir,
    loadStatus,
    install,
    startLive,
    stopLive,
    reveal,
    isLive
  }
})
