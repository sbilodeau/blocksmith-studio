import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ProjectSchema, type Project } from '@shared/model/pack'
import { writeFileAtomic } from './files'
import { parseJson, toJsonBytes } from './mcmeta'

export const META_DIR = '.blocksmith'
export const PROJECT_FILE = `${META_DIR}/project.json`

/** A pack found in the workspace. */
export interface PackLocation {
  id: string
  /** Absolute pack folder. */
  folder: string
  project: Project
}

/** Reads and validates `<folder>/.blocksmith/project.json`; null when missing or invalid. */
export async function readProject(folder: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(join(folder, PROJECT_FILE))
    const parsed = ProjectSchema.safeParse(parseJson(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function writeProject(folder: string, project: Project): Promise<void> {
  await writeFileAtomic(join(folder, PROJECT_FILE), toJsonBytes(ProjectSchema.parse(project)))
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Short random pack id (12 base-36 characters from crypto, ~62 bits). */
export function newPackId(): string {
  const bytes = randomBytes(12)
  let id = ''
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length]
  return id
}
