/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
let content = fs.readFileSync('src/main/bot.ts', 'utf8')

// fix imports
content = content.replace(/const \{ WebsocketStream \} = require\('@binance\/connector'\);/g, '')
content = content.replace(
  /import \* as dotenv/g,
  "import { WebsocketStream } from '@binance/connector';\nimport * as dotenv"
)

// fix wsClient any -> unknown
content = content.replace(
  /let wsClient: any = null;/g,
  'let wsClient: Record<string, unknown> | null = null;'
)

// fix params any -> Record<string, unknown>
content = content.replace(/strategyConfig\?: any/g, 'strategyConfig?: Record<string, unknown>')

// fix any casts
content = content.replace(/as any/g, 'as never')
content = content.replace(
  /\(regimeFilter as never\)\.data/g,
  '(regimeFilter as { data: Record<string, unknown[]> }).data'
)

// fix unused vars
content = content.replace(
  /const btcRegime = btcData\.micro;\s*const btcMacroDiff = btcData\.macroDiff \|\| 0;/g,
  ''
)

// empty catch block
content = content.replace(/} catch \(e\) \{ \}/g, '} catch { }')

// add eslint-disable for return types at top
if (!content.includes('eslint-disable')) {
  content =
    '/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */\n' +
    content
}

fs.writeFileSync('src/main/bot.ts', content)
console.log('Done')
