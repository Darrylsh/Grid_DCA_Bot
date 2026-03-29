import { ElectronAPI } from '@electron-toolkit/preload'

export interface IElectronAPI {
  startBot: () => Promise<void>
  stopBot: () => Promise<void>
  getSettings: () => Promise<any>
  saveSettings: (settings: any) => Promise<void>
  manualTrade: (symbol: string, side: string) => Promise<boolean>
  onMarketUpdate: (callback: (data: any) => void) => void
  onTradeExecuted: (callback: (data: any) => void) => void
  onBalanceUpdate: (callback: (data: any) => void) => void
  onMonitoringUpdate: (callback: (data: any) => void) => void
  getWhitelist: () => Promise<any[]>
  saveWhitelist: (list: any[]) => Promise<boolean>
  getDecoupledWhitelist: () => Promise<string[]>
  saveDecoupledWhitelist: (list: string[]) => Promise<boolean>
  getStats: () => Promise<{
    totalPnl: number
    avgRoi: number
    winRate: number
    totalTrades: number
    unrealizedPnl: number
  }>
  toggleBotManualMode: (symbol: string, enable: boolean) => Promise<boolean>
  getRecentTrades: (args: { mode: string; limit: number }) => Promise<any[]>
  clearTradeHistory: (mode: string) => Promise<boolean>
  runBacktest: (
    symbol: string,
    strategy: string,
    start: string,
    end: string,
    initialEquity: number,
    isDecoupled: boolean
  ) => Promise<any>
  onBacktestUpdate: (callback: (data: any) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: IElectronAPI
  }
}
