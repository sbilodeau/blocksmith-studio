#!/usr/bin/env node
/**
 * Release helpers for CHANGELOG.md, used by .github/workflows/release.yml.
 *
 * Usage:
 *   node scripts/changelog.mjs notes
 *     Prints the notes under "## Unreleased" (nothing when empty).
 *   node scripts/changelog.mjs stamp --version 26.47.0 --date 2026-11-17 [--expect notes.md]
 *     Moves the "## Unreleased" notes under "## 26.47.0 - 2026-11-17" in CHANGELOG.md.
 *     With --expect, exits with code 3 (and changes nothing) when the notes differ from that file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { stampRelease, unreleasedNotes } from './lib/changelog.mjs'

const FILE = 'CHANGELOG.md'
const USAGE =
  'Usage: node scripts/changelog.mjs notes | stamp --version <v> --date <YYYY-MM-DD> [--expect <file>]'

/**
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
function options(args) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) throw new Error(`Unknown argument "${arg}". ${USAGE}`)
    const value = args[++i]
    if (value === undefined) throw new Error(`Missing value for ${arg}. ${USAGE}`)
    out[arg.slice(2)] = value
  }
  return out
}

/**
 * @param {string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  const [command, ...rest] = argv
  const text = readFileSync(FILE, 'utf8')
  if (command === 'notes') {
    const notes = unreleasedNotes(text)
    if (notes) process.stdout.write(`${notes}\n`)
    return 0
  }
  if (command === 'stamp') {
    const opts = options(rest)
    if (!opts.version || !opts.date) throw new Error(USAGE)
    if (opts.expect !== undefined) {
      const expected = readFileSync(opts.expect, 'utf8').replace(/\r\n?/g, '\n').trim()
      if (unreleasedNotes(text) !== expected) {
        console.error('changelog: the "## Unreleased" notes changed since the release started')
        return 3
      }
    }
    writeFileSync(FILE, stampRelease(text, opts.version, opts.date))
    return 0
  }
  throw new Error(USAGE)
}

try {
  process.exit(main(process.argv.slice(2)))
} catch (err) {
  console.error(`changelog: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
