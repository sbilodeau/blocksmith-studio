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
 * - 'minmax' style:      `{ pack: { pack_format: major, min_format: [major, 0], max_format: [major, minor], description } }`
 *   e.g. 26.3 (97.1): `{ pack_format: 97, min_format: [97, 0], max_format: [97, 1] }`. The range covers every
 *   revision of the target's major format up to the target itself. `pack_format` is optional for 1.21.9+ but
 *   allowed (and inside the range); tools and older guides expect it. No `supported_formats`, since the range
 *   is >= 65.
 *
 * With `acceptNewer` (export option "also accept newer versions", for snapshots and releases the app does not
 * know yet) the range stays open to OPEN_MAX_FORMAT, so newer games list the pack as compatible:
 * - 'minmax' style:      `max_format: OPEN_MAX_FORMAT` (pack_format and min_format unchanged)
 * - 'pack_format' style: the range now spans the 1.21.9 boundary, so both declarations are written and must agree:
 *   `{ pack_format: N, supported_formats: [N, OPEN], min_format: N, max_format: OPEN }` (old games read the first
 *   two, new games the last two).
 */
export const OPEN_MAX_FORMAT = 999

export interface McmetaOptions {
  /** Also declare every newer format as supported (snapshots, future releases). */
  acceptNewer?: boolean
}

export function buildResourcePackMcmeta(
  description: string,
  target: McVersion,
  options: McmetaOptions = {}
): Record<string, unknown> {
  const { major, minor } = target.resourcePack
  if (target.mcmetaStyle === 'pack_format') {
    return options.acceptNewer
      ? {
          pack: {
            pack_format: major,
            supported_formats: [major, OPEN_MAX_FORMAT],
            min_format: major,
            max_format: OPEN_MAX_FORMAT,
            description
          }
        }
      : { pack: { pack_format: major, description } }
  }
  return {
    pack: {
      pack_format: major,
      min_format: [major, 0],
      max_format: options.acceptNewer ? OPEN_MAX_FORMAT : [major, minor],
      description
    }
  }
}
