// ---------------------------------------------------------------------------
// Trade Executor for Grid DCA Bot
// ---------------------------------------------------------------------------

import { getShareAmount, getCurrentMode } from './settings-manager'
import { GridState } from './types'
import { getClient, getFilter, fetchBalances, getFeeRate } from './exchange-client'
import { saveGridState, logTrade } from './db'
import {
  getGridState,
  setGridState,
  getLastPrice,
  deleteTrailingStop,
  deleteGridState,
  clearGridLevels as clearGridLevelsState
} from './state-manager'
import { roundToStep, safeDivide, getAvgEntryPrice } from './utils'
import { botEvents, broadcastMarketUpdate } from './bot-events'

const client = getClient()

/**
 * Register Base Share (called from UI / manual trade)
 */
export const registerBaseShare = async (
  symbol: string,
  price: number,
  quantity: number
): Promise<void> => {
  const currentMode = getCurrentMode()
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

      const result = (await client.newOrder(symbol, 'BUY', 'MARKET', orderParams)) as any

      const fills = result.data.fills || []
      if (fills.length > 0) {
        const totalQty = fills.reduce((sum: number, f: any) => sum + parseFloat(f.qty), 0)
        const totalCost = fills.reduce(
          (sum: number, f: any) => sum + parseFloat(f.price) * parseFloat(f.qty),
          0
        )
        fillPrice = totalCost / totalQty
        fillQuantity = totalQty
        console.log(
          `[BASE SHARE] ${symbol}: Market buy filled @ avg $${fillPrice.toFixed(4)}, qty: ${fillQuantity.toFixed(6)}`
        )
      }
      fetchBalances()
    } catch (e: any) {
      console.error(`[BASE SHARE FAILED] ${symbol}:`, e.response?.data || e.message)
      throw e // Re-throw to inform the UI of the failure
    }
  } else {
    // SIMULATION mode: auto-calculate from current price if 0/0
    if (useCapitalAlloc) {
      fillPrice = getLastPrice(symbol) || 0
      fillQuantity = fillPrice > 0 ? shareAmount / fillPrice : 0
    }
  }

  const cost = fillPrice * fillQuantity
  const state = {
    basePrice: fillPrice,
    baseQuantity: fillQuantity,
    baseEntryCost: cost,
    isPaused: false
  }
  setGridState(symbol, state)
  await saveGridState(symbol, state, currentMode)

  console.log(
    `[BASE SHARE] ${symbol}: Registered base share @ $${fillPrice.toFixed(4)}, qty: ${fillQuantity.toFixed(6)}, cost: $${cost.toFixed(2)}`
  )

  await logTrade(
    {
      symbol,
      side: 'BUY',
      price: fillPrice,
      quantity: fillQuantity,
      pnl: 0,
      roi: 0,
      fee: cost * getFeeRate(currentMode),
      reason: 'BASE_SHARE'
    },
    currentMode
  )

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

  // Reset trailing stop for this symbol on new base
  deleteTrailingStop(symbol)

  broadcastMarketUpdate(symbol, getLastPrice(symbol) || fillPrice)
}

/**
 * Sell Base Share (manual action)
 */
export const sellBaseShare = async (
  symbol: string,
  reason: string = 'MANUAL_BASE_SELL'
): Promise<void> => {
  const currentMode = getCurrentMode()
  const stateOrRecord = getGridState(symbol)
  if (
    !stateOrRecord ||
    typeof stateOrRecord !== 'object' ||
    !('basePrice' in stateOrRecord) ||
    !('baseQuantity' in stateOrRecord)
  ) {
    throw new Error(`No base share registered for ${symbol}`)
  }
  const state: GridState = stateOrRecord as GridState

  const currentPrice = getLastPrice(symbol) || state.basePrice
  let fillPrice = currentPrice

  if (currentMode === 'LIVE') {
    const filter = getFilter(symbol)
    let qty = roundToStep(state.baseQuantity, filter?.stepSize || 0)
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
        qty = totalQty
      }
      fetchBalances()
    } catch (e: any) {
      console.error(`[SELL BASE FAILED] ${symbol}:`, e.response?.data || e.message)
      throw e
    }
  }

  const avgEntryPrice = getAvgEntryPrice(state)
  const pnl = (fillPrice - avgEntryPrice) * state.baseQuantity
  const roi = safeDivide(
    fillPrice - avgEntryPrice,
    avgEntryPrice,
    0,
    `sellBaseShare ROI for ${symbol}`
  )

  await logTrade(
    {
      symbol,
      side: 'SELL',
      price: fillPrice,
      quantity: state.baseQuantity,
      pnl,
      roi,
      fee: fillPrice * state.baseQuantity * getFeeRate(currentMode),
      reason
    },
    currentMode
  )

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

  // Delete grid state and trailing stop
  deleteGridState(symbol)
  clearGridLevelsState(symbol)
  deleteTrailingStop(symbol)

  broadcastMarketUpdate(symbol, fillPrice)
}

/**
 * Execute Manual Trade (IPC compatibility)
 */
export const executeManualTrade = async (
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  price: number
): Promise<void> => {
  const currentMode = getCurrentMode()
  console.log(`[MANUAL TRADE] ${symbol} ${side} ${quantity} @ ${price} (${currentMode})`)

  if (currentMode === 'LIVE') {
    const filter = getFilter(symbol)
    const qty = roundToStep(quantity, filter?.stepSize || 0)
    const px = roundToStep(price, filter?.tickSize || 0)

    try {
      const result = (await client.newOrder(symbol, side, 'LIMIT', {
        quantity: qty.toString(),
        price: px.toString(),
        timeInForce: 'GTC'
      })) as any
      console.log(`[MANUAL TRADE] Order placed:`, result.data)
    } catch (e: any) {
      console.error(`[MANUAL TRADE FAILED] ${symbol}:`, e.response?.data || e.message)
      throw e
    }
  } else {
    // SIMULATION: just log
    console.log(`[MANUAL TRADE SIM] ${symbol} ${side} ${quantity} @ ${price}`)
  }
}
