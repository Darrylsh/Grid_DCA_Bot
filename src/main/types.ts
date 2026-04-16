// ---------------------------------------------------------------------------
// Core Types for Grid DCA Bot
// ---------------------------------------------------------------------------

export interface GridState {
  basePrice: number // Original entry price — grid buys trigger below this
  baseQuantity: number // Coin quantity of the base share
  baseEntryCost: number // USDT cost of the base share
  isPaused?: boolean // Whether the bot is paused from buying down
}

export interface GridLevel {
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

export interface Filter {
  stepSize: number
  tickSize: number
}

export interface TrailingStop {
  armed: boolean
  trailHigh: number // highest price seen since arming
  stopPrice: number // trailHigh * (1 - stopPct)
}

export interface DelayedBuyState {
  active: boolean
  triggerPrice: number // Original grid trigger price where delay started
  lowSinceTrigger: number // Lowest price observed since delay
  triggeredAt: number // Timestamp for timeout
}

// Type for trade execution data
export interface TradeData {
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  pnl?: number
  roi?: number
  reason: string
  mode: string
}

// Type for market update data
export interface MarketUpdateData {
  symbol: string
  price: number
  unrealizedPnl: number
  unrealizedRoi: number
  pctFromBase: number
  gridLevels: GridLevel[]
  basePrice: number
  baseQuantity: number
  baseEntryCost: number
  isPaused?: boolean
}

// Type for balance update
export interface BalanceUpdate {
  USDT: number
  BNB: number
  [key: string]: number
}
