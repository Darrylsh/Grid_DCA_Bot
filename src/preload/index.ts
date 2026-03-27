import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import { ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  startBot: () => ipcRenderer.invoke('bot:start'),
  stopBot: () => ipcRenderer.invoke('bot:stop'),
  getSettings: () => ipcRenderer.invoke('bot:getSettings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('bot:saveSettings', settings),
  manualTrade: (symbol: string, side: string) => ipcRenderer.invoke('bot:manualTrade', symbol, side),
  
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
  getWhitelist: () => ipcRenderer.invoke('bot:getWhitelist'),
  saveWhitelist: (list: any[]) => ipcRenderer.invoke('bot:saveWhitelist', list),
  getDecoupledWhitelist: () => ipcRenderer.invoke('bot:getDecoupledWhitelist'),
  saveDecoupledWhitelist: (list: string[]) => ipcRenderer.invoke('bot:saveDecoupledWhitelist', list),
  getStats: () => ipcRenderer.invoke('bot:getStats'),
  toggleBotManualMode: (symbol: string, enable: boolean) => ipcRenderer.invoke('bot:toggleBotManualMode', symbol, enable),
  runBacktest: (symbol: string, strategy: string, start: string, end: string, initialEquity: number, isDecoupled: boolean) => ipcRenderer.invoke('bot:runBacktest', symbol, strategy, start, end, initialEquity, isDecoupled),
  getRecentTrades: (args: { mode: string, limit: number }) => ipcRenderer.invoke('bot:getRecentTrades', args),
  clearTradeHistory: (mode: string) => ipcRenderer.invoke('bot:clearTradeHistory', mode)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
