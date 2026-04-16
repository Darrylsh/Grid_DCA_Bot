// ---------------------------------------------------------------------------
// State Manager for Grid DCA Bot
// ---------------------------------------------------------------------------

import { GridState, GridLevel, TrailingStop, DelayedBuyState } from './types'

// In-memory state containers
let gridState: Record<string, GridState> = {}
let gridLevels: Record<string, GridLevel[]> = {}
let lastPrices: Record<string, number> = {}
let trailingStops: Record<string, TrailingStop> = {}
let priceHistories: Record<string, number[]> = {}
let delayedBuyStates: Record<string, DelayedBuyState> = {}

// Cooldown state
let levelCooldowns: Record<string, number> = {}
export const LEVEL_COOLDOWN_MS = 5000 // 5 second cooldown after a grid purchase

// Telegram Notification Cooldowns
let lastLowBnbNotified = 0
let lastLowUsdtNotified = 0
let missedBuyCooldowns: Record<string, number> = {}

// Bot runtime state
let botStartTime: number | null = null
let isBotRunning = false
let botIntervals: NodeJS.Timeout[] = []

// WebSocket state
let wsClient: any = null
let streamGeneration = 0

// ---------------------------------------------------------------------------
// Grid State Management
// ---------------------------------------------------------------------------

export const getGridState = (
  symbol?: string
): GridState | undefined | Record<string, GridState> => {
  if (symbol) return gridState[symbol]
  return { ...gridState }
}

export const setGridState = (symbol: string, state: GridState): void => {
  gridState[symbol] = state
}

export const deleteGridState = (symbol: string): void => {
  delete gridState[symbol]
}

export const clearAllGridState = (): void => {
  gridState = {}
}

// ---------------------------------------------------------------------------
// Grid Levels Management
// ---------------------------------------------------------------------------

export const getGridLevels = (symbol?: string): GridLevel[] | Record<string, GridLevel[]> => {
  if (symbol) return gridLevels[symbol] || []
  return { ...gridLevels }
}

export const setGridLevels = (symbol: string, levels: GridLevel[]): void => {
  gridLevels[symbol] = levels
}

export const addGridLevel = (symbol: string, level: GridLevel): void => {
  if (!gridLevels[symbol]) gridLevels[symbol] = []
  gridLevels[symbol].push(level)
}

export const removeGridLevel = (symbol: string, levelId: number): void => {
  if (!gridLevels[symbol]) return
  gridLevels[symbol] = gridLevels[symbol].filter((level) => level.id !== levelId)
}

export const clearGridLevels = (symbol?: string): void => {
  if (symbol) {
    delete gridLevels[symbol]
  } else {
    gridLevels = {}
  }
}

// ---------------------------------------------------------------------------
// Price Management
// ---------------------------------------------------------------------------

export const getLastPrice = (symbol: string): number | undefined => {
  return lastPrices[symbol]
}

export const setLastPrice = (symbol: string, price: number): void => {
  lastPrices[symbol] = price
}

export const getAllLastPrices = (): Record<string, number> => {
  return { ...lastPrices }
}

// ---------------------------------------------------------------------------
// Trailing Stop Management
// ---------------------------------------------------------------------------

export const getTrailingStop = (symbol: string): TrailingStop | undefined => {
  return trailingStops[symbol]
}

export const setTrailingStop = (symbol: string, stop: TrailingStop): void => {
  trailingStops[symbol] = stop
}

export const deleteTrailingStop = (symbol: string): void => {
  delete trailingStops[symbol]
}

// ---------------------------------------------------------------------------
// Price History Management (for momentum calculation)
// ---------------------------------------------------------------------------

export const getPriceHistory = (symbol: string): number[] => {
  return priceHistories[symbol] || []
}

export const setPriceHistory = (symbol: string, history: number[]): void => {
  priceHistories[symbol] = history
}

export const addPriceToHistory = (symbol: string, price: number): void => {
  if (!priceHistories[symbol]) priceHistories[symbol] = []
  priceHistories[symbol].push(price)
}

// ---------------------------------------------------------------------------
// Delayed Buy State Management
// ---------------------------------------------------------------------------

export const getDelayedBuyState = (symbol: string): DelayedBuyState | undefined => {
  return delayedBuyStates[symbol]
}

export const setDelayedBuyState = (symbol: string, state: DelayedBuyState): void => {
  delayedBuyStates[symbol] = state
}

export const deleteDelayedBuyState = (symbol: string): void => {
  delete delayedBuyStates[symbol]
}

// ---------------------------------------------------------------------------
// Cooldown Management
// ---------------------------------------------------------------------------

export const getLevelCooldown = (symbol: string): number => {
  return levelCooldowns[symbol] || 0
}

export const setLevelCooldown = (symbol: string, timestamp: number): void => {
  levelCooldowns[symbol] = timestamp
}

export const checkLevelCooldown = (symbol: string): boolean => {
  const last = levelCooldowns[symbol] || 0
  return Date.now() - last < LEVEL_COOLDOWN_MS
}

// ---------------------------------------------------------------------------
// Bot Runtime State
// ---------------------------------------------------------------------------

export const getBotStartTime = (): number | null => botStartTime
export const setBotStartTime = (time: number | null): void => {
  botStartTime = time
}

export const getIsBotRunning = (): boolean => isBotRunning
export const setIsBotRunning = (running: boolean): void => {
  isBotRunning = running
}

export const getBotIntervals = (): NodeJS.Timeout[] => botIntervals
export const addBotInterval = (interval: NodeJS.Timeout): void => {
  botIntervals.push(interval)
}
export const clearAllBotIntervals = (): void => {
  botIntervals.forEach(clearInterval)
  botIntervals = []
}

// ---------------------------------------------------------------------------
// WebSocket State
// ---------------------------------------------------------------------------

export const getWsClient = (): any => wsClient
export const setWsClient = (client: any): void => {
  wsClient = client
}

export const getStreamGeneration = (): number => streamGeneration
export const setStreamGeneration = (gen: number): void => {
  streamGeneration = gen
}
export const incrementStreamGeneration = (): number => {
  streamGeneration++
  return streamGeneration
}

// ---------------------------------------------------------------------------
// Telegram Cooldowns
// ---------------------------------------------------------------------------

export const getLastLowBnbNotified = (): number => lastLowBnbNotified
export const setLastLowBnbNotified = (time: number): void => {
  lastLowBnbNotified = time
}

export const getLastLowUsdtNotified = (): number => lastLowUsdtNotified
export const setLastLowUsdtNotified = (time: number): void => {
  lastLowUsdtNotified = time
}

export const getMissedBuyCooldown = (symbol: string): number => missedBuyCooldowns[symbol] || 0
export const setMissedBuyCooldown = (symbol: string, time: number): void => {
  missedBuyCooldowns[symbol] = time
}
