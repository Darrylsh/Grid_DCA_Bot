import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  Trade,
  MarketUpdate,
  BalanceUpdate,
  Stats,
  Settings as AppSettings,
  BacktestResults,
  VersionInfo,
  Toast as ToastType
} from '@shared/types'
import buySound from '../assets/buy.mp3'
import sellSound from '../assets/sell.mp3'

// Utility function
const stripUSDT = (s: string): string => (s ? s.replace('USDT', '') : s)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const useAppState = () => {
  // All state declarations from App.tsx
  const [activeTab, setActiveTab] = useState('dashboard')
  const [balances, setBalances] = useState<BalanceUpdate>({ USDT: 0, BNB: 0 })
  const [marketData, setMarketData] = useState<Record<string, MarketUpdate>>({})
  const [logs, setLogs] = useState<Trade[]>([])
  const [botStartTime, setBotStartTime] = useState<number | null>(null)
  const [uptime, setUptime] = useState('00:00:00')
  const [whitelist, setWhitelist] = useState<string[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  const [tradingMode, setTradingMode] = useState('LIVE')
  const [settings, setSettings] = useState<AppSettings>({
    capital_type: 'FIXED',
    capital_value: '100',
    grid_step_percent: '3'
  })
  const [stats, setStats] = useState<Stats>({
    totalPnl: 0,
    totalFees: 0,
    avgRoi: 0,
    winRate: 0,
    fillRate: 0,
    unrealizedPnl: 0,
    totalTrades: 0
  })
  const [tickFlashing, setTickFlashing] = useState(false)
  const [registeringSymbol, setRegisteringSymbol] = useState<string | null>(null)

  // Backtest state
  const [btSymbol, setBtSymbol] = useState('')
  const [btStart, setBtStart] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [btEnd, setBtEnd] = useState(new Date().toISOString().split('T')[0])
  const [btShareAmount, setBtShareAmount] = useState('100')
  const [btGridStep, setBtGridStep] = useState('3')
  const [btLoading, setBtLoading] = useState(false)
  const [btResults, setBtResults] = useState<BacktestResults | null>(null)
  const [btError, setBtError] = useState<string | null>(null)
  const [btProgress, setBtProgress] = useState(0)
  const [btStatus, setBtStatus] = useState('')

  // Reports state
  const [reportStart, setReportStart] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [reportEnd, setReportEnd] = useState(new Date().toISOString().split('T')[0])
  const [reportData, setReportData] = useState<Trade[]>([])
  const [reportLoading, setReportLoading] = useState(false)

  // UI state
  const [toast, setToast] = useState<ToastType | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateNotAvailable, setUpdateNotAvailable] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState(0)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [electronVersion, setElectronVersion] = useState<string>('')

  // Refs
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const whitelistRef = useRef<string[]>([])

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(t)
    }
    return () => {}
  }, [toast])

  // Uptime ticker
  useEffect(() => {
    const t = setInterval(() => {
      if (!botStartTime) return
      const diff = Math.floor((Date.now() - botStartTime) / 1000)
      const h = Math.floor(diff / 3600)
        .toString()
        .padStart(2, '0')
      const m = Math.floor((diff % 3600) / 60)
        .toString()
        .padStart(2, '0')
      const s = (diff % 60).toString().padStart(2, '0')
      setUptime(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(t)
  }, [botStartTime])

  // Keep whitelist ref up to date
  useEffect(() => {
    whitelistRef.current = whitelist
  }, [whitelist])

  // Clean up marketData when whitelist changes (remove symbols not in whitelist and without base share)
  useEffect(() => {
    setMarketData((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((symbol) => {
        if (!whitelist.includes(symbol) && !next[symbol]?.hasBaseShare) {
          delete next[symbol]
        }
      })
      return next
    })
  }, [whitelist])

  // Fetch logs when trading mode changes
  useEffect(() => {
    if (window.api) {
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }, [tradingMode])

  // Fetch reports when tab changes
  useEffect(() => {
    if (activeTab === 'reports') {
      const fetchReports = async (): Promise<void> => {
        setReportLoading(true)
        try {
          const startMs = new Date(reportStart + 'T00:00:00.000Z').getTime()
          const endMs = new Date(reportEnd + 'T23:59:59.999Z').getTime()
          const trades = await window.api.getTradesByTimeRange(tradingMode, startMs, endMs)
          setReportData(trades || [])
        } catch (err) {
          console.error('Failed to fetch reports', err)
          setReportData([])
        }
        setReportLoading(false)
      }
      fetchReports()
    }
  }, [activeTab, reportStart, reportEnd, tradingMode])

  // Main initialization effect
  useEffect(() => {
    let statsInterval: ReturnType<typeof setInterval>
    let tickTimer: ReturnType<typeof setTimeout>
    let handleUpdateChecking: (() => void) | null = null
    let handleUpdateAvailable: ((info: any) => void) | null = null
    let handleUpdateNotAvailable: ((info: any) => void) | null = null
    let handleUpdateProgress: ((progress: any) => void) | null = null
    let handleUpdateDownloaded: ((info: any) => void) | null = null
    let handleUpdateError: ((error: string) => void) | null = null
    if (window.api) {
      window.api.getConnectionStatus?.().then((status: boolean) => setIsConnected(status))
      window.api.onConnectionStatus?.((status: boolean) => setIsConnected(status))
      window.api.onWhitelistUpdated?.(() => {
        window.api.getWhitelist().then((list) => {
          setWhitelist(list)
          whitelistRef.current = list
        })
      })
      window.api.onMarketUpdate((data) => {
        // Keep symbol if it's in whitelist or has an active base share
        if (whitelistRef.current.includes(data.symbol) || data.hasBaseShare) {
          setMarketData((prev) => ({ ...prev, [data.symbol]: data }))
        } else {
          // Remove symbol from marketData if not in whitelist and no base share
          setMarketData((prev) => {
            const next = { ...prev }
            delete next[data.symbol]
            return next
          })
        }
        if (data.botStartTime) setBotStartTime(data.botStartTime)
        setTickFlashing(true)
        if (tickTimer) clearTimeout(tickTimer)
        tickTimer = setTimeout(() => setTickFlashing(false), 50)
      })
      window.api.onBalanceUpdate((data) => setBalances(data))
      window.api.onTradeExecuted((data) => {
        // Play sounds
        if (data.side === 'BUY') new Audio(buySound).play().catch(() => {})
        if (data.side === 'SELL') new Audio(sellSound).play().catch(() => {})

        // Refresh from DB
        window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
        setToast({
          message: `[${data.side}] ${stripUSDT(data.symbol)} @ $${Number(data.price).toFixed(4)} — ${data.reason || ''}`,
          type: 'success'
        })
      })
      window.api.onBacktestProgress?.((p) => setBtProgress(p))
      window.api.onBacktestUpdate?.((data) => {
        if ('status' in data && data.status === 'fetching') {
          setBtStatus(data.message || 'Downloading candles...')
          return
        }
        // Type guard: ensure data is BacktestResults
        if ('realizedPnl' in data && 'chartData' in data) {
          setBtResults(data)
          setBtStatus('')
        }
      })

      window.api.getWhitelist().then((list) => {
        const symbols = Array.isArray(list)
          ? list.map((i: unknown) => (typeof i === 'string' ? i : (i as { symbol: string }).symbol))
          : []
        setWhitelist(symbols)
        if (symbols.length > 0 && !btSymbol) setBtSymbol(symbols[0])
      })
      window.api.getSettings().then((res) => {
        if (res.trading_mode) setTradingMode(res.trading_mode)
        if (res.grid_step_percent) setBtGridStep(res.grid_step_percent)
        if (res.capital_value) setBtShareAmount(res.capital_value)
        setSettings((prev) => ({ ...prev, ...res }))
      })

      const refreshStats = (): Promise<void> => window.api.getStats().then(setStats)
      refreshStats()
      statsInterval = setInterval(refreshStats, 10000)
      window.api.startBot()
      window.api.getVersion?.().then((v) => setVersions(v))

      // Auto-update event listeners
      handleUpdateChecking = () => {
        setUpdateChecking(true)
        setUpdateAvailable(false)
        setUpdateNotAvailable(false)
        setUpdateDownloaded(false)
        setUpdateError(null)
      }
      handleUpdateAvailable = (info: any) => {
        setUpdateChecking(false)
        setUpdateAvailable(true)
        setUpdateNotAvailable(false)
        setUpdateInfo(info)
        setUpdateError(null)
      }
      handleUpdateNotAvailable = (info: any) => {
        setUpdateChecking(false)
        setUpdateAvailable(false)
        setUpdateNotAvailable(true)
        setUpdateInfo(info)
        setUpdateError(null)
      }
      handleUpdateProgress = (progress: any) => {
        setUpdateDownloading(true)
        setUpdateDownloadProgress(progress.percent || 0)
      }
      handleUpdateDownloaded = (info: any) => {
        setUpdateDownloading(false)
        setUpdateDownloaded(true)
        setUpdateNotAvailable(false)
        setUpdateInfo(info)
        setUpdateError(null)
      }
      handleUpdateError = (error: string) => {
        setUpdateChecking(false)
        setUpdateDownloading(false)
        setUpdateNotAvailable(false)
        setUpdateError(error)
      }

      window.api.onUpdateChecking?.(handleUpdateChecking)
      window.api.onUpdateAvailable?.(handleUpdateAvailable)
      window.api.onUpdateNotAvailable?.(handleUpdateNotAvailable)
      window.api.onUpdateProgress?.(handleUpdateProgress)
      window.api.onUpdateDownloaded?.(handleUpdateDownloaded)
      window.api.onUpdateError?.(handleUpdateError)

      // Get current electron app version
      if (typeof window.api.getCurrentVersion === 'function') {
        window.api.getCurrentVersion().then((v) => {
          setElectronVersion(v?.version || '')
        })
      } else {
        setElectronVersion('')
      }
    }
    return () => {
      if (statsInterval) clearInterval(statsInterval)
      if (tickTimer) clearTimeout(tickTimer)
      // Clean up update listeners
      if (handleUpdateChecking) window.api.offUpdateChecking?.(handleUpdateChecking)
      if (handleUpdateAvailable) window.api.offUpdateAvailable?.(handleUpdateAvailable)
      if (handleUpdateNotAvailable) window.api.offUpdateNotAvailable?.(handleUpdateNotAvailable)
      if (handleUpdateProgress) window.api.offUpdateProgress?.(handleUpdateProgress)
      if (handleUpdateDownloaded) window.api.offUpdateDownloaded?.(handleUpdateDownloaded)
      if (handleUpdateError) window.api.offUpdateError?.(handleUpdateError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handlers
  const debouncedSaveWhitelist = useCallback((list: string[]) => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = setTimeout(() => {
      window.api.saveWhitelist(list)
    }, 500)
  }, [])

  const handleAddSymbol = (): void => {
    if (!newSymbol) return
    let s = newSymbol.toUpperCase()
    if (!s.endsWith('USDT')) s += 'USDT'
    if (whitelist.includes(s)) return
    setWhitelist((prev) => {
      const list = [...prev, s]
      whitelistRef.current = list
      debouncedSaveWhitelist(list)
      return list
    })
    if (!btSymbol) setBtSymbol(s)
    setNewSymbol('')
  }

  const handleRemoveSymbol = (sym: string): void => {
    setWhitelist((prev) => {
      const list = prev.filter((w) => w !== sym)
      whitelistRef.current = list
      debouncedSaveWhitelist(list)
      return list
    })
    // Automatically refresh grid state by purging from local market data if no active position
    setMarketData((prev) => {
      const next = { ...prev }
      if (!next[sym]?.hasBaseShare) {
        delete next[sym]
      }
      return next
    })
  }

  const updateSetting = (key: string, value: string): void => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    window.api.saveSettings({ key, value })
  }

  const checkForUpdates = async (): Promise<void> => {
    try {
      // Check if API method exists
      if (typeof window.api.checkForUpdates !== 'function') {
        setUpdateError('Auto-update not available in this version')
        return
      }

      const result = await window.api.checkForUpdates()
      if (!result?.success) {
        setUpdateError(result?.error || 'Update check failed')
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    try {
      // Check if API method exists
      if (typeof window.api.downloadUpdate !== 'function') {
        setUpdateError('Auto-update not available in this version')
        return
      }

      const result = await window.api.downloadUpdate()
      if (!result?.success) {
        setUpdateError(result?.error || 'Download failed')
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const installUpdate = async (): Promise<void> => {
    try {
      // Check if API method exists
      if (typeof window.api.installUpdate !== 'function') {
        setUpdateError('Auto-update not available in this version')
        return
      }

      const result = await window.api.installUpdate()
      if (!result?.success) {
        setUpdateError(result?.error || 'Installation failed')
      }
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const toggleTradingMode = (): void => {
    const newMode = tradingMode === 'LIVE' ? 'SIMULATION' : 'LIVE'
    setTradingMode(newMode)
    window.api.saveSettings({ key: 'trading_mode', value: newMode })
  }

  const handleResetStats = async (): Promise<void> => {
    const confirmed = await window.api.showConfirm({
      title: 'Reset Trade History',
      message: `Reset all ${tradingMode} trade history?`,
      detail: 'This action cannot be undone and will reset all profit metrics.',
      type: 'warning'
    })

    if (confirmed) {
      await window.api.clearTradeHistory(tradingMode)
      window.api.getStats().then(setStats)
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }

  const handleWipeAllData = async (): Promise<void> => {
    const confirmed = await window.api.showConfirm({
      title: 'Full Data Wipe',
      message: `WIPE ALL DATA for ${tradingMode}?`,
      detail:
        'This will permanently delete all base shares, grid levels, and trade history. This action cannot be undone.',
      type: 'error'
    })

    if (confirmed) {
      await window.api.wipeAllData(tradingMode)
      setToast({ message: `Full data wipe completed for ${tradingMode}`, type: 'success' })
      // Refresh all state
      window.api.getGridState().then(setMarketData)
      window.api.getStats().then(setStats)
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }

  const handleDeleteBaseShare = async (symbol: string): Promise<void> => {
    const confirmed = await window.api.showConfirm({
      title: 'Delete Local Record',
      message: `Delete local record for ${stripUSDT(symbol)}?`,
      detail:
        "This will NOT sell your coins on Binance. It only clears the bot's tracking state for this symbol.",
      type: 'question'
    })

    if (confirmed) {
      await window.api.deleteBaseShare(symbol)
      setToast({ message: `Record deleted for ${stripUSDT(symbol)}`, type: 'success' })
      // Refresh state
      window.api.getGridState().then(setMarketData)
    }
  }

  const handleSetBase = async (symbol: string): Promise<void> => {
    setRegisteringSymbol(symbol)
    try {
      // price=0 and qty=0 signals the bot to use capital_value setting for a market buy
      await window.api.registerBaseShare(symbol, 0, 0)
      setToast({
        message: `Market buy submitted for ${stripUSDT(symbol)} — check activity log`,
        type: 'success'
      })
    } catch (e: unknown) {
      setToast({
        message: `Failed to buy: ${e instanceof Error ? e.message : 'Unknown error'}`,
        type: 'error'
      })
    } finally {
      setRegisteringSymbol(null)
    }
  }

  // Return all state, setters, and handlers
  return {
    // State
    activeTab,
    setActiveTab,
    balances,
    setBalances,
    marketData,
    setMarketData,
    logs,
    setLogs,
    botStartTime,
    setBotStartTime,
    uptime,
    setUptime,
    whitelist,
    setWhitelist,
    newSymbol,
    setNewSymbol,
    tradingMode,
    setTradingMode,
    settings,
    setSettings,
    stats,
    setStats,
    tickFlashing,
    setTickFlashing,
    registeringSymbol,
    setRegisteringSymbol,
    // Backtest state
    btSymbol,
    setBtSymbol,
    btStart,
    setBtStart,
    btEnd,
    setBtEnd,
    btShareAmount,
    setBtShareAmount,
    btGridStep,
    setBtGridStep,
    btLoading,
    setBtLoading,
    btResults,
    setBtResults,
    btError,
    setBtError,
    btProgress,
    setBtProgress,
    btStatus,
    setBtStatus,
    // Reports state
    reportStart,
    setReportStart,
    reportEnd,
    setReportEnd,
    reportData,
    setReportData,
    reportLoading,
    setReportLoading,
    // UI state
    toast,
    setToast,
    isConnected,
    setIsConnected,
    versions,
    setVersions,
    updateChecking,
    setUpdateChecking,
    updateAvailable,
    setUpdateAvailable,
    updateNotAvailable,
    setUpdateNotAvailable,
    updateInfo,
    setUpdateInfo,
    updateDownloadProgress,
    setUpdateDownloadProgress,
    updateDownloading,
    setUpdateDownloading,
    updateDownloaded,
    setUpdateDownloaded,
    updateError,
    setUpdateError,
    electronVersion,
    setElectronVersion,
    // Handlers
    updateSetting,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    handleAddSymbol,
    handleRemoveSymbol,
    handleResetStats,
    handleWipeAllData,
    handleDeleteBaseShare,
    handleSetBase,
    toggleTradingMode,
    // Utility function
    stripUSDT
  }
}

export type AppContextType = ReturnType<typeof useAppState>
