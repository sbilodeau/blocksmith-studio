import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import {
  SettingsSchema,
  applySettingsPatch,
  defaultSettings,
  type Settings,
  type SettingsPatch
} from '@shared/model/settings'

/**
 * App settings persisted as JSON in userData. Invalid or unreadable files fall back to defaults
 * (the broken file is kept as settings.json.bak for inspection). Writes are atomic (tmp + rename).
 */
export class SettingsService {
  private settings: Settings = defaultSettings()
  private readonly listeners = new Set<(s: Settings) => void>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static forUserData(userDataDir: string): SettingsService {
    return new SettingsService(join(userDataDir, 'settings.json'))
  }

  async load(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = SettingsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) {
        this.settings = parsed.data
      } else {
        await this.backupBrokenFile()
        this.settings = defaultSettings()
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') await this.backupBrokenFile()
      this.settings = defaultSettings()
    }
    return this.settings
  }

  get(): Settings {
    return this.settings
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    this.settings = applySettingsPatch(this.settings, patch)
    const snapshot = this.settings
    this.writeQueue = this.writeQueue.then(() => this.write(snapshot))
    await this.writeQueue
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async write(settings: Settings): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    await fs.rename(tmp, this.filePath)
  }

  private async backupBrokenFile(): Promise<void> {
    try {
      await fs.copyFile(this.filePath, `${this.filePath}.bak`)
    } catch {
      // nothing to back up
    }
  }
}
