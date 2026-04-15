/**
 * bump-version.mjs
 * Usage: node scripts/bump-version.mjs [ui|srv] [patch|minor|major]
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')

const target = process.argv[2] // 'ui' or 'srv'
const bumpType = process.argv[3] || 'patch'

if (!['ui', 'srv'].includes(target)) {
  console.error('❌ Please specify a target: "ui" or "srv"')
  process.exit(1)
}

/**
 * @param {string} version
 * @param {string} type
 * @returns {string}
 * @type {(version: string, type: string) => string}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function bump(version, type) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

if (target === 'ui') {
  // --- Update package.json (Frontend Source of Truth) ---
  const pkgPath = resolve(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const oldVersion = pkg.version
  const newVersion = bump(oldVersion, bumpType)

  pkg.version = newVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✅ UI Version bumped: ${oldVersion} → ${newVersion} (package.json)`)
} else {
  // --- Update BACKEND_VERSION in headless-server.ts (Backend Source of Truth) ---
  const serverPath = resolve(root, 'src/main/headless-server.ts')
  let serverSrc = readFileSync(serverPath, 'utf8')

  const versionMatch = serverSrc.match(/export const BACKEND_VERSION = '(.*?)'/)
  if (!versionMatch) {
    console.error('❌ Could not find BACKEND_VERSION in headless-server.ts')
    process.exit(1)
  }

  const oldVersion = versionMatch[1]
  const newVersion = bump(oldVersion, bumpType)
  const newLine = `export const BACKEND_VERSION = '${newVersion}'`

  serverSrc = serverSrc.replace(/export const BACKEND_VERSION = '.*?'/, newLine)
  writeFileSync(serverPath, serverSrc)
  console.log(`✅ Server Version bumped: ${oldVersion} → ${newVersion} (headless-server.ts)`)
}
