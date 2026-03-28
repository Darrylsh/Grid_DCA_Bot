// Filter Binance PING/PONG logs that clutter the terminal
// This is placed at the top to ensure it's active before other modules are imported.
const filterBinanceHeartbeats = (method: 'log' | 'info' | 'warn' | 'debug'): void => {
  const original = console[method]
  // @ts-ignore - overriding built-in console methods
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
    original.apply(console, args as any[])
  }
}
;(['log', 'info', 'warn', 'debug'] as const).forEach(filterBinanceHeartbeats)

// Also wrap process.stdout.write as some libraries bypass console
const originalStdoutWrite = process.stdout.write.bind(process.stdout)
// @ts-ignore - wrapping native method
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

const originalStderrWrite = process.stderr.write.bind(process.stderr)
// @ts-ignore - wrapping native method
process.stderr.write = (
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
  return originalStderrWrite(chunk, encoding as BufferEncoding, callback)
}

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { botEvents, startBot, executeManualTrade, reloadWhitelist, updateSettingsLocally, reloadDecoupledList, getUnrealizedPnl, getCurrentMode, toggleBotManualMode } from './bot'
import { getWhitelist, updateWhitelist, getSettings, updateSetting, getDecoupledWhitelist, updateDecoupledWhitelist, getMetrics, getRecentTrades } from './db'
import { runBacktest } from './backtest'

function createWindow(settings: Record<string, string>): void {
  let windowState = { width: 900, height: 670, x: undefined, y: undefined, isMaximized: false };
  try {
    if (settings.window_state) {
      windowState = JSON.parse(settings.window_state);
    }
  } catch (e) {
    console.error('Failed to parse window state:', e);
  }

  // Create the browser window.
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

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Debounced Window State Save
  let saveTimeout: NodeJS.Timeout | undefined;
  const saveWindowState = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      const bounds = mainWindow.getBounds();
      const isMaximized = mainWindow.isMaximized();
      const state = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized
      };
      await updateSetting('window_state', JSON.stringify(state));
    }, 1000);
  };

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Listen to bot events and forward to renderer
  const forwardEvent = (channel: string) => (data: unknown) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  botEvents.on('market_update', forwardEvent('bot:marketUpdate'))
  botEvents.on('trade_executed', forwardEvent('bot:tradeExecuted'))
  botEvents.on('monitoring_update', forwardEvent('bot:monitoringUpdate'))
  botEvents.on('balance_update', forwardEvent('bot:balanceUpdate'))

  // Cleanup on close
  mainWindow.on('closed', () => {
    botEvents.removeAllListeners('market_update')
    botEvents.removeAllListeners('trade_executed')
    botEvents.removeAllListeners('monitoring_update')
    botEvents.removeAllListeners('balance_update')
  })

  // Bot background loops will be started by the UI via IPC
  // startBot().catch(console.error)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  const initialSettings = await getSettings()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC bot hooks - Defensive registration to prevent "second handler" errors during HMR
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleIPC = (channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }

  handleIPC('bot:start', async () => startBot())
  handleIPC('bot:runBacktest', async (event, symbol, strategy, start, end, initialEquity, isDecoupled) => {
    return await runBacktest(symbol, strategy, new Date(start), new Date(end), initialEquity, isDecoupled, (progress, interimResults) => {
      event.sender.send('bt:progress', progress)
      if (interimResults) {
        event.sender.send('bt:update', interimResults)
      }
    })
  })
  handleIPC('bot:manualTrade', async (_, symbol, side) => executeManualTrade(symbol, side))
  handleIPC('bot:getWhitelist', async () => await getWhitelist())
  handleIPC('bot:saveWhitelist', async (_, list) => {
    await updateWhitelist(list)
    await reloadWhitelist(list)
    return true
  })
  handleIPC('bot:getDecoupledWhitelist', async () => await getDecoupledWhitelist())
  handleIPC('bot:saveDecoupledWhitelist', async (_, list) => {
    await updateDecoupledWhitelist(list)
    await reloadDecoupledList()
    return true
  })
  handleIPC('bot:getSettings', async () => await getSettings())
  handleIPC('bot:saveSettings', async (_, { key, value }) => {
    await updateSetting(key, value)
    await updateSettingsLocally({ [key]: value })
    return true
  })
  handleIPC('bot:getStats', async () => {
    const mode = getCurrentMode()
    const metrics = await getMetrics(mode)
    const unrealizedPnl = getUnrealizedPnl()
    return { ...metrics, unrealizedPnl }
  })
  handleIPC('bot:toggleBotManualMode', async (_, symbol, enable) => {
    toggleBotManualMode(symbol, enable)
    return true
  })
  handleIPC('bot:getRecentTrades', async (_, { mode, limit }) => {
    return await getRecentTrades(mode, limit)
  })
  handleIPC('bot:clearTradeHistory', async (_, mode) => {
    const { clearTradeHistory } = require('./db')
    return await clearTradeHistory(mode)
  })

  createWindow(initialSettings)

  app.on('activate', async function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const settings = await getSettings()
      createWindow(settings)
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
