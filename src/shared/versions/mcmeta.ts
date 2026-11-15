import type { McVersion } from '../model/versions'

/**
 * Builds the pack.mcmeta object for a resource pack targeting one Minecraft version.
 * STUB - implemented in the vanilla/versions work stream (M1). Keep the signature.
 */
export function buildResourcePackMcmeta(
  description: string,
  target: McVersion
): Record<string, unknown> {
  return { pack: { pack_format: target.resourcePack.major, description } }
}
