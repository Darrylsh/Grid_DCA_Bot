/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
let content = fs.readFileSync('src/main/bot.ts', 'utf8')

// Revert the faulty strict type casts since eslint is disabled for explicit-any
content = content.replace(
  /\(regimeFilter as \{ data: Record<string, unknown\[\]> \}\)/g,
  '(regimeFilter as any)'
)
content = content.replace(/as never/g, 'as any')

fs.writeFileSync('src/main/bot.ts', content)
console.log('Done')
