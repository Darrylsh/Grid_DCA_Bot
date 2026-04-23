// ---------------------------------------------------------------------------
// Grid Engine for Grid DCA Bot
// ---------------------------------------------------------------------------

import { GridLevel, GridState } from './types'
import {
  getShareAmount,
  getGridStep,
  getCurrentMode,
  getTrailingStopLevels,
  getTrailingStopPct,
  getMaxGridLevels,
  getDynamicGridEnabled,
  getMomentumWindow,
  getMomentumThresholdPct,
  getReboundThresholdPct,
  getDynamicModeTimeoutMs
} from './settings-manager'
import { roundToStep, roundTick } from './utils'
import {
  getClient,
  getFilter,
  getFeeRate,
  fetchBalances,
  cancelOrder,
  balances
} from './exchange-client'
import {
  saveGridLevel,
  logTrade,
  markGridLevelFilled,
  deleteAllGridLevels,
  saveGridState
} from './db'
import { sendTelegramMessage } from './telegram'
import {
  getGridState,
  setGridState,
  getGridLevels,
  setGridLevels,
  clearGridLevels as clearGridLevelsState,
  getLastPrice,
  setLastPrice,
  getTrailingStop,
  setTrailingStop,
  deleteTrailingStop,
  getPriceHistory,
  setPriceHistory,
  getDelayedBuyState,
  setDelayedBuyState,
  deleteDelayedBuyState,
  getLevelCooldown,
  setLevelCooldown,
  getMissedBuyCooldown,
  setMissedBuyCooldown,
  LEVEL_COOLDOWN_MS
} from './state-manager'
import { botEvents, broadcastMarketUpdate } from './bot-events'
import { sellBaseShare } from './trade-executor'

const client = getClient()

// Per-symbol mutex to prevent concurrent processTick execution
const tickLocks: Map<string, Promise<void>> = new Map()

/**
 * Buy a new share and place a limit sell
 */
export const executeGridBuy = async (symbol: string, currentPrice: number): Promise<void> => {
  // Hard guard: re-check max grid levels right before executing
  // This catches races where another tick already started a buy
  const currentLevels = getGridLevels(symbol) as GridLevel[]
  const maxLevels = getMaxGridLevels()
  if (currentLevels.length >= maxLevels) {
    console.log(
      `[GRID BUY GUARD] ${symbol}: Already at max grid levels (${currentLevels.length} >= ${maxLevels}). Aborting buy.`
    )
    return
  }

  const shareAmount = getShareAmount()
  const gridStep = getGridStep()
  const stepMultiplier = gridStep / 100
  const currentMode = getCurrentMode()
  // For LIVE mode, fetch actual balances from exchange
  if (currentMode === 'LIVE') {
    try {
      await fetchBalances()
    } catch (error) {
      console.error(`[GRID] ${symbol}: Failed to fetch balances:`, error)
      // Continue with potentially stale balances
    }
  }

  if (currentMode === 'LIVE' && balances.USDT < shareAmount) {
    console.log(
      `[GRID] ${symbol}: Insufficient USDT (${balances.USDT.toFixed(2)} < ${shareAmount}). Skipping grid buy.`
    )
    const now = Date.now()
    const COOLDOWN_MISSEDBUY = 4 * 60 * 60 * 1000
    if (now - (getMissedBuyCooldown(symbol) || 0) > COOLDOWN_MISSEDBUY) {
      sendTelegramMessage(
        `🚨 Missed Buy (${symbol})\nAttempted grid buy @ $${currentPrice.toFixed(4)}, but USDT balance is too low ($${balances.USDT.toFixed(2)} < $${shareAmount.toFixed(2)}).`
      )
      setMissedBuyCooldown(symbol, now)
    }
    return
  }

  const filter = getFilter(symbol)
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

  console.log(
    `[GRID BUY] ${symbol}: Buying ${quantity.toFixed(6)} @ ~$${currentPrice.toFixed(4)}. Will sell @ $${sellLimitPrice.toFixed(4)} (+${gridStep}%)`
  )

  let binanceSellOrderId: string | undefined

  if (currentMode === 'LIVE') {
    try {
      // Place market buy
      const buyResult = (await client.newOrder(symbol, 'BUY', 'MARKET', {
        quoteOrderQty: shareAmount.toFixed(2)
      })) as any

      // Extract actual fill
      const fills = buyResult.data.fills || []
      if (fills.length > 0) {
        const totalQty = fills.reduce((sum: number, f: any) => sum + parseFloat(f.qty), 0)
        const totalCost = fills.reduce(
          (sum: number, f: any) => sum + parseFloat(f.price) * parseFloat(f.qty),
          0
        )
        buyFillPrice = totalCost / totalQty
        quantity = totalQty
        console.log(
          `[GRID FILL] ${symbol} BUY: ${quantity.toFixed(6)} @ avg $${buyFillPrice.toFixed(6)}`
        )
      }

      // Recalculate sell price based on actual fill
      sellLimitPrice = buyFillPrice * (1 + stepMultiplier)
      if (filter) {
        quantity = roundToStep(quantity, filter.stepSize)
        sellLimitPrice = roundTick(sellLimitPrice, filter.tickSize, 'up')
      }

      // Place GTC limit sell immediately
      try {
        const sellResult = (await client.newOrder(symbol, 'SELL', 'LIMIT', {
          quantity: quantity.toString(),
          price: sellLimitPrice.toFixed(
            filter?.tickSize ? filter.tickSize.toString().split('.')[1]?.length || 2 : 4
          ),
          timeInForce: 'GTC'
        })) as any

        binanceSellOrderId = sellResult.data.orderId?.toString()
        console.log(
          `[GRID SELL ORDER] ${symbol}: GTC SELL placed @ $${sellLimitPrice.toFixed(4)} (orderId: ${binanceSellOrderId})`
        )
      } catch (sellErr: any) {
        console.error(
          `[GRID] Failed to place limit sell for ${symbol}:`,
          sellErr.response?.data || sellErr.message
        )
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
  const levels = getGridLevels(symbol) as GridLevel[]
  const newLevel: GridLevel = {
    id: levelId,
    symbol,
    mode: currentMode,
    buyPrice: buyFillPrice,
    sellPrice: sellLimitPrice,
    quantity,
    cost,
    status: 'PENDING_SELL',
    binanceSellOrderId
  }
  const updatedLevels = [...levels, newLevel]
  setGridLevels(symbol, updatedLevels)

  // Log the buy trade
  await logTrade(
    {
      symbol,
      side: 'BUY',
      price: buyFillPrice,
      quantity,
      pnl: 0,
      roi: 0,
      fee: shareAmount * getFeeRate(currentMode),
      reason: 'GRID_BUY'
    },
    currentMode
  )

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

  broadcastMarketUpdate(symbol, getLastPrice(symbol) || currentPrice)
}

/**
 * Handle a sell fill (from simulation or user data stream)
 */
export const handleGridSellFill = async (
  symbol: string,
  level: GridLevel,
  fillPrice: number
): Promise<void> => {
  const currentMode = getCurrentMode()
  const pnl = (fillPrice - level.buyPrice) * level.quantity
  const roi = (fillPrice - level.buyPrice) / level.buyPrice

  console.log(
    `[GRID SELL FILLED] ${symbol}: Sold ${level.quantity.toFixed(6)} @ $${fillPrice.toFixed(4)}. PnL: $${pnl.toFixed(4)} (${(roi * 100).toFixed(2)}%)`
  )

  await markGridLevelFilled(level.id)

  // Remove from in-memory
  const levels = getGridLevels(symbol) as GridLevel[]
  const updatedLevels = levels.filter((l) => l.id !== level.id)
  setGridLevels(symbol, updatedLevels)

  // Update simulated USDT balance
  if (currentMode === 'SIMULATION') {
    balances.USDT += fillPrice * level.quantity
    botEvents.emit('balance_update', { ...balances })
  }

  await logTrade(
    {
      symbol,
      side: 'SELL',
      price: fillPrice,
      quantity: level.quantity,
      pnl,
      roi,
      fee: fillPrice * level.quantity * getFeeRate(currentMode),
      reason: 'GRID_SELL_FILL'
    },
    currentMode
  )

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

  broadcastMarketUpdate(symbol, getLastPrice(symbol) || fillPrice)
}

/**
 * Core price tick handler
 */
export const processTick = async (symbol: string, currentPrice: number): Promise<void> => {
  // Serialize ticks per-symbol to prevent concurrent grid buys
  const prev = tickLocks.get(symbol) || Promise.resolve()
  let releaseLock: () => void
  const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve })
  tickLocks.set(symbol, lockPromise)
  await prev

  try {
    await processTickInner(symbol, currentPrice)
  } finally {
    releaseLock!()
  }
}

const processTickInner = async (symbol: string, currentPrice: number): Promise<void> => {
  const currentMode = getCurrentMode()
  setLastPrice(symbol, currentPrice)

  // Update price history for momentum detection
  if (getDynamicGridEnabled()) {
    const now = Date.now()
    const windowMs = getMomentumWindow() * 1000 // Convert seconds to ms
    const history = getPriceHistory(symbol)
    history.push({ price: currentPrice, time: now })
    // Prune entries older than the time window (keep a small buffer for edge cases)
    const cutoff = now - windowMs * 1.5
    const pruned = history.filter((p) => p.time >= cutoff)
    setPriceHistory(symbol, pruned)
  }

  const stateOrRecord = getGridState(symbol)
  const levels = getGridLevels(symbol) as GridLevel[]

  // --- SIMULATION: Check if any pending limit sells are now fulfilled ---
  if (currentMode === 'SIMULATION') {
    for (const level of [...levels]) {
      if (currentPrice >= level.sellPrice) {
        handleGridSellFill(symbol, level, level.sellPrice).catch(console.error)
      }
    }
  }

  // No base share registered for this symbol — nothing to do
  if (!stateOrRecord || typeof stateOrRecord !== 'object' || !('basePrice' in stateOrRecord)) {
    broadcastMarketUpdate(symbol, currentPrice)
    return
  }
  const state = stateOrRecord as GridState

  const gridStep = getGridStep()
  const stepMult = gridStep / 100

  // --- TRAILING STOP CHECK ---
  // Fires before UP/DOWN grid logic so a stop hit terminates processing immediately
  {
    const avgEntryPrice = state.baseEntryCost / state.baseQuantity
    const levelsUp = Math.log(currentPrice / avgEntryPrice) / Math.log(1 + stepMult)
    const triggerLevels = getTrailingStopLevels()
    const stopPct = getTrailingStopPct()
    let ts = getTrailingStop(symbol)

    if (levelsUp >= triggerLevels) {
      if (!ts?.armed) {
        // Arm the trail from the current price
        ts = { armed: true, trailHigh: currentPrice, stopPrice: currentPrice * (1 - stopPct) }
        setTrailingStop(symbol, ts)
        console.log(
          `[TRAIL] ${symbol}: ARMED @ $${currentPrice.toFixed(4)} (${levelsUp.toFixed(2)} levels up, stop ${(stopPct * 100).toFixed(2)}% below high)`
        )
      }
      // Update high-water mark if price rises further
      if (currentPrice > ts.trailHigh) {
        ts.trailHigh = currentPrice
        ts.stopPrice = currentPrice * (1 - stopPct)
        console.log(
          `[TRAIL] ${symbol}: High → $${ts.trailHigh.toFixed(4)}, Stop → $${ts.stopPrice.toFixed(4)}`
        )
        setTrailingStop(symbol, ts)
      }
    }

    // CRITICAL: Check stop price SEPARATELY from the arming threshold.
    // The stop must fire even if the price has dropped back below the trigger level.
    if (ts?.armed) {
      if (currentPrice <= ts.stopPrice) {
        console.log(
          `[TRAIL] ${symbol}: STOP HIT @ $${currentPrice.toFixed(4)} (stop was $${ts.stopPrice.toFixed(4)}). Selling base share...`
        )
        deleteTrailingStop(symbol)
        sellBaseShare(symbol, 'TRAIL_STOP_SELL').catch(console.error)
        return // sellBaseShare calls broadcastMarketUpdate internally
      }
    }
  }

  // --- DELAYED BUY REBOUND CHECK ---
  const delayedState = getDelayedBuyState(symbol)
  if (delayedState?.active) {
    // Update lowest price since trigger
    if (currentPrice < delayedState.lowSinceTrigger) {
      delayedState.lowSinceTrigger = currentPrice
      setDelayedBuyState(symbol, delayedState)
    }

    // Check for rebound
    const reboundPrice = delayedState.lowSinceTrigger * (1 + getReboundThresholdPct() / 100)
    if (currentPrice >= reboundPrice) {
      // Verify still below original trigger price
      if (currentPrice <= delayedState.triggerPrice) {
        // Buy at market price
        console.log(`[DYNAMIC] ${symbol}: Rebound detected. Buying at $${currentPrice.toFixed(4)}`)
        if (!state.isPaused && levels.length < getMaxGridLevels()) {
          const cooldownKey = `${symbol}_${currentPrice.toFixed(6)}`
          if (Date.now() - (getLevelCooldown(cooldownKey) || 0) > LEVEL_COOLDOWN_MS) {
            // LEVEL_COOLDOWN_MS
            setLevelCooldown(cooldownKey, Date.now())
            try {
              await executeGridBuy(symbol, currentPrice)
            } catch (e) { console.error(e) }
          }
        }
      } else {
        // Price rebounded above trigger - cancel delay
        console.log(
          `[DYNAMIC] ${symbol}: Rebound above trigger (${currentPrice.toFixed(4)} > ${delayedState.triggerPrice.toFixed(4)}). Canceling delay.`
        )
      }
      deleteDelayedBuyState(symbol)
    }

    // Safety timeout
    if (Date.now() - delayedState.triggeredAt > getDynamicModeTimeoutMs()) {
      console.log(`[DYNAMIC] ${symbol}: Timeout. Resuming normal grid.`)
      deleteDelayedBuyState(symbol)
    }

    // Skip normal grid logic while in delayed mode
    broadcastMarketUpdate(symbol, currentPrice)
    return
  }

  // Determine the reference price for the next buy:
  // The next buy triggers at gridStep% BELOW whichever is lower: basePrice or the lowest current grid level buy
  const lowestLevelBuyPrice = levels.length > 0 ? Math.min(...levels.map((l) => l.buyPrice)) : null
  const referencePrice =
    lowestLevelBuyPrice !== null ? Math.min(state.basePrice, lowestLevelBuyPrice) : state.basePrice
  const nextBuyTrigger = referencePrice * (1 - stepMult)

  // NOTE: Base price no longer ratchets upward. It stays at the original entry.
  // Trailing stop detection uses currentPrice vs avgEntry (above) instead.

  // --- DOWN: Buy a new grid level ---
  const cooldownKey = `${symbol}_${nextBuyTrigger.toFixed(6)}`
  const lastBuy = getLevelCooldown(cooldownKey) || 0
  if (currentPrice <= nextBuyTrigger && Date.now() - lastBuy > LEVEL_COOLDOWN_MS) {
    // LEVEL_COOLDOWN_MS
    if (!state.isPaused) {
      const maxLevels = getMaxGridLevels()
      if (levels.length < maxLevels) {
        // --- DYNAMIC GRID MOMENTUM CHECK ---
        let shouldDelay = false
        if (getDynamicGridEnabled()) {
          const windowSec = getMomentumWindow()
          const windowMs = windowSec * 1000
          const now = Date.now()
          const history = getPriceHistory(symbol)
          // Find the oldest entry within the time window
          const windowStart = now - windowMs
          const inWindow = history.filter((p) => p.time >= windowStart)
          if (inWindow.length >= 2) {
            const oldestPrice = inWindow[0].price
            const newestPrice = inWindow[inWindow.length - 1].price
            const momentumPct = ((newestPrice - oldestPrice) / oldestPrice) * 100
            const threshold = getMomentumThresholdPct()
            if (momentumPct <= threshold) {
              shouldDelay = true
              setDelayedBuyState(symbol, {
                active: true,
                triggerPrice: nextBuyTrigger,
                lowSinceTrigger: currentPrice,
                triggeredAt: Date.now()
              })
              console.log(
                `[DYNAMIC] ${symbol}: Negative momentum ${momentumPct.toFixed(2)}% over ${windowSec}s ≤ ${threshold.toFixed(2)}%. Delaying buy. Watching for rebound.`
              )
            }
          }
        }
        if (!shouldDelay) {
          setLevelCooldown(cooldownKey, Date.now())
          console.log(
            `[GRID DOWN] ${symbol}: Price $${currentPrice.toFixed(4)} hit next buy trigger $${nextBuyTrigger.toFixed(4)} (${gridStep}% below $${referencePrice.toFixed(4)})`
          )
          try {
            await executeGridBuy(symbol, currentPrice)
          } catch (e) { console.error(e) }
        }
      } else {
        console.log(
          `[GRID DOWN LIMIT] ${symbol}: Hit max grid levels (${levels.length} >= ${maxLevels}). Skipping buy.`
        )
      }
    } else {
      console.log(
        `[GRID DOWN PAUSED] ${symbol} hit trigger $${nextBuyTrigger.toFixed(4)} but is paused.`
      )
    }
  }

  broadcastMarketUpdate(symbol, currentPrice)
}

/**
 * Cancel all open grid levels for a symbol (live cancels on Binance)
 */
export const clearGridLevels = async (symbol: string): Promise<void> => {
  const currentMode = getCurrentMode()
  const levels = getGridLevels(symbol) as GridLevel[]
  if (currentMode === 'LIVE') {
    for (const level of levels) {
      if (level.binanceSellOrderId) {
        try {
          await cancelOrder(symbol, level.binanceSellOrderId)
          console.log(`[GRID] Cancelled order ${level.binanceSellOrderId} for ${symbol}`)
        } catch (e: any) {
          console.error(`[GRID] Failed to cancel order ${level.binanceSellOrderId}:`, e.message)
        }
      }
    }
  }
  await deleteAllGridLevels(symbol, currentMode)
  clearGridLevelsState(symbol)
  console.log(`[GRID] Cleared all grid levels for ${symbol}`)
  broadcastMarketUpdate(symbol, getLastPrice(symbol) || 0)
}

/**
 * Sell lowest grid level at market price
 */
export const sellLowestGridLevel = async (symbol: string): Promise<void> => {
  const currentMode = getCurrentMode()
  const levels = getGridLevels(symbol) as GridLevel[]
  if (levels.length === 0) {
    throw new Error(`No grid levels for ${symbol}`)
  }

  // Find lowest sell price (closest target)
  const lowestLevel = [...levels].sort((a, b) => a.sellPrice - b.sellPrice)[0]

  // Cancel Binance limit order if LIVE mode
  if (currentMode === 'LIVE' && lowestLevel.binanceSellOrderId) {
    try {
      await cancelOrder(symbol, lowestLevel.binanceSellOrderId)
      console.log(`[GRID] Cancelled order ${lowestLevel.binanceSellOrderId} for ${symbol}`)
    } catch (e: any) {
      console.error(`[GRID] Failed to cancel order ${lowestLevel.binanceSellOrderId}:`, e.message)
      // Continue anyway, the order might already be filled or cancelled
    }
  }

  // Get current price for market sell
  const currentPrice = getLastPrice(symbol) || lowestLevel.sellPrice
  let fillPrice = currentPrice

  if (currentMode === 'LIVE') {
    const filter = getFilter(symbol)
    const qty = roundToStep(lowestLevel.quantity, filter?.stepSize || 0)
    try {
      const result = (await client.newOrder(symbol, 'SELL', 'MARKET', {
        quantity: qty.toString()
      })) as any
      const fills = result.data.fills || []
      if (fills.length > 0) {
        const totalQty = fills.reduce((s: number, f: any) => s + parseFloat(f.qty), 0)
        const totalCost = fills.reduce(
          (s: number, f: any) => s + parseFloat(f.price) * parseFloat(f.qty),
          0
        )
        fillPrice = totalCost / totalQty
      }
      fetchBalances()
    } catch (marketError: any) {
      console.error(`[GRID SELL FAILED] ${symbol}: Market sell failed:`, marketError.message)
      // Attempt to recreate limit order at original price
      if (currentMode === 'LIVE') {
        try {
          const filter = getFilter(symbol)
          const qty = roundToStep(lowestLevel.quantity, filter?.stepSize || 0)
          const price = roundToStep(lowestLevel.sellPrice, filter?.tickSize || 0)
          const result = (await client.newOrder(symbol, 'SELL', 'LIMIT', {
            quantity: qty.toString(),
            price: price.toString(),
            timeInForce: 'GTC'
          })) as any
          const orderId = result.data.orderId.toString()
          // Update level with new order ID
          const updatedLevels = levels.map((l) =>
            l.id === lowestLevel.id ? { ...l, binanceSellOrderId: orderId } : l
          )
          setGridLevels(symbol, updatedLevels)
          console.log(`[GRID] Re‑created limit sell @ $${price.toFixed(4)} (order ${orderId})`)
        } catch (limitErr: any) {
          console.error(`[GRID] Failed to re‑create limit sell:`, limitErr.message)
        }
      }
    }
  } else {
    // SIMULATION: treat as filled at current price
    fillPrice = currentPrice
  }

  // Handle the fill
  await handleGridSellFill(symbol, lowestLevel, fillPrice)
}

/**
 * Toggle pause state for a symbol
 */
export const togglePause = async (symbol: string): Promise<void> => {
  const stateOrRecord = getGridState(symbol)
  if (!stateOrRecord || typeof stateOrRecord !== 'object' || !('basePrice' in stateOrRecord)) {
    return
  }
  const state = stateOrRecord as GridState
  state.isPaused = !state.isPaused
  setGridState(symbol, state)
  await saveGridState(symbol, state, getCurrentMode())
  broadcastMarketUpdate(symbol, getLastPrice(symbol) || state.basePrice)
  console.log(`[PAUSE TOGGLED] ${symbol}: ${state.isPaused ? 'PAUSED' : 'RESUMED'}`)
}
