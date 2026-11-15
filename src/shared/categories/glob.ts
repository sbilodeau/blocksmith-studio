/**
 * Tiny glob matcher for POSIX paths (no dependencies, safe for every process).
 *
 *   *       any characters except '/'
 *   **      any characters including '/' ("a/**" = everything under a/, "**\/x.png" = x.png at any depth)
 *   ?       exactly one character except '/'
 *   {a,b}   alternatives (may be nested and may contain other wildcards)
 *
 * Everything else matches literally. Matching is case-sensitive and anchored on the whole path.
 */

const REGEX_SPECIALS = /[.+^$()|[\]\\]/

/** Index of the '}' closing the '{' at `open`, or -1 when unbalanced. */
function findClosingBrace(glob: string, open: number): number {
  let depth = 0
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++
    else if (glob[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Splits the inside of a brace group on its top-level commas. */
function splitAlternatives(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

function convert(glob: string): string {
  let out = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      let j = i
      while (glob[j] === '*') j++
      if (j - i >= 2) {
        const atSegmentStart = i === 0 || glob[i - 1] === '/'
        if (atSegmentStart && glob[j] === '/') {
          // "**/" = zero or more whole directories
          out += '(?:[^/]*/)*'
          i = j + 1
        } else {
          out += '.*'
          i = j
        }
      } else {
        out += '[^/]*'
        i = j
      }
      continue
    }
    if (c === '?') {
      out += '[^/]'
      i++
      continue
    }
    if (c === '{') {
      const close = findClosingBrace(glob, i)
      if (close > i) {
        const alternatives = splitAlternatives(glob.slice(i + 1, close)).map(convert)
        out += `(?:${alternatives.join('|')})`
        i = close + 1
        continue
      }
    }
    out += REGEX_SPECIALS.test(c) ? `\\${c}` : c
    i++
  }
  return out
}

/** Compiles a glob into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${convert(glob)}$`)
}

/** Convenience one-shot match (compile once with globToRegExp when matching many paths). */
export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path)
}
