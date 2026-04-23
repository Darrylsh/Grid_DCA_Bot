import * as https from 'https'
import TelegramBot from 'node-telegram-bot-api'
import { executeManualTrade, sellLowestGridLevel, getFullGridState } from './bot'

let botInstance: TelegramBot | null = null

const ALLOWED_USER_ID = 6642185954

export const startTelegramBot = (): void => {
  const token = process.env['TELEGRAM_BOT_TOKEN']
  if (!token) {
    console.warn('[TELEGRAM] Skipping bot initialization. TELEGRAM_BOT_TOKEN is not set.')
    return
  }

  // Initialize bot with polling
  botInstance = new TelegramBot(token, { polling: true })
  console.log('[TELEGRAM] Bot started and polling for commands...')

  // Helper to format symbols (auto-appends USDT if missing)
  const formatSymbol = (input: string): string => {
    let symbol = input.trim().toUpperCase()
    if (!symbol.endsWith('USDT')) {
      symbol += 'USDT'
    }
    return symbol
  }

  // /buy command
  botInstance.onText(/^\/buy\s+(.+)$/i, async (msg, match) => {
    if (msg.from?.id !== ALLOWED_USER_ID) return
    const chatId = msg.chat.id
    if (!match) return
    const symbol = formatSymbol(match[1])

    try {
      await botInstance?.sendMessage(chatId, `Executing BUY for ${symbol}...`)
      await executeManualTrade(symbol, 'BUY')
      await botInstance?.sendMessage(chatId, `✅ Successfully bought base share for ${symbol}.`)
    } catch (err: any) {
      await botInstance?.sendMessage(chatId, `❌ Failed to buy ${symbol}: ${err.message}`)
    }
  })

  // /sell command
  botInstance.onText(/^\/sell\s+(.+)$/i, async (msg, match) => {
    if (msg.from?.id !== ALLOWED_USER_ID) return
    const chatId = msg.chat.id
    if (!match) return
    const symbol = formatSymbol(match[1])

    try {
      await botInstance?.sendMessage(chatId, `Executing SELL for ${symbol}...`)
      await executeManualTrade(symbol, 'SELL')
      await botInstance?.sendMessage(chatId, `✅ Successfully sold base share for ${symbol}.`)
    } catch (err: any) {
      await botInstance?.sendMessage(chatId, `❌ Failed to sell ${symbol}: ${err.message}`)
    }
  })

  // /gridsell command
  botInstance.onText(/^\/gridsell\s+(.+)$/i, async (msg, match) => {
    if (msg.from?.id !== ALLOWED_USER_ID) return
    const chatId = msg.chat.id
    if (!match) return
    const symbol = formatSymbol(match[1])

    try {
      await botInstance?.sendMessage(chatId, `Executing GRID SELL for ${symbol}...`)
      await sellLowestGridLevel(symbol)
      await botInstance?.sendMessage(chatId, `✅ Successfully sold lowest grid level for ${symbol}.`)
    } catch (err: any) {
      await botInstance?.sendMessage(chatId, `❌ Failed to grid sell ${symbol}: ${err.message}`)
    }
  })

  // /info command
  botInstance.onText(/^\/info\s+(.+)$/i, async (msg, match) => {
    if (msg.from?.id !== ALLOWED_USER_ID) return
    const chatId = msg.chat.id
    if (!match) return
    const symbol = formatSymbol(match[1])

    try {
      const state = getFullGridState()
      const coinState = state[symbol]
      if (!coinState) {
        await botInstance?.sendMessage(chatId, `ℹ️ No data available for ${symbol}.`)
        return
      }

      let infoMsg = `📊 *Info for ${symbol}*\n`
      infoMsg += `Current Price: $${coinState.currentPrice?.toFixed(4) || 'N/A'}\n`
      infoMsg += `Base Share: ${coinState.hasBaseShare ? 'Yes' : 'No'}\n`
      if (coinState.hasBaseShare) {
        infoMsg += `Base Price: $${coinState.basePrice?.toFixed(4)}\n`
        infoMsg += `Pct From Base: ${coinState.pctFromBase?.toFixed(2)}%\n`
      }
      infoMsg += `Grid Levels: ${coinState.gridLevels?.length || 0}\n`
      if (coinState.pctToGrid !== null && coinState.pctToGrid !== undefined) {
        infoMsg += `Pct To Next Grid: ${coinState.pctToGrid?.toFixed(2)}%\n`
      }
      infoMsg += `Total Unrealized PnL: $${coinState.totalUnrealizedPnl?.toFixed(4) || '0.0000'}`

      await botInstance?.sendMessage(chatId, infoMsg, { parse_mode: 'Markdown' })
    } catch (err: any) {
      await botInstance?.sendMessage(chatId, `❌ Failed to get info for ${symbol}: ${err.message}`)
    }
  })
}

export const sendTelegramMessage = (message: string): void => {
  const token = process.env['TELEGRAM_BOT_TOKEN']
  const chatId = process.env['TELEGRAM_CHAT_ID']

  if (!token || !chatId) {
    console.warn(
      '[TELEGRAM] Skipping notification. TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set in .env'
    )
    return
  }

  if (botInstance) {
    botInstance.sendMessage(chatId, message).catch((err) => {
      console.error('[TELEGRAM] Error sending message via bot instance:', err.message)
    })
  } else {
    // Fallback if bot is not started (e.g. testing context or UI)
    const data = JSON.stringify({
      chat_id: chatId,
      text: message
    })

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn(`[TELEGRAM] Failed to send message. HTTP ${res.statusCode}: ${body}`)
        }
      })
    })

    req.on('error', (error) => {
      console.error('[TELEGRAM] Error sending message:', error.message)
    })

    req.write(data)
    req.end()
  }
}
