import { Server as SocketIOServer } from 'socket.io'
import * as http from 'http'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '../../.env') })

// Global error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

import { sendTelegramMessage } from './telegram'

import {
  botEvents,
  startBot,
  executeManualTrade,
  reloadWhitelist,
  updateSettingsLocally,
  getUnrealizedPnl,
  getCurrentMode,
  registerBaseShare,
  sellBaseShare,
  deleteBaseShareLocally,
  clearGridLevels,
  wipeAllDataLocally,
  getFullGridState,
  togglePause,
  sellLowestGridLevel
} from './bot'

import {
  getWhitelist,
  updateWhitelist,
  getSettings,
  updateSetting,
  getMetrics,
  getRecentTrades,
  getTradesByTimeRange,
  clearTradeHistory,
  wipeAllData
} from './db'

import { runBacktest } from './backtest'

export const BACKEND_VERSION = '1.9.4'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

// (Simulation override removed so the Bot respects user DB settings at boot)

async function startHeadless(): Promise<void> {
  // Create HTTP & Socket.io server
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Gridbot Headless Server Running\n')
  })

  const io = new SocketIOServer(server, {
    cors: {
      origin: '*', // Allow all origins for the control UI
      methods: ['GET', 'POST']
    }
  })

  console.log(`Socket.io server initialized on port ${PORT}`)

  // Bot Event bridging to Socket.io
  botEvents.on('market_update', (data) => io.emit('market_update', data))
  botEvents.on('trade_executed', (data) => io.emit('trade_executed', data))
  botEvents.on('balance_update', (data) => io.emit('balance_update', data))
  botEvents.on('grid_levels_update', (data) => io.emit('grid_levels_update', data))
  botEvents.on('bot_log', (data) => io.emit('bot_log', data))

  botEvents.on('whitelist_update', (data) => io.emit('whitelist_update', data))

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`)

    // Expose version so frontend can detect mismatches
    socket.on('getVersion', (callback) => {
      if (typeof callback === 'function') callback({ success: true, data: BACKEND_VERSION })
    })

    // Read Operations
    socket.on('getSettings', async (callback) => {
      try {
        const s = await getSettings()
        callback({ success: true, data: s })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('getWhitelist', async (callback) => {
      try {
        const w = await getWhitelist()
        callback({ success: true, data: w })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('getMetrics', async (...args) => {
      const callback = args.pop()
      try {
        const m = await getMetrics(getCurrentMode())
        if (typeof callback === 'function') callback({ success: true, data: m })
      } catch (err: unknown) {
        if (typeof callback === 'function')
          callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('getRecentTrades', async (...args) => {
      const callback = args.pop()
      const payload = args.length > 0 ? args[0] : null
      try {
        const mode = payload?.mode || getCurrentMode()
        const limit = payload?.limit || 50
        const t = await getRecentTrades(mode, limit)
        if (typeof callback === 'function') callback({ success: true, data: t })
      } catch (err: unknown) {
        if (typeof callback === 'function')
          callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('getTradesByTimeRange', async (...args) => {
      const callback = args.pop()
      const [mode, startMs, endMs] = args
      try {
        const t = await getTradesByTimeRange(mode, startMs, endMs)
        if (typeof callback === 'function') callback({ success: true, data: t })
      } catch (err: unknown) {
        if (typeof callback === 'function')
          callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('getFullGridState', async (...args) => {
      const callback = args.pop()
      try {
        const g = await getFullGridState()
        if (typeof callback === 'function') callback({ success: true, data: g })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('getUnrealizedPnl', (callback) => {
      callback({ success: true, data: getUnrealizedPnl() })
    })

    socket.on('updateSetting', async (key, value, callback) => {
      try {
        await updateSetting(key, value)
        await updateSettingsLocally({ [key]: value })
        callback({ success: true })
        io.emit('settings_updated')
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('updateWhitelist', async (...args) => {
      const callback = args.pop()
      const [symbols] = args
      try {
        await updateWhitelist(symbols)
        await reloadWhitelist(symbols)
        if (typeof callback === 'function') callback({ success: true })
        io.emit('whitelist_updated')
      } catch (err: unknown) {
        if (typeof callback === 'function')
          callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('registerBaseShare', async (...args) => {
      const callback = args.pop()
      const [symbol, basePrice, baseQuantity] = args
      try {
        await registerBaseShare(symbol, basePrice, baseQuantity)
        if (typeof callback === 'function') callback({ success: true })
      } catch (err: unknown) {
        if (typeof callback === 'function')
          callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('sellBaseShare', async (symbol, callback) => {
      try {
        await sellBaseShare(symbol)
        callback({ success: true })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('deleteBaseShare', async (symbol, callback) => {
      try {
        await deleteBaseShareLocally(symbol)
        callback({ success: true })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('clearTradeHistory', async (mode, callback) => {
      try {
        await clearTradeHistory(mode || getCurrentMode())
        callback({ success: true })
        io.emit('trades_updated')
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('wipeAllData', async (mode, callback) => {
      try {
        await wipeAllData(mode || getCurrentMode())
        await wipeAllDataLocally()
        callback({ success: true })
        io.emit('grid_updated')
        io.emit('trades_updated')
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('clearGridLevels', async (symbol, callback) => {
      try {
        await clearGridLevels(symbol)
        callback({ success: true })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('sellLowestGridLevel', async (symbol, callback) => {
      try {
        await sellLowestGridLevel(symbol)
        callback({ success: true })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('togglePause', async (symbol, callback) => {
      try {
        await togglePause(symbol)
        callback({ success: true })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('executeManualTrade', async (...args) => {
      const callback = args.pop()
      const [symbol, side] = args
      try {
        await executeManualTrade(symbol, side)
        if (typeof callback === 'function') callback({ success: true })
      } catch (err: unknown) {
        if (typeof callback === 'function')
          callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('runBacktest', async (symbol, start, end, shareAmount, gridStep, callback) => {
      try {
        const s = await getSettings()
        const trailLevels = parseInt(s.trailing_stop_levels || '3')
        const trailPct = parseFloat(s.trailing_stop_pct || '0.5')
        const dynamicGridEnabled = s.dynamic_grid_enabled === 'true'
        const momentumWindow = parseInt(s.momentum_window || '10')
        const momentumThresholdPct = parseFloat(s.momentum_threshold_pct || '-0.5')
        const reboundThresholdPct = parseFloat(s.rebound_threshold_pct || '0.25')
        const dynamicModeTimeoutMin = parseInt(s.dynamic_mode_timeout_min || '30')
        const results = await runBacktest(
          symbol,
          start,
          end,
          shareAmount,
          gridStep,
          trailLevels,
          trailPct,
          dynamicGridEnabled,
          momentumWindow,
          momentumThresholdPct,
          reboundThresholdPct,
          dynamicModeTimeoutMin,
          (progress, interimResults) => {
            socket.emit('bt:progress', progress)
            if (interimResults) socket.emit('bt:update', interimResults)
          }
        )
        callback({ success: true, data: results })
      } catch (err: unknown) {
        callback({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    })

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`)
    })
  })

  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Headless server listening on 0.0.0.0:${PORT}`)
    // Send Telegram startup notification
    sendTelegramMessage(
      `🚀 Algobot Online\nHeadless server successfully started and listening on port ${PORT}.`
    )

    // Start bot logic
    await startBot()
  })
}

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Unhandled Rejection:', reason)
})

startHeadless().catch((err) => {
  console.error('Failed to start headless server:', err)
  process.exit(1)
})
