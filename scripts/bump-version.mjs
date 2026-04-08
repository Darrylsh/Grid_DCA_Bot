/**
 * bump-version.mjs
 * Run: node scripts/bump-version.mjs [patch|minor|major]
 * Increments the version in package.json AND syncs it to headless-server.ts
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')

// --- Read current version from package.json ---
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

const bumpType = process.argv[2] || 'patch'
let newVersion
if (bumpType === 'major') newVersion = `${major + 1}.0.0`
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`
else newVersion = `${major}.${minor}.${patch + 1}`

// --- Update package.json ---
pkg.version = newVersion
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ package.json → ${newVersion}`)

// --- Update BACKEND_VERSION in headless-server.ts ---
const serverPath = resolve(root, 'src/main/headless-server.ts')
let serverSrc = readFileSync(serverPath, 'utf8')
const versionLine = /^export const BACKEND_VERSION = '.*?';$/m
const newLine = `export const BACKEND_VERSION = '${newVersion}';`
if (versionLine.test(serverSrc)) {
  serverSrc = serverSrc.replace(versionLine, newLine)
} else {
  // Insert after the last import line
  serverSrc = serverSrc.replace(
    /(import { runBacktest } from '\.\/backtest';\n)/,
    `$1\n${newLine}\n`
  )
}
writeFileSync(serverPath, serverSrc)
console.log(`✅ headless-server.ts BACKEND_VERSION → ${newVersion}`)
console.log(`\n🚀 Version bumped to ${newVersion}`)
