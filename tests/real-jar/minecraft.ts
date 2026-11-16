import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** The official launcher's folder on this platform. */
export function defaultMinecraftDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/minecraft')
  if (process.platform === 'win32') return join(process.env['APPDATA'] ?? '', '.minecraft')
  return join(homedir(), '.minecraft')
}

/** Minecraft folders to search: BLOCKSMITH_REAL_JAR_MINECRAFT_DIRS (":" / ";" list) or the launcher's folder. */
export function minecraftDirs(): string[] {
  return (process.env['BLOCKSMITH_REAL_JAR_MINECRAFT_DIRS'] ?? defaultMinecraftDir())
    .split(delimiter)
    .filter((d) => d && existsSync(d))
}

/** Installed client jar of a version: <dir>/versions/<id>/<id>.jar in the first folder that has it. */
export function findJar(dirs: readonly string[], versionId: string): string | undefined {
  return dirs
    .map((d) => join(d, 'versions', versionId, `${versionId}.jar`))
    .find((p) => existsSync(p))
}
