import { ElectronAPI } from '@electron-toolkit/preload'
import {
  GridLevel,
  SymbolGridState,
  Trade,
  BalanceUpdate,
  Stats,
  Settings,
  BacktestResults,
  VersionInfo,
  MarketUpdate
} from '../shared/types'
import type { UpdateInfo, ProgressInfo } from 'electron-updater'

// Re-export shared types for backward compatibility
export { GridLevel, SymbolGridState }

export interface IElectronAPI {
  startBot: () => Promise<void>

  // Grid
  registerBaseShare: (symbol: string, price: number, quantity: number) => Promise<boolean>
  sellBaseShare: (symbol: string) => Promise<boolean>
  clearGridLevels: (symbol: string) => Promise<boolean>
  sellLowestGridLevel: (symbol: string) => Promise<boolean>
  getGridState: () => Promise<Record<string, SymbolGridState>>
  deleteBaseShare: (symbol: string) => Promise<boolean>
  togglePause: (symbol: string) => Promise<boolean>

  // Manual trade (quick base share register/sell)
  manualTrade: (symbol: string, side: string) => Promise<boolean>

  // Events with typed callbacks
  onMarketUpdate: (callback: (data: MarketUpdate) => void) => void
  offMarketUpdate: (callback: (data: MarketUpdate) => void) => void
  onTradeExecuted: (callback: (data: Trade) => void) => void
  offTradeExecuted: (callback: (data: Trade) => void) => void
  onBalanceUpdate: (callback: (data: BalanceUpdate) => void) => void
  offBalanceUpdate: (callback: (data: BalanceUpdate) => void) => void
  onMonitoringUpdate: (callback: (data: unknown) => void) => void
  offMonitoringUpdate: (callback: (data: unknown) => void) => void
  onConnectionStatus: (callback: (status: boolean) => void) => void
  offConnectionStatus: (callback: (status: boolean) => void) => void
  getConnectionStatus: () => Promise<boolean>

  // Whitelist
  getWhitelist: () => Promise<string[]>
  saveWhitelist: (symbols: string[]) => Promise<boolean>
  getVersion: () => Promise<VersionInfo>

  // Settings
  getSettings: () => Promise<Settings>
  saveSettings: (settings: { key: string; value: string }) => Promise<boolean>

  // Stats
  getStats: () => Promise<Stats>

  // Trade history
  getRecentTrades: (args: { mode: string; limit: number }) => Promise<Trade[]>
  getTradesByTimeRange: (mode: string, startMs: number, endMs: number) => Promise<Trade[]>
  clearTradeHistory: (mode: string) => Promise<boolean>
  wipeAllData: (mode: string) => Promise<boolean>

  // Backtest
  runBacktest: (
    symbol: string,
    start: string,
    end: string,
    shareAmount: number,
    gridStep: number
  ) => Promise<BacktestResults>
  onBacktestUpdate: (
    callback: (data: BacktestResults | { status: string; message?: string }) => void
  ) => void
  offBacktestUpdate: (
    callback: (data: BacktestResults | { status: string; message?: string }) => void
  ) => void
  onBacktestProgress: (callback: (progress: number) => void) => void
  offBacktestProgress: (callback: (progress: number) => void) => void

  // Auto-update
  checkForUpdates: () => Promise<{ success: boolean; data?: UpdateInfo; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  getCurrentVersion: () => Promise<{
    version: string
    name: string
    platform: string
    arch: string
  }>

  onUpdateChecking: (callback: () => void) => void
  offUpdateChecking: (callback: () => void) => void
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => void
  offUpdateAvailable: (callback: (info: UpdateInfo) => void) => void
  onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => void
  offUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => void
  onUpdateProgress: (callback: (progress: ProgressInfo) => void) => void
  offUpdateProgress: (callback: (progress: ProgressInfo) => void) => void
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => void
  offUpdateDownloaded: (callback: (info: UpdateInfo) => void) => void
  onUpdateError: (callback: (error: string) => void) => void
  offUpdateError: (callback: (error: string) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: IElectronAPI
  }
}
