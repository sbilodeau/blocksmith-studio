#!/usr/bin/env node
/**
 * Starts the Release workflow on GitHub for `main` (same as Actions > Release > Run workflow).
 * Shows the version it will get and the release notes (the "## Unreleased" section of CHANGELOG.md on main) first.
 *
 * Usage: npm run release [-- --preview] [-- --yes]
 *   --preview  only show the version and the notes
 *   --yes      do not ask for confirmation
 * Needs the GitHub CLI (`gh`) signed in with access to the repository.
 */
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { nextVersion } from './lib/calver.mjs'
import { unreleasedNotes } from './lib/changelog.mjs'

const WORKFLOW_URL = 'https://github.com/sbilodeau/blocksmith-studio/actions/workflows/release.yml'

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const unknown = [...args].filter((a) => a !== '--preview' && a !== '--yes')
  if (unknown.length) throw new Error(`Unknown argument ${unknown[0]}`)

  run('git', ['fetch', '--quiet', '--tags', 'origin', 'main'])
  const tags = run('git', ['tag', '--list', 'v*']).split(/\r?\n/)
  const version = nextVersion(tags, new Date())
  const notes = unreleasedNotes(run('git', ['show', 'origin/main:CHANGELOG.md']))

  console.log(`Next release: v${version} (from main)\n`)
  console.log(notes ? `Release notes:\n\n${notes}\n` : 'Release notes: none\n')
  if (!notes) {
    throw new Error('CHANGELOG.md on main has nothing under "## Unreleased": nothing to release')
  }
  if (args.has('--preview')) return

  if (!args.has('--yes')) {
    if (!process.stdin.isTTY) throw new Error('Not a terminal: add --yes to start the release')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`Release v${version}? [y/N] `)
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Cancelled.')
      return
    }
  }

  run('gh', ['workflow', 'run', 'release.yml', '--ref', 'main'])
  console.log(`Release started. Follow it at ${WORKFLOW_URL}`)
}

main().catch((err) => {
  const stderr = /** @type {{ stderr?: string }} */ (err).stderr
  console.error(`release: ${stderr?.trim() || (err instanceof Error ? err.message : String(err))}`)
  process.exit(1)
})
