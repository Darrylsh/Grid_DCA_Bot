/* eslint-disable @typescript-eslint/no-explicit-any */
// bot.ts — Grid DCA Bot Engine
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config({ path: path.join(__dirname, '../../.env') })

import { WebsocketStream, Spot } from '@binance/connector'
import * as https from 'https'
import WebSocket from 'ws'
import { EventEmitter } from 'events'
import {
  initDb,
  getWhitelist,
  getSettings,
  logTrade,
  saveGridState,
  deleteGridState,
  getGridState,
  getAllActiveGridLevels,
  saveGridLevel,
  markGridLevelFilled,
  deleteAllGridLevels
} from './db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GridState {
  basePrice: number       // Reference price for 3% up/down calculation
  baseQuantity: number    // Coin quantity of the base share
  baseEntryCost: number   // USDT cost of the base share
}

interface GridLevel {
  id: number
  symbol: string
  mode: string
  buyPrice: number
  sellPrice: number
  quantity: number
  cost: number
  status: 'PENDING_SELL' | 'FILLED'
  binanceSellOrderId?: string
}

interface Filter {
  stepSize: number
  tickSize: number
}

// ---------------------------------------------------------------------------
// Binance Client
// ---------------------------------------------------------------------------
const apiKey = process.env['BINANCE_API_KEY']
const apiSecret = process.env['BINANCE_API_SECRET']
const client = apiKey ? new Spot(apiKey, apiSecret) : new Spot()

// ---------------------------------------------------------------------------
// In-Memory State
// ---------------------------------------------------------------------------
// gridState: basePrice tracking per symbol — only set once user registers a base share
const gridState: Record<string, GridState> = {}

// gridLevels: in-memory cache of pending grid sells (synced from DB on start)
const gridLevels: Record<string, GridLevel[]> = {}

// Last price seen per symbol
const lastPrices: Record<string, number> = {}

// Exchange lot/tick size filters
let symbolFilters: Record<string, Filter> = {}

// Balances
export const balances: Record<string, number> = { USDT: 0, BNB: 0 }

// Settings
const currentSettings: Record<string, string> = {
  trading_mode: 'LIVE',
  capital_type: 'FIXED',
  capital_value: '100',
  grid_step_percent: '3'
}

let currentMode = 'LIVE'
let currentWhitelist: string[] = []
let wsClient: any = null
let streamGeneration = 0
let botStartTime: number | null = null
let isBotRunning = false
let botIntervals: NodeJS.Timeout[] = []

// Cooldown: prevent double-buying at same grid level (per symbol, ms timestamp)
const levelCooldowns: Record<string, number> = {}
const LEVEL_COOLDOWN_MS = 5000 // 5 second cooldown after a grid purchase

export const botEvents = new EventEmitter()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getGridStep = (): number => {
  const step = parseFloat(currentSettings.grid_step_percent || '3')
  return isNaN(step) || step <= 0 ? 3 : step
}

const getShareAmount = (): number => {
  const val = parseFloat(currentSettings.capital_value || '100')
  return isNaN(val) || val <= 0 ? 100 : val
}

const roundToStep = (value: number, step: number): number => {
  if (!step || step === 0) return value
  const precision = step.toString().split('.')[1]?.length || 0
  return parseFloat((Math.floor(value / step) * step).toFixed(precision))
}

const roundTick = (value: number, tickSize: number, direction: 'up' | 'down' = 'down'): number => {
  if (!tickSize || tickSize === 0) return value
  const precision = tickSize.toString().split('.')[1]?.length || 0
  if (direction === 'up') return parseFloat((Math.ceil(value / tickSize) * tickSize).toFixed(precision))
  return parseFloat((Math.floor(value / tickSize) * tickSize).toFixed(precision))
}

// ---------------------------------------------------------------------------
// Exchange Filters
// ---------------------------------------------------------------------------
const updateFilters = async (): Promise<void> => {
  if (!apiKey) return
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('exchangeInfo timeout')), 10000)
    )
    const response = await Promise.race([client.exchangeInfo(), timeout]) as any
    const filters: Record<string, Filter> = {}
    response.data.symbols.forEach((s: any) => {
      const lotSize = s.filters.find((f: any) => f.filterType === 'LOT_SIZE')
      const priceFilter = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER')
      if (lotSize || priceFilter) {
        filters[s.symbol] = {
          stepSize: lotSize ? parseFloat(lotSize.stepSize) : 0,
          tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : 0
        }
      }
    })
    symbolFilters = filters
    console.log(`[FILTERS] Updated exchange filters for ${Object.keys(symbolFilters).length} symbols.`)
  } catch (e: any) {
    console.error('[FILTERS] Failed to update exchange filters:', e.message)
  }
}

// ---------------------------------------------------------------------------
// Balance Fetch
// ---------------------------------------------------------------------------
const fetchBalances = async (): Promise<void> => {
  if (!apiKey || !apiSecret) return
  try {
    const response = await client.account() as any
    const usdt = response.data.balances.find((b: any) => b.asset === 'USDT')
    const bnb = response.data.balances.find((b: any) => b.asset === 'BNB')
    balances.USDT = parseFloat(usdt?.free || '0')
    balances.BNB = parseFloat(bnb?.free || '0')
    botEvents.emit('balance_update', { ...balances })
  } catch (e: any) {
    console.error('[BALANCE] Failed to fetch balances:', e.message)
  }
}

// ---------------------------------------------------------------------------
// Grid Level - Buy a new share and place a limit sell
// ---------------------------------------------------------------------------
const executeGridBuy = async (symbol: string, currentPrice: number): Promise<void> => {
  const shareAmount = getShareAmount()
  const gridStep = getGridStep()
  const stepMultiplier = gridStep / 100

  if (currentMode === 'LIVE' && balances.USDT < shareAmount) {
    console.log(`[GRID] ${symbol}: Insufficient USDT (${balances.USDT.toFixed(2)} < ${shareAmount}). Skipping grid buy.`)
    return
  }

  const filter = symbolFilters[symbol]
  let quantity = shareAmount / currentPrice
  let buyFillPrice = currentPrice
  let sellLimitPrice = currentPrice * (1 + stepMultiplier)

  if (filter) {
    quantity = roundToStep(quantity, filter.stepSize)
    sellLimitPrice = roundTick(sellLimitPrice, filter.tickSize, 'up')
  }

  if (quantity <= 0) {
    console.log(`[GRID] ${symbol}: Quantity rounded to 0. Skipping.`)
    return
  }

  console.log(`[GRID BUY] ${symbol}: Buying ${quantity.toFixed(6)} @ ~$${currentPrice.toFixed(4)}. Will sell @ $${sellLimitPrice.toFixed(4)} (+${gridStep}%)`)

  let binanceSellOrderId: string | undefined

  if (currentMode === 'LIVE') {
    try {
      // Place market buy
      const buyResult = await client.newOrder(symbol, 'BUY', 'MARKET', {
        quoteOrderQty: shareAmount.toFixed(2)
      }) as any

      // Extract actual fill
      const fills = buyResult.data.fills || []
      if (fills.length > 0) {
        const totalQty = fills.reduce((sum: number, f: any) => sum + parseFloat(f.qty), 0)
        const totalCost = fills.reduce((sum: number, f: any) => sum + parseFloat(f.price) * parseFloat(f.qty), 0)
        buyFillPrice = totalCost / totalQty
        quantity = totalQty
        console.log(`[GRID FILL] ${symbol} BUY: ${quantity.toFixed(6)} @ avg $${buyFillPrice.toFixed(6)}`)
      }

      // Recalculate sell price based on actual fill
      sellLimitPrice = buyFillPrice * (1 + stepMultiplier)
      if (filter) {
        quantity = roundToStep(quantity, filter.stepSize)
        sellLimitPrice = roundTick(sellLimitPrice, filter.tickSize, 'up')
      }

      // Place GTC limit sell immediately
      try {
        const sellResult = await client.newOrder(symbol, 'SELL', 'LIMIT', {
          quantity: quantity.toString(),
          price: sellLimitPrice.toFixed(filter?.tickSize ? filter.tickSize.toString().split('.')[1]?.length || 2 : 4),
          timeInForce: 'GTC'
        }) as any

        binanceSellOrderId = sellResult.data.orderId?.toString()
        console.log(`[GRID SELL ORDER] ${symbol}: GTC SELL placed @ $${sellLimitPrice.toFixed(4)} (orderId: ${binanceSellOrderId})`)
      } catch (sellErr: any) {
        console.error(`[GRID] Failed to place limit sell for ${symbol}:`, sellErr.response?.data || sellErr.message)
        // Still record the grid level even if sell order failed — user can manage manually
      }

      fetchBalances()
    } catch (e: any) {
      console.error(`[GRID BUY FAILED] ${symbol}:`, e.response?.data || e.message)
      return
    }
  } else {
    // SIMULATION: track the pending sell in memory only
    buyFillPrice = currentPrice
    sellLimitPrice = currentPrice * (1 + stepMultiplier)
    if (filter) sellLimitPrice = roundTick(sellLimitPrice, filter.tickSize, 'up')
    // Deduct from simulated balance
    balances.USDT = Math.max(0, balances.USDT - shareAmount)
    botEvents.emit('balance_update', { ...balances })
  }

  const cost = buyFillPrice * quantity

  // Persist grid level to DB
  const levelId = saveGridLevel({
    symbol,
    mode: currentMode,
    buyPrice: buyFillPrice,
    sellPrice: sellLimitPrice,
    quantity,
    cost,
    binanceSellOrderId
  })

  // Update in-memory grid levels
  if (!gridLevels[symbol]) gridLevels[symbol] = []
  gridLevels[symbol].push({
    id: levelId,
    symbol,
    mode: currentMode,
    buyPrice: buyFillPrice,
    sellPrice: sellLimitPrice,
    quantity,
    cost,
    status: 'PENDING_SELL',
    binanceSellOrderId
  })

  // Log the buy trade
  logTrade({
    symbol,
    side: 'BUY',
    price: buyFillPrice,
    quantity,
    pnl: 0,
    roi: 0,
    reason: 'GRID_BUY'
  }, currentMode)

  botEvents.emit('trade_executed', {
    symbol,
    side: 'BUY',
    price: buyFillPrice,
    quantity,
    pnl: 0,
    roi: 0,
    reason: 'GRID_BUY',
    timestamp: new Date()
  })

  broadcastMarketUpdate(symbol, lastPrices[symbol] || currentPrice)
}

// ---------------------------------------------------------------------------
// Grid Level - Handle a sell fill (from simulation or user data stream)
// ---------------------------------------------------------------------------
const handleGridSellFill = async (
  symbol: string,
  level: GridLevel,
  fillPrice: number
): Promise<void> => {
  const pnl = (fillPrice - level.buyPrice) * level.quantity
  const roi = (fillPrice - level.buyPrice) / level.buyPrice

  console.log(`[GRID SELL FILLED] ${symbol}: Sold ${level.quantity.toFixed(6)} @ $${fillPrice.toFixed(4)}. PnL: $${pnl.toFixed(4)} (${(roi * 100).toFixed(2)}%)`)

  markGridLevelFilled(level.id)

  // Remove from in-memory
  if (gridLevels[symbol]) {
    gridLevels[symbol] = gridLevels[symbol].filter((l) => l.id !== level.id)
  }

  // Update simulated USDT balance
  if (currentMode === 'SIMULATION') {
    balances.USDT += fillPrice * level.quantity
    botEvents.emit('balance_update', { ...balances })
  }

  logTrade({
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: level.quantity,
    pnl,
    roi,
    reason: 'GRID_SELL_FILL'
  }, currentMode)

  botEvents.emit('trade_executed', {
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: level.quantity,
    pnl,
    roi,
    reason: 'GRID_SELL_FILL',
    timestamp: new Date()
  })

  broadcastMarketUpdate(symbol, lastPrices[symbol] || fillPrice)
}

// ---------------------------------------------------------------------------
// Core Price Tick Handler
// ---------------------------------------------------------------------------
const processTick = (symbol: string, currentPrice: number): void => {
  lastPrices[symbol] = currentPrice

  const state = gridState[symbol]
  const levels = gridLevels[symbol] || []

  // --- SIMULATION: Check if any pending limit sells are now fulfilled ---
  if (currentMode === 'SIMULATION') {
    for (const level of [...levels]) {
      if (currentPrice >= level.sellPrice) {
        handleGridSellFill(symbol, level, level.sellPrice).catch(console.error)
      }
    }
  }

  // No base share registered for this symbol — nothing to do
  if (!state) {
    broadcastMarketUpdate(symbol, currentPrice)
    return
  }

  const gridStep = getGridStep()
  const stepMult = gridStep / 100

  // Determine the reference price for the next buy:
  // The next buy triggers at 3% BELOW whichever is lower: basePrice or the lowest current grid level buy
  const lowestLevelBuyPrice = levels.length > 0
    ? Math.min(...levels.map((l) => l.buyPrice))
    : null
  const referencePrice = lowestLevelBuyPrice !== null
    ? Math.min(state.basePrice, lowestLevelBuyPrice)
    : state.basePrice
  const nextBuyTrigger = referencePrice * (1 - stepMult)

  // --- UP 3%: Move base price up, no trade ---
  if (currentPrice >= state.basePrice * (1 + stepMult)) {
    const oldBase = state.basePrice
    const newBase = currentPrice
    state.basePrice = newBase
    saveGridState(symbol, state, currentMode)
    console.log(`[GRID UP] ${symbol}: Base price moved from $${oldBase.toFixed(4)} → $${newBase.toFixed(4)} (+${gridStep}%). No trade.`)
    broadcastMarketUpdate(symbol, currentPrice)
    return
  }

  // --- DOWN 3%: Buy a new grid level ---
  const cooldownKey = `${symbol}_${nextBuyTrigger.toFixed(6)}`
  const lastBuy = levelCooldowns[cooldownKey] || 0
  if (currentPrice <= nextBuyTrigger && Date.now() - lastBuy > LEVEL_COOLDOWN_MS) {
    levelCooldowns[cooldownKey] = Date.now()
    console.log(`[GRID DOWN] ${symbol}: Price $${currentPrice.toFixed(4)} hit next buy trigger $${nextBuyTrigger.toFixed(4)} (${gridStep}% below $${referencePrice.toFixed(4)})`)
    executeGridBuy(symbol, currentPrice).catch(console.error)
  }

  broadcastMarketUpdate(symbol, currentPrice)
}

// ---------------------------------------------------------------------------
// Market Update Broadcast
// ---------------------------------------------------------------------------
const broadcastMarketUpdate = (symbol: string, currentPrice: number): void => {
  const state = gridState[symbol]
  const levels = gridLevels[symbol] || []
  const gridStep = getGridStep()

  let pctFromBase: number | null = null
  if (state) {
    pctFromBase = ((currentPrice - state.basePrice) / state.basePrice) * 100
  }

  // Unrealized PnL from base share
  let baseUnrealizedPnl = 0
  let baseUnrealizedRoi = 0
  if (state) {
    baseUnrealizedPnl = (currentPrice - state.basePrice) * state.baseQuantity
    baseUnrealizedRoi = (currentPrice - state.basePrice) / state.basePrice
  }

  // Unrealized PnL from grid levels
  const gridUnrealizedPnl = levels.reduce((sum, l) => {
    return sum + (currentPrice - l.buyPrice) * l.quantity
  }, 0)

  botEvents.emit('market_update', {
    symbol,
    currentPrice,
    basePrice: state?.basePrice ?? null,
    baseQuantity: state?.baseQuantity ?? null,
    baseEntryCost: state?.baseEntryCost ?? null,
    pctFromBase,
    gridLevels: levels.map((l) => ({
      id: l.id,
      buyPrice: l.buyPrice,
      sellPrice: l.sellPrice,
      quantity: l.quantity,
      cost: l.cost,
      pctChange: ((currentPrice - l.buyPrice) / l.buyPrice) * 100
    })),
    gridStep,
    baseUnrealizedPnl,
    baseUnrealizedRoi,
    gridUnrealizedPnl,
    totalUnrealizedPnl: baseUnrealizedPnl + gridUnrealizedPnl,
    botStartTime,
    hasBaseShare: !!state
  })
}

// ---------------------------------------------------------------------------
// Register Base Share (called from UI / manual trade)
// ---------------------------------------------------------------------------
const registerBaseShare = async (
  symbol: string,
  price: number,
  quantity: number
): Promise<void> => {
  const cost = price * quantity
  gridState[symbol] = { basePrice: price, baseQuantity: quantity, baseEntryCost: cost }
  saveGridState(symbol, gridState[symbol], currentMode)

  console.log(`[BASE SHARE] ${symbol}: Registered base share @ $${price.toFixed(4)}, qty: ${quantity.toFixed(6)}, cost: $${cost.toFixed(2)}`)

  logTrade({
    symbol,
    side: 'BUY',
    price,
    quantity,
    pnl: 0,
    roi: 0,
    reason: 'BASE_SHARE'
  }, currentMode)

  botEvents.emit('trade_executed', {
    symbol,
    side: 'BUY',
    price,
    quantity,
    pnl: 0,
    roi: 0,
    reason: 'BASE_SHARE',
    timestamp: new Date()
  })

  broadcastMarketUpdate(symbol, lastPrices[symbol] || price)
}

// ---------------------------------------------------------------------------
// Sell Base Share (manual action)
// ---------------------------------------------------------------------------
const sellBaseShare = async (symbol: string): Promise<void> => {
  const state = gridState[symbol]
  if (!state) {
    throw new Error(`No base share registered for ${symbol}`)
  }

  const currentPrice = lastPrices[symbol] || state.basePrice
  let fillPrice = currentPrice

  if (currentMode === 'LIVE') {
    const filter = symbolFilters[symbol]
    let qty = roundToStep(state.baseQuantity, filter?.stepSize || 0)
    try {
      const result = await client.newOrder(symbol, 'SELL', 'MARKET', {
        quantity: qty.toString()
      }) as any
      const fills = result.data.fills || []
      if (fills.length > 0) {
        const totalQty = fills.reduce((s: number, f: any) => s + parseFloat(f.qty), 0)
        const totalCost = fills.reduce((s: number, f: any) => s + parseFloat(f.price) * parseFloat(f.qty), 0)
        fillPrice = totalCost / totalQty
        qty = totalQty
      }
      fetchBalances()
    } catch (e: any) {
      console.error(`[SELL BASE FAILED] ${symbol}:`, e.response?.data || e.message)
      throw e
    }
  }

  const pnl = (fillPrice - state.baseEntryCost / state.baseQuantity) * state.baseQuantity
  const roi = (fillPrice - state.baseEntryCost / state.baseQuantity) / (state.baseEntryCost / state.baseQuantity)

  logTrade({
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: state.baseQuantity,
    pnl,
    roi,
    reason: 'MANUAL_BASE_SELL'
  }, currentMode)

  botEvents.emit('trade_executed', {
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: state.baseQuantity,
    pnl,
    roi,
    reason: 'MANUAL_BASE_SELL',
    timestamp: new Date()
  })

  delete gridState[symbol]
  deleteGridState(symbol, currentMode)
  console.log(`[BASE SHARE SOLD] ${symbol}: Sold @ $${fillPrice.toFixed(4)}. PnL: $${pnl.toFixed(4)}`)
  broadcastMarketUpdate(symbol, fillPrice)
}

// ---------------------------------------------------------------------------
// Cancel all open grid levels for a symbol (live cancels on Binance)
// ---------------------------------------------------------------------------
const clearGridLevels = async (symbol: string): Promise<void> => {
  const levels = gridLevels[symbol] || []
  if (currentMode === 'LIVE') {
    for (const level of levels) {
      if (level.binanceSellOrderId) {
        try {
          await client.cancelOrder(symbol, { orderId: level.binanceSellOrderId })
          console.log(`[GRID] Cancelled order ${level.binanceSellOrderId} for ${symbol}`)
        } catch (e: any) {
          console.error(`[GRID] Failed to cancel order ${level.binanceSellOrderId}:`, e.message)
        }
      }
    }
  }
  deleteAllGridLevels(symbol, currentMode)
  gridLevels[symbol] = []
  console.log(`[GRID] Cleared all grid levels for ${symbol}`)
  broadcastMarketUpdate(symbol, lastPrices[symbol] || 0)
}

// ---------------------------------------------------------------------------
// User Data Stream — detect live limit sell fills
// Direct REST + raw WebSocket (bypasses connector's broken listen key path)
// ---------------------------------------------------------------------------

// Post/PUT to Binance REST without the connector (avoids 410 bugs)
// Tries api.binance.com first, then falls back to api.binance.us
const BINANCE_HOSTS = ['api.binance.com', 'api.binance.us']
let activeHost = BINANCE_HOSTS[0]

// Simple unsigned request (userDataStream only needs API key, no signature)
const binanceRestRequestToHost = (
  hostname: string,
  method: 'POST' | 'PUT' | 'DELETE',
  reqPath: string,
  params: Record<string, string> = {}
): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error('No API key'))

    const queryString = Object.keys(params).length
      ? new URLSearchParams(params).toString()
      : ''
    const fullPath = queryString ? `${reqPath}?${queryString}` : reqPath

    const options = {
      hostname,
      port: 443,
      path: fullPath,
      method,
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': 0
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.msg || body}`))
          } else {
            resolve(parsed)
          }
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

const binanceRestRequest = async (
  method: 'POST' | 'PUT' | 'DELETE',
  reqPath: string,
  params: Record<string, string> = {}
): Promise<any> => {
  try {
    const result = await binanceRestRequestToHost(activeHost, method, reqPath, params)
    return result
  } catch (e: any) {
    // Trigger fallback on any 4xx error or HTML response (geo-block returns raw HTML 410)
    const isGeoBlocked = e.message.includes('410')
      || e.message.includes('403')
      || e.message.includes('Gone')
      || e.message.includes('HTTP 4')
    const otherHost = BINANCE_HOSTS.find((h) => h !== activeHost)
    if (otherHost && isGeoBlocked) {
      console.log(`[USER DATA STREAM] ${activeHost} blocked (${e.message.substring(0, 60)}), trying ${otherHost}...`)
      const result = await binanceRestRequestToHost(otherHost, method, reqPath, params)
      activeHost = otherHost // Remember which one works
      console.log(`[USER DATA STREAM] Switched to ${activeHost}.`)
      return result
    }
    throw e
  }
}

const startUserDataStream = async (): Promise<void> => {
  if (!apiKey || !apiSecret) {
    console.log('[USER DATA STREAM] No API credentials — skipping. Fill detection disabled.')
    return
  }

  let listenKey: string
  let udWs: WebSocket | null = null
  let reconnectTimeout: NodeJS.Timeout | null = null
  const isShuttingDown = false

  const connectWS = (key: string): void => {
    if (udWs) {
      try { udWs.terminate() } catch { /* ignore */ }
    }
    const wsUrl = `wss://stream.binance.com:9443/ws/${key}`
    console.log(`[USER DATA STREAM] Connecting to ${wsUrl}`)
    udWs = new WebSocket(wsUrl)

    udWs.on('open', () => {
      console.log('[USER DATA STREAM] Connected. Watching for order fills...')
    })

    udWs.on('message', (raw: WebSocket.RawData) => {
      try {
        const event = JSON.parse(raw.toString())
        if (event.e === 'executionReport' && event.X === 'FILLED' && event.S === 'SELL') {
          const symbol: string = event.s
          const orderId: string = event.i?.toString()
          const fillPrice: number = parseFloat(event.L)
          const levels = gridLevels[symbol] || []
          const matchedLevel = levels.find((l) => l.binanceSellOrderId === orderId)
          if (matchedLevel) {
            console.log(`[USER DATA] Grid sell fill detected for ${symbol} — order ${orderId}`)
            handleGridSellFill(symbol, matchedLevel, fillPrice).catch(console.error)
          }
        }
      } catch { /* ignore */ }
    })

    udWs.on('error', (err) => {
      console.error('[USER DATA STREAM] WebSocket error:', err.message)
    })

    udWs.on('close', (code) => {
      console.log(`[USER DATA STREAM] Disconnected (code: ${code})`)
      if (!isShuttingDown) {
        // Auto-reconnect after 5 seconds
        if (reconnectTimeout) clearTimeout(reconnectTimeout)
        reconnectTimeout = setTimeout(() => {
          console.log('[USER DATA STREAM] Reconnecting...')
          connectWS(listenKey)
        }, 5000)
      }
    })
  }

  try {
    const result = await binanceRestRequest('POST', '/api/v3/userDataStream')
    listenKey = result.listenKey
    if (!listenKey) throw new Error(`No listenKey in response: ${JSON.stringify(result)}`)
    console.log('[USER DATA STREAM] Listen key obtained.')

    connectWS(listenKey)

    // Binance requires a PUT every 29 min to keep the listen key alive
    setInterval(async () => {
      try {
        await binanceRestRequest('PUT', '/api/v3/userDataStream', { listenKey })
        console.log('[USER DATA STREAM] Listen key renewed.')
      } catch (e: any) {
        console.error('[USER DATA STREAM] Failed to renew listen key:', e.message)
        // Re-obtain a fresh listen key and reconnect
        try {
          const fresh = await binanceRestRequest('POST', '/api/v3/userDataStream')
          listenKey = fresh.listenKey
          connectWS(listenKey)
        } catch { /* ignore */ }
      }
    }, 29 * 60 * 1000) // 29 min — slightly before the 30 min timeout
  } catch (e: any) {
    console.error('[USER DATA STREAM] Failed to start:', e.message)
    console.log('[ORDER POLL] Falling back to polling open orders every 60s to detect fills...')
    startOrderPolling()
  }
}

// ---------------------------------------------------------------------------
// Order Polling Fallback — for when User Data Stream is geo-blocked
// Polls Binance every ~60s to check if any pending grid sell orders were filled
// ---------------------------------------------------------------------------
const startOrderPolling = (): void => {
  console.log('[ORDER POLL] Starting order poll fallback (60s interval)')

  setInterval(async () => {
    // Collect all symbols that have pending grid levels with order IDs
    const symbolsToCheck = Object.keys(gridLevels).filter(
      (sym) => gridLevels[sym]?.some((l) => l.binanceSellOrderId)
    )
    if (symbolsToCheck.length === 0) return

    for (const symbol of symbolsToCheck) {
      try {
        const openOrdersRes = await client.openOrders(symbol) as any
        const openOrders: any[] = openOrdersRes.data || []
        const openOrderIds = new Set(openOrders.map((o: any) => o.orderId?.toString()))

        const levels = gridLevels[symbol] || []
        for (const level of [...levels]) {
          if (!level.binanceSellOrderId) continue
          if (!openOrderIds.has(level.binanceSellOrderId)) {
            // Order no longer open — assume it was filled at the sell price
            console.log(`[ORDER POLL] Grid sell likely filled for ${symbol} — order ${level.binanceSellOrderId}`)
            handleGridSellFill(symbol, level, level.sellPrice).catch(console.error)
          }
        }
      } catch {
        // Silently skip — network issues shouldn't spam the log
      }
    }
  }, 60_000)
}

// ---------------------------------------------------------------------------
// WebSocket — Market Price Feed
// ---------------------------------------------------------------------------
const connectWebSocket = (): void => {
  streamGeneration += 1
  const currentGen = streamGeneration

  // Monitor all whitelisted symbols + any with active grid states
  const monitoringSet = new Set([
    ...currentWhitelist,
    ...Object.keys(gridState)
  ])
  const monitoringList = Array.from(monitoringSet).filter(Boolean)
  console.log(`[GEN ${currentGen}] Connecting WebSocket for ${monitoringList.length} symbols: ${monitoringList.join(', ')}`)
  botEvents.emit('monitoring_update', monitoringList)

  if (monitoringList.length === 0) return

  const callbacks = {
    open: () => console.log(`[GEN ${currentGen}] WebSocket connected.`),
    close: () => console.log(`[GEN ${currentGen}] WebSocket closed.`),
    error: (err: any) => console.error(`[GEN ${currentGen}] WebSocket error:`, err),
    message: (data: string) => {
      if (streamGeneration !== currentGen) return
      try {
        const combined = JSON.parse(data)
        const parsed = combined.data ?? combined
        if (parsed.e === 'aggTrade' || parsed.e === 'trade') {
          const symbol = parsed.s
          const price = parseFloat(parsed.p)
          if (!isNaN(price)) processTick(symbol, price)
        }
      } catch { /* ignore */ }
    }
  }

  wsClient = new WebsocketStream({ callbacks })
  const streams = monitoringList.map((sym) => `${sym.toLowerCase()}@aggTrade`)
  streams.forEach((stream) => wsClient.subscribe(stream))
}

// ---------------------------------------------------------------------------
// Reload Whitelist / Reconnect
// ---------------------------------------------------------------------------
const reloadWhitelist = async (newSymbols: string[]): Promise<void> => {
  currentWhitelist = newSymbols.map((s) => (typeof s === 'object' ? (s as any).symbol : s))
  console.log(`[WHITELIST] Reloaded: ${currentWhitelist.join(', ')}`)

  if (wsClient) {
    try {
      if (typeof wsClient.disconnect === 'function') wsClient.disconnect()
      if (wsClient.ws) wsClient.ws.terminate()
    } catch { /* ignore */ }
  }

  await updateFilters()
  connectWebSocket()
}

// ---------------------------------------------------------------------------
// Settings Update
// ---------------------------------------------------------------------------
const updateSettingsLocally = (newSettings: Record<string, string>): void => {
  const oldMode = currentMode
  Object.assign(currentSettings, newSettings)
  currentMode = currentSettings.trading_mode || 'LIVE'

  if (oldMode !== currentMode) {
    console.log(`[BOT] Trading mode switched to: ${currentMode}`)
    // Reload grid state for new mode
    loadBotState()
  }
}

// ---------------------------------------------------------------------------
// Load Persisted State
// ---------------------------------------------------------------------------
const loadBotState = (): void => {
  // Load grid states for current mode
  const savedStates = getGridState(currentMode)
  Object.assign(gridState, savedStates)

  // Clear any states from a different mode
  for (const sym of Object.keys(gridState)) {
    if (!savedStates[sym]) delete gridState[sym]
  }

  // Load active grid levels
  const allLevels = getAllActiveGridLevels(currentMode)
  for (const sym of Object.keys(gridLevels)) gridLevels[sym] = []
  allLevels.forEach((row: any) => {
    if (!gridLevels[row.symbol]) gridLevels[row.symbol] = []
    gridLevels[row.symbol].push({
      id: row.id,
      symbol: row.symbol,
      mode: row.mode,
      buyPrice: row.buy_price,
      sellPrice: row.sell_price,
      quantity: row.quantity,
      cost: row.cost,
      status: 'PENDING_SELL',
      binanceSellOrderId: row.binance_sell_order_id
    })
  })

  console.log(
    `[BOT] Loaded ${Object.keys(gridState).length} base shares and ${allLevels.length} grid levels for ${currentMode} mode.`
  )
}

// ---------------------------------------------------------------------------
// Unrealized PnL (for stats)
// ---------------------------------------------------------------------------
export const getUnrealizedPnl = (): number => {
  let total = 0
  for (const symbol of Object.keys(gridState)) {
    const state = gridState[symbol]
    const price = lastPrices[symbol] || state.basePrice
    total += (price - state.basePrice) * state.baseQuantity
    const levels = gridLevels[symbol] || []
    for (const level of levels) {
      total += (price - level.buyPrice) * level.quantity
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Get Grid State (for IPC)
// ---------------------------------------------------------------------------
export const getFullGridState = (): Record<string, any> => {
  const result: Record<string, any> = {}
  for (const symbol of [...currentWhitelist, ...Object.keys(gridState)]) {
    const state = gridState[symbol]
    const levels = gridLevels[symbol] || []
    const price = lastPrices[symbol] || 0
    result[symbol] = {
      symbol,
      hasBaseShare: !!state,
      basePrice: state?.basePrice,
      baseQuantity: state?.baseQuantity,
      baseEntryCost: state?.baseEntryCost,
      currentPrice: price,
      pctFromBase: state ? ((price - state.basePrice) / state.basePrice) * 100 : null,
      gridLevels: levels,
      totalUnrealizedPnl: state
        ? (price - state.basePrice) * state.baseQuantity +
          levels.reduce((s, l) => s + (price - l.buyPrice) * l.quantity, 0)
        : 0
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Legacy compatibility exports
// ---------------------------------------------------------------------------
export const executeManualTrade = async (symbol: string, side: 'BUY' | 'SELL'): Promise<boolean> => {
  if (side === 'SELL') {
    await sellBaseShare(symbol)
    return true
  }
  // Manual BUY: register as base share using last known price
  const price = lastPrices[symbol]
  if (!price) throw new Error(`No price data available for ${symbol}`)
  const qty = getShareAmount() / price
  await registerBaseShare(symbol, price, qty)
  return true
}

export const getCurrentMode = (): string => currentMode

// Forward-compatible no-ops for removed features
export const reloadDecoupledList = async (): Promise<void> => { /* no-op */ }
export const toggleBotManualMode = async (): Promise<boolean> => true

// ---------------------------------------------------------------------------
// Start Bot
// ---------------------------------------------------------------------------
export const startBot = async (): Promise<void> => {
  if (isBotRunning) {
    console.log('[BOT] Already running.')
    return
  }
  isBotRunning = true
  botStartTime = Date.now()

  await initDb()

  const settings = getSettings()
  Object.assign(currentSettings, settings)
  currentMode = currentSettings.trading_mode || 'LIVE'

  currentWhitelist = getWhitelist()
  console.log(`[BOT] Whitelist: ${currentWhitelist.join(', ')}`)
  console.log(`[BOT] Mode: ${currentMode}, Share: $${getShareAmount()}, Grid Step: ${getGridStep()}%`)

  loadBotState()

  await updateFilters()
  await fetchBalances()

  connectWebSocket()

  // Start User Data Stream for live order fill detection
  if (currentMode === 'LIVE' && apiKey) {
    await startUserDataStream()
  }

  botIntervals.forEach(clearInterval)
  botIntervals = []

  // Refresh balances every 30 seconds
  botIntervals.push(setInterval(fetchBalances, 30 * 1000))

  // Periodic filter refresh (every hour)
  botIntervals.push(setInterval(updateFilters, 60 * 60 * 1000))

  // Market pulse log every minute
  botIntervals.push(setInterval(() => {
    const symbolList = [...new Set([...currentWhitelist, ...Object.keys(gridState)])]
    const summary = symbolList.map((sym) => {
      const price = lastPrices[sym]
      const state = gridState[sym]
      const levels = (gridLevels[sym] || []).length
      if (!price) return `${sym.replace('USDT', '')}: no data`
      const pct = state ? (((price - state.basePrice) / state.basePrice) * 100).toFixed(2) + '%' : 'no base'
      return `${sym.replace('USDT', '')}: $${price.toFixed(4)} (${pct}) [${levels} levels]`
    }).join(' | ')
    console.log(`[MARKET PULSE] ${summary}`)
  }, 60_000))

  console.log('[BOT] Grid DCA Bot started.')
}

// Named exports for IPC compatibility
export {
  reloadWhitelist,
  registerBaseShare,
  sellBaseShare,
  clearGridLevels,
  updateSettingsLocally
}
