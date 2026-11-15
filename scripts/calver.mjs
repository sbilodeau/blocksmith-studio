#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS: return types are in JSDoc */
/**
 * Prints the next CalVer release version computed from the git tags of the current repository.
 * The date defaults to today (UTC).
 *
 * Usage: node scripts/calver.mjs [--date YYYY-MM-DD]
 */
import { execFileSync } from 'node:child_process'
import { nextVersion, parseDate } from './lib/calver.mjs'

const USAGE = 'Usage: node scripts/calver.mjs [--date YYYY-MM-DD]'

/**
 * @param {string[]} argv
 * @returns {void}
 */
function main(argv) {
  let date = new Date()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--date') {
      date = parseDate(argv[++i] ?? '')
    } else if (arg.startsWith('--date=')) {
      date = parseDate(arg.slice('--date='.length))
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      return
    } else {
      throw new Error(`Unknown argument "${arg}". ${USAGE}`)
    }
  }
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split(/\r?\n/)
  console.log(nextVersion(tags, date))
}

try {
  main(process.argv.slice(2))
} catch (err) {
  console.error(`calver: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
