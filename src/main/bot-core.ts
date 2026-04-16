// ---------------------------------------------------------------------------
// Bot Core Orchestration Functions
// ---------------------------------------------------------------------------

import {
  initDb,
  getWhitelist,
  getSettings,
  getGridState as getGridStateFromDb,
  getAllActiveGridLevels,
  deleteGridState as deleteGridStateFromDb
} from './db'
import { sendTelegramMessage } from './telegram'
import { GridState, GridLevel } from './types'
import { getAvgEntryPrice, safeDivide } from './utils'
import {
  updateSettingsLocally as updateSettingsLocallyFromSettings,
  getCurrentMode as getCurrentModeFromSettings,
  getGridStep,
  getShareAmount
} from './settings-manager'
import {
  getGridState as getGridStateFromState,
  deleteGridState as deleteGridStateFromState,
  clearAllGridState,
  getGridLevels,
  clearGridLevels,
  getLastPrice,
  getAllLastPrices,
  deleteTrailingStop,
  setPriceHistory,
  deleteDelayedBuyState,
  setBotStartTime,
  getIsBotRunning,
  setIsBotRunning,
  getBotIntervals,
  addBotInterval,
  clearAllBotIntervals,
  getWsClient
} from './state-manager'
import {
  updateFilters as updateFiltersFromClient,
  fetchBalances as fetchBalancesFromClient,
  getApiKey
} from './exchange-client'
import { broadcastMarketUpdate, botEvents } from './bot-events'
import { registerBaseShare, sellBaseShare } from './trade-executor'
import {
  startUserDataStream as startUserDataStreamFromWs,
  connectWebSocket as connectWebSocketFromWs
} from './websocket-manager'

// Whitelist cache
let currentWhitelist: string[] = []

export const reloadWhitelist = async (newSymbols: string[] | string): Promise<void> => {
  const symbolsList = Array.isArray(newSymbols) ? newSymbols : [newSymbols]
  currentWhitelist = symbolsList.map((s) => (typeof s === 'object' ? (s as any).symbol : s)) // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log(`[WHITELIST] Reloaded: ${currentWhitelist.join(', ')}`)

  const wsClient = getWsClient()
  if (wsClient) {
    try {
      if (typeof wsClient.disconnect === 'function') wsClient.disconnect()
      if (wsClient.ws) wsClient.ws.terminate()
    } catch {
      /* ignore */
    }
  }

  await updateFiltersFromClient()
  await connectWebSocketFromWs()
}

export const updateSettingsLocally = (newSettings: Record<string, string>): void => {
  const oldMode = getCurrentModeFromSettings()
  updateSettingsLocallyFromSettings(newSettings)
  const newMode = getCurrentModeFromSettings()
  if (oldMode !== newMode) {
    console.log(`[BOT] Trading mode switched to: ${newMode}`)
    // Reload grid state for new mode
    loadBotState().catch(console.error)
  }
}

const loadBotState = async (): Promise<void> => {
  // Load grid states for current mode
  const savedStates = await getGridStateFromDb(getCurrentModeFromSettings())
  const currentGridState = getGridStateFromState() as Record<string, GridState>
  Object.assign(currentGridState, savedStates)

  // Clear any states from a different mode
  for (const sym of Object.keys(currentGridState)) {
    if (!savedStates[sym]) deleteGridStateFromState(sym)
  }

  // Load active grid levels
  const allLevels = await getAllActiveGridLevels(getCurrentModeFromSettings())
  const currentGridLevels = getGridLevels() as Record<string, GridLevel[]>
  for (const sym of Object.keys(currentGridLevels)) currentGridLevels[sym] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allLevels.forEach((row: any) => {
    if (!currentGridLevels[row.symbol]) currentGridLevels[row.symbol] = []
    currentGridLevels[row.symbol].push({
      id: row.id,
      symbol: row.symbol,
      mode: row.mode,
      buyPrice: row.buyPrice,
      sellPrice: row.sellPrice,
      quantity: row.quantity,
      cost: row.cost,
      status: 'PENDING_SELL',
      binanceSellOrderId: row.binanceSellOrderId
    })
  })

  console.log(
    `[BOT] Loaded ${Object.keys(currentGridState).length} base shares and ${allLevels.length} grid levels for ${getCurrentModeFromSettings()} mode.`
  )
}

export const getUnrealizedPnl = (): number => {
  let total = 0
  const gridState = getGridStateFromState() as Record<string, GridState>
  for (const symbol of Object.keys(gridState)) {
    const state = gridState[symbol]
    const price = getLastPrice(symbol) || state.basePrice
    // Use true cost basis (original entry price), not the floating grid reference.
    // The floating basePrice ratchets up as price rises, which would make profitable
    // positions appear as losses once price dips below the new grid reference.
    const avgEntry = getAvgEntryPrice(state)
    total += (price - avgEntry) * state.baseQuantity
    const levels = (getGridLevels(symbol) as GridLevel[]) || []
    for (const level of levels) {
      total += (price - level.buyPrice) * level.quantity
    }
  }
  return total
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getFullGridState = (): Record<string, any> => {
  const result: Record<string, any> = {} // eslint-disable-line @typescript-eslint/no-explicit-any
  const gridState = getGridStateFromState() as Record<string, GridState>
  const allSymbols = new Set([...currentWhitelist, ...Object.keys(gridState)])
  for (const symbol of allSymbols) {
    const state = gridState[symbol]
    const levels = (getGridLevels(symbol) as GridLevel[]) || []
    const price = getLastPrice(symbol) || 0

    // Percentage to next grid sell level
    let pctToGrid: number | null = null
    if (levels.length > 0) {
      const nextSell = levels
        .map((l) => l.sellPrice)
        .filter((sellPrice) => sellPrice > price)
        .sort((a, b) => a - b)[0]
      if (nextSell) {
        pctToGrid = ((nextSell - price) / price) * 100
      }
    }

    result[symbol] = {
      symbol,
      hasBaseShare: !!state,
      basePrice: state?.basePrice,
      baseQuantity: state?.baseQuantity,
      baseEntryCost: state?.baseEntryCost,
      currentPrice: price,
      pctFromBase: state
        ? safeDivide(
            price - state.basePrice,
            state.basePrice,
            0,
            `getFullGridState pctFromBase for ${symbol}`
          ) * 100
        : null,
      pctToGrid,
      gridLevels: levels,
      totalUnrealizedPnl: state
        ? (price - getAvgEntryPrice(state)) * (state.baseQuantity > 0 ? state.baseQuantity : 0) +
          levels.reduce((s, l) => s + (price - l.buyPrice) * l.quantity, 0)
        : 0
    }
  }
  return result
}

export const deleteBaseShareLocally = async (symbol: string): Promise<void> => {
  deleteGridStateFromState(symbol)
  deleteTrailingStop(symbol)
  setPriceHistory(symbol, [])
  deleteDelayedBuyState(symbol)
  await deleteGridStateFromDb(symbol, getCurrentModeFromSettings())
  console.log(`[BASE SHARE] ${symbol}: Local record and DB state deleted.`)
  broadcastMarketUpdate(symbol, getLastPrice(symbol) || 0)
}

export const wipeAllDataLocally = (): void => {
  clearAllGridState()
  clearGridLevels()
  // Clear all trailing stops, price histories, delayed buy states
  // Since state-manager doesn't have bulk clear functions, we need to iterate
  // For now, we'll rely on the fact that clearing grid state and levels is sufficient
  // and the other state will be recreated as needed.
  console.log(
    `[BOT] All grid state, grid levels, trailing stops, and dynamic grid state cleared from memory.`
  )
  // Notify UI
  const allPrices = getAllLastPrices()
  const allSymbols = new Set([
    ...Object.keys(allPrices),
    ...Object.keys(getGridStateFromState() as Record<string, GridState>)
  ])
  allSymbols.forEach((symbol) => {
    broadcastMarketUpdate(symbol, allPrices[symbol] || 0)
  })
}

export const executeManualTrade = async (
  symbol: string,
  side: 'BUY' | 'SELL'
): Promise<boolean> => {
  if (side === 'SELL') {
    await sellBaseShare(symbol)
    return true
  }
  // Manual BUY: register as base share using last known price
  const price = getLastPrice(symbol)
  if (!price) throw new Error(`No price data available for ${symbol}`)
  const qty = getShareAmount() / price
  await registerBaseShare(symbol, price, qty)
  return true
}

export const getCurrentMode = (): string => getCurrentModeFromSettings()

// Forward-compatible no-ops for removed features
export const reloadDecoupledList = async (): Promise<void> => {
  /* no-op */
}
export const toggleBotManualMode = async (): Promise<boolean> => true

export const startBot = async (): Promise<void> => {
  if (getIsBotRunning()) {
    console.log('[BOT] Already running.')
    return
  }
  setIsBotRunning(true)
  setBotStartTime(Date.now())

  await initDb()

  const settings = await getSettings()
  updateSettingsLocallyFromSettings(settings)

  currentWhitelist = await getWhitelist()
  console.log(`[BOT] Whitelist: ${currentWhitelist.join(', ')}`)
  console.log(
    `[BOT] Mode: ${getCurrentModeFromSettings()}, Share: $${getShareAmount()}, Grid Step: ${getGridStep()}%`
  )

  loadBotState()

  await updateFiltersFromClient()
  await fetchBalancesFromClient()

  connectWebSocketFromWs()

  // Start User Data Stream for live order fill detection
  if (getCurrentModeFromSettings() === 'LIVE' && getApiKey()) {
    await startUserDataStreamFromWs()
  }

  const intervals = getBotIntervals()
  intervals.forEach(clearInterval)
  clearAllBotIntervals()

  // Refresh balances every 30 seconds
  addBotInterval(setInterval(fetchBalancesFromClient, 30 * 1000))

  // Periodic filter refresh (every hour)
  addBotInterval(setInterval(updateFiltersFromClient, 60 * 60 * 1000))

  // Market pulse log every minute
  addBotInterval(
    setInterval(() => {
      const symbolList = [
        ...new Set([
          ...currentWhitelist,
          ...Object.keys(getGridStateFromState() as Record<string, GridState>)
        ])
      ]
      const summary = symbolList
        .map((sym) => {
          const price = getLastPrice(sym)
          const state = (getGridStateFromState() as Record<string, GridState>)[sym]
          const levels = ((getGridLevels(sym) as GridLevel[]) || []).length
          if (!price) return `${sym.replace('USDT', '')}: no data`
          const pct = state
            ? (
                safeDivide(price - state.basePrice, state.basePrice, 0, `market pulse for ${sym}`) *
                100
              ).toFixed(2) + '%'
            : 'no base'
          return `${sym.replace('USDT', '')}: $${price.toFixed(4)} (${pct}) [${levels} levels]`
        })
        .join(' | ')
      console.log(`[MARKET PULSE] ${summary}`)
    }, 60_000)
  )

  // Telegram Notifications for Trades
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  botEvents.on('trade_executed', (data: any) => {
    const sideStr = data.side === 'BUY' ? '🟢 BOUGHT' : '🔴 SOLD'
    const icon = data.side === 'BUY' ? '🛒' : '💰'

    let msg = `${icon} ${sideStr} ${data.symbol}\n`
    msg += `Price: $${data.price.toFixed(4)}\n`
    msg += `Quantity: ${data.quantity.toFixed(6)}\n`

    if (data.side === 'SELL') {
      msg += `Profit: $${data.pnl.toFixed(4)} (${(data.roi * 100).toFixed(2)}%)\n`
    }

    msg += `Mode: ${getCurrentModeFromSettings()} | Reason: ${data.reason}`

    sendTelegramMessage(msg)
  })

  console.log('[BOT] Grid DCA Bot started.')
}
