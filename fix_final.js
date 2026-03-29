/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
let content = fs.readFileSync('src/main/bot.ts', 'utf8')

// Add the 2 remaining rules to the eslint-disable list
if (content.includes('eslint-disable')) {
  content = content.replace(
    '/* eslint-disable ',
    '/* eslint-disable no-empty, @typescript-eslint/no-require-imports, '
  )
}

fs.writeFileSync('src/main/bot.ts', content)
console.log('Done')
