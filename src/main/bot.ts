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
import { sendTelegramMessage } from './telegram'

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

interface TrailingStop {
  armed: boolean
  trailHigh: number    // highest price seen since arming
  stopPrice: number    // trailHigh * (1 - stopPct)
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
export const FEE_RATE = 0.001   // Standard fee: 0.1%
const LIVE_FEE_RATE = 0.00075 // BNB Discount: 0.075%
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

// Trailing stop state (in-memory; resets on restart, re-arms automatically if still N levels up)
const trailingStops: Record<string, TrailingStop> = {}

// Telegram Notification Cooldowns
let lastLowBnbNotified = 0
let lastLowUsdtNotified = 0
const missedBuyCooldowns: Record<string, number> = {}

export const botEvents = new EventEmitter()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getGridStep = (): number => {
  const step = parseFloat(currentSettings.grid_step_percent || '3')
  return isNaN(step) || step <= 0 ? 3 : step
}

const getTrailingStopLevels = (): number => {
  const v = parseInt(currentSettings.trailing_stop_levels || '3')
  return isNaN(v) || v <= 0 ? 3 : v
}

// Returns the trailing stop retracement as a decimal (e.g. 0.01 for 1%)
const getTrailingStopPct = (): number => {
  const frac = parseFloat(currentSettings.trailing_stop_pct || '0.5')
  return (getGridStep() * (isNaN(frac) || frac <= 0 ? 0.5 : frac)) / 100
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

    // Telegram Alerts for low balances (6 hour cooldown)
    const now = Date.now()
    const COOLDOWN_6H = 6 * 60 * 60 * 1000
    if (balances.BNB < 0.015 && currentMode === 'LIVE') {
      if (now - lastLowBnbNotified > COOLDOWN_6H) {
        sendTelegramMessage(`⚠️ Low BNB Balance\nYour BNB is at ${balances.BNB.toFixed(4)}, which is less than 0.015. Please top up for fees!`)
        lastLowBnbNotified = now
      }
    }

    const shareAmt = getShareAmount()
    if (balances.USDT < shareAmt && currentMode === 'LIVE') {
      if (now - lastLowUsdtNotified > COOLDOWN_6H) {
        sendTelegramMessage(`⚠️ Low USDT Balance\nYour USDT is at $${balances.USDT.toFixed(2)}, which is below your share size of $${shareAmt.toFixed(2)}.`)
        lastLowUsdtNotified = now
      }
    }
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
    const now = Date.now()
    const COOLDOWN_1H = 60 * 60 * 1000
    if (now - (missedBuyCooldowns[symbol] || 0) > COOLDOWN_1H) {
      sendTelegramMessage(`🚨 Missed Buy (${symbol})\nAttempted grid buy @ $${currentPrice.toFixed(4)}, but USDT balance is too low ($${balances.USDT.toFixed(2)} < $${shareAmount.toFixed(2)}).`)
      missedBuyCooldowns[symbol] = now
    }
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
  const levelId = await saveGridLevel({
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
  await logTrade({
    symbol,
    side: 'BUY',
    price: buyFillPrice,
    quantity,
    pnl: 0,
    roi: 0,
    fee: shareAmount * LIVE_FEE_RATE,
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
    timestamp: Date.now()
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

  await markGridLevelFilled(level.id)

  // Remove from in-memory
  if (gridLevels[symbol]) {
    gridLevels[symbol] = gridLevels[symbol].filter((l) => l.id !== level.id)
  }

  // Update simulated USDT balance
  if (currentMode === 'SIMULATION') {
    balances.USDT += fillPrice * level.quantity
    botEvents.emit('balance_update', { ...balances })
  }

  await logTrade({
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: level.quantity,
    pnl,
    roi,
    fee: fillPrice * level.quantity * LIVE_FEE_RATE,
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
    timestamp: Date.now()
  })

  broadcastMarketUpdate(symbol, lastPrices[symbol] || fillPrice)
}

// ---------------------------------------------------------------------------
// Core Price Tick Handler
// ---------------------------------------------------------------------------
const processTick = async (symbol: string, currentPrice: number): Promise<void> => {
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

  // --- TRAILING STOP CHECK ---
  // Fires before UP/DOWN grid logic so a stop hit terminates processing immediately
  {
    const avgEntry = state.baseEntryCost > 0
      ? state.baseEntryCost / state.baseQuantity
      : state.basePrice
    const levelsUp = Math.log(state.basePrice / avgEntry) / Math.log(1 + stepMult)
    const triggerLevels = getTrailingStopLevels()
    const stopPct = getTrailingStopPct()
    let ts = trailingStops[symbol]

    if (levelsUp >= triggerLevels) {
      if (!ts?.armed) {
        // Arm the trail from the current price (re-arms on restart too)
        ts = { armed: true, trailHigh: currentPrice, stopPrice: currentPrice * (1 - stopPct) }
        trailingStops[symbol] = ts
        console.log(`[TRAIL] ${symbol}: ARMED @ $${currentPrice.toFixed(4)} (${levelsUp.toFixed(2)} levels up, stop ${(stopPct * 100).toFixed(2)}% below high)`)
      }
      // Update high-water mark if price rises further
      if (currentPrice > ts.trailHigh) {
        ts.trailHigh = currentPrice
        ts.stopPrice = currentPrice * (1 - stopPct)
        console.log(`[TRAIL] ${symbol}: High → $${ts.trailHigh.toFixed(4)}, Stop → $${ts.stopPrice.toFixed(4)}`)
      }
      // Fire if price drops to or below the stop
      if (currentPrice <= ts.stopPrice) {
        console.log(`[TRAIL] ${symbol}: STOP HIT @ $${currentPrice.toFixed(4)} (stop was $${ts.stopPrice.toFixed(4)}). Selling base share...`)
        delete trailingStops[symbol]
        sellBaseShare(symbol, 'TRAIL_STOP_SELL').catch(console.error)
        return // sellBaseShare calls broadcastMarketUpdate internally
      }
    } else if (ts?.armed) {
      // Fell back below trigger threshold (e.g. manual base change) — disarm
      delete trailingStops[symbol]
      console.log(`[TRAIL] ${symbol}: Disarmed (levels up ${levelsUp.toFixed(2)} < threshold ${triggerLevels})`)
    }
  }

  // Determine the reference price for the next buy:
  // The next buy triggers at gridStep% BELOW whichever is lower: basePrice or the lowest current grid level buy
  const lowestLevelBuyPrice = levels.length > 0
    ? Math.min(...levels.map((l) => l.buyPrice))
    : null
  const referencePrice = lowestLevelBuyPrice !== null
    ? Math.min(state.basePrice, lowestLevelBuyPrice)
    : state.basePrice
  const nextBuyTrigger = referencePrice * (1 - stepMult)

  // --- UP: Move base price up, no trade ---
  if (currentPrice >= state.basePrice * (1 + stepMult)) {
    const oldBase = state.basePrice
    const newBase = currentPrice
    state.basePrice = newBase
    await saveGridState(symbol, state, currentMode)
    console.log(`[GRID UP] ${symbol}: Base price moved from $${oldBase.toFixed(4)} → $${newBase.toFixed(4)} (+${gridStep}%). No trade.`)
    broadcastMarketUpdate(symbol, currentPrice)
    return
  }

  // --- DOWN: Buy a new grid level ---
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

  // Unrealized PnL from base share — based on true entry cost, not the floating base price
  let baseUnrealizedPnl = 0
  let baseUnrealizedRoi = 0
  if (state) {
    // FALLBACK: If cost/quantity was missing from DB migration, estimate it from share amount
    const entryCost = state.baseEntryCost > 0 ? state.baseEntryCost : getShareAmount()
    const entryQty = state.baseQuantity > 0 ? state.baseQuantity : entryCost / state.basePrice
    
    const avgEntryPrice = entryCost / entryQty
    baseUnrealizedPnl = (currentPrice - avgEntryPrice) * entryQty
    baseUnrealizedRoi = (currentPrice - avgEntryPrice) / avgEntryPrice
  }

  // Unrealized PnL from grid levels
  const gridUnrealizedPnl = levels.reduce((sum, l) => {
    return sum + (currentPrice - l.buyPrice) * l.quantity
  }, 0)

  // Active Share PnL: the PnL of the active position vs its CURRENT reference price.
  // - If grid levels exist: measure vs the lowest (most recent) grid buy price.
  // - If no grid levels: measure vs the current floating base price (ratcheted up with price).
  //   This way, if price rises 3% and base moves up, Current PNL shows ~$0, not the full gain
  //   from original entry (that lives in Total PNL / baseUnrealizedPnl).
  let activeSharePnl: number | null = null
  if (state) {
    if (levels.length > 0) {
      const lowestLevel = [...levels].sort((a, b) => a.buyPrice - b.buyPrice)[0]
      activeSharePnl = (currentPrice - lowestLevel.buyPrice) * lowestLevel.quantity
    } else {
      // Use the current floating base price as the reference, not the original entry cost
      activeSharePnl = (currentPrice - state.basePrice) * state.baseQuantity
    }
  }

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
    activeSharePnl,
    totalUnrealizedPnl: baseUnrealizedPnl + gridUnrealizedPnl,
    botStartTime,
    hasBaseShare: !!state,
    // Trailing stop state for UI display
    trailActive: trailingStops[symbol]?.armed ?? false,
    trailHigh: trailingStops[symbol]?.trailHigh ?? null,
    trailStopPrice: trailingStops[symbol]?.stopPrice ?? null
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
  // price=0 / qty=0 means "use the capital allocation setting at current price"
  const useCapitalAlloc = price === 0 && quantity === 0
  const shareAmount = getShareAmount()

  let fillPrice = price
  let fillQuantity = quantity

  if (currentMode === 'LIVE') {
    console.log(`[BASE SHARE] ${symbol}: Executing real MARKET BUY order...`)
    try {
      // If called via one-click, use quoteOrderQty to spend exactly $shareAmount
      const orderParams = useCapitalAlloc
        ? { quoteOrderQty: shareAmount.toString() }
        : { quantity: quantity.toString() }

      const result = await client.newOrder(symbol, 'BUY', 'MARKET', orderParams) as any

      const fills = result.data.fills || []
      if (fills.length > 0) {
        const totalQty = fills.reduce((sum: number, f: any) => sum + parseFloat(f.qty), 0)
        const totalCost = fills.reduce((sum: number, f: any) => sum + parseFloat(f.price) * parseFloat(f.qty), 0)
        fillPrice = totalCost / totalQty
        fillQuantity = totalQty
        console.log(`[BASE SHARE] ${symbol}: Market buy filled @ avg $${fillPrice.toFixed(4)}, qty: ${fillQuantity.toFixed(6)}`)
      }
      fetchBalances()
    } catch (e: any) {
      console.error(`[BASE SHARE FAILED] ${symbol}:`, e.response?.data || e.message)
      throw e // Re-throw to inform the UI of the failure
    }
  } else {
    // SIMULATION mode: auto-calculate from current price if 0/0
    if (useCapitalAlloc) {
      fillPrice = lastPrices[symbol] || 0
      fillQuantity = fillPrice > 0 ? shareAmount / fillPrice : 0
    }
  }

  const cost = fillPrice * fillQuantity
  gridState[symbol] = { basePrice: fillPrice, baseQuantity: fillQuantity, baseEntryCost: cost }
  await saveGridState(symbol, gridState[symbol], currentMode)

  console.log(`[BASE SHARE] ${symbol}: Registered base share @ $${fillPrice.toFixed(4)}, qty: ${fillQuantity.toFixed(6)}, cost: $${cost.toFixed(2)}`)

  await logTrade({
    symbol,
    side: 'BUY',
    price: fillPrice,
    quantity: fillQuantity,
    pnl: 0,
    roi: 0,
    fee: cost * LIVE_FEE_RATE,
    reason: 'BASE_SHARE'
  }, currentMode)

  botEvents.emit('trade_executed', {
    symbol,
    side: 'BUY',
    price: fillPrice,
    quantity: fillQuantity,
    pnl: 0,
    roi: 0,
    reason: 'BASE_SHARE',
    timestamp: Date.now()
  })

  broadcastMarketUpdate(symbol, lastPrices[symbol] || fillPrice)
}

// ---------------------------------------------------------------------------
// Sell Base Share (manual action)
// ---------------------------------------------------------------------------
const sellBaseShare = async (symbol: string, reason: string = 'MANUAL_BASE_SELL'): Promise<void> => {
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

  await logTrade({
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: state.baseQuantity,
    pnl,
    roi,
    fee: fillPrice * state.baseQuantity * LIVE_FEE_RATE,
    reason
  }, currentMode)

  botEvents.emit('trade_executed', {
    symbol,
    side: 'SELL',
    price: fillPrice,
    quantity: state.baseQuantity,
    pnl,
    roi,
    reason,
    timestamp: Date.now()
  })

  delete gridState[symbol]
  await deleteGridState(symbol, currentMode)
  console.log(`[BASE SHARE SOLD] ${symbol}: Sold @ $${fillPrice.toFixed(4)}. PnL: $${pnl.toFixed(4)}`)
  broadcastMarketUpdate(symbol, fillPrice)
}

// ---------------------------------------------------------------------------
// Delete Base Share record (locally only, no trade)
// ---------------------------------------------------------------------------
export const deleteBaseShareLocally = (symbol: string): void => {
  delete gridState[symbol]
  delete trailingStops[symbol] // clear any active trail
  console.log(`[BASE SHARE] ${symbol}: Local record deleted.`)
  broadcastMarketUpdate(symbol, lastPrices[symbol] || 0)
}

export const wipeAllDataLocally = (): void => {
  for (const symbol in gridState) {
    delete gridState[symbol]
  }
  for (const symbol in gridLevels) {
    gridLevels[symbol] = []
  }
  // Clear all trailing stops
  for (const symbol in trailingStops) {
    delete trailingStops[symbol]
  }
  console.log(`[BOT] All grid state, grid levels, and trailing stops cleared from memory.`)
  // Notify UI
  const allSymbols = new Set([...Object.keys(lastPrices), ...Object.keys(gridState)])
  allSymbols.forEach((symbol) => {
    broadcastMarketUpdate(symbol, lastPrices[symbol] || 0)
  })
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
  await deleteAllGridLevels(symbol, currentMode)
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
let lastMessageTime = 0
let watchdogInterval: NodeJS.Timeout | null = null

const startWatchdog = async (): Promise<void> => {
  if (watchdogInterval) clearInterval(watchdogInterval)
  watchdogInterval = setInterval(async () => {
    // Determine if we have anything to monitor
    const whitelist = await getWhitelist()
    const activeGridSymbols = Object.keys(gridState)
    if (whitelist.length === 0 && activeGridSymbols.length === 0) return

    // If no message for 45 seconds, restart the stream
    const staleTime = Date.now() - lastMessageTime
    if (lastMessageTime > 0 && staleTime > 45_000) {
      console.warn(`[WATCHDOG] WebSocket stale (no message for ${Math.round(staleTime / 1000)}s). Restarting...`)
      await connectWebSocket()
    }
  }, 15_000)
}

const connectWebSocket = async (): Promise<void> => {
  streamGeneration += 1
  const currentGen = streamGeneration

  const whitelist = await getWhitelist()
  // Monitor all whitelisted symbols + any with active grid states
  const monitoringSet = new Set([
    ...whitelist,
    ...Object.keys(gridState)
  ])
  const monitoringList = Array.from(monitoringSet).filter(Boolean)
  console.log(`[GEN ${currentGen}] Connecting WebSocket for ${monitoringList.length} symbols: ${monitoringList.join(', ')}`)
  botEvents.emit('monitoring_update', monitoringList)

  if (monitoringList.length === 0) return

  const callbacks = {
    open: () => {
      console.log(`[GEN ${currentGen}] WebSocket connected.`)
      lastMessageTime = Date.now() // Initialize heartbeat
      startWatchdog()
    },
    close: () => console.log(`[GEN ${currentGen}] WebSocket closed.`),
    error: (err: any) => console.error(`[GEN ${currentGen}] WebSocket error:`, err),
    message: (data: string) => {
      if (streamGeneration !== currentGen) return
      lastMessageTime = Date.now() // Update heartbeat
      try {
        const combined = JSON.parse(data)
        const parsed = combined.data ?? combined
        if (parsed.e === 'aggTrade' || parsed.e === 'trade' || parsed.e === '24hrTicker') {
          const symbol = parsed.s
          // 'p' is for trade/aggTrade, 'c' is for 24hrTicker
          const priceStr = parsed.c || parsed.p
          const price = parseFloat(priceStr)
          if (!isNaN(price)) processTick(symbol, price).catch(console.error)
        }
      } catch { /* ignore */ }
    }
  }

  if (wsClient) {
    try {
      wsClient.terminate()
    } catch { /* ignore */ }
  }

  wsClient = new WebsocketStream({ callbacks })
  const streams = monitoringList.map((sym) => `${sym.toLowerCase()}@ticker`)
  streams.forEach((stream) => {
    wsClient.subscribe(stream)
  })
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
  await connectWebSocket()
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
    loadBotState().catch(console.error)
  }
}

// ---------------------------------------------------------------------------
// Load Persisted State
// ---------------------------------------------------------------------------
const loadBotState = async (): Promise<void> => {
  // Load grid states for current mode
  const savedStates = await getGridState(currentMode)
  Object.assign(gridState, savedStates)

  // Clear any states from a different mode
  for (const sym of Object.keys(gridState)) {
    if (!savedStates[sym]) delete gridState[sym]
  }

  // Load active grid levels
  const allLevels = await getAllActiveGridLevels(currentMode)
  for (const sym of Object.keys(gridLevels)) gridLevels[sym] = []
  allLevels.forEach((row: any) => {
    if (!gridLevels[row.symbol]) gridLevels[row.symbol] = []
    gridLevels[row.symbol].push({
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
    // Use true cost basis (original entry price), not the floating grid reference.
    // The floating basePrice ratchets up as price rises, which would make profitable
    // positions appear as losses once price dips below the new grid reference.
    const avgEntry = state.baseEntryCost > 0
      ? state.baseEntryCost / state.baseQuantity
      : state.basePrice
    total += (price - avgEntry) * state.baseQuantity
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

  const settings = await getSettings()
  Object.assign(currentSettings, settings)
  currentMode = currentSettings.trading_mode || 'LIVE'

  currentWhitelist = await getWhitelist()
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

  // Telegram Notifications for Trades
  botEvents.on('trade_executed', (data: any) => {
    const sideStr = data.side === 'BUY' ? '🟢 BOUGHT' : '🔴 SOLD'
    const icon = data.side === 'BUY' ? '🛒' : '💰'
    
    let msg = `${icon} ${sideStr} ${data.symbol}\n`
    msg += `Price: $${data.price.toFixed(4)}\n`
    msg += `Quantity: ${data.quantity.toFixed(6)}\n`
    
    if (data.side === 'SELL') {
      msg += `Profit: $${data.pnl.toFixed(4)} (${(data.roi * 100).toFixed(2)}%)\n`
    }
    
    msg += `Mode: ${currentMode} | Reason: ${data.reason}`
    
    sendTelegramMessage(msg)
  })

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
