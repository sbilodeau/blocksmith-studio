const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Reads width and height from a PNG's IHDR chunk without decoding the image. The IHDR chunk must come first
 * (right after the 8-byte signature): length (4) + "IHDR" (4) + width (4, big endian) + height (4).
 * Returns null for anything that is not a well-formed PNG header.
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (view.getUint32(8) !== 13 || chunkType !== 'IHDR') return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width === 0 || height === 0) return null
  return { width, height }
}
