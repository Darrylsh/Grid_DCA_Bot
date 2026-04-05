import { useState, useEffect } from 'react'
import {
  Activity,
  Settings,
  BarChart2,
  DollarSign,
  Percent,
  Zap,
  RotateCcw,
  Clock,
  Microscope,
  Play,
  TrendingDown,
  Trash2,
  TrendingUp,
  Layers,
  CheckCircle,
  Shuffle,
  Receipt
} from 'lucide-react'
import buySound from './assets/buy.mp3'
import sellSound from './assets/sell.mp3'

const RobotIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <rect x="11" y="2" width="2" height="3" rx="0.5" />
    <rect x="2" y="10" width="3" height="6" rx="1.5" />
    <rect x="19" y="10" width="3" height="6" rx="1.5" />
    <rect x="5" y="5" width="14" height="15" rx="2" />
    <circle cx="9" cy="11" r="1.2" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="15" cy="11" r="1.2" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="9" cy="16" r="0.8" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="12" cy="16" r="0.8" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="15" cy="16" r="0.8" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
  </svg>
)

const BacktestPriceChart = ({ results }: { results: any }) => {
  if (!results?.chartData || results.chartData.length < 2) return null
  const { chartData, trades } = results
  const prices = chartData.map((d: any) => d.p)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const priceRange = maxPrice - minPrice || 1
  const pPadding = priceRange * 0.15
  const bottom = minPrice - pPadding
  const totalRange = priceRange + 2 * pPadding
  const startTime = chartData[0].t
  const endTime = chartData[chartData.length - 1].t
  const timeRange = endTime - startTime || 1
  const points = chartData.map((d: any) => {
    const x = ((d.t - startTime) / timeRange) * 100
    const y = 100 - ((d.p - bottom) / totalRange) * 100
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="h-72 w-full bg-slate-900/50 rounded-2xl border border-slate-700/30 overflow-hidden relative group mt-4 mb-8 shadow-inner shadow-black/20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(79,70,229,0.05),transparent)] pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none opacity-20">
        {[0, 0.25, 0.5, 0.75, 1].map((scale) => {
          const price = bottom + (1 - scale) * totalRange
          return (
            <div key={scale} className="absolute w-full h-[1px] border-t border-dashed border-slate-500" style={{ top: `${scale * 100}%` }}>
              <span className="absolute left-2 -top-2 text-[8px] font-mono font-bold text-slate-400 bg-slate-900/80 px-1 rounded">${price.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full opacity-80 group-hover:opacity-100 transition-opacity">
        <polyline fill="none" stroke="#4f46e5" strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 pointer-events-none">
        {trades.slice(0, 500).map((trade: any, i: number) => {
          const tTime = new Date(trade.timestamp).getTime()
          const x = ((tTime - startTime) / timeRange) * 100
          const y = 100 - ((trade.price - bottom) / totalRange) * 100
          if (x < 0 || x > 100) return null
          const isBuy = trade.side === 'BUY'
          const isBase = trade.reason === 'BASE_SHARE'
          return (
            <div key={i} className={`absolute w-2 h-2 rounded-full border border-slate-900 shadow-lg pointer-events-auto cursor-help ${isBase ? 'bg-amber-400 shadow-amber-400/30' : isBuy ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-rose-500 shadow-rose-500/20'}`}
              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              title={`${trade.reason} @ $${trade.price?.toFixed(4)}${trade.pnl != null ? ` | PnL: $${trade.pnl?.toFixed(2)}` : ''}`} />
          )
        })}
      </div>
      <div className="absolute bottom-1 left-0 w-full flex justify-between px-2 opacity-40 text-[7px] font-mono font-bold text-slate-500 pointer-events-none">
        {[0, 0.25, 0.5, 0.75, 1].map((scale) => {
          const time = startTime + scale * timeRange
          const d = new Date(time)
          return <div key={scale} className="flex flex-col items-center"><span>{d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span></div>
        })}
      </div>
      <div className="absolute top-4 right-6 flex gap-4 backdrop-blur-sm bg-slate-900/40 p-3 rounded-xl border border-slate-800/50">
        {[{ color: 'bg-amber-400', label: 'Base' }, { color: 'bg-emerald-500', label: 'Buy' }, { color: 'bg-rose-500', label: 'Sell' }].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${item.color}`} />
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [balances, setBalances] = useState({ USDT: 0, BNB: 0 })
  const [marketData, setMarketData] = useState<Record<string, any>>({})
  const [logs, setLogs] = useState<any[]>([])
  const [botStartTime, setBotStartTime] = useState<number | null>(null)
  const [uptime, setUptime] = useState('00:00:00')
  const [whitelist, setWhitelist] = useState<string[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  const [tradingMode, setTradingMode] = useState('LIVE')
  const [settings, setSettings] = useState<Record<string, string>>({
    capital_type: 'FIXED',
    capital_value: '100',
    grid_step_percent: '3'
  })
  const [stats, setStats] = useState({ totalPnl: 0, totalFees: 0, avgRoi: 0, winRate: 0, fillRate: 0, unrealizedPnl: 0, totalTrades: 0 })
  const [tickFlashing, setTickFlashing] = useState(false)

  const [registeringSymbol, setRegisteringSymbol] = useState<string | null>(null)

  // Backtest state
  const [btSymbol, setBtSymbol] = useState('')
  const [btStart, setBtStart] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
  const [btEnd, setBtEnd] = useState(new Date().toISOString().split('T')[0])
  const [btShareAmount, setBtShareAmount] = useState('100')
  const [btGridStep, setBtGridStep] = useState('3')
  const [btLoading, setBtLoading] = useState(false)
  const [btResults, setBtResults] = useState<any>(null)
  const [btError, setBtError] = useState<string | null>(null)
  const [btProgress, setBtProgress] = useState(0)
  const [btStatus, setBtStatus] = useState('')

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(t)
    }
    return () => {}
  }, [toast])

  useEffect(() => {
    let statsInterval: any
    let tickTimer: any
    if (window.api) {
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

        // Refresh from DB (single source of truth) to avoid duplicate entries
        window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
        setToast({ message: `[${data.side}] ${stripUSDT(data.symbol)} @ $${Number(data.price).toFixed(4)} — ${data.reason || ''}`, type: 'success' })
      })
      window.api.onBacktestProgress?.((p) => setBtProgress(p))
      window.api.onBacktestUpdate?.((data) => {
        if (data.status === 'fetching') { setBtStatus(data.message || 'Downloading candles...'); return }
        setBtResults(data)
        setBtStatus('')
      })

      window.api.getWhitelist().then((list: any) => {
        const symbols = Array.isArray(list) ? list.map((i: any) => (typeof i === 'string' ? i : i.symbol)) : []
        setWhitelist(symbols)
        if (symbols.length > 0 && !btSymbol) setBtSymbol(symbols[0])
      })
      window.api.getSettings().then((res: any) => {
        if (res.trading_mode) setTradingMode(res.trading_mode)
        if (res.grid_step_percent) setBtGridStep(res.grid_step_percent)
        if (res.capital_value) setBtShareAmount(res.capital_value)
        setSettings((prev) => ({ ...prev, ...res }))
      })

      const refreshStats = () => window.api.getStats().then(setStats)
      refreshStats()
      statsInterval = setInterval(refreshStats, 10000)
      window.api.startBot()
    }
    return () => {
      if (statsInterval) clearInterval(statsInterval)
      if (tickTimer) clearTimeout(tickTimer)
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      if (!botStartTime) return
      const diff = Math.floor((Date.now() - botStartTime) / 1000)
      const h = Math.floor(diff / 3600).toString().padStart(2, '0')
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0')
      const s = (diff % 60).toString().padStart(2, '0')
      setUptime(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(t)
  }, [botStartTime])

  useEffect(() => {
    if (window.api) window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
  }, [tradingMode])

  const stripUSDT = (s: string) => (s ? s.replace('USDT', '') : s)

  const handleAddSymbol = () => {
    if (!newSymbol) return
    let s = newSymbol.toUpperCase()
    if (!s.endsWith('USDT')) s += 'USDT'
    if (whitelist.includes(s)) return
    const list = [...whitelist, s]
    setWhitelist(list)
    window.api.saveWhitelist(list)
    if (!btSymbol) setBtSymbol(s)
    setNewSymbol('')
  }

  const handleRemoveSymbol = (sym: string) => {
    const list = whitelist.filter((w) => w !== sym)
    setWhitelist(list)
    window.api.saveWhitelist(list)

    // Automatically refresh grid state by purging from local market data if no active position
    setMarketData((prev) => {
      const next = { ...prev }
      if (!next[sym]?.hasBaseShare) {
        delete next[sym]
      }
      return next
    })
  }

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    window.api.saveSettings({ key, value })
  }

  const toggleTradingMode = () => {
    const newMode = tradingMode === 'LIVE' ? 'SIMULATION' : 'LIVE'
    setTradingMode(newMode)
    window.api.saveSettings({ key: 'trading_mode', value: newMode })
  }

  const handleResetStats = async () => {
    if (window.confirm(`Reset all ${tradingMode} trade history? This cannot be undone.`)) {
      await window.api.clearTradeHistory(tradingMode)
      window.api.getStats().then(setStats)
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }

  const handleWipeAllData = async () => {
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

  const handleDeleteBaseShare = async (symbol: string) => {
    if (window.confirm(`Delete local record for ${stripUSDT(symbol)}? This will NOT sell your coins on Binance, it only clears the bot's tracking state.`)) {
      await window.api.deleteBaseShare(symbol)
      setToast({ message: `Record deleted for ${stripUSDT(symbol)}`, type: 'success' })
      // Refresh state
      window.api.getGridState().then(setMarketData)
    }
  }

  // Direct one-click market buy at configured capital allocation
  const handleSetBase = async (symbol: string) => {
    setRegisteringSymbol(symbol)
    try {
      // price=0 and qty=0 signals the bot to use capital_value setting for a market buy
      await window.api.registerBaseShare(symbol, 0, 0)
      setToast({ message: `Market buy submitted for ${stripUSDT(symbol)} — check activity log`, type: 'success' })
    } catch (e: any) {
      setToast({ message: `Failed to buy: ${e?.message || 'Unknown error'}`, type: 'error' })
    } finally {
      setRegisteringSymbol(null)
    }
  }

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-slate-800/50 backdrop-blur-md border-r border-slate-700/50 flex flex-col p-4 shadow-xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 bg-indigo-500/20 rounded-lg text-white"><RobotIcon size={24} /></div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">Grid DCA Bot</h1>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] transition-all duration-75 ${tickFlashing ? 'bg-emerald-400 scale-150' : 'bg-emerald-600 animate-pulse'}`} />
              System Online
            </div>
            {botStartTime && (
              <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                <Clock size={10} className="text-slate-600" />
                <span>UPTIME: {uptime}</span>
              </div>
            )}
          </div>
        </div>

        <nav className="flex flex-col gap-2 mb-6">
          {[
            { id: 'dashboard', icon: BarChart2, label: 'Dashboard' },
            { id: 'settings', icon: Settings, label: 'Settings' },
            { id: 'backtest', icon: Microscope, label: 'Backtest Lab' }
          ].map(({ id, icon: Icon, label }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === id ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>

        {/* Balance */}
        <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50 mb-4">
          <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider flex items-center gap-2">
            <DollarSign size={14} /> Exchange Balance
          </h3>
          <div className="flex justify-between items-end mb-2">
            <span className="text-emerald-400 font-bold text-xs">USDT</span>
            <span className="text-lg font-mono tracking-tighter">${balances.USDT.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-amber-400 font-bold text-xs">BNB</span>
            <span className="text-sm font-mono text-slate-300">{balances.BNB.toFixed(4)}</span>
          </div>
        </div>

        {/* Whitelist */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-800/20 rounded-xl p-2 border border-slate-700/30">
          <h3 className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-widest flex items-center justify-between px-2">
            <span>Monitored Pairs</span>
            <span className="bg-slate-700/50 text-slate-400 py-0.5 px-2 rounded-full font-mono">{whitelist.length}</span>
          </h3>
          <div className="flex gap-2 mb-4 px-1">
            <input type="text" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              placeholder="ADD PAIR..." onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 font-bold" />
            <button onClick={handleAddSymbol} className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 rounded-lg transition-colors font-bold">+</button>
          </div>
          <ul className="flex flex-col gap-1.5 overflow-y-auto pr-1 custom-scrollbar">
            {whitelist.map((sym) => {
              const row = marketData[sym]
              const hasBase = row?.hasBaseShare
              return (
                <li key={sym} className="flex items-center gap-2 p-2 bg-slate-800/40 border border-slate-700/50 rounded-lg group transition-all hover:border-slate-600">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${hasBase ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'bg-slate-600'}`} title={hasBase ? 'Base share active' : 'No base share'} />
                  <span className="font-bold text-xs text-slate-200 tracking-wide flex-1">{stripUSDT(sym)}</span>
                  {row?.currentPrice && <span className="text-[10px] font-mono text-slate-400">${row.currentPrice.toFixed(4)}</span>}
                  <button onClick={() => handleRemoveSymbol(sym)} className="text-slate-600 hover:text-rose-500 transition-colors text-lg leading-none">&times;</button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-900 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
              {activeTab === 'dashboard' ? 'Grid DCA Dashboard' : activeTab === 'settings' ? 'Bot Configuration' : 'Backtest Research Lab'}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {activeTab === 'dashboard' ? 'Live grid monitoring — buy shares on dips, sell at profit targets' : activeTab === 'settings' ? 'Configure grid parameters and trading options' : 'Simulate grid strategy against historical 1-minute candle data'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-full px-4 py-2 flex items-center gap-3">
              <span className={`text-sm font-semibold ${tradingMode === 'LIVE' ? 'text-rose-400' : 'text-indigo-300'}`}>{tradingMode}</span>
              <div onClick={toggleTradingMode} className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${tradingMode === 'LIVE' ? 'bg-rose-500' : 'bg-slate-600'}`}>
                <div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${tradingMode === 'LIVE' ? 'translate-x-4' : ''}`} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto w-full px-4 pt-4 custom-scrollbar">

          {/* ================================================================ */}
          {/* DASHBOARD TAB                                                    */}
          {/* ================================================================ */}
          {activeTab === 'dashboard' && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-6 gap-3 mb-8 text-[10px]">
                {[
                  { label: 'Realized PNL', value: `$${stats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: 'bg-emerald-500/10' },
                  { label: 'Total Fees', value: `$${stats.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Receipt, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                  { label: 'Avg Grid ROI', value: `${(stats.avgRoi * 100).toFixed(2)}%`, icon: Percent, color: stats.avgRoi >= 0 ? 'text-blue-400' : 'text-rose-400', bg: 'bg-blue-500/10' },
                  { label: 'Win Rate', value: `${stats.winRate.toFixed(1)}%`, icon: CheckCircle, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                  { label: 'Fill Rate', value: `${stats.fillRate.toFixed(1)}%`, icon: Shuffle, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                  { label: 'Unrealized PNL', value: `$${stats.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Zap, color: stats.unrealizedPnl >= 0 ? 'text-amber-400' : 'text-rose-400', bg: 'bg-amber-500/10' }
                ].map((stat, i) => (
                  <div key={i} className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-4 flex items-center gap-3 hover:bg-slate-800/60 transition-colors">
                    <div className={`p-2 rounded-xl ${stat.bg} ${stat.color}`}><stat.icon size={20} /></div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">{stat.label}</p>
                      <h3 className={`text-xl font-bold font-mono tracking-tight ${stat.color}`}>{stat.value}</h3>
                    </div>
                  </div>
                ))}
              </div>

              {/* Live Grid Table */}
              <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl flex flex-col overflow-hidden shadow-2xl mb-8">
                <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Layers size={18} className="text-indigo-400" /> Active Grid Monitor
                  </h3>
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full transition-all duration-75 ${tickFlashing ? 'bg-emerald-400 scale-150' : 'bg-emerald-600 animate-pulse'}`} />
                    Live Price Feed
                  </div>
                </div>
                <div className="overflow-auto max-h-[600px] custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-800/90 backdrop-blur z-10 text-[10px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="p-4 font-medium">Symbol</th>
                        <th className="p-4 font-medium">Current Price</th>
                        <th className="p-4 font-medium">Base Price</th>
                        <th className="p-4 font-medium">% From Base</th>
                        <th className="p-4 font-medium">Grid Levels</th>
                        <th className="p-4 font-medium text-amber-400">Current PnL</th>
                        <th className="p-4 font-medium text-emerald-400">Total PnL</th>
                        <th className="p-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {Object.values(marketData).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-3">
                              <RotateCcw size={32} className="animate-spin text-slate-600" />
                              Waiting for market data streams...
                            </div>
                          </td>
                        </tr>
                      ) : (
                        Object.values(marketData)
                          .sort((a: any, b: any) => (a.hasBaseShare === b.hasBaseShare ? a.symbol.localeCompare(b.symbol) : a.hasBaseShare ? -1 : 1))
                          .map((row: any) => {
                            const pct = row.pctFromBase
                            const isUp = pct != null && pct >= 0
                            const levels: any[] = row.gridLevels || []
                            return (
                              <tr key={row.symbol} className="hover:bg-slate-700/20 transition-colors">
                                <td className="p-4">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${row.hasBaseShare ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' : 'bg-slate-600'}`} />
                                    <span className="font-bold">{stripUSDT(row.symbol)}</span>
                                  </div>
                                </td>
                                <td className="p-4 font-mono font-bold">${row.currentPrice?.toFixed(4) ?? '-'}</td>
                                <td className="p-4 font-mono text-amber-400">
                                  {row.hasBaseShare ? (
                                    <div className="flex flex-col gap-0.5">
                                      <span>${row.basePrice?.toFixed(4)}</span>
                                      {row.trailActive && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5 animate-pulse">
                                          {'\u{1F512}'} Stop: ${row.trailStopPrice?.toFixed(4)}
                                        </span>
                                      )}
                                    </div>
                                  ) : <span className="text-slate-600 italic text-xs">No base share</span>}
                                </td>
                                <td className="p-4">
                                  {pct != null ? (
                                    <span className={`flex items-center gap-1 font-mono font-bold ${row.trailActive ? 'text-amber-400' : isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {row.trailActive ? '\u{1F512}' : isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                    </span>
                                  ) : <span className="text-slate-600">-</span>}
                                </td>
                                <td className="p-4">
                                  {levels.length > 0 ? (
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-bold text-indigo-400">{levels.length} pending sell{levels.length !== 1 ? 's' : ''}</span>
                                      <span className="text-[9px] text-slate-500">
                                        Targets: {levels.slice(0, 2).map((l) => `$${l.sellPrice?.toFixed(4)}`).join(', ')}
                                        {levels.length > 2 ? ` +${levels.length - 2}` : ''}
                                      </span>
                                    </div>
                                  ) : <span className="text-slate-600 text-xs">—</span>}
                                </td>
                                <td className="p-4">
                                  {row.activeSharePnl != null ? (
                                    <span className={`font-mono font-bold ${row.activeSharePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {row.activeSharePnl >= 0 ? '+' : ''}${row.activeSharePnl?.toFixed(2)}
                                    </span>
                                  ) : <span className="text-slate-600">-</span>}
                                </td>
                                <td className="p-4 border-l border-slate-700/30">
                                  {row.totalUnrealizedPnl != null ? (
                                    <span className={`font-mono font-bold ${row.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {row.totalUnrealizedPnl >= 0 ? '+' : ''}${row.totalUnrealizedPnl?.toFixed(2)}
                                    </span>
                                  ) : <span className="text-slate-600">-</span>}
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {!row.hasBaseShare ? (
                                      <button
                                        onClick={() => handleSetBase(row.symbol)}
                                        disabled={registeringSymbol === row.symbol}
                                        className="px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 rounded-lg text-[10px] font-bold transition-colors border border-amber-500/30">
                                        {registeringSymbol === row.symbol ? 'BUYING...' : 'SET BASE'}
                                      </button>
                                    ) : (
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => {
                                            if (
                                              window.confirm(
                                                `Sell base share for ${stripUSDT(row.symbol)}?`
                                              )
                                            ) {
                                              window.api.sellBaseShare(row.symbol).then(() => {
                                                setToast({
                                                  message: `Base share sold for ${stripUSDT(
                                                    row.symbol
                                                  )}`,
                                                  type: 'success'
                                                })
                                                window.api.getGridState().then(setMarketData)
                                              })
                                            }
                                          }}
                                          className="px-3 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg text-[10px] font-bold transition-colors border border-rose-500/20"
                                        >
                                          Sell Base
                                        </button>
                                        <button
                                          onClick={() => handleDeleteBaseShare(row.symbol)}
                                          className="p-1.5 bg-slate-700 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all border border-slate-600"
                                          title="Delete local record only"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )}
                                    {levels.length > 0 && (
                                      <button onClick={async () => {
                                        if (window.confirm(`Cancel all ${levels.length} pending grid sells for ${stripUSDT(row.symbol)}?`)) {
                                          await window.api.clearGridLevels(row.symbol)
                                          setToast({ message: `Grid levels cleared for ${stripUSDT(row.symbol)}`, type: 'info' })
                                        }
                                      }} className="px-2 py-1.5 bg-slate-700 text-slate-400 hover:text-rose-400 rounded-lg text-[10px] font-bold transition-colors">
                                        CLEAR
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Activity Log */}
              <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Activity size={14} className="text-emerald-400" /> Recent Activity
                  </h3>
                  <button onClick={() => setLogs([])} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold">Clear</button>
                </div>
                <div className="max-h-48 overflow-y-auto p-4 flex flex-col gap-2 font-mono text-[13px] custom-scrollbar bg-slate-900/40">
                  {logs.length === 0 ? (
                    <div className="text-slate-600 italic">No activity recorded yet...</div>
                  ) : logs.map((log, i) => (
                    <div key={i} className="flex gap-3 border-l-2 border-slate-700 pl-3 py-1 hover:border-indigo-500 transition-colors">
                      <span className="text-slate-500 shrink-0">
                        [{log.timestamp ? new Date(Number(log.timestamp)).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '') : 'No Time'}]
                      </span>
                      <div className="flex justify-between w-full pr-2">
                        <span className={log.side === 'BUY' ? 'text-emerald-400 font-bold' : log.side === 'SELL' ? 'text-rose-400 font-bold' : 'text-indigo-300'}>
                          {log.side ? `${log.side} ${stripUSDT(log.symbol)} @ $${Number(log.price).toFixed(4)} [${log.reason || ''}]` : log.message || JSON.stringify(log)}
                        </span>
                        {log.side === 'SELL' && log.pnl !== undefined && (
                          <span className={log.pnl >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>
                            {log.pnl >= 0 ? '+' : ''}${Number(log.pnl).toFixed(4)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ================================================================ */}
          {/* BACKTEST TAB                                                     */}
          {/* ================================================================ */}
          {activeTab === 'backtest' && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                {/* Symbol */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Symbol</label>
                  <select value={btSymbol} onChange={(e) => setBtSymbol(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold appearance-none cursor-pointer">
                    {whitelist.map((sym) => <option key={sym} value={sym}>{stripUSDT(sym)}</option>)}
                    {whitelist.length === 0 && <option value="">Add symbols first</option>}
                  </select>
                </div>
                {/* Start */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Start Date</label>
                  <input type="date" value={btStart} onChange={(e) => setBtStart(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono" style={{ colorScheme: 'dark' }} />
                </div>
                {/* End */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">End Date</label>
                  <input type="date" value={btEnd} onChange={(e) => setBtEnd(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono" style={{ colorScheme: 'dark' }} />
                </div>
                {/* Share Amount */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Share Amount ($)</label>
                  <input type="number" value={btShareAmount} onChange={(e) => setBtShareAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold" />
                </div>
                {/* Grid Step */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Grid Step (%)</label>
                  <input type="number" value={btGridStep} onChange={(e) => setBtGridStep(e.target.value)} step="0.5" min="0.5" max="20"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold" />
                </div>
                {/* Run Button */}
                <div className="flex items-end md:col-span-5">
                  <button onClick={async () => {
                    setBtResults(null); setBtLoading(true); setBtError(null); setBtProgress(0); setBtStatus('Starting...')
                    try {
                      const res = await window.api.runBacktest(btSymbol, btStart, btEnd, parseFloat(btShareAmount), parseFloat(btGridStep))
                      if (res?.error) setBtError(res.error)
                      else setBtResults(res)
                    } catch (e: any) {
                      setBtError(e.message || 'Simulation failed')
                    } finally {
                      setBtLoading(false); setBtStatus('')
                    }
                  }} disabled={btLoading || !btSymbol}
                    className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg transition-all flex items-center justify-center gap-2 h-[38px]">
                    {btLoading ? <Activity size={18} className="animate-spin" /> : <Play size={18} />}
                    {btLoading ? (btStatus || `RUNNING... ${btProgress}%`) : 'START SIMULATION'}
                  </button>
                </div>
              </div>

              {btLoading && (
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4">
                  <div className="flex justify-between text-xs text-slate-400 mb-2 font-mono">
                    <span>{btStatus}</span><span>{btProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${btProgress}%` }} />
                  </div>
                </div>
              )}

              {btError && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-4 rounded-xl text-sm font-bold flex items-center gap-3">
                  <Activity size={18} /> {btError}
                </div>
              )}

              {btResults && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  {/* Stats cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                    {[
                      { label: 'Realized PnL', value: `${btResults.realizedPnl >= 0 ? '+' : ''}$${Number(btResults.realizedPnl).toFixed(2)}`, color: btResults.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                      { label: 'Unrealized PnL', value: `${btResults.unrealizedPnl >= 0 ? '+' : ''}$${Number(btResults.unrealizedPnl).toFixed(2)}`, color: btResults.unrealizedPnl >= 0 ? 'text-amber-400' : 'text-rose-400' },
                      { label: 'Total ROI', value: `${((btResults.totalRoi || 0) * 100).toFixed(2)}%`, color: btResults.totalRoi >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                      { label: 'Grid Buys', value: btResults.gridLevelCount, color: 'text-indigo-400' },
                      { label: 'Sells Filled', value: btResults.totalTrades, color: 'text-emerald-400' },
                      { label: 'Pending Sells', value: btResults.pendingLevels, color: 'text-amber-400' },
                      { label: 'Total Fees', value: `-$${Number(btResults.totalFees).toFixed(2)}`, color: 'text-rose-400' }
                    ].map((s, i) => (
                      <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">{s.label}</p>
                        <h3 className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</h3>
                      </div>
                    ))}
                  </div>

                  <div className="mb-6">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">Price Chart & Grid Trades</p>
                    <BacktestPriceChart results={btResults} />
                  </div>

                  {/* Trade table */}
                  <div className="bg-slate-800/20 border border-slate-700/30 rounded-2xl overflow-hidden">
                    <div className="p-4 border-b border-slate-700/30 font-bold text-sm text-slate-300 flex justify-between">
                      Simulation Trade Log
                      <span className="text-slate-500 font-mono text-xs">
                        {(btResults.range?.start || '').split('T')[0]} → {(btResults.range?.end || '').split('T')[0]}
                        {' '}({btResults.range?.candlesProcessed?.toLocaleString()} candles)
                      </span>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-900/90 backdrop-blur text-[10px] uppercase text-slate-500 font-bold border-b border-slate-700/30">
                          <tr>
                            <th className="p-4">Time</th>
                            <th className="p-4">Side</th>
                            <th className="p-4">Price</th>
                            <th className="p-4">Qty</th>
                            <th className="p-4">Result</th>
                            <th className="p-4">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs font-mono">
                          {btResults.trades.slice(0, 1000).map((t: any, i: number) => (
                            <tr key={i} className="border-b border-slate-700/20 hover:bg-slate-800/30 transition-colors">
                              <td className="p-4 text-slate-400">
                                <div className="flex flex-col">
                                  <span className="font-bold text-slate-300">{new Date(t.timestamp).toLocaleDateString()}</span>
                                  <span className="text-[10px] opacity-60 text-indigo-300">{new Date(t.timestamp).toLocaleTimeString()}</span>
                                </div>
                              </td>
                              <td className="p-4">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.side === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{t.side}</span>
                              </td>
                              <td className="p-4 font-bold">${Number(t.price).toFixed(4)}</td>
                              <td className="p-4 text-slate-400">{Number(t.quantity).toFixed(6)}</td>
                              <td className={`p-4 font-bold ${t.pnl > 0 ? 'text-emerald-400' : t.pnl < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                                {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(4)}` : '-'}
                              </td>
                              <td className="p-4 text-[10px] text-slate-500 italic uppercase">{t.reason || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================ */}
          {/* SETTINGS TAB                                                     */}
          {/* ================================================================ */}
          {activeTab === 'settings' && (
            <div className="max-w-2xl bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-8 shadow-2xl">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Settings className="text-indigo-400" /> Grid Bot Configuration
              </h3>
              <div className="grid gap-8">
                {/* Trading Mode */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Trading Mode</label>
                  <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700">
                    {['SIMULATION', 'LIVE'].map((mode) => (
                      <button key={mode} onClick={() => { setTradingMode(mode); window.api.saveSettings({ key: 'trading_mode', value: mode }) }}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tradingMode === mode ? (mode === 'LIVE' ? 'bg-rose-500 text-white shadow-lg' : 'bg-indigo-500 text-white shadow-lg') : 'text-slate-500 hover:text-slate-300'}`}>
                        {mode}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 italic">
                    {tradingMode === 'LIVE' ? '⚠️ Real orders will be placed on Binance.' : 'Simulation tracks grid levels in memory without placing real orders.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  {/* Share Amount */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Share Amount (USDT)</label>
                    <div className="relative">
                      <input type="number" value={settings.capital_value}
                        onChange={(e) => updateSetting('capital_value', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-indigo-500 transition-colors pl-8" />
                      <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
                    </div>
                    <p className="text-xs text-slate-500 italic">Fixed USDT amount per grid share purchase.</p>
                  </div>

                  {/* Grid Step */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Grid Step (%)</label>
                    <div className="relative">
                      <input type="number" value={settings.grid_step_percent} step="0.5" min="0.5" max="20"
                        onChange={(e) => updateSetting('grid_step_percent', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-indigo-500 transition-colors pr-8" />
                      <span className="absolute right-3 top-3 text-slate-500 font-bold">%</span>
                    </div>
                    <p className="text-xs text-slate-500 italic">Buy/sell trigger distance from reference price.</p>
                  </div>
                </div>

                {/* Trailing Stop */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Trail Stop Trigger (levels)</label>
                    <input type="number" value={settings.trailing_stop_levels || '3'} min="1" max="20" step="1"
                      onChange={(e) => updateSetting('trailing_stop_levels', e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-amber-500 transition-colors" />
                    <p className="text-xs text-slate-500 italic">Levels above entry to arm the trailing stop (e.g. 3 = +6% at 2% grid).</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Trail Stop Distance (×grid)</label>
                    <div className="relative">
                      <input type="number" value={settings.trailing_stop_pct || '0.5'} min="0.1" max="2" step="0.1"
                        onChange={(e) => updateSetting('trailing_stop_pct', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-amber-500 transition-colors pr-8" />
                      <span className="absolute right-3 top-3 text-slate-500 font-bold text-xs">×g</span>
                    </div>
                    <p className="text-xs text-slate-500 italic">Stop distance as fraction of grid step (0.5 = ½ grid = 1% at 2% grid).</p>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="mt-12 pt-8 border-t border-slate-800/60">
                <h3 className="text-sm font-bold text-rose-400 uppercase tracking-widest mb-4">Danger Zone</h3>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between p-4 bg-slate-800/40 border border-slate-700/50 rounded-2xl">
                    <div>
                      <h4 className="text-white font-bold mb-1">Reset {tradingMode} Trade History</h4>
                      <p className="text-slate-400 text-xs">Permanently delete all trade logs and reset profit metrics.</p>
                    </div>
                    <button
                      onClick={handleResetStats}
                      className="bg-rose-600/20 hover:bg-rose-600 border border-rose-600/30 text-rose-400 hover:text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                    >
                      Reset History
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl">
                    <div>
                      <h4 className="text-rose-400 font-bold mb-1">Full Data Wipe ({tradingMode})</h4>
                      <p className="text-slate-400 text-xs">Delete EVERYTHING: Base shares, grid levels, and history.</p>
                    </div>
                    <button
                      onClick={handleWipeAllData}
                      className="bg-rose-600 hover:bg-rose-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-rose-900/20"
                    >
                      Wipe All Data
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className="bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-indigo-400/50">
            <Zap size={18} className="text-amber-400 animate-pulse" />
            <span className="font-bold tracking-tight text-sm">{toast.message}</span>
          </div>
        </div>
      )}

    </div>
  )
}
