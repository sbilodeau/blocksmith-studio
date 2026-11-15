#!/usr/bin/env node
/**
 * Checks the built-in entity definitions against an extracted vanilla version: for each definition, how many
 * entity textures its globs match, and which of them have another size than its `textureSize` (a layout that
 * changed in that Minecraft version). Also lists entity textures no definition covers.
 *
 *   node scripts/audit-entity-models.mjs "<userData>/vanilla/26.3"
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const MODELS = resolve(import.meta.dirname, '../resources/data/entity-models')

function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += glob[i + 2] === '/' ? 2 : 1
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') re += '(?:'
    else if (c === '}') re += ')'
    else if (c === ',') re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function main() {
  const root = process.argv[2]
  if (!root) {
    console.error('usage: node scripts/audit-entity-models.mjs <extracted vanilla folder>')
    process.exit(1)
  }
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.png')) files.push(p.slice(root.length + 1).replace(/\\/g, '/'))
    }
  }
  walk(join(root, 'assets/minecraft/textures/entity'))
  const size = (p) => {
    const b = readFileSync(join(root, p))
    return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
  }
  const covered = new Set()
  for (const f of readdirSync(MODELS)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const def = JSON.parse(readFileSync(join(MODELS, f), 'utf8'))
    const res = def.textures.map(globToRegExp)
    const matched = files.filter((p) => !p.endsWith('_baby.png') && res.some((r) => r.test(p)))
    matched.forEach((p) => covered.add(p))
    const expected = def.textureSize.join('x')
    const wrong = matched.filter((p) => size(p) !== expected)
    const note =
      matched.length === 0
        ? '  NO TEXTURE MATCHES'
        : wrong.length
          ? `  wrong size: ${wrong.map((p) => `${p.split('/entity/')[1]}=${size(p)}`).join(', ')}`
          : ''
    console.log(
      `${def.id.padEnd(20)} ${expected.padEnd(7)} ${String(matched.length).padStart(3)} textures${note}`
    )
  }
  const missing = files.filter((p) => !covered.has(p) && !p.endsWith('_baby.png'))
  console.log(`\n${missing.length} entity textures without a definition (flat view), by folder:`)
  const byFolder = new Map()
  for (const p of missing) {
    const folder = p.split('/entity/')[1].split('/').slice(0, -1).join('/') || '.'
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1)
  }
  for (const [folder, n] of [...byFolder].sort()) console.log(`  ${folder} (${n})`)
}

main()
