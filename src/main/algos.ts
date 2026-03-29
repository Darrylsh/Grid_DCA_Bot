// const { ... } = require('./db');
// Not required in this file directly if memory serves, let's just make sure we don't have .js
// Shared engine: market regime filtering, trailing profit targets, volume confirmation.
// Strategy configs live in strategies/ — add new strategies there, not here.

import STRATEGIES from './strategies/index'

export interface StrategyConfig {
  VOLUME_MULTIPLIER: number
  BULL_THRESH: number
  BEAR_THRESH: number
  BTC_STRENGTH_THRESHOLD: number
  TRAIL_ACTIVATION: number
  TRAIL_DELTA: number
  HARD_STOP: number
  MID_TRAIL_ACTIVATION: number
  MID_TRAIL_DELTA: number
  HEADROOM_REQUIRED: number
  HISTORY_LENGTH: number
  MICRO_SHORT: number
  MICRO_LONG: number
  MACRO_SHORT: number
  MACRO_LONG: number
  SWING_WINDOW: number
  ATR_CANDLE_PERIOD: number
  ATR_BASELINE: number
  SLOPE_THRESH: number
  BOUNCE_PROXIMITY: number
  COOLDOWN_MS: number
  MAX_RSI: number
  SLIPPAGE_TOLERANCE: number
  VOLUME_CAP_MULT: number
  Z_SCORE_LIMIT?: number
  MOMENTUM_MIN?: number
  OBI_MIN?: number
  ATR_STOP_MULTIPLIER?: number
  TECHNICAL_EXIT?: boolean
  BREAKEVEN_PROTECTION?: number
  DISABLE_ATR_SCALING?: boolean
  atrMultiplier?: number
  BOX_BUY_ZONE?: number
  BOX_SELL_ZONE?: number
}

class RegimeFilter {
  data: Record<string, { price: number; volume: number; dailyVolume: number }[]>
  sums: Record<string, { price: number; volume: number; vwapNum: number }>
  windowSums: Record<string, Record<number, number>>
  windowSqSums: Record<string, Record<number, number>>
  windowVolSums: Record<string, Record<number, number>>
  returns: Record<string, number[]>
  orderBooks: Record<string, { bidQty: number; askQty: number }>
  offsets: Record<string, number>
  lastCapLog?: number

  constructor() {
    this.data = {} // symbol -> [{ price, volume, dailyVolume }]
    this.sums = {} // { symbol: { price, volume, vwapNum } }

    // windowSum map: symbol -> { [windowSize]: sumOfPrices }
    this.windowSums = {} // { symbol: { size: sumOfPrice } }
    this.windowSqSums = {} // { symbol: { size: sumOfPriceSquared } }
    this.windowVolSums = {} // { symbol: { size: sumOfVolume } }

    this.returns = {} // symbol -> [float] (last 60 returns)
    this.orderBooks = {} // symbol -> { bidQty, askQty }

    // Start index pointers to avoid Array.shift() O(n) penalty
    this.offsets = {}
  }

  updateOrderBook(symbol: string, bidQty: number, askQty: number): void {
    this.orderBooks[symbol] = { bidQty, askQty }
  }

  addTick(
    symbol: string,
    price: number,
    dailyVolume: number,
    historyLength = 14400,
    directVolume: number | null = null,
    volumeCapMult = 0
  ): void {
    if (!this.data[symbol]) {
      this.data[symbol] = []
      this.sums[symbol] = { price: 0, volume: 0, vwapNum: 0 }
      this.windowSums[symbol] = {}
      this.windowSqSums[symbol] = {}
      this.windowVolSums[symbol] = {}
      this.returns[symbol] = []
      this.offsets[symbol] = 0
    }

    let tickVolume = 0
    if (directVolume !== null) {
      tickVolume = directVolume
    } else if (this.data[symbol].length > this.offsets[symbol]) {
      const lastData = this.data[symbol][this.data[symbol].length - 1]
      tickVolume = lastData.dailyVolume > 0 ? dailyVolume - lastData.dailyVolume : 0
      if (tickVolume < 0) tickVolume = 0

      // Track returns for autocorrelation (simple % change)
      const ret = (price - lastData.price) / lastData.price
      this.returns[symbol].push(ret)
      if (this.returns[symbol].length > 120) this.returns[symbol].shift() // Keep enough for lag-1
    }

    // Fat-Finger Volume Guard: Cap outliers based on 5-minute historical average.
    // We use the 300-tick (5m) window as a baseline for "normal" volatility.
    if (volumeCapMult > 0 && this.windowVolSums[symbol][300] !== undefined) {
      const effectiveLen = this.data[symbol].length - this.offsets[symbol]
      const avgVol = this.windowVolSums[symbol][300] / Math.min(effectiveLen, 300)
      const cap = avgVol * volumeCapMult

      if (avgVol > 0 && tickVolume > cap) {
        // If the bot hasn't already logged this symbol recently, log the clipping
        if (!this.lastCapLog || Date.now() - this.lastCapLog > 10000) {
          console.log(
            `[VOLUME GUARD] ${symbol}: Clipping outlier trade (${tickVolume.toFixed(2)} -> ${cap.toFixed(2)}).`
          )
          this.lastCapLog = Date.now()
        }
        tickVolume = cap
      }
    }

    const newTick = { price, volume: tickVolume, dailyVolume: dailyVolume || 0 }
    this.data[symbol].push(newTick)
    const currentLen = this.data[symbol].length

    // Update Global Running Sums
    const s = this.sums[symbol]
    s.price += price
    s.volume += tickVolume
    s.vwapNum += price * tickVolume

    // Update specific window sums (Hardcoded loop for performance)
    const w = this.windowSums[symbol]
    const w2 = this.windowSqSums[symbol]
    const wv = this.windowVolSums[symbol]
    const sizes = [60, 300, 900, 3600, 14400, 86400]
    const effectiveLen = currentLen - this.offsets[symbol]

    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i]
      if (!w[size]) w[size] = 0
      if (!w2[size]) w2[size] = 0
      if (!wv[size]) wv[size] = 0

      w[size] += price
      w2[size] += price * price
      wv[size] += tickVolume

      if (effectiveLen > size) {
        const removedIdx = currentLen - size - 1
        if (removedIdx >= 0) {
          const oldPrice = this.data[symbol][removedIdx].price
          w[size] -= oldPrice
          w2[size] -= oldPrice * oldPrice
          wv[size] -= this.data[symbol][removedIdx].volume
        }
      }
    }

    // Logical shift
    if (effectiveLen > historyLength) {
      const offset = this.offsets[symbol]
      const removed = this.data[symbol][offset]
      s.price -= removed.price
      s.volume -= removed.volume
      s.vwapNum -= removed.price * removed.volume
      this.offsets[symbol]++

      // Periodic physical compaction (every 10k items) to prevent infinite growth
      if (this.offsets[symbol] > 10000) {
        this.data[symbol] = this.data[symbol].slice(this.offsets[symbol])
        this.offsets[symbol] = 0
      }
    }
  }

  getHistory(symbol: string): { price: number; volume: number; dailyVolume: number }[] {
    if (!this.data[symbol]) return []
    const offset = this.offsets[symbol] || 0
    if (offset === 0) return this.data[symbol]
    return this.data[symbol].slice(offset)
  }

  // Determine Regime: returns { micro, macro, zScore, autocorrelation, obi }
  getRegime(
    symbol: string,
    config: StrategyConfig = STRATEGIES.SNIPER as StrategyConfig
  ): {
    micro: string
    macro: string
    zScore: number
    autocorrelation: number
    obi: number
    macroDiff?: number
    isBouncing?: boolean
    atr?: number
  } {
    const history = this.data[symbol]
    const offset = this.offsets[symbol] || 0
    const effectiveLen = (history ? history.length : 0) - offset

    if (!history || effectiveLen < config.MICRO_SHORT)
      return { micro: 'UNKNOWN', macro: 'UNKNOWN', zScore: 0, autocorrelation: 0, obi: 0 }

    const currentPrice = history[history.length - 1].price
    const sums = this.sums[symbol]
    const w = this.windowSums[symbol]
    const w2 = this.windowSqSums[symbol]

    // 1. Calculate Micro Regime (O(1) using window sums)
    const microShortSize = config.MICRO_SHORT
    const microLongSize = config.MICRO_LONG

    const microShortSum = w[microShortSize] || 0
    const microLongSum = w[microLongSize] || 0
    const microShortVolSum = this.windowVolSums[symbol][microShortSize] || 0
    const microLongVolSum = this.windowVolSums[symbol][microLongSize] || 0

    const microShortMA = microShortSum / Math.min(effectiveLen, microShortSize)
    const microLongMA = microLongSum / Math.min(effectiveLen, microLongSize)
    const microDiff = (microShortMA - microLongMA) / microLongMA

    // --- NEW: Z-Score (Calculated over Micro window) ---
    const n = Math.min(effectiveLen, microShortSize)
    const sumX = w[microShortSize] || 0
    const sumX2 = w2[microShortSize] || 0
    const mean = sumX / n
    const variance = sumX2 / n - mean * mean
    const stdDev = Math.sqrt(Math.max(0, variance))
    const zScore = stdDev > 0 ? (currentPrice - mean) / stdDev : 0

    // --- NEW: Autocorrelation (Lag-1) ---
    let autocorrelation = 0
    const rets = this.returns[symbol] || []
    if (rets.length > 30) {
      // Simple Pearson correlation for lag-1
      const x = rets.slice(0, -1)
      const y = rets.slice(1)
      const n_corr = x.length
      const mu_x = x.reduce((a, b) => a + b, 0) / n_corr
      const mu_y = y.reduce((a, b) => a + b, 0) / n_corr
      let num = 0,
        denX = 0,
        denY = 0
      for (let i = 0; i < n_corr; i++) {
        const dx = x[i] - mu_x
        const dy = y[i] - mu_y
        num += dx * dy
        denX += dx * dx
        denY += dy * dy
      }
      autocorrelation = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0
    }

    // --- NEW: Order Book Imbalance (OBI) ---
    let obi = 0
    const ob = this.orderBooks[symbol]
    if (ob && ob.bidQty + ob.askQty > 0) {
      obi = (ob.bidQty - ob.askQty) / (ob.bidQty + ob.askQty)
    }

    // Calculate MA Slope (velocity of the short MA)
    let microSlope = 0.0001
    if (effectiveLen > microShortSize + 10) {
      const pNow = microShortMA
      const olderSlice = history.slice(-(microShortSize + 10), -10)
      const olderSum = olderSlice.reduce((sum, t) => sum + t.price, 0)
      const pOld = olderSum / (olderSlice.length || 1)
      microSlope = (pNow - pOld) / pOld
    }

    let micro = 'SIDEWAYS'
    const requiredSlope = config.SLOPE_THRESH || 0.00005
    const volMult = config.VOLUME_MULTIPLIER || 1.0

    if (microDiff > config.BULL_THRESH && microSlope > requiredSlope) {
      const shortVolMA = microShortVolSum / Math.min(effectiveLen, microShortSize)
      const longVolMA = microLongVolSum / Math.min(effectiveLen, microLongSize)
      const hasVolume = shortVolMA >= longVolMA * volMult

      const vwap = sums.volume > 0 ? sums.vwapNum / sums.volume : currentPrice
      const priceAboveVwap = currentPrice > vwap
      const priceIsClimbing = currentPrice >= microShortMA
      micro = priceAboveVwap && priceIsClimbing && hasVolume ? 'BULL' : 'SIDEWAYS'
    } else if (microDiff < config.BEAR_THRESH) {
      micro = 'BEAR'
    }

    if (micro !== 'BULL' && microDiff < 0 && microSlope > 0) {
      micro = 'RECOVERY'
    }

    // 2. Calculate Macro Regime (O(1))
    if (effectiveLen < config.MACRO_SHORT)
      return { micro, macro: micro, zScore, autocorrelation, obi }

    const macroShortSum = w[config.MACRO_SHORT] || microLongSum
    const macroLongSum = w[config.MACRO_LONG] || 0

    const macroShortMA = macroShortSum / Math.min(effectiveLen, config.MACRO_SHORT)
    const macroLongMA = macroLongSum / Math.min(effectiveLen, config.MACRO_LONG)
    const macroDiff = (macroShortMA - macroLongMA) / macroLongMA

    const vwap = sums.volume > 0 ? sums.vwapNum / sums.volume : macroLongMA
    const priceVsVwap = (currentPrice - vwap) / vwap

    let macro = 'SIDEWAYS'
    if (macroDiff > 0.001 && priceVsVwap > 0) macro = 'BULL'
    else if (macroDiff < -0.001 && priceVsVwap < 0) macro = 'BEAR'

    let isBouncing = false
    const bounceProximity = config.BOUNCE_PROXIMITY || 0.01
    const distFromMacroLongMA = (macroLongMA - currentPrice) / (macroLongMA || 1)
    if (
      distFromMacroLongMA >= 0 &&
      distFromMacroLongMA <= bounceProximity &&
      microSlope > 0 &&
      macro !== 'BEAR'
    ) {
      isBouncing = true
    }

    const atr = calculateATR(history.slice(offset), config.ATR_CANDLE_PERIOD || 900) || 0

    return { micro, macro, macroDiff, isBouncing, zScore, autocorrelation, obi, atr }
  }
}

// Scalper's Pivot Trailing Take-Profit Logic (3-Phase Hybrid + New Safeties)
const checkTrailingStop = (
  currentPrice: number,
  entryPrice: number,
  highWaterMark: number,
  config: StrategyConfig | undefined,
  boxBounds: { low: number; high: number } | null = null,
  atr: number = 0,
  currentRegime: string = 'UNKNOWN'
): { shouldSell: boolean; reason?: string } => {
  if (!config) return { shouldSell: false, reason: 'CONFIG_MISSING' }
  const currentRoi = (currentPrice - entryPrice) / entryPrice
  const highRoi = (highWaterMark - entryPrice) / entryPrice
  const isBoxStrategy = boxBounds && boxBounds.high > 0

  // BOX STRATEGY EXIT: Sell if we hit the top zone of the previous day's box
  if (isBoxStrategy && config.BOX_SELL_ZONE) {
    const boxRange = boxBounds.high - boxBounds.low
    const pricePosition = (currentPrice - boxBounds.low) / boxRange
    if (pricePosition >= config.BOX_SELL_ZONE) {
      return { shouldSell: true, reason: `BOX_TOP_REACHED (${(pricePosition * 100).toFixed(1)}%)` }
    }
  }

  if (!entryPrice) return { shouldSell: false }

  // --- NEW: Technical Exit (Trend Flip) ---
  // Exit if the fast regime turned BEAR or RECOVERY (if we are in a loss)
  if (config.TECHNICAL_EXIT) {
    if (currentRegime === 'BEAR' || (currentRegime === 'RECOVERY' && currentRoi < -0.01)) {
      return { shouldSell: true, reason: `TECHNICAL_EXIT (${currentRegime})` }
    }
  }

  // --- NEW: Break-Even Protection ---
  // Once we hit the trigger (e.g. +1%), the stop moves to entry.
  // If we dip below 0.1% profit after hitting trigger, exit.
  if (config.BREAKEVEN_PROTECTION && highRoi >= config.BREAKEVEN_PROTECTION) {
    if (currentRoi < 0.001) {
      return { shouldSell: true, reason: 'BREAKEVEN_PROTECTION' }
    }
  }

  // --- NEW: Volatility-Adjusted Stop (ATR) ---
  // Exit if price drops more than X * ATR from the high water mark
  if (config.ATR_STOP_MULTIPLIER && atr > 0) {
    const atrDistance = atr * config.ATR_STOP_MULTIPLIER
    if (currentRoi < highRoi - atrDistance) {
      return { shouldSell: true, reason: `ATR_STOP (${(atrDistance * 100).toFixed(2)}%)` }
    }
  }

  // Profit-Protected Trailing: If the strategy is a "Hold" strategy (deep hard stop),
  // ensure trailing stops only trigger if the trade is NET profitable after fees.
  const isHoldStrategy = config.HARD_STOP <= -0.2
  const FEE_BREAKEVEN = 0.002 // 0.1% buy + 0.1% sell round-trip
  const isBelowBreakeven = currentRoi < FEE_BREAKEVEN

  // === Phase 3: Tight Trail ===
  if (highRoi >= config.TRAIL_ACTIVATION) {
    if (isHoldStrategy && isBelowBreakeven) return { shouldSell: false }

    const delta = config.TRAIL_DELTA
    if (currentRoi <= highRoi - delta) {
      return { shouldSell: true, reason: 'TRAIL_STOP' }
    }
    return { shouldSell: false }
  }

  // === Phase 2: Protective Wide Trail ===
  if (config.MID_TRAIL_ACTIVATION && highRoi >= config.MID_TRAIL_ACTIVATION) {
    if (isHoldStrategy && isBelowBreakeven) return { shouldSell: false }

    if (currentRoi <= highRoi - config.MID_TRAIL_DELTA) {
      return { shouldSell: true, reason: 'MID_TRAIL_STOP' }
    }
    return { shouldSell: false }
  }

  // === Phase 1: Fixed Hard Floor ===
  if (currentRoi <= config.HARD_STOP) {
    return { shouldSell: true, reason: 'HARD_STOP' }
  }

  return { shouldSell: false }
}

// Detect nearest swing high resistance level above current price
// Scans the tick history for local price peaks, clusters nearby ones, and returns
// the nearest cluster above the current price. Returns null if no clear resistance found.
const detectResistance = (
  history: { price: number }[],
  currentPrice: number,
  config: StrategyConfig = STRATEGIES.SNIPER as StrategyConfig
): number | null => {
  if (!history || history.length < config.SWING_WINDOW * 2) return null // Need enough data

  const SWING_WINDOW = config.SWING_WINDOW // Number of ticks each side that must be lower for a peak
  const CLUSTER_THRESHOLD = 0.002 // Peaks within 0.2% are grouped into the same zone

  // Find local swing highs
  const peaks: number[] = []
  for (let i = SWING_WINDOW; i < history.length - SWING_WINDOW; i++) {
    const price = history[i].price
    let isPeak = true
    for (let j = i - SWING_WINDOW; j <= i + SWING_WINDOW; j++) {
      if (j !== i && history[j].price >= price) {
        isPeak = false
        break
      }
    }
    if (isPeak) peaks.push(price)
  }

  if (peaks.length === 0) return null

  // Cluster nearby peaks (within 0.2% of each other)
  const clusters: { level: number; count: number }[] = []
  peaks.forEach((p) => {
    const existing = clusters.find((c) => Math.abs(c.level - p) / c.level < CLUSTER_THRESHOLD)
    if (existing) {
      existing.count++
      existing.level = (existing.level * (existing.count - 1) + p) / existing.count // rolling avg
    } else {
      clusters.push({ level: p, count: 1 })
    }
  })

  // Find the nearest resistance zone that is ABOVE the current price
  const nearestResistance = clusters
    .filter((c) => c.level > currentPrice)
    .sort((a, b) => a.level - b.level)[0]

  return nearestResistance ? nearestResistance.level : null
}

// Market Entry Condition Helper
const shouldEnter = (
  symbol: string,
  regime: string,
  isBNB: boolean,
  btcRegime: string,
  whitelist: (string | { symbol: string })[] = [],
  history: { price: number }[] | null = null,
  currentPrice: number = 0,
  btcMacroDiff: number = 0,
  config: StrategyConfig = STRATEGIES.SNIPER as StrategyConfig,
  macroRegime: string = 'UNKNOWN',
  isDecoupled: boolean = false,
  skipResistance: boolean = false,
  rsi: number | null = null,
  boxBounds: { low: number; high: number } | null = null,
  zScore: number = 0,
  autocorrelation: number = 0,
  obi: number = 0
): boolean | { allowed: boolean; reason: string; advice?: string } => {
  if (isBNB) return false // Never trade BNB

  // BOX STRATEGY GUARD: Only enter if price is in the defined "Buy Zone" (bottom X%) of the box
  if (boxBounds && boxBounds.low > 0 && boxBounds.high > 0) {
    const boxRange = boxBounds.high - boxBounds.low
    if (boxRange > 0) {
      const pricePosition = (currentPrice - boxBounds.low) / boxRange
      if (pricePosition > (config.BOX_BUY_ZONE || 0.2)) {
        return {
          allowed: false,
          reason: `PRICE_ABOVE_BOX_ZONE (${(pricePosition * 100).toFixed(1)}%)`
        }
      }
    }
  }

  // Only trade if specifically in the whitelist (handles both object and string array formats)
  if (!whitelist.find((i) => (typeof i === 'string' ? i : i.symbol) === symbol)) return false

  // RSI Guard: Do not enter if the asset is overbought (RSI > MAX_RSI)
  if (rsi !== null && config.MAX_RSI && rsi > config.MAX_RSI) {
    return { allowed: false, reason: `RSI_TOO_HIGH (rsi: ${rsi.toFixed(1)})` }
  }

  // --- NEW: Autocorrelation (Momentum) Guard ---
  if (config.MOMENTUM_MIN !== undefined && autocorrelation < config.MOMENTUM_MIN) {
    return { allowed: false, reason: `LOW_MOMENTUM (autoCorr: ${autocorrelation.toFixed(2)})` }
  }

  // --- NEW: Order Book Imbalance (OBI) Guard ---
  if (config.OBI_MIN !== undefined && obi < config.OBI_MIN) {
    return { allowed: false, reason: `LOW_ORDER_BOOK_IMBALANCE (obi: ${obi.toFixed(2)})` }
  }

  // BTC Market Guard: Block if BTC is BEAR, or if BTC trend strength is too weak
  if (symbol !== 'BTCUSDT' && !isDecoupled) {
    if (btcRegime === 'BEAR') return false
    if (btcMacroDiff < config.BTC_STRENGTH_THRESHOLD) {
      return {
        allowed: false,
        reason: `BTC_TOO_WEAK (macroDiff: ${(btcMacroDiff * 100).toFixed(3)}%)`
      }
    }
  }

  // Macro Trend Guard: Do not buy dips in a confirmed macro BEAR trend
  if (regime === 'RECOVERY' && macroRegime === 'BEAR') {
    return { allowed: false, reason: `MACRO_BEAR_DIP` }
  }

  // ALLOW BULL entries or RECOVERY hook entries
  if (regime !== 'BULL' && regime !== 'RECOVERY') return false

  // --- NEW: Z-Score (Over-extension) Guard with Moon Potential Advice ---
  if (config.Z_SCORE_LIMIT !== undefined && zScore > config.Z_SCORE_LIMIT) {
    return {
      allowed: false,
      reason: `OVEREXTENDED_Z_SCORE (${zScore.toFixed(2)})`,
      advice: 'MOON_POTENTIAL'
    }
  }

  // Resistance Headroom Check
  if (!skipResistance && history && currentPrice > 0) {
    const resistance = detectResistance(history, currentPrice, config)
    if (resistance !== null) {
      const headroom = (resistance - currentPrice) / currentPrice
      if (headroom < config.HEADROOM_REQUIRED) {
        return {
          allowed: false,
          reason: `RESISTANCE_TOO_CLOSE (headroom: ${(headroom * 100).toFixed(2)}%, level: ${resistance.toFixed(6)})`
        }
      }
    }
  }

  return true
}

// Calculate ATR from tick history by bucketing into synthetic candles
// Returns ATR as a fraction of current price (e.g., 0.015 = 1.5%)
const calculateATR = (history: { price: number }[], candlePeriod = 900): number | null => {
  // Note: history is already sliced by getHistory() before coming here
  if (!history || history.length < candlePeriod * 2) return null

  const currentPrice = history[history.length - 1].price
  let totalRange = 0
  let candleCount = 0

  // Scan backwards from end of history to find last 16 candles
  // This is MUCH faster than bucketting the entire 24h history every time
  for (let i = history.length - candlePeriod; i >= 0 && candleCount < 16; i -= candlePeriod) {
    let high = -Infinity
    let low = Infinity
    for (let j = 0; j < candlePeriod; j++) {
      const p = history[i + j].price
      if (p > high) high = p
      if (p < low) low = p
    }
    totalRange += high - low
    candleCount++
  }

  if (candleCount === 0) return null
  return totalRange / candleCount / currentPrice
}

// Calculate RSI from tick history using synthetic candles (default 14-period, 5m candles)
const calculateRSI = (
  history: { price: number }[],
  period = 14,
  candlePeriod = 300
): number | null => {
  if (!history || history.length < candlePeriod * (period + 1)) return null

  // Bucket ticks into candles
  const candles: number[] = []
  for (let i = 0; i < history.length; i += candlePeriod) {
    const slice = history.slice(i, i + candlePeriod)
    if (slice.length > 0) {
      candles.push(slice[slice.length - 1].price) // Just need close price
    }
  }

  if (candles.length < period + 1) return null

  // Standard RSI Wilder's Smoothing
  let avgGain = 0
  let avgLoss = 0

  // First averages are simple moving average
  for (let i = 1; i <= period; i++) {
    const diff = candles[i] - candles[i - 1]
    if (diff >= 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period

  // Smooth the rest of the available history
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i] - candles[i - 1]
    const gain = diff >= 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return 100
  if (avgGain === 0) return 0

  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// Get a scaled copy of the strategy config for a specific symbol
// ATR multiplier adjusts exit thresholds (clamped 0.5x - 2.0x)
const getScaledConfig = (history: { price: number }[], config: StrategyConfig): StrategyConfig => {
  // If scaling is disabled, return base config plus indicator
  if (config.DISABLE_ATR_SCALING) {
    return { ...config, atrMultiplier: 1.0 }
  }

  const atr = calculateATR(history, config.ATR_CANDLE_PERIOD || 900)

  if (!atr || !config.ATR_BASELINE) {
    return { ...config, atrMultiplier: 1.0 } // No ATR data yet — use base config
  }

  // Clamp multiplier between 0.5 and 2.0
  const rawMultiplier = atr / config.ATR_BASELINE
  const multiplier = Math.max(0.5, Math.min(2.0, rawMultiplier))

  return {
    ...config,
    HARD_STOP: config.HARD_STOP,
    MID_TRAIL_ACTIVATION: config.MID_TRAIL_ACTIVATION,
    MID_TRAIL_DELTA: config.MID_TRAIL_DELTA,
    TRAIL_ACTIVATION: config.TRAIL_ACTIVATION,
    TRAIL_DELTA: config.TRAIL_DELTA,
    atrMultiplier: Math.round(multiplier * 100) / 100 // rounded for display
  }
}

export {
  STRATEGIES,
  RegimeFilter,
  checkTrailingStop,
  shouldEnter,
  detectResistance,
  calculateATR,
  calculateRSI,
  getScaledConfig
}
