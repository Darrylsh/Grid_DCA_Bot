// ---------------------------------------------------------------------------
// Exchange Client for Binance API
// ---------------------------------------------------------------------------

import * as path from 'path'
import * as dotenv from 'dotenv'
import { Spot } from '@binance/connector'
import { EventEmitter } from 'events'
import { sendTelegramMessage } from './telegram'
import { getShareAmount, getCurrentMode } from './settings-manager'
import { Filter } from './types'

dotenv.config({ path: path.join(__dirname, '../../.env') })

const apiKey = process.env['BINANCE_API_KEY']
const apiSecret = process.env['BINANCE_API_SECRET']
const baseURL = process.env['BINANCE_HOST'] ? `https://${process.env['BINANCE_HOST']}` : undefined
console.log(`[EXCHANGE] API key present: ${!!apiKey}, baseURL: ${baseURL || 'default'}`)
const client = apiKey
  ? new Spot(apiKey, apiSecret, { baseURL })
  : new Spot(undefined, undefined, { baseURL })

// Exchange lot/tick size filters
let symbolFilters: Record<string, Filter> = {}

// Balances
export const FEE_RATE = 0.001 // Standard fee: 0.1%
export const LIVE_FEE_RATE = 0.00075 // BNB Discount: 0.075%
export const balances: Record<string, number> = { USDT: 0, BNB: 0 }

// Telegram Notification Cooldowns
let lastLowBnbNotified = 0
let lastLowUsdtNotified = 0

// Event emitter for balance updates (will be set by bot-core)
let balanceEventEmitter: EventEmitter | null = null

/**
 * Set the event emitter for balance updates
 */
export const setBalanceEventEmitter = (emitter: EventEmitter): void => {
  balanceEventEmitter = emitter
}

/**
 * Get Binance client instance
 */
export const getClient = (): Spot => client

/**
 * Get API key (for checking if live trading is enabled)
 */
export const getApiKey = (): string | undefined => apiKey

/**
 * Get API secret (for checking if live trading is enabled)
 */
export const getApiSecret = (): string | undefined => apiSecret

/**
 * Get filter for a symbol
 */
export const getFilter = (symbol: string): Filter | undefined => symbolFilters[symbol]

/**
 * Get all symbol filters
 */
export const getAllFilters = (): Record<string, Filter> => ({ ...symbolFilters })

/**
 * Update exchange filters from Binance API
 */
export const updateFilters = async (): Promise<void> => {
  if (!apiKey) return
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('exchangeInfo timeout')), 10000)
    )
    const response = (await Promise.race([client.exchangeInfo(), timeout])) as any
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
    console.log(
      `[FILTERS] Updated exchange filters for ${Object.keys(symbolFilters).length} symbols.`
    )
  } catch (e: any) {
    console.error('[FILTERS] Failed to update exchange filters:', e.message)
  }
}

/**
 * Fetch balances from Binance API
 */
export const fetchBalances = async (): Promise<void> => {
  if (!apiKey || !apiSecret) return
  try {
    const response = (await client.account()) as any
    const usdt = response.data.balances.find((b: any) => b.asset === 'USDT')
    const bnb = response.data.balances.find((b: any) => b.asset === 'BNB')
    balances.USDT = parseFloat(usdt?.free || '0')
    balances.BNB = parseFloat(bnb?.free || '0')

    // Emit balance update event if emitter is set
    if (balanceEventEmitter) {
      balanceEventEmitter.emit('balance_update', { ...balances })
    }

    // Telegram Alerts for low balances (6 hour cooldown)
    const now = Date.now()
    const COOLDOWN_6H = 6 * 60 * 60 * 1000
    const currentMode = getCurrentMode()

    if (balances.BNB < 0.015 && currentMode === 'LIVE') {
      if (now - lastLowBnbNotified > COOLDOWN_6H) {
        sendTelegramMessage(
          `⚠️ Low BNB Balance\nYour BNB is at ${balances.BNB.toFixed(4)}, which is less than 0.015. Please top up for fees!`
        )
        lastLowBnbNotified = now
      }
    }

    const shareAmt = getShareAmount()
    if (balances.USDT < shareAmt && currentMode === 'LIVE') {
      if (now - lastLowUsdtNotified > COOLDOWN_6H) {
        sendTelegramMessage(
          `⚠️ Low USDT Balance\nYour USDT is at $${balances.USDT.toFixed(2)}, which is below your share size of $${shareAmt.toFixed(2)}.`
        )
        lastLowUsdtNotified = now
      }
    }
  } catch (e: any) {
    console.error('[BALANCE] Failed to fetch balances:', e.message)
    console.error('[BALANCE] Error details:', e.response?.data || e.response || e)
  }
}

/**
 * Get current fee rate based on mode
 */
export const getFeeRate = (mode: string = 'LIVE'): number => {
  return mode === 'LIVE' ? LIVE_FEE_RATE : FEE_RATE
}

/**
 * Place a buy order
 */
export const placeBuyOrder = async (
  symbol: string,
  quantity: number,
  price: number,
  mode: string
): Promise<any> => {
  if (mode !== 'LIVE' || !apiKey) {
    // Simulated execution for backtest mode
    return { status: 'FILLED', executedQty: quantity.toString(), price: price.toString() }
  }

  try {
    const order = await client.newOrder(symbol, 'BUY', 'LIMIT', {
      price: price.toString(),
      quantity: quantity.toString(),
      timeInForce: 'GTC'
    })
    return order.data
  } catch (error: any) {
    console.error(`[EXCHANGE] Buy order failed for ${symbol}:`, error.message)
    throw error
  }
}

/**
 * Place a sell order
 */
export const placeSellOrder = async (
  symbol: string,
  quantity: number,
  price: number,
  mode: string
): Promise<any> => {
  if (mode !== 'LIVE' || !apiKey) {
    // Simulated execution for backtest mode
    return { status: 'FILLED', executedQty: quantity.toString(), price: price.toString() }
  }

  try {
    const order = await client.newOrder(symbol, 'SELL', 'LIMIT', {
      price: price.toString(),
      quantity: quantity.toString(),
      timeInForce: 'GTC'
    })
    return order.data
  } catch (error: any) {
    console.error(`[EXCHANGE] Sell order failed for ${symbol}:`, error.message)
    throw error
  }
}

/**
 * Cancel an order
 */
export const cancelOrder = async (symbol: string, orderId: string): Promise<void> => {
  if (!apiKey) return
  try {
    await client.cancelOrder(symbol, { orderId })
  } catch (error: any) {
    console.error(`[EXCHANGE] Cancel order failed for ${symbol}:`, error.message)
  }
}
