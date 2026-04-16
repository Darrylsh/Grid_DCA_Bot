// Filter Binance PING/PONG logs that clutter the terminal
const filterBinanceHeartbeats = (method: 'log' | 'info' | 'warn' | 'debug'): void => {
  const original = console[method]
  // @ts-ignore: Overriding console method for filtering heartbeat logs
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
// @ts-ignore: Overriding stdout.write for filtering heartbeat logs
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

import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { readFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { io as ioClient } from 'socket.io-client'
import * as dotenv from 'dotenv'

dotenv.config({ path: join(__dirname, '../../.env') })

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length > 0) {
    const mainWindow = windows[0]
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

const SERVER_URL = process.env.HEADLESS_SERVER_URL || 'http://192.168.10.42:3030'
const socket = ioClient(SERVER_URL)
let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

interface SocketResponse {
  success: boolean
  data?: unknown
  error?: string
}

const socketCall = (event: string, ...args: unknown[]): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, ...args, (err: unknown, res: SocketResponse | undefined) => {
      if (err) return reject(new Error(`Socket timeout on ${event}`))
      if (!res) return resolve(undefined)
      if (res.success) return resolve(res.data)
      return reject(new Error(res.error || 'Unknown error'))
    })
  })
}

function createTray(mainWindow: BrowserWindow): void {
  if (tray) return

  const iconPath = icon
  const trayIcon = nativeImage.createFromPath(iconPath)
  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: `Connection: ${socket.connected ? 'Connected' : 'Disconnected'}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip(`AlgoBot Desktop - ${socket.connected ? 'Connected' : 'Disconnected'}`)
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function updateTrayMenu(): void {
  if (!tray) return

  if (!mainWindow) return
  const win = mainWindow

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (win.isVisible()) {
          win.hide()
        } else {
          win.show()
          win.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: `Connection: ${socket.connected ? 'Connected' : 'Disconnected'}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

function createWindow(settings: Record<string, string>): void {
  let windowState = {
    width: 1200,
    height: 750,
    x: undefined as number | undefined,
    y: undefined as number | undefined,
    isMaximized: false
  }
  try {
    if (settings.window_state) {
      windowState = JSON.parse(settings.window_state)
    }
  } catch (e) {
    console.error('Failed to parse window state:', e)
  }

  const window = new BrowserWindow({
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

  createTray(window)
  mainWindow = window // Set global reference

  if (windowState.isMaximized) window.maximize()

  window.on('ready-to-show', () => {
    window.show()
    fwd('bot:connectionStatus')(socket.connected)
  })

  // Debounced window state save
  let saveTimeout: NodeJS.Timeout | undefined
  const saveWindowState = (): void => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(async () => {
      const bounds = window.getBounds()
      const isMaximized = window.isMaximized()
      await socketCall(
        'updateSetting',
        'window_state',
        JSON.stringify({ ...bounds, isMaximized })
      ).catch(console.error)
    }, 1000)
  }
  window.on('resize', saveWindowState)
  window.on('move', saveWindowState)

  // Forward bot events to renderer
  const fwd =
    (channel: string) =>
    (data: unknown): void => {
      if (!window.isDestroyed()) window.webContents.send(channel, data)
    }

  socket.on('market_update', fwd('bot:marketUpdate'))
  socket.on('trade_executed', fwd('bot:tradeExecuted'))
  socket.on('balance_update', fwd('bot:balanceUpdate'))
  socket.on('whitelist_updated', fwd('bot:whitelistUpdated'))
  socket.on('settings_updated', fwd('bot:settingsUpdated'))
  socket.on('grid_levels_update', fwd('bot:gridLevelsUpdate'))
  socket.on('bot_log', fwd('bot:botLog'))

  socket.on('connect', () => {
    fwd('bot:connectionStatus')(true)
    if (tray) {
      tray.setToolTip('AlgoBot Desktop - Connected')
      updateTrayMenu()
    }
  })
  socket.on('disconnect', () => {
    fwd('bot:connectionStatus')(false)
    if (tray) {
      tray.setToolTip('AlgoBot Desktop - Disconnected')
      updateTrayMenu()
    }
  })

  window.on('close', (event) => {
    if (tray !== null) {
      event.preventDefault()
      window.hide()
      return
    }
  })

  window.on('closed', () => {
    socket.off('market_update')
    socket.off('trade_executed')
    socket.off('balance_update')
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  // Initialize by fetching settings via socket
  const initialSettings = (await socketCall('getSettings').catch(() => ({}))) as Record<
    string,
    string
  >

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

  // Socket proxies for all original bot features
  handleIPC('bot:start', async () => true)

  handleIPC('bot:getConnectionStatus', async () => socket.connected)

  handleIPC('bot:registerBaseShare', async (_, symbol: string, price: number, quantity: number) => {
    await socketCall('registerBaseShare', symbol, price, quantity, price * quantity)
    return true
  })

  handleIPC('bot:sellBaseShare', async (_, symbol: string) => {
    await socketCall('sellBaseShare', symbol)
    return true
  })

  handleIPC('bot:clearGridLevels', async (_, symbol: string) => {
    await socketCall('clearGridLevels', symbol)
    return true
  })

  handleIPC('bot:sellLowestGridLevel', async (_, symbol: string) => {
    await socketCall('sellLowestGridLevel', symbol)
    return true
  })

  handleIPC('bot:getGridState', async () => await socketCall('getFullGridState', undefined))

  handleIPC('bot:deleteBaseShare', async (_, symbol: string) => {
    await socketCall('deleteBaseShare', symbol)
    return true
  })

  handleIPC('bot:togglePause', async (_, symbol: string) => {
    await socketCall('togglePause', symbol)
    return true
  })

  handleIPC('bot:manualTrade', async (_, symbol: string, side: 'BUY' | 'SELL') =>
    socketCall('executeManualTrade', symbol, side, 0, 0, 'MANUAL_TRADE')
  )

  handleIPC(
    'bot:runBacktest',
    async (
      event,
      symbol: string,
      start: string,
      end: string,
      shareAmount: number,
      gridStep: number
    ) => {
      // Temporarily bind backtest streams from socket to renderer
      const onProgress = (p: unknown): void => event.sender.send('bt:progress', p)
      const onUpdate = (u: unknown): void => event.sender.send('bt:update', u)
      socket.on('bt:progress', onProgress)
      socket.on('bt:update', onUpdate)

      try {
        return await new Promise((resolve, reject) => {
          socket
            .timeout(1800000)
            .emit(
              'runBacktest',
              symbol,
              start,
              end,
              shareAmount,
              gridStep,
              (err: unknown, res: SocketResponse | undefined) => {
                if (err) return reject(new Error(`Socket timeout on runBacktest`))
                if (!res) return resolve(undefined)
                if (res.success) return resolve(res.data)
                return reject(new Error(res.error || 'Unknown error'))
              }
            )
        })
      } finally {
        socket.off('bt:progress', onProgress)
        socket.off('bt:update', onUpdate)
      }
    }
  )

  handleIPC('bot:getWhitelist', async () => await socketCall('getWhitelist'))
  handleIPC('bot:getVersion', async () => {
    const backendVersion = await socketCall('getVersion').catch(() => 'unknown')
    let expectedBackend = 'unknown'
    try {
      const pkgPath = join(__dirname, '../../package.json')
      // require('fs') could be used or we can just import fs.
      // It's safer to require inline if not imported at top
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      expectedBackend = pkg.expectedBackendVersion || 'unknown'
    } catch {
      // ignore
    }

    return { frontend: app.getVersion(), backend: backendVersion, expectedBackend }
  })
  handleIPC('bot:saveWhitelist', async (_, symbols: string[]) => {
    await socketCall('updateWhitelist', symbols)
    return true
  })

  handleIPC(
    'bot:getSettings',
    async () => (await socketCall('getSettings')) as Record<string, string>
  )
  handleIPC('bot:saveSettings', async (_, { key, value }: { key: string; value: string }) => {
    await socketCall('updateSetting', key, value)
    return true
  })

  handleIPC('bot:getStats', async () => {
    const metrics = (await socketCall('getMetrics').catch(() => ({}))) as Record<string, unknown>
    const unrealizedPnl = await socketCall('getUnrealizedPnl').catch(() => 0)
    return { ...metrics, unrealizedPnl }
  })

  handleIPC('bot:getRecentTrades', async () => await socketCall('getRecentTrades').catch(() => []))
  handleIPC('bot:getTradesByTimeRange', async (_, mode: string, startMs: number, endMs: number) => {
    return await socketCall('getTradesByTimeRange', mode, startMs, endMs).catch(() => [])
  })
  handleIPC('bot:clearTradeHistory', async () => true)
  handleIPC('bot:wipeAllData', async () => true)

  handleIPC('bot:getDecoupledWhitelist', async () => [])
  handleIPC('bot:saveDecoupledWhitelist', async () => true)
  handleIPC('bot:toggleBotManualMode', async () => true)

  // ---------------------------------------------------------------------------
  // Auto-updater configuration
  // ---------------------------------------------------------------------------

  // Configure autoUpdater
  autoUpdater.autoDownload = false // Let user choose when to download
  autoUpdater.allowPrerelease = false // Only stable releases
  autoUpdater.autoInstallOnAppQuit = true // Install on quit if update downloaded
  autoUpdater.fullChangelog = true // Include full changelog in update info

  // Set feed URL for GitHub releases
  if (app.isPackaged) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'Darrylsh',
      repo: 'Grid_DCA_Bot',
      releaseType: 'release',
      channel: 'latest'
    })
  }

  console.log(
    `[AutoUpdater] Configured for GitHub: Darrylsh/Grid_DCA_Bot, app version: ${app.getVersion()}, packaged: ${app.isPackaged}`
  )

  // Forward auto-updater events to renderer
  const sendUpdateStatus = (channel: string, data?: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...')
    sendUpdateStatus('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] Update available: ${info.version}`)
    sendUpdateStatus('update:available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[AutoUpdater] No updates available (current: ${app.getVersion()})`)
    sendUpdateStatus('update:not-available', info)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    console.log(`[AutoUpdater] Download progress: ${Math.floor(progressObj.percent)}%`)
    sendUpdateStatus('update:progress', progressObj)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[AutoUpdater] Update downloaded: ${info.version}, ready to install`)
    sendUpdateStatus('update:downloaded', info)
  })

  autoUpdater.on('error', (error) => {
    console.error(`[AutoUpdater] Error: ${error.message}`)
    sendUpdateStatus('update:error', error.message)
  })

  // IPC handlers for update actions
  handleIPC('update:check', async () => {
    try {
      console.log('[AutoUpdater] Manual update check requested')

      // Skip update checks in development mode (not packaged)
      if (!app.isPackaged) {
        console.log('[AutoUpdater] Skipping update check in development mode')
        return { success: false, error: 'Auto-update is disabled in development mode' }
      }

      // Check for updates, will trigger events above
      const result = await autoUpdater.checkForUpdates()
      console.log(`[AutoUpdater] Update check result: ${result ? 'update available' : 'no update'}`)
      return { success: true, data: result?.updateInfo }
    } catch (error) {
      console.error(`[AutoUpdater] Update check failed: ${(error as Error).message}`)
      return { success: false, error: (error as Error).message }
    }
  })

  handleIPC('update:download', async () => {
    try {
      console.log('[AutoUpdater] Download requested')
      // Download the update, will trigger progress events
      await autoUpdater.downloadUpdate()
      console.log('[AutoUpdater] Download completed successfully')
      return { success: true }
    } catch (error) {
      console.error(`[AutoUpdater] Download failed: ${(error as Error).message}`)
      return { success: false, error: (error as Error).message }
    }
  })

  handleIPC('update:install', async () => {
    try {
      console.log('[AutoUpdater] Installation requested, quitting and installing...')
      // Quit and install the update
      autoUpdater.quitAndInstall()
      return { success: true }
    } catch (error) {
      console.error(`[AutoUpdater] Install failed: ${(error as Error).message}`)
      return { success: false, error: (error as Error).message }
    }
  })

  handleIPC('update:get-current-version', async () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      platform: process.platform,
      arch: process.arch
    }
  })

  createWindow(initialSettings)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow((await socketCall('getSettings').catch(() => ({}))) as Record<string, string>)
    }
  })
})

app.on('before-quit', () => {
  if (tray) {
    tray.destroy()
    tray = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  if (tray === null) app.quit()
})
