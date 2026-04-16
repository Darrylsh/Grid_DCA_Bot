// ---------------------------------------------------------------------------
// Utility functions for Grid DCA Bot
// ---------------------------------------------------------------------------

import { GridState } from './types'

/**
 * Safely calculates average entry price from grid state
 * Prefers true cost basis (baseEntryCost / baseQuantity)
 * Falls back to basePrice if cost basis unavailable
 * Returns 0 for invalid state
 */
export const getAvgEntryPrice = (state: GridState): number => {
  // Prefer true cost basis if available
  if (state.baseEntryCost > 0 && state.baseQuantity > 0) {
    return state.baseEntryCost / state.baseQuantity
  }
  // Fallback to floating base price (should always be > 0 in valid state)
  if (state.basePrice > 0) {
    console.warn(
      `[BOT] Using basePrice as avgEntry fallback for corrupted state (cost=${state.baseEntryCost}, qty=${state.baseQuantity})`
    )
    return state.basePrice
  }
  // Last resort fallback
  console.error(
    `[BOT] Invalid grid state: basePrice=${state.basePrice}, baseEntryCost=${state.baseEntryCost}, baseQuantity=${state.baseQuantity}`
  )
  return 0
}

/**
 * Safe division with fallback and logging
 * Prevents division by zero or infinity
 */
export const safeDivide = (
  numerator: number,
  denominator: number,
  fallback: number,
  context: string
): number => {
  if (denominator === 0 || !isFinite(denominator)) {
    console.warn(`[BOT] Division by zero/infinity in ${context}, using fallback ${fallback}`)
    return fallback
  }
  return numerator / denominator
}

/**
 * Rounds a value to the nearest step (for quantity/lot size)
 */
export const roundToStep = (value: number, step: number): number => {
  if (!step || step === 0) return value
  const precision = step.toString().split('.')[1]?.length || 0
  return parseFloat((Math.floor(value / step) * step).toFixed(precision))
}

/**
 * Rounds a value to the nearest tick (for price)
 * @param direction 'up' or 'down' (default 'down')
 */
export const roundTick = (
  value: number,
  tickSize: number,
  direction: 'up' | 'down' = 'down'
): number => {
  if (!tickSize || tickSize === 0) return value
  const precision = tickSize.toString().split('.')[1]?.length || 0
  if (direction === 'up')
    return parseFloat((Math.ceil(value / tickSize) * tickSize).toFixed(precision))
  return parseFloat((Math.floor(value / tickSize) * tickSize).toFixed(precision))
}

/**
 * Calculates percentage change between two values
 */
export const calculatePercentageChange = (oldValue: number, newValue: number): number => {
  if (oldValue === 0) return 0
  return ((newValue - oldValue) / oldValue) * 100
}

/**
 * Calculates grid buy price based on base price and step percentage
 */
export const calculateGridBuyPrice = (basePrice: number, stepPercent: number): number => {
  return basePrice * (1 - stepPercent / 100)
}

/**
 * Calculates grid sell price based on buy price and step percentage
 */
export const calculateGridSellPrice = (buyPrice: number, stepPercent: number): number => {
  return buyPrice * (1 + stepPercent / 100)
}

/**
 * Calculates quantity for a grid level based on share amount and buy price
 */
export const calculateGridQuantity = (shareAmount: number, buyPrice: number): number => {
  return shareAmount / buyPrice
}

/**
 * Formats a number to a specified decimal precision
 */
export const formatDecimal = (value: number, decimals: number): string => {
  return value.toFixed(decimals)
}
