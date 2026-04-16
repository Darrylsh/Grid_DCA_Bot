// ---------------------------------------------------------------------------
// Bot Events Manager for Grid DCA Bot
// ---------------------------------------------------------------------------

import { EventEmitter } from 'events'
import { GridState, GridLevel } from './types'
import { getGridStep } from './settings-manager'
import { safeDivide, getAvgEntryPrice } from './utils'
import { getGridState, getGridLevels, getTrailingStop, getBotStartTime } from './state-manager'

export const botEvents = new EventEmitter()

/**
 * Broadcast market update with full symbol state
 */
export const broadcastMarketUpdate = (symbol: string, currentPrice: number): void => {
  const state = getGridState(symbol) as GridState | undefined
  const levels = getGridLevels(symbol) as GridLevel[]
  const gridStep = getGridStep()

  let pctFromBase: number | null = null
  if (state) {
    pctFromBase =
      safeDivide(currentPrice - state.basePrice, state.basePrice, 0, `pctFromBase for ${symbol}`) *
      100
  }

  // Percentage to next grid sell level
  let pctToGrid: number | null = null
  if (levels.length > 0) {
    const nextSell = levels
      .map((l) => l.sellPrice)
      .filter((sellPrice) => sellPrice > currentPrice)
      .sort((a, b) => a - b)[0]
    if (nextSell) {
      pctToGrid = ((nextSell - currentPrice) / currentPrice) * 100
    }
  }

  // Unrealized PnL from base share — based on true entry cost, not the floating base price
  let baseUnrealizedPnl = 0
  let baseUnrealizedRoi = 0
  if (state) {
    const avgEntryPrice = getAvgEntryPrice(state)
    // Use actual base quantity; if 0 (corrupted), PnL is 0
    const baseQty = state.baseQuantity > 0 ? state.baseQuantity : 0
    baseUnrealizedPnl = (currentPrice - avgEntryPrice) * baseQty
    baseUnrealizedRoi = safeDivide(
      currentPrice - avgEntryPrice,
      avgEntryPrice,
      0,
      `broadcastMarketUpdate ROI for ${symbol}`
    )
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

  // Debug log for market updates (only for symbols with base share)
  if (state) {
    console.log(
      `[MARKET UPDATE] ${symbol}: $${currentPrice.toFixed(4)}, base: $${state.basePrice.toFixed(4)}, levels: ${levels.length}`
    )
  }

  botEvents.emit('market_update', {
    symbol,
    currentPrice,
    basePrice: state?.basePrice ?? null,
    baseQuantity: state?.baseQuantity ?? null,
    baseEntryCost: state?.baseEntryCost ?? null,
    pctFromBase,
    pctToGrid,
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
    botStartTime: getBotStartTime(),
    hasBaseShare: !!state,
    isPaused: state?.isPaused ?? false,
    // Trailing stop state for UI display
    trailActive: getTrailingStop(symbol)?.armed ?? false,
    trailHigh: getTrailingStop(symbol)?.trailHigh ?? null,
    trailStopPrice: getTrailingStop(symbol)?.stopPrice ?? null
  })
}
