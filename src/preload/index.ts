import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Trade,
  BalanceUpdate,
  MarketUpdate,
  Settings,
  Stats,
  BacktestResults,
  VersionInfo
} from '../shared/types'

const api = {
  // ---- Application / UI ----
  showConfirm: (options: { title: string; message: string; detail?: string; type?: string }) =>
    ipcRenderer.invoke('app:showConfirm', options),

  // ---- Bot lifecycle ----
  startBot: () => ipcRenderer.invoke('bot:start'),

  // ---- Grid-specific ----
  registerBaseShare: (symbol: string, price: number, quantity: number) =>
    ipcRenderer.invoke('bot:registerBaseShare', symbol, price, quantity),
  sellBaseShare: (symbol: string) => ipcRenderer.invoke('bot:sellBaseShare', symbol),
  clearGridLevels: (symbol: string) => ipcRenderer.invoke('bot:clearGridLevels', symbol),
  sellLowestGridLevel: (symbol: string) => ipcRenderer.invoke('bot:sellLowestGridLevel', symbol),
  getGridState: () => ipcRenderer.invoke('bot:getGridState'),
  deleteBaseShare: (symbol: string) => ipcRenderer.invoke('bot:deleteBaseShare', symbol),
  togglePause: (symbol: string) => ipcRenderer.invoke('bot:togglePause', symbol),

  // ---- Manual trade ----
  manualTrade: (symbol: string, side: string) =>
    ipcRenderer.invoke('bot:manualTrade', symbol, side),

  // ---- Events (bot → renderer) ----
  getConnectionStatus: () => ipcRenderer.invoke('bot:getConnectionStatus'),

  // Market updates
  onMarketUpdate: (callback: (data: MarketUpdate) => void) => {
    ipcRenderer.on('bot:marketUpdate', (_event, data) => callback(data))
  },
  offMarketUpdate: (callback: (data: MarketUpdate) => void) => {
    ipcRenderer.off('bot:marketUpdate', (_event, data) => callback(data))
  },

  // Trade executions
  onTradeExecuted: (callback: (data: Trade) => void) => {
    ipcRenderer.on('bot:tradeExecuted', (_event, data) => callback(data))
  },
  offTradeExecuted: (callback: (data: Trade) => void) => {
    ipcRenderer.off('bot:tradeExecuted', (_event, data) => callback(data))
  },

  // Balance updates
  onBalanceUpdate: (callback: (data: BalanceUpdate) => void) => {
    ipcRenderer.on('bot:balanceUpdate', (_event, data) => callback(data))
  },
  offBalanceUpdate: (callback: (data: BalanceUpdate) => void) => {
    ipcRenderer.off('bot:balanceUpdate', (_event, data) => callback(data))
  },

  // Monitoring updates (unknown type)
  onMonitoringUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on('bot:monitoringUpdate', (_event, data) => callback(data))
  },
  offMonitoringUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.off('bot:monitoringUpdate', (_event, data) => callback(data))
  },

  // Connection status
  onConnectionStatus: (callback: (status: boolean) => void) => {
    ipcRenderer.on('bot:connectionStatus', (_event, status) => callback(status))
  },
  offConnectionStatus: (callback: (status: boolean) => void) => {
    ipcRenderer.off('bot:connectionStatus', (_event, status) => callback(status))
  },

  // Whitelist updates
  onWhitelistUpdated: (callback: (symbols?: string[]) => void) => {
    ipcRenderer.on('bot:whitelistUpdated', (_event, symbols) => callback(symbols))
  },
  offWhitelistUpdated: (callback: (symbols?: string[]) => void) => {
    ipcRenderer.off('bot:whitelistUpdated', (_event, symbols) => callback(symbols))
  },

  // ---- Whitelist ----
  getWhitelist: () => ipcRenderer.invoke('bot:getWhitelist') as Promise<string[]>,
  saveWhitelist: (symbols: string[]) => ipcRenderer.invoke('bot:saveWhitelist', symbols),
  getVersion: () => ipcRenderer.invoke('bot:getVersion') as Promise<VersionInfo>,

  // ---- Settings ----
  getSettings: () => ipcRenderer.invoke('bot:getSettings') as Promise<Settings>,
  saveSettings: (settings: { key: string; value: string }) =>
    ipcRenderer.invoke('bot:saveSettings', settings),

  // ---- Stats ----
  getStats: () => ipcRenderer.invoke('bot:getStats') as Promise<Stats>,
  getRecentTrades: (payload: { mode: string; limit: number }) =>
    ipcRenderer.invoke('bot:getRecentTrades', payload) as Promise<Trade[]>,
  getTradesByTimeRange: (mode: string, startMs: number, endMs: number) =>
    ipcRenderer.invoke('bot:getTradesByTimeRange', mode, startMs, endMs) as Promise<Trade[]>,
  clearTradeHistory: (mode: string) => ipcRenderer.invoke('bot:clearTradeHistory', mode),
  wipeAllData: (mode: string) => ipcRenderer.invoke('bot:wipeAllData', mode),

  // ---- Backtest ----
  runBacktest: (
    symbol: string,
    start: string,
    end: string,
    shareAmount: number,
    gridStep: number
  ) =>
    ipcRenderer.invoke(
      'bot:runBacktest',
      symbol,
      start,
      end,
      shareAmount,
      gridStep
    ) as Promise<BacktestResults>,

  onBacktestUpdate: (
    callback: (data: BacktestResults | { status: string; message?: string }) => void
  ) => {
    ipcRenderer.on('bt:update', (_event, data) => callback(data))
  },
  offBacktestUpdate: (
    callback: (data: BacktestResults | { status: string; message?: string }) => void
  ) => {
    ipcRenderer.off('bt:update', (_event, data) => callback(data))
  },

  onBacktestProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('bt:progress', (_event, progress) => callback(progress))
  },
  offBacktestProgress: (callback: (progress: number) => void) => {
    ipcRenderer.off('bt:progress', (_event, progress) => callback(progress))
  },

  // ---- Auto-update ----
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getCurrentVersion: () => ipcRenderer.invoke('update:get-current-version'),

  onUpdateChecking: (callback: () => void) => {
    ipcRenderer.on('update:checking', () => callback())
  },
  offUpdateChecking: (callback: () => void) => {
    ipcRenderer.off('update:checking', () => callback())
  },
  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update:available', (_event, info) => callback(info))
  },
  offUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.off('update:available', (_event, info) => callback(info))
  },
  onUpdateNotAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update:not-available', (_event, info) => callback(info))
  },
  offUpdateNotAvailable: (callback: (info: any) => void) => {
    ipcRenderer.off('update:not-available', (_event, info) => callback(info))
  },
  onUpdateProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('update:progress', (_event, progress) => callback(progress))
  },
  offUpdateProgress: (callback: (progress: any) => void) => {
    ipcRenderer.off('update:progress', (_event, progress) => callback(progress))
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.on('update:downloaded', (_event, info) => callback(info))
  },
  offUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.off('update:downloaded', (_event, info) => callback(info))
  },
  onUpdateError: (callback: (error: string) => void) => {
    ipcRenderer.on('update:error', (_event, error) => callback(error))
  },
  offUpdateError: (callback: (error: string) => void) => {
    ipcRenderer.off('update:error', (_event, error) => callback(error))
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore: contextIsolated is false in non-isolated context
  window.electron = electronAPI
  // @ts-ignore: contextIsolated is false in non-isolated context
  window.api = api
}
