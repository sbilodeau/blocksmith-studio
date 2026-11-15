import type { McVersion } from '../model/versions'

/**
 * pack.mcmeta rules (verified 2026-11-15 against https://minecraft.wiki/w/Pack.mcmeta and
 * https://minecraft.wiki/w/Pack_format, see docs/versions.md):
 *
 * - Up to 1.21.8 (resource pack format < 65): `pack.pack_format` (integer) is required. The optional
 *   `supported_formats` (1.20.2+) widens the accepted range but must contain `pack_format`.
 * - Since 1.21.9 (25w31a, resource pack format 65+): `pack.min_format` and `pack.max_format` are required.
 *   Each is an integer or a `[major, minor]` array. An integer `min_format` means `[major, 0]`; an integer
 *   `max_format` means "any minor of that major" (minor 0x7fffffff).
 *   `pack_format` became optional and `supported_formats` was removed: both are still REQUIRED when the declared
 *   range includes a pre-1.21.9 format (resource < 65), and `supported_formats` MUST be absent otherwise.
 *
 * For a single target we therefore emit:
 * - 'pack_format' style: `{ pack: { pack_format: N, description } }`
 * - 'minmax' style:      `{ pack: { min_format: [major, minor], max_format: major, description } }`
 *   min_format pins the exact format of the target (content may rely on its minor features) and max_format
 *   accepts any later minor revision of the same major format. No legacy field, since the range is >= 65.
 */
export function buildResourcePackMcmeta(
  description: string,
  target: McVersion
): Record<string, unknown> {
  const { major, minor } = target.resourcePack
  if (target.mcmetaStyle === 'pack_format') {
    return { pack: { pack_format: major, description } }
  }
  return { pack: { min_format: [major, minor], max_format: major, description } }
}
