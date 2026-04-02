// @ts-nocheck
// backtest.ts — Grid DCA Bot Backtest Engine
// Uses 1-minute OHLCV candles, fetches from Binance and caches in SQLite.
import { Spot } from '@binance/connector'
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '../../.env') })

import { saveCandleBatch, getCachedCandles, getEarliestCachedCandle, getLatestCachedCandle } from './db'

const apiKey = process.env['BINANCE_API_KEY']
const apiSecret = process.env['BINANCE_API_SECRET']
const client = apiKey ? new Spot(apiKey, apiSecret) : new Spot()

// ---------------------------------------------------------------------------
// Candle Fetching & Caching
// ---------------------------------------------------------------------------

/**
 * Fetch 1-minute Binance klines in pages of 1000 and store them in SQLite.
 * Skips any candles already in the cache.
 */
const fetchAndCacheCandles = async (
  symbol: string,
  startMs: number,
  endMs: number,
  onProgress?: (msg: string) => void
): Promise<void> => {
  const PAGE_SIZE = 1000 // Binance max
  const ONE_MIN_MS = 60 * 1000

  let cursor = startMs
  let totalFetched = 0

  while (cursor < endMs) {
    const pageEnd = Math.min(cursor + PAGE_SIZE * ONE_MIN_MS, endMs)

    try {
      const response = await client.klines(symbol, '1m', {
        startTime: cursor,
        endTime: pageEnd,
        limit: PAGE_SIZE
      })

      const klines = response.data
      if (!klines || klines.length === 0) break

      const candles = klines.map((k) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }))

      saveCandleBatch(symbol, candles)
      totalFetched += candles.length

      const lastCandle = klines[klines.length - 1]
      cursor = lastCandle[0] + ONE_MIN_MS

      onProgress?.(`Fetching ${symbol}: ${totalFetched} candles (${new Date(cursor).toLocaleDateString()})`)

      // Throttle slightly to avoid Binance rate limits
      await new Promise((r) => setTimeout(r, 100))
    } catch (e: any) {
      console.error(`[BACKTEST] Failed to fetch candles for ${symbol}:`, e.message)
      break
    }
  }

  if (totalFetched > 0) {
    console.log(`[BACKTEST] Fetched and cached ${totalFetched} candles for ${symbol}`)
  }
}

/**
 * Ensure candle data exists in cache for the given range.
 * Fills any gaps by fetching from Binance API.
 */
const ensureCandleData = async (
  symbol: string,
  startMs: number,
  endMs: number,
  onProgress?: (msg: string) => void
): Promise<void> => {
  const earliest = getEarliestCachedCandle(symbol)
  const latest = getLatestCachedCandle(symbol)

  let needsFetch = false
  let fetchStart = startMs
  let fetchEnd = endMs

  if (earliest === null || latest === null) {
    // No data at all
    needsFetch = true
  } else {
    if (startMs < earliest) {
      needsFetch = true
      fetchEnd = Math.min(endMs, earliest - 1)
    }
    if (endMs > latest + 60_000) {
      needsFetch = true
      fetchStart = Math.max(startMs, latest + 60_000)
      fetchEnd = endMs
    }
  }

  if (needsFetch) {
    onProgress?.(`Downloading ${symbol} candle data from Binance...`)
    await fetchAndCacheCandles(symbol, fetchStart, fetchEnd, onProgress)
  }
}

// ---------------------------------------------------------------------------
// Backtest Engine
// ---------------------------------------------------------------------------

/**
 * Run a Grid DCA backtest using 1-minute candles.
 *
 * Strategy simulation:
 * - Starts with a virtual base share at the OPEN of the first candle.
 * - Walks through each 1m candle. Uses the LOW to check for buy triggers
 *   and the HIGH to check for pending sell fills within a candle.
 * - +gridStep%: moves base price up (no trade)
 * - -gridStep%: buys a new grid level, places virtual sell at +gridStep%
 * - Any pending sell hit by the candle HIGH → filled at the sell price
 */
export async function runBacktest(
  symbol: string,
  startDate: string,
  endDate: string,
  initialEquity: number,
  gridStepPercent: number,
  onUpdate?: (progress: number, results: any) => void
): Promise<any> {
  const gridStep = (gridStepPercent ?? 3) / 100
  // Per user's design: fixed amount = one share cost
  const shareCost = initialEquity // The initial equity IS the share amount

  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate + 'T23:59:59Z').getTime()

  console.log(
    `[BACKTEST] ${symbol} | ${startDate} → ${endDate} | Share: $${shareCost} | Grid: ${gridStepPercent}%`
  )

  // ---- 1. Ensure candle data is available ----
  await ensureCandleData(symbol, startMs, endMs, (msg) => {
    onUpdate?.(0, { status: 'fetching', message: msg })
  })

  const candles = getCachedCandles(symbol, startMs, endMs)
  if (!candles || candles.length === 0) {
    return { error: `No candle data found for ${symbol} in the selected range.` }
  }

  console.log(`[BACKTEST] Running simulation on ${candles.length} 1m candles...`)

  // ---- 2. Initialize simulation state ----
  let totalSpent = 0       // Total USDT invested (all buys)
  let totalRecovered = 0   // Total USDT recovered from sells (net of sell fee)
  let realizedCost = 0     // Cost of ONLY the levels that have actually been sold
  const FEE_RATE = 0.001   // 0.1% Binance fee (each side)

  // Base share: bought at open of first candle
  const firstCandle = candles[0]
  const baseEntryPrice = firstCandle.open
  const baseQty = shareCost / baseEntryPrice * (1 - FEE_RATE)
  const baseCost = shareCost
  totalSpent += shareCost

  let basePrice = baseEntryPrice // Reference price (moves up)
  const trades: any[] = [{
    side: 'BUY',
    price: baseEntryPrice,
    quantity: baseQty,
    cost: baseCost,
    fee: baseCost * FEE_RATE,
    timestamp: new Date(firstCandle.open_time).toISOString(),
    reason: 'BASE_SHARE',
    pnl: null,
    roi: null
  }]

  // Grid levels: { id, buyPrice, sellPrice, qty, cost, status }
  let nextLevelId = 1
  const pendingLevels: any[] = []
  let gridLevelCount = 0
  let totalFeesPaid = baseCost * FEE_RATE

  const chartData: { t: number; p: number }[] = []
  const totalCandles = candles.length
  const CHART_SAMPLE = Math.max(1, Math.floor(totalCandles / 1500))
  let lastChartSample = 0

  // Track looping
  let lastProgressReport = 0

  // ---- 3. Walk candles ----
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const { open_time, high, low, close } = candle

    // Progress chart sampling
    if (i - lastChartSample >= CHART_SAMPLE) {
      chartData.push({ t: open_time, p: close })
      lastChartSample = i
    }

    if (i % 5000 === 0) await new Promise((r) => setTimeout(r, 0))

    // ---- Check if pending limit sells are hit by this candle's HIGH ----
    for (const level of [...pendingLevels]) {
      if (high >= level.sellPrice) {
        // Fill the sell at the limit price
        const fillPrice = level.sellPrice
        const proceeds = fillPrice * level.qty
        const fee = proceeds * FEE_RATE
        // grossPnl: sell proceeds minus what we spent to buy (buy fee already baked into qty)
        const grossPnl = proceeds - level.cost
        const netPnl = grossPnl - fee  // only deduct sell-side fee here
        const roi = (fillPrice - level.buyPrice) / level.buyPrice

        totalRecovered += proceeds - fee
        realizedCost += level.cost  // track cost of completed (sold) levels only
        totalFeesPaid += fee

        trades.push({
          side: 'SELL',
          price: fillPrice,
          quantity: level.qty,
          cost: level.cost,
          fee,
          timestamp: new Date(open_time).toISOString(),
          reason: 'GRID_SELL_FILL',
          pnl: netPnl,
          roi,
          levelId: level.id
        })

        pendingLevels.splice(pendingLevels.indexOf(level), 1)
      }
    }

    // ---- Determine the reference price for next buy trigger ----
    // Next buy triggers at gridStep% below the lowest of: basePrice, lowest pending level buy price
    const lowestLevelBuy = pendingLevels.length > 0
      ? Math.min(...pendingLevels.map((l) => l.buyPrice))
      : null
    const referencePrice = lowestLevelBuy !== null
      ? Math.min(basePrice, lowestLevelBuy)
      : basePrice
    const nextBuyTrigger = referencePrice * (1 - gridStep)

    // ---- Check UP: base price steps up in discrete gridStep increments ----
    // Don't jump to the raw high — step up once per candle if threshold crossed
    if (high >= basePrice * (1 + gridStep)) {
      // Step base price up by exactly one gridStep from its current value
      basePrice = basePrice * (1 + gridStep)
    }

    // ---- Check DOWN: new grid buy if LOW hit the trigger ----
    if (low <= nextBuyTrigger) {
      // Buy at the trigger price (simulate limit buy)
      const buyPrice = nextBuyTrigger
      const buyFee = shareCost * FEE_RATE
      const qty = (shareCost / buyPrice) * (1 - FEE_RATE)
      const sellTarget = buyPrice * (1 + gridStep)
      const levelId = nextLevelId++

      totalSpent += shareCost
      totalFeesPaid += buyFee
      gridLevelCount++

      pendingLevels.push({
        id: levelId,
        buyPrice,
        sellPrice: sellTarget,
        qty,
        cost: shareCost,
        status: 'PENDING'
      })

      trades.push({
        side: 'BUY',
        price: buyPrice,
        quantity: qty,
        cost: shareCost,
        fee: buyFee,
        timestamp: new Date(open_time).toISOString(),
        reason: 'GRID_BUY',
        pnl: null,
        roi: null,
        levelId
      })
    }

    // ---- Streaming progress update (every 10%) ----
    const progress = Math.round((i / totalCandles) * 100)
    if (progress >= lastProgressReport + 10 && onUpdate) {
      lastProgressReport = progress

      const currentPrice = close
      const unrealizedBase = (currentPrice - baseEntryPrice) * baseQty
      const unrealizedLevels = pendingLevels.reduce(
        (sum, l) => sum + (currentPrice - l.buyPrice) * l.qty, 0
      )
      const totalUnrealized = unrealizedBase + unrealizedLevels
      // Realized PnL = profit from completed sells only (never negative if sells are at +gridStep%)
      const realizedPnl = totalRecovered - realizedCost
      const sellTrades = trades.filter((t) => t.side === 'SELL')

      onUpdate(progress, {
        symbol,
        gridStep: gridStepPercent,
        shareAmount: shareCost,
        totalTrades: sellTrades.length,
        gridLevelCount,
        pendingLevels: pendingLevels.length,
        totalSpent,
        totalRecovered,
        realizedPnl,
        unrealizedPnl: totalUnrealized,
        totalFees: totalFeesPaid,
        totalPnl: realizedPnl + totalUnrealized,
        trades: [...trades],
        chartData: [...chartData],
        finalEquity: shareCost + realizedPnl + totalUnrealized,
        totalRoi: (realizedPnl + totalUnrealized) / shareCost,
        winRate: sellTrades.length > 0
          ? (sellTrades.filter((t) => t.pnl > 0).length / sellTrades.length) * 100
          : 0,
        range: {
          start: new Date(candles[0].open_time).toISOString(),
          end: new Date(candle.open_time).toISOString(),
          candlesProcessed: i + 1
        }
      })
    }
  }

  // Ensure last candle is in chart data
  const lastCandle = candles[candles.length - 1]
  chartData.push({ t: lastCandle.open_time, p: lastCandle.close })

  // ---- 4. Final Results ----
  const finalPrice = lastCandle.close
  const unrealizedBase = (finalPrice - baseEntryPrice) * baseQty
  const unrealizedLevels = pendingLevels.reduce(
    (sum, l) => sum + (finalPrice - l.buyPrice) * l.qty, 0
  )
  const totalUnrealized = unrealizedBase + unrealizedLevels
  // Realized PnL = profit from completed sells only (never negative if sells are at +gridStep%)
  const realizedPnl = totalRecovered - realizedCost
  const sellTrades = trades.filter((t) => t.side === 'SELL')
  const winTrades = sellTrades.filter((t) => t.pnl > 0)

  const results = {
    symbol,
    gridStep: gridStepPercent,
    shareAmount: shareCost,
    totalTrades: sellTrades.length,
    gridLevelCount,
    pendingLevels: pendingLevels.length,
    totalSpent,
    totalRecovered,
    realizedPnl,
    unrealizedPnl: totalUnrealized,
    totalFees: totalFeesPaid,
    totalPnl: realizedPnl + totalUnrealized,
    finalEquity: shareCost + realizedPnl + totalUnrealized,
    totalRoi: (realizedPnl + totalUnrealized) / shareCost,
    winRate: sellTrades.length > 0 ? (winTrades.length / sellTrades.length) * 100 : 0,
    trades,
    chartData,
    range: {
      start: new Date(candles[0].open_time).toISOString(),
      end: new Date(lastCandle.open_time).toISOString(),
      candlesProcessed: candles.length
    }
  }

  onUpdate?.(100, results)
  return results
}
