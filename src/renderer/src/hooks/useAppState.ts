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

  // Refs
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (window.api) {
      window.api.getConnectionStatus?.().then((status: boolean) => setIsConnected(status))
      window.api.onConnectionStatus?.((status: boolean) => setIsConnected(status))
      window.api.onMarketUpdate((data) => {
        setMarketData((prev) => ({ ...prev, [data.symbol]: data }))
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
    }
    return () => {
      if (statsInterval) clearInterval(statsInterval)
      if (tickTimer) clearTimeout(tickTimer)
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
      debouncedSaveWhitelist(list)
      return list
    })
    if (!btSymbol) setBtSymbol(s)
    setNewSymbol('')
  }

  const handleRemoveSymbol = (sym: string): void => {
    setWhitelist((prev) => {
      const list = prev.filter((w) => w !== sym)
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

  const toggleTradingMode = (): void => {
    const newMode = tradingMode === 'LIVE' ? 'SIMULATION' : 'LIVE'
    setTradingMode(newMode)
    window.api.saveSettings({ key: 'trading_mode', value: newMode })
  }

  const handleResetStats = async (): Promise<void> => {
    if (window.confirm(`Reset all ${tradingMode} trade history? This cannot be undone.`)) {
      await window.api.clearTradeHistory(tradingMode)
      window.api.getStats().then(setStats)
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }

  const handleWipeAllData = async (): Promise<void> => {
    if (
      window.confirm(
        `WIPE ALL DATA for ${tradingMode}? This will delete all base shares, grid levels, and trade history. This cannot be undone.`
      )
    ) {
      await window.api.wipeAllData(tradingMode)
      setToast({ message: `Full data wipe completed for ${tradingMode}`, type: 'success' })
      // Refresh all state
      window.api.getGridState().then(setMarketData)
      window.api.getStats().then(setStats)
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }

  const handleDeleteBaseShare = async (symbol: string): Promise<void> => {
    if (
      window.confirm(
        `Delete local record for ${stripUSDT(symbol)}? This will NOT sell your coins on Binance, it only clears the bot's tracking state.`
      )
    ) {
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
    // Handlers
    updateSetting,
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
