// Shared TypeScript interfaces for the trading bot application

// ==================== CORE TRADE TYPES ====================

/**
 * Represents a single trade execution
 */
export interface Trade {
  timestamp: number
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  reason: string
  pnl?: number
  fees?: number
  message?: string // For log entries without structured trade data
}

/**
 * Grid level for a specific symbol
 */
export interface GridLevel {
  id: number
  buyPrice: number
  sellPrice: number
  quantity: number
  cost: number
  pctChange: number
}

/**
 * Complete grid state for a single symbol
 */
export interface SymbolGridState {
  symbol: string
  hasBaseShare: boolean
  basePrice?: number
  baseQuantity?: number
  baseEntryCost?: number
  currentPrice: number
  pctFromBase?: number
  pctToGrid?: number
  gridLevels: GridLevel[]
  totalUnrealizedPnl: number
  trailActive?: boolean
  trailHigh?: number
  trailStopPrice?: number
  activeSharePnl?: number // PnL for the active base share
  botStartTime?: number // When the bot started (from market update)
  isPaused?: boolean // Whether the grid bot is paused from buying down
}

/**
 * Extended market update from socket (includes SymbolGridState plus additional fields)
 */
export interface MarketUpdate extends SymbolGridState {
  // Inherits all SymbolGridState fields
}

// ==================== BALANCE & STATS ====================

/**
 * Exchange balance update
 */
export interface BalanceUpdate {
  USDT: number
  BNB: number
}

/**
 * Trading statistics
 */
export interface Stats {
  totalPnl: number
  totalFees: number
  avgRoi: number
  winRate: number
  fillRate: number
  totalTrades: number
  unrealizedPnl: number
  firstTradeTime?: number
}

// ==================== BACKTEST TYPES ====================

/**
 * Extended trade type used internally by backtest engine
 */
export interface BacktestTrade {
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  cost: number
  fee: number
  timestamp: string // ISO string
  reason: string
  pnl: number | null
  roi: number | null
  levelId?: number
}

/**
 * Grid level used internally by backtest engine
 */
export interface BacktestGridLevel {
  id: number
  buyPrice: number
  sellPrice: number
  qty: number
  cost: number
  status: 'PENDING' | 'FILLED'
}

/**
 * Backtest results from simulation
 */
export interface BacktestResults {
  symbol: string
  gridStep: number
  shareAmount: number
  totalSpent: number
  totalRecovered: number
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  totalFees: number
  totalRoi: number
  finalEquity: number
  gridLevelCount: number
  totalTrades: number
  pendingLevels: number
  winRate: number
  chartData: Array<{ t: number; p: number }>
  trades: Trade[]
  range?: {
    start: string
    end: string
    candlesProcessed: number
  }
  error?: string
}

/**
 * Backtest progress update
 */
export interface BacktestProgress {
  progress: number
  status: string
}

// ==================== SETTINGS & CONFIG ====================

/**
 * Valid setting keys
 */
export type SettingKey =
  | 'trading_mode'
  | 'capital_value'
  | 'grid_step_percent'
  | 'trailing_stop_levels'
  | 'trailing_stop_pct'
  | 'window_state'

/**
 * Setting value (always string for storage)
 */
export type SettingValue = string

/**
 * Settings object (key-value pairs)
 */
export type Settings = Record<string, SettingValue>

// ==================== APP STATE ====================

/**
 * Toast notification
 */
export interface Toast {
  message: string
  type: 'success' | 'error' | 'info'
}

/**
 * Version information
 */
export interface VersionInfo {
  frontend: string
  backend: string
  expectedBackend: string
}

// ==================== UTILITY TYPES ====================

/**
 * API error response
 */
export interface ApiError {
  success: false
  error: string
  data?: never
}

/**
 * API success response
 */
export interface ApiSuccess<T = unknown> {
  success: true
  data: T
  error?: never
}

/**
 * API response (union type)
 */
export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError

// ==================== EVENT TYPES ====================

/**
 * Socket event data types
 */
export interface SocketEvents {
  market_update: MarketUpdate
  trade_executed: Trade
  balance_update: BalanceUpdate
  whitelist_updated: string[]
  settings_updated: Settings
  grid_levels_update: SymbolGridState[]
  bot_log: Trade | { message: string }
  'bt:progress': number
  'bt:update': BacktestResults | { status: string; message?: string }
}
