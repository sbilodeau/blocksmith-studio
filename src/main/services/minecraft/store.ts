import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { MinecraftLinkSchema, type MinecraftLink } from '@shared/model/minecraft'
import { writeFileAtomic } from '../packs/files'

const FileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Game folders added by hand (absolute paths, main-process only). */
  gameDirs: z.array(z.string()).default([]),
  /** Where each pack goes in the game, by pack id. */
  packs: z.record(z.string(), MinecraftLinkSchema).default({})
})
type MinecraftFile = z.infer<typeof FileSchema>

/**
 * userData/minecraft.json: this computer's Minecraft destinations. Kept out of the pack folder (project.json) so a
 * pack shared through git carries no local paths. An unreadable file starts empty.
 */
export class MinecraftStore {
  private data: MinecraftFile = FileSchema.parse({})
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  static forUserData(userDataDir: string): MinecraftStore {
    return new MinecraftStore(join(userDataDir, 'minecraft.json'))
  }

  async load(): Promise<void> {
    try {
      const parsed = FileSchema.safeParse(JSON.parse(await fs.readFile(this.filePath, 'utf8')))
      this.data = parsed.success ? parsed.data : FileSchema.parse({})
    } catch {
      this.data = FileSchema.parse({})
    }
  }

  gameDirs(): readonly string[] {
    return this.data.gameDirs
  }

  link(packId: string): MinecraftLink | null {
    return this.data.packs[packId] ?? null
  }

  links(): [string, MinecraftLink][] {
    return Object.entries(this.data.packs)
  }

  async addGameDir(path: string): Promise<void> {
    if (this.data.gameDirs.includes(path)) return
    this.data = { ...this.data, gameDirs: [...this.data.gameDirs, path] }
    await this.save()
  }

  async setLink(packId: string, link: MinecraftLink | null): Promise<void> {
    const packs = { ...this.data.packs }
    if (link) packs[packId] = link
    else delete packs[packId]
    this.data = { ...this.data, packs }
    await this.save()
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2) + '\n'
    this.queue = this.queue.then(() => writeFileAtomic(this.filePath, snapshot))
    return this.queue
  }
}
