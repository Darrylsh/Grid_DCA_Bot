// Filter Binance PING/PONG logs that clutter the terminal
const filterBinanceHeartbeats = (method: 'log' | 'info' | 'warn' | 'debug'): void => {
  const original = console[method]
  // @ts-ignore
  console[method] = (...args: unknown[]): void => {
    const msg = args.map((arg) => String(arg)).join(' ')
    if (
      msg.includes('Received PING from server') ||
      msg.includes("Responded PONG to server's PING message") ||
      (msg.toLowerCase().includes('ping') && msg.toLowerCase().includes('server')) ||
      (msg.toLowerCase().includes('pong') && msg.toLowerCase().includes('server'))
    ) {
      return
    }
    original.apply(console, args as unknown[])
  }
}
;(['log', 'info', 'warn', 'debug'] as const).forEach(filterBinanceHeartbeats)

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
// @ts-ignore
process.stdout.write = (
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
  callback?: (error: Error | null | undefined) => void
): boolean => {
  const msg = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()
  if (
    msg.includes('Received PING from server') ||
    msg.includes("Responded PONG to server's PING message")
  ) {
    return true
  }
  return originalStdoutWrite(chunk, encoding as BufferEncoding, callback)
}

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import {
  botEvents,
  startBot,
  executeManualTrade,
  reloadWhitelist,
  updateSettingsLocally,
  reloadDecoupledList,
  getUnrealizedPnl,
  getCurrentMode,
  registerBaseShare,
  sellBaseShare,
  clearGridLevels,
  getFullGridState
} from './bot'

import {
  getWhitelist,
  updateWhitelist,
  getSettings,
  updateSetting,
  getMetrics,
  getRecentTrades,
  clearTradeHistory
} from './db'

import { runBacktest } from './backtest'

function createWindow(settings: Record<string, string>): void {
  let windowState = { width: 1200, height: 750, x: undefined as number | undefined, y: undefined as number | undefined, isMaximized: false }
  try {
    if (settings.window_state) {
      windowState = JSON.parse(settings.window_state)
    }
  } catch (e) {
    console.error('Failed to parse window state:', e)
  }

  const mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x ?? undefined,
    y: windowState.y ?? undefined,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (windowState.isMaximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Debounced window state save
  let saveTimeout: NodeJS.Timeout | undefined
  const saveWindowState = (): void => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      const bounds = mainWindow.getBounds()
      const isMaximized = mainWindow.isMaximized()
      updateSetting('window_state', JSON.stringify({ ...bounds, isMaximized }))
    }, 1000)
  }
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)

  // Forward bot events to renderer
  const fwd = (channel: string) => (data: unknown): void => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data)
  }
  botEvents.on('market_update', fwd('bot:marketUpdate'))
  botEvents.on('trade_executed', fwd('bot:tradeExecuted'))
  botEvents.on('monitoring_update', fwd('bot:monitoringUpdate'))
  botEvents.on('balance_update', fwd('bot:balanceUpdate'))

  mainWindow.on('closed', () => {
    botEvents.removeAllListeners('market_update')
    botEvents.removeAllListeners('trade_executed')
    botEvents.removeAllListeners('monitoring_update')
    botEvents.removeAllListeners('balance_update')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  // Initialize DB and get settings BEFORE creating window
  const { initDb } = await import('./db')
  await initDb()
  const initialSettings = getSettings()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const handleIPC = (
    channel: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }

  // ---- Bot lifecycle ----
  handleIPC('bot:start', async () => startBot())

  // ---- Grid-specific IPC ----
  handleIPC('bot:registerBaseShare', async (_, symbol: string, price: number, quantity: number) => {
    await registerBaseShare(symbol, price, quantity)
    return true
  })
  handleIPC('bot:sellBaseShare', async (_, symbol: string) => {
    await sellBaseShare(symbol)
    return true
  })
  handleIPC('bot:clearGridLevels', async (_, symbol: string) => {
    await clearGridLevels(symbol)
    return true
  })
  handleIPC('bot:getGridState', async () => getFullGridState())
  handleIPC('bot:deleteBaseShare', async (_, symbol: string) => {
    const { deleteGridState } = await import('./db')
    const { deleteBaseShareLocally } = await import('./bot')
    deleteGridState(symbol, getCurrentMode())
    deleteBaseShareLocally(symbol)
    return true
  })

  // ---- Manual trade (sets base share on BUY, sells base on SELL) ----
  handleIPC('bot:manualTrade', async (_, symbol: string, side: 'BUY' | 'SELL') =>
    executeManualTrade(symbol, side)
  )

  // ---- Backtest ----
  handleIPC(
    'bot:runBacktest',
    async (event, symbol: string, start: string, end: string, shareAmount: number, gridStep: number) => {
      return await runBacktest(symbol, start, end, shareAmount, gridStep, (progress, interimResults) => {
        event.sender.send('bt:progress', progress)
        if (interimResults) {
          event.sender.send('bt:update', interimResults)
        }
      })
    }
  )

  // ---- Whitelist ----
  handleIPC('bot:getWhitelist', async () => getWhitelist())
  handleIPC('bot:saveWhitelist', async (_, symbols: string[]) => {
    updateWhitelist(symbols)
    await reloadWhitelist(symbols)
    return true
  })

  // ---- Settings ----
  handleIPC('bot:getSettings', async () => getSettings())
  handleIPC('bot:saveSettings', async (_, { key, value }: { key: string; value: string }) => {
    updateSetting(key, value)
    updateSettingsLocally({ [key]: value })
    return true
  })

  // ---- Stats ----
  handleIPC('bot:getStats', async () => {
    const mode = getCurrentMode()
    const metrics = getMetrics(mode)
    const unrealizedPnl = getUnrealizedPnl()
    return { ...metrics, unrealizedPnl }
  })

  // ---- Trade history ----
  handleIPC('bot:getRecentTrades', async (_, { mode, limit }: { mode: string; limit: number }) =>
    getRecentTrades(mode, limit)
  )
  handleIPC('bot:clearTradeHistory', async (_, mode: string) => clearTradeHistory(mode))

  // ---- Legacy no-op handlers (kept for smooth transition) ----
  handleIPC('bot:getDecoupledWhitelist', async () => [])
  handleIPC('bot:saveDecoupledWhitelist', async () => true)
  handleIPC('bot:toggleBotManualMode', async () => true)

  createWindow(initialSettings)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(getSettings())
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
