import { ElectronAPI } from '@electron-toolkit/preload'

export interface GridLevel {
  id: number
  buyPrice: number
  sellPrice: number
  quantity: number
  cost: number
  pctChange: number
}

export interface SymbolGridState {
  symbol: string
  hasBaseShare: boolean
  basePrice?: number
  baseQuantity?: number
  baseEntryCost?: number
  currentPrice: number
  pctFromBase?: number
  gridLevels: GridLevel[]
  totalUnrealizedPnl: number
}

export interface IElectronAPI {
  startBot: () => Promise<void>

  // Grid
  registerBaseShare: (symbol: string, price: number, quantity: number) => Promise<boolean>
  sellBaseShare: (symbol: string) => Promise<boolean>
  clearGridLevels: (symbol: string) => Promise<boolean>
  getGridState: () => Promise<Record<string, SymbolGridState>>
  deleteBaseShare: (symbol: string) => Promise<boolean>

  // Manual trade (quick base share register/sell)
  manualTrade: (symbol: string, side: string) => Promise<boolean>

  // Events
  onMarketUpdate: (callback: (data: any) => void) => void
  onTradeExecuted: (callback: (data: any) => void) => void
  onBalanceUpdate: (callback: (data: any) => void) => void
  onMonitoringUpdate: (callback: (data: any) => void) => void

  // Whitelist
  getWhitelist: () => Promise<string[]>
  saveWhitelist: (symbols: string[]) => Promise<boolean>

  // Settings
  getSettings: () => Promise<Record<string, string>>
  saveSettings: (settings: { key: string; value: string }) => Promise<boolean>

  // Stats
  getStats: () => Promise<{
    totalPnl: number
    avgRoi: number
    winRate: number
    totalTrades: number
    unrealizedPnl: number
  }>

  // Trade history
  getRecentTrades: (args: { mode: string; limit: number }) => Promise<any[]>
  clearTradeHistory: (mode: string) => Promise<boolean>

  // Backtest
  runBacktest: (
    symbol: string,
    start: string,
    end: string,
    shareAmount: number,
    gridStep: number
  ) => Promise<any>
  onBacktestUpdate: (callback: (data: any) => void) => void
  onBacktestProgress: (callback: (progress: number) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: IElectronAPI
  }
}
