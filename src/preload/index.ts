import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // ---- Bot lifecycle ----
  startBot: () => ipcRenderer.invoke('bot:start'),

  // ---- Grid-specific ----
  registerBaseShare: (symbol: string, price: number, quantity: number) =>
    ipcRenderer.invoke('bot:registerBaseShare', symbol, price, quantity),
  sellBaseShare: (symbol: string) => ipcRenderer.invoke('bot:sellBaseShare', symbol),
  clearGridLevels: (symbol: string) => ipcRenderer.invoke('bot:clearGridLevels', symbol),
  getGridState: () => ipcRenderer.invoke('bot:getGridState'),
  deleteBaseShare: (symbol: string) => ipcRenderer.invoke('bot:deleteBaseShare', symbol),

  // ---- Manual trade ----
  manualTrade: (symbol: string, side: string) =>
    ipcRenderer.invoke('bot:manualTrade', symbol, side),

  // ---- Events (bot → renderer) ----
  onMarketUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('bot:marketUpdate', (_event, data) => callback(data))
  },
  onTradeExecuted: (callback: (data: any) => void) => {
    ipcRenderer.on('bot:tradeExecuted', (_event, data) => callback(data))
  },
  onBalanceUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('bot:balanceUpdate', (_event, data) => callback(data))
  },
  onMonitoringUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('bot:monitoringUpdate', (_event, data) => callback(data))
  },

  // ---- Whitelist ----
  getWhitelist: () => ipcRenderer.invoke('bot:getWhitelist'),
  saveWhitelist: (symbols: string[]) => ipcRenderer.invoke('bot:saveWhitelist', symbols),

  // ---- Settings ----
  getSettings: () => ipcRenderer.invoke('bot:getSettings'),
  saveSettings: (settings: { key: string; value: string }) =>
    ipcRenderer.invoke('bot:saveSettings', settings),

  // ---- Stats ----
  getStats: () => ipcRenderer.invoke('bot:getStats'),

  // ---- Trade history ----
  getRecentTrades: (args: { mode: string; limit: number }) =>
    ipcRenderer.invoke('bot:getRecentTrades', args),
  clearTradeHistory: (mode: string) => ipcRenderer.invoke('bot:clearTradeHistory', mode),
  wipeAllData: (mode: string) => ipcRenderer.invoke('bot:wipeAllData', mode),

  // ---- Backtest ----
  runBacktest: (
    symbol: string,
    start: string,
    end: string,
    shareAmount: number,
    gridStep: number
  ) => ipcRenderer.invoke('bot:runBacktest', symbol, start, end, shareAmount, gridStep),
  onBacktestUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('bt:update', (_event, data) => callback(data))
  },
  onBacktestProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('bt:progress', (_event, progress) => callback(progress))
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
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
