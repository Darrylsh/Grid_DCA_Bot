import { useState, useEffect } from 'react'
import { 
  Activity, Settings, BarChart2, DollarSign, Percent, Target, Zap, RotateCcw, Clock, Microscope, Play, Receipt
} from 'lucide-react'

const RobotIcon = ({ size = 24, className = "" }: { size?: number, className?: string }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Antenna (short vertical stick) */}
    <rect x="11" y="2" width="2" height="3" rx="0.5" />
    {/* Sidebar Ears (vertical bars) */}
    <rect x="2" y="10" width="3" height="6" rx="1.5" />
    <rect x="19" y="10" width="3" height="6" rx="1.5" />
    {/* Main Head Box */}
    <rect x="5" y="5" width="14" height="15" rx="2" />
    {/* Cutout Eyes - using background color or mask-like circles */}
    <circle cx="9" cy="11" r="1.2" fill="navy" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="15" cy="11" r="1.2" fill="navy" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    {/* Cutout Mouth - Three dots as requested */}
    <circle cx="9" cy="16" r="0.8" fill="navy" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="12" cy="16" r="0.8" fill="navy" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="15" cy="16" r="0.8" fill="navy" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
  </svg>
)

const BacktestPriceChart = ({ results }: { results: any }) => {
  if (!results || !results.chartData || results.chartData.length < 2) return null;
  
  const { chartData, trades } = results;
  const prices = chartData.map((d: any) => d.p);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;
  const pPadding = priceRange * 0.15;
  const bottom = minPrice - pPadding;
  const totalRange = priceRange + 2 * pPadding;

  const startTime = chartData[0].t;
  const endTime = chartData[chartData.length - 1].t;
  const timeRange = endTime - startTime || 1;

  const points = chartData.map((d: any) => {
    const x = ((d.t - startTime) / timeRange) * 100;
    const y = 100 - ((d.p - bottom) / totalRange) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="h-72 w-full bg-slate-900/50 rounded-2xl border border-slate-700/30 overflow-hidden relative group mt-4 mb-8 shadow-inner shadow-black/20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(79,70,229,0.05),transparent)] pointer-events-none"></div>
      
      {/* Price Grid (Y-Axis) */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        {[0, 0.16, 0.33, 0.5, 0.66, 0.83, 1].map((scale) => {
          const price = bottom + (1 - scale) * totalRange;
          return (
            <div key={scale} className="absolute w-full h-[1px] border-t border-dashed border-slate-500" style={{ top: `${scale * 100}%` }}>
              <span className="absolute left-2 -top-2 text-[8px] font-mono font-bold text-slate-400 bg-slate-900/80 px-1 rounded">${price.toFixed(2)}</span>
            </div>
          );
        })}
      </div>

      {/* Price Line SVG (Stretched) */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full opacity-80 group-hover:opacity-100 transition-opacity">
        <polyline
          fill="none"
          stroke="#4f46e5"
          strokeWidth="1.5"
          points={points}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {/* Distortion-Free Markers (HTML Overlays) */}
      <div className="absolute inset-0 pointer-events-none">
        {trades.map((trade: any, i: number) => {
          const tTime = new Date(trade.timestamp).getTime();
          const x = ((tTime - startTime) / timeRange) * 100;
          const y = 100 - ((trade.price - bottom) / totalRange) * 100;
          if (x < 0 || x > 100) return null;
          return (
            <div
              key={i}
              className={`absolute w-2 h-2 rounded-full border border-slate-900 shadow-lg pointer-events-auto cursor-help ${trade.side === 'BUY' ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-rose-500 shadow-rose-500/20'}`}
              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              title={`${trade.side} @ $${trade.price.toFixed(4)} (${trade.reason})`}
            />
          );
        })}
      </div>

      {/* Time Markers (X-Axis) - Updated to 5 points */}
      <div className="absolute bottom-1 left-0 w-full flex justify-between px-2 opacity-40 text-[7px] font-mono font-bold text-slate-500 pointer-events-none">
        {[0, 0.25, 0.5, 0.75, 1].map((scale) => {
          const time = startTime + scale * timeRange;
          const dateObj = new Date(time);
          const dateStr = dateObj.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
          const timeStr = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
          return (
            <div key={scale} className="flex flex-col items-center">
              <span>{dateStr} {timeStr}</span>
            </div>
          );
        })}
      </div>

      <div className="absolute top-4 right-6 flex gap-6 backdrop-blur-sm bg-slate-900/40 p-3 rounded-xl border border-slate-800/50">
        <div>
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Price Corridor</p>
          <p className="text-[11px] font-bold font-mono text-slate-300">
            ${minPrice.toFixed(2)} → ${maxPrice.toFixed(2)}
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/20"></div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-[8px]">Entry</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-lg shadow-rose-500/20"></div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-[8px]">Exit</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [balances, setBalances] = useState({ USDT: 0, BNB: 0 })
  const [marketData, setMarketData] = useState<Record<string, any>>({})
  const [logs, setLogs] = useState<any[]>([])
  const [botStartTime, setBotStartTime] = useState<number | null>(null)
  const [uptime, setUptime] = useState('00:00:00')
  const [whitelist, setWhitelist] = useState<any[]>([])
  const [newSymbol, setNewSymbol] = useState('')
  const [tradingMode, setTradingMode] = useState('SIMULATION')
  const [decoupledSymbols, setDecoupledSymbols] = useState<string[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({
    capital_type: 'PERCENTAGE',
    capital_value: '5',
    active_strategy: 'SNIPER',
    max_concurrent_trades: '3'
  })
  const [stats, setStats] = useState({ totalPnl: 0, avgRoi: 0, winRate: 0, unrealizedPnl: 0, totalTrades: 0 })

  const [tickFlashing, setTickFlashing] = useState(false)

  // Backtest Lab State
  const [btSymbol, setBtSymbol] = useState('SOLUSDT')
  const [btStrategy, setBtStrategy] = useState('SNIPER')
  const [btStart, setBtStart] = useState(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0])
  const [btEnd, setBtEnd] = useState(new Date().toISOString().split('T')[0])
  const [btEquity, setBtEquity] = useState('1000')
  const [btDecoupled, setBtDecoupled] = useState(false)
  const [btLoading, setBtLoading] = useState(false)
  const [btResults, setBtResults] = useState<any>(null)
  const [btError, setBtError] = useState<string | null>(null)

  // Toast State for Manual/Live trades
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null)
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(timer)
    }
    return () => {}
  }, [toast])

  // Combined initialization and listeners
  useEffect(() => {
    let interval: any;
    let timer: any;

    if (window.api) {
      window.api.onMarketUpdate((data) => {
        setMarketData(prev => ({ ...prev, [data.symbol]: data }))
        if (data.botStartTime) setBotStartTime(data.botStartTime)
        
        // Trigger brief tick flash
        setTickFlashing(true)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => setTickFlashing(false), 50)
      })
      window.api.onBalanceUpdate((data) => {
        setBalances(data)
      })
      window.api.onTradeExecuted((data) => {
        setLogs(prev => [data, ...prev].slice(0, 50))
        setToast({ message: `[${data.side}] ${stripUSDT(data.symbol)} @ $${data.price.toFixed(4)}`, type: 'success' })
      })
      window.api.getWhitelist().then(setWhitelist)
      window.api.getDecoupledWhitelist().then(setDecoupledSymbols)
      window.api.getSettings().then(res => {
        if (res.trading_mode) setTradingMode(res.trading_mode)
        setSettings(prev => ({ ...prev, ...res }))
      })
      
      window.api.onBacktestUpdate((data) => {
        setBtResults(data)
      })
      
      const refreshStats = () => {
        window.api.getStats().then(setStats)
      }
      refreshStats()
      interval = setInterval(refreshStats, 10000)

      window.api.startBot()
    }

    return () => {
      if (interval) clearInterval(interval)
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!botStartTime) return
      const diff = Math.floor((Date.now() - botStartTime) / 1000)
      const h = Math.floor(diff / 3600).toString().padStart(2, '0')
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0')
      const s = (diff % 60).toString().padStart(2, '0')
      setUptime(`${h}:${m}:${s}`)
    }, 1000)
    return () => clearInterval(timer)
  }, [botStartTime])

  useEffect(() => {
    if (window.api) {
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }, [tradingMode])

  const stripUSDT = (s: string) => s ? s.replace('USDT', '') : s

  const handleAddSymbol = () => {
    if (!newSymbol) return;
    let s = newSymbol.toUpperCase();
    if (!s.endsWith('USDT')) s += 'USDT';
    
    if (whitelist.find(w => w.symbol === s)) return;
    const list = [...whitelist, { symbol: s, strategy: 'SNIPER' }];
    setWhitelist(list);
    window.api.saveWhitelist(list);
    setNewSymbol('');
  }

  const handleRemoveSymbol = (symbolToRemove: string) => {
    const list = whitelist.filter(w => w.symbol !== symbolToRemove);
    setWhitelist(list);
    window.api.saveWhitelist(list);
  }

  const updateSetting = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    window.api.saveSettings({ key, value });
  }

  const toggleTradingMode = () => {
    const newMode = tradingMode === 'LIVE' ? 'SIMULATION' : 'LIVE';
    setTradingMode(newMode);
    window.api.saveSettings({ key: 'trading_mode', value: newMode });
  }

  const handleResetStats = async () => {
    if (window.confirm(`Are you sure you want to reset all ${tradingMode} stats? This will delete all trade history and cannot be undone.`)) {
      await window.api.clearTradeHistory(tradingMode)
      window.api.getStats().then(setStats)
      window.api.getRecentTrades({ mode: tradingMode, limit: 50 }).then(setLogs)
    }
  }

  const handleUpdateSymbolStrategy = (symbol: string, strategy: string) => {
    const list = whitelist.map(w => w.symbol === symbol ? { ...w, strategy } : w);
    setWhitelist(list);
    window.api.saveWhitelist(list);
  }

  const toggleDecoupled = (symbol: string) => {
    const newList = decoupledSymbols.includes(symbol) 
      ? decoupledSymbols.filter(s => s !== symbol)
      : [...decoupledSymbols, symbol];
    setDecoupledSymbols(newList);
    window.api.saveDecoupledWhitelist(newList);
  }

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar - Widened to w-80 */}
      <aside className="w-80 bg-slate-800/50 backdrop-blur-md border-r border-slate-700/50 flex flex-col p-4 shadow-xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 bg-indigo-500/20 rounded-lg text-white">
            <RobotIcon size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">AlgoBot</h1>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] transition-all duration-75 ${tickFlashing ? 'bg-emerald-400 scale-150' : 'bg-emerald-600 animate-pulse'}`}></span>
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
        <div className="h-10"></div>
        <nav className="flex flex-col gap-2 mb-8">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}
          >
            <BarChart2 size={18} /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}
          >
            <Settings size={18} /> Settings
          </button>
          <button 
            onClick={() => setActiveTab('backtest')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'backtest' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}
          >
            <Microscope size={18} /> Backtest Lab
          </button>
        </nav>

        <div className="h-10"></div>
        <div className="bg-slate-800/80 rounded-xl p-4 border border-slate-700/50 transition-all hover:bg-slate-800">
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
        <div className="h-10"></div>

        {/* Active Whitelist */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-800/20 rounded-xl p-2 border border-slate-700/30">
          <h3 className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-widest flex items-center justify-between px-2">
            <span>Market Whitelist</span>
            <span className="bg-slate-700/50 text-slate-400 py-0.5 px-2 rounded-full font-mono">{whitelist.length}</span>
          </h3>
          <div className="flex gap-2 mb-6 px-1">
            <input 
              type="text" 
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
              placeholder="ADD PAIR..." 
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 font-bold"
              onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
            />
            <button onClick={handleAddSymbol} className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 rounded-lg transition-colors flex items-center justify-center font-bold">
              +
            </button>
          </div>
          <ul className="flex flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar pt-2">
            {whitelist.map(w => {
              const isDecoupled = decoupledSymbols.includes(w.symbol);
              return (
                <li key={w.symbol} className="flex items-center gap-2 p-2 bg-slate-800/40 border border-slate-700/50 rounded-lg group transition-all hover:border-slate-600">
                  <span className="font-bold text-xs text-slate-200 tracking-wide min-w-[36px]">{stripUSDT(w.symbol)}</span>
                  
                  <select 
                    value={w.strategy}
                    onChange={(e) => handleUpdateSymbolStrategy(w.symbol, e.target.value)}
                    className="bg-slate-900 text-[9px] font-bold text-indigo-400 border border-slate-700 rounded px-1 py-1 flex-1 focus:outline-none"
                  >
                    <option value="SNIPER">SNIPER</option>
                    <option value="HUNTER">HUNTER</option>
                    <option value="BOX">BOX</option>
                    <option value="QUICK_EXIT">EXIT</option>
                  </select>

                  <button 
                    onClick={() => toggleDecoupled(w.symbol)}
                    title={isDecoupled ? "Decoupled from BTC Guard" : "Synced with BTC Guard"}
                    className={`p-1 rounded transition-colors ${isDecoupled ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-700 text-slate-400 border border-transparent hover:border-slate-500'}`}
                  >
                    {isDecoupled ? <Zap size={10} /> : <Target size={10} />}
                  </button>

                  <button onClick={() => handleRemoveSymbol(w.symbol)} className="text-slate-600 hover:text-rose-500 transition-colors text-lg leading-none">&times;</button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-900 p-8 overflow-y-auto">
        
        {/* Header */}
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
              {activeTab === 'dashboard' ? 'Bot Execution Dashboard' : activeTab === 'settings' ? 'Global Bot Settings' : 'Backtest Research Lab'}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {activeTab === 'dashboard' ? 'Live Market Monitoring & Hybrid Execution' : activeTab === 'settings' ? 'Configure trading parameters and maintenance' : 'Simulate strategies against historical live data'}
            </p>
            {/* TODO:
            - [x] 64. Add Price Curve Graph with Signal Overlays and Equity Control. (FIXED: Render limits)
            - [x] 65. Style Backtest Date Pickers for high visibility in Dark Mode.
            */}
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-full px-4 py-2 flex items-center gap-3">
              <span className={`text-sm font-semibold ${tradingMode === 'LIVE' ? 'text-rose-400' : 'text-indigo-300'}`}>{tradingMode}</span>
              <div 
                onClick={toggleTradingMode}
                className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${tradingMode === 'LIVE' ? 'bg-rose-500' : 'bg-slate-600'}`}
              >
                <div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${tradingMode === 'LIVE' ? 'translate-x-4' : ''}`}></div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area - Full width expansion */}
        <div className="flex-1 overflow-y-auto w-full px-4 pt-4 custom-scrollbar">
          {activeTab === 'backtest' ? (
            <div className="flex flex-col gap-6">
              {/* Params Input Row */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Symbol</label>
                  <select 
                    value={btSymbol} 
                    onChange={(e) => setBtSymbol(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold appearance-none cursor-pointer transition-all hover:bg-slate-800 hover:border-slate-600"
                  >
                    {whitelist.map((item: any) => (
                      <option key={item.symbol} value={item.symbol}>
                        {stripUSDT(item.symbol)}
                      </option>
                    ))}
                    {!whitelist.some((w: any) => w.symbol === btSymbol) && (
                      <option value={btSymbol}>{stripUSDT(btSymbol)} (Current)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Strategy</label>
                  <select 
                    value={btStrategy} 
                    onChange={(e) => setBtStrategy(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold appearance-none cursor-pointer transition-all hover:bg-slate-800 hover:border-slate-600"
                  >
                    <option value="SNIPER">SNIPER</option>
                    <option value="HUNTER">HUNTER</option>
                    <option value="BOX">BOX</option>
                    <option value="QUICK_EXIT">EXIT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Start Date</label>
                   <input 
                    type="date" 
                    value={btStart} 
                    onChange={(e) => setBtStart(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 font-mono transition-all hover:bg-slate-800 hover:border-slate-600"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">End Date</label>
                  <input 
                    type="date" 
                    value={btEnd} 
                    onChange={(e) => setBtEnd(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 font-mono transition-all hover:bg-slate-800 hover:border-slate-600"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Equity (USDT)</label>
                  <input 
                    type="number" 
                    value={btEquity} 
                    onChange={(e) => setBtEquity(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold transition-all hover:bg-slate-800 hover:border-slate-600"
                  />
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <input 
                    type="checkbox" 
                    id="btDecoupled"
                    checked={btDecoupled}
                    onChange={(e) => setBtDecoupled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
                  />
                  <label htmlFor="btDecoupled" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer select-none">Ignore BTC Guard</label>
                </div>
                <div className="flex items-end">
                  <button 
                    onClick={async () => {
                      setBtResults(null); 
                      setBtLoading(true);
                      setBtError(null);
                      try {
                        console.log('[BACKTEST UI] Starting request...');
                        const res = await window.api.runBacktest(btSymbol, btStrategy, btStart, btEnd, parseFloat(btEquity), btDecoupled);
                        console.log('[BACKTEST UI] Received response:', !!res, res?.error);
                        if (res.error) setBtError(res.error);
                        else {
                          console.log('[BACKTEST UI] Setting results. Trades:', res.trades?.length);
                          setBtResults(res);
                        }
                      } catch (e: any) {
                        setBtError(e.message || 'Simulation failed');
                      } finally {
                        setBtLoading(false);
                      }
                    }}
                    disabled={btLoading}
                    className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg transition-all flex items-center justify-center gap-2 h-[38px]"
                  >
                    {btLoading ? <Activity size={18} className="animate-spin" /> : <Play size={18} />}
                    {btLoading ? 'RUNNING...' : 'START RESEARCH'}
                  </button>
                </div>
              </div>

              {btError && (
                <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-4 rounded-xl text-sm font-bold flex items-center gap-3">
                  <Activity size={18} /> {btError}
                </div>
              )}

              {btResults && (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className={`grid gap-4 mb-8 ${btResults.hasOpenPosition ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'}`}>
                    <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Final Result (USDT)</p>
                      <h3 className={`text-2xl font-bold font-mono ${(btResults.finalEquity >= (parseFloat(btEquity) || 0)) ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${(Number(btResults.finalEquity) || 0).toFixed(2)}
                      </h3>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Profit / Loss</p>
                      <h3 className={`text-2xl font-bold font-mono ${(Number(btResults.totalPnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(Number(btResults.totalPnl) || 0) >= 0 ? '+' : ''}${(Number(btResults.totalPnl) || 0).toFixed(2)}
                      </h3>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total ROI</p>
                      <h3 className={`text-2xl font-bold font-mono ${(btResults.totalRoi >= 0) ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {((btResults.totalRoi || 0) * 100).toFixed(2)}%
                      </h3>
                    </div>
                    {btResults.hasOpenPosition && (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 relative overflow-hidden group">
                        <div className="absolute -right-2 -top-2 opacity-10 group-hover:rotate-12 transition-transform">
                          <Activity size={48} className="text-amber-400" />
                        </div>
                        <p className="text-[10px] font-bold text-amber-500/70 uppercase tracking-widest mb-1 flex items-center gap-2">
                          Unrealized PNL <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                        </p>
                        <h3 className={`text-2xl font-bold font-mono ${(Number(btResults.unrealizedPnl) || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(Number(btResults.unrealizedPnl) || 0) >= 0 ? '+' : ''}${(Number(btResults.unrealizedPnl) || 0).toFixed(2)}
                        </h3>
                      </div>
                    )}
                    <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Trades</p>
                      <h3 className="text-2xl font-bold font-mono text-slate-100">{btResults.totalTrades}</h3>
                    </div>

                    <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
                      <div className="flex items-center gap-2 mb-1 text-rose-400">
                        <Receipt size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Total Fees</span>
                      </div>
                      <h3 className="text-2xl font-bold font-mono text-rose-400">
                        -${(Number(btResults.totalFees) || 0).toFixed(2)}
                      </h3>
                    </div>
                  </div>

                  <div className="mb-8">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">Market Context (Price vs. Signals)</p>
                    <BacktestPriceChart results={btResults} />
                  </div>

                  <div className="bg-slate-800/20 border border-slate-700/30 rounded-2xl overflow-hidden">
                    <div className="p-4 border-b border-slate-700/30 font-bold text-sm text-slate-300 flex justify-between">
                      Simulated Research Feed
                      <span className="text-slate-500 font-mono text-xs">{(btResults.range.start || '').split('T')[0]} → {(btResults.range.end || '').split('T')[0]}</span>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-0">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-900/90 backdrop-blur text-[10px] uppercase text-slate-500 font-bold border-b border-slate-700/30">
                          <tr>
                            <th className="p-4">Time</th>
                            <th className="p-4">Side</th>
                            <th className="p-4">Price</th>
                            <th className="p-4">Result</th>
                            <th className="p-4">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs font-mono">
                          {btResults.trades.slice(0, 1000).map((t, i) => (
                            <tr key={i} className="border-b border-slate-700/20 hover:bg-slate-800/30 transition-colors">
                              <td className="p-4 text-slate-400 flex flex-col">
                                <span className="font-bold text-slate-300">{new Date(t.timestamp).toLocaleDateString()}</span>
                                <span className="text-[10px] opacity-60 text-indigo-300">{new Date(t.timestamp).toLocaleTimeString()}</span>
                              </td>
                              <td className="p-4">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.side === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                  {t.side}
                                </span>
                              </td>
                              <td className="p-4 font-bold">${t.price.toFixed(4)}</td>
                              <td className={`p-4 font-bold ${t.roi > 0 ? 'text-emerald-400' : t.roi < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                                {t.side === 'SELL' ? (
                                  `${(t.roi * 100).toFixed(2)}%`
                                ) : (
                                  (i === btResults.trades.length - 1 && btResults.hasOpenPosition) ? (
                                    <span className="text-amber-400 flex items-center gap-1">
                                      OPEN <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                                    </span>
                                  ) : '-'
                                )}
                              </td>
                              <td className="p-4 text-[10px] text-slate-500 italic uppercase underline decoration-indigo-500/30">{t.reason || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'dashboard' ? (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4 mt-10">
                {[
                  { label: 'Total PNL', value: `$${stats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: 'bg-emerald-500/10' },
                  { label: 'Average ROI', value: `${(stats.avgRoi * 100).toFixed(2)}%`, icon: Percent, color: stats.avgRoi >= 0 ? 'text-blue-400' : 'text-rose-400', bg: 'bg-blue-500/10' },
                  { label: 'Match Success Rate', value: `${stats.winRate.toFixed(1)}%`, icon: Target, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                  { label: 'Unrealized PNL', value: `$${stats.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Zap, color: stats.unrealizedPnl >= 0 ? 'text-amber-400' : 'text-rose-400', bg: 'bg-amber-500/10' }
                ].map((stat, i) => (
                  <div key={i} className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-5 flex items-center gap-4 hover:bg-slate-800/60 transition-colors">
                    <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                      <stat.icon size={24} />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{stat.label}</p>
                      <h3 className="text-2xl font-bold font-mono tracking-tight">{stat.value}</h3>
                    </div>
                  </div>
                ))}
              </div>
              <div className="h-10"></div>

              {/* Live Table */}
              <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl flex flex-col overflow-hidden shadow-2xl mb-8">
                <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <RobotIcon size={18} className="text-white" /> Live Ticker
                  </h3>
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full transition-all duration-75 ${tickFlashing ? 'bg-emerald-400 scale-150' : 'bg-emerald-600 animate-pulse'}`}></span> Streaming from Binance
                  </div>
                </div>
                <div className="overflow-auto max-h-[650px] custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-800/90 backdrop-blur z-10 text-[10px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="p-4 font-medium">Symbol</th>
                        <th className="p-4 font-medium">Regime</th>
                        <th className="p-4 font-medium">Macro</th>
                        <th className="p-4 font-medium">Pos / Entry</th>
                        <th className="p-4 font-medium">Price</th>
                        <th className="p-4 font-medium">Z-Score</th>
                        <th className="p-4 font-medium">Mom</th>
                        <th className="p-4 font-medium">OBI</th>
                        <th className="p-4 font-medium">High / Status</th>
                        <th className="p-4 font-medium">Unrealized ROI</th>
                        <th className="p-4 font-medium">RSI</th>
                        <th className="p-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {Object.values(marketData).length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
                            <RotateCcw size={32} className="animate-spin text-slate-600" />
                            Waiting for market data streams...
                          </td>
                        </tr>
                      ) : Object.values(marketData)
                        .sort((a: any, b: any) => {
                          if (!!a.position !== !!b.position) {
                            return a.position ? -1 : 1;
                          }
                          return a.symbol.localeCompare(b.symbol);
                        })
                        .map((row: any) => (
                        <tr key={row.symbol} className="hover:bg-slate-700/20 transition-colors">
                          <td className="p-4 font-bold">{stripUSDT(row.symbol)}</td>
                          <td className="p-4">
                            <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-semibold">
                              {row.regime}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded text-[10px] font-semibold ${row.macroRegime === 'BULL' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                              {row.macroRegime || 'BEAR'}
                            </span>
                          </td>
                          <td className="p-4 font-mono text-sm text-slate-300">
                            {row.position ? (
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-100">{row.position.quantity.toFixed(4)}</span>
                                <span className="text-[10px] text-slate-500">@ ${row.position.entryPrice.toFixed(4)}</span>
                              </div>
                            ) : '-'}
                          </td>
                          <td className="p-4 font-mono">{row.currentPrice.toFixed(4)}</td>
                          <td className="p-4 font-mono">
                            <span className={`text-xs font-bold ${Math.abs(row.zScore) > 2 ? 'text-amber-400' : 'text-slate-400'}`}>
                              {row.zScore?.toFixed(2) || '0.00'}
                            </span>
                          </td>
                          <td className="p-4 font-mono">
                            <span className={`text-xs font-bold ${row.autocorrelation > 0.2 ? 'text-emerald-400' : row.autocorrelation < -0.2 ? 'text-rose-400' : 'text-slate-400'}`}>
                              {row.autocorrelation?.toFixed(2) || '0.00'}
                            </span>
                          </td>
                          <td className="p-4 font-mono">
                            <span className={`text-xs font-bold ${row.obi > 0.6 ? 'text-emerald-400' : row.obi < 0.4 ? 'text-rose-400' : 'text-slate-400'}`}>
                              {row.obi?.toFixed(2) || '0.50'}
                            </span>
                          </td>
                          <td className="p-4">
                            {row.position ? (
                              <div className="flex flex-col">
                                <span className={`font-mono font-bold ${
                                  row.trailingStatus === 'TRAILING' ? 'text-indigo-400' :
                                  row.trailingStatus === 'MID_TRAIL' ? 'text-emerald-400' :
                                  'text-amber-400'
                                }`}>
                                  {(((row.position.highWaterMark - row.position.entryPrice) / row.position.entryPrice) * 100) >= 0 ? '+' : ''}
                                  {(((row.position.highWaterMark - row.position.entryPrice) / row.position.entryPrice) * 100).toFixed(2)}%
                                </span>
                                <span className="text-[9px] text-slate-500 font-bold tracking-tighter uppercase leading-none">
                                  {row.trailingStatus !== 'PROTECTIVE' ? row.trailingStatus : 'ACTIVE'}
                                </span>
                              </div>
                            ) : '-'}
                          </td>
                          <td className="p-4">
                            {row.position ? (
                              <span className={`font-mono font-bold text-lg ${((row.currentPrice - row.position.entryPrice) / row.position.entryPrice) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {((row.currentPrice - row.position.entryPrice) / row.position.entryPrice * 100).toFixed(2)}%
                              </span>
                            ) : '-'}
                          </td>
                          <td className="p-4">
                            <span className={`font-mono font-bold ${row.rsi5m > 70 ? 'text-rose-400' : row.rsi5m < 30 ? 'text-emerald-400' : 'text-slate-300'}`}>
                              {row.rsi5m || '-'}
                            </span>
                          </td>
                          <td className="p-4 text-right flex items-center justify-end">
                            <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700 gap-1 shrink-0">
                              <button 
                                onClick={async () => {
                                  await window.api?.manualTrade(row.symbol, 'BUY');
                                  setToast({ message: `Manual BUY order placed for ${stripUSDT(row.symbol)}`, type: 'success' });
                                }} 
                                className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded text-[9px] font-bold transition-colors"
                              >
                                BUY
                              </button>
                              <button 
                                onClick={async () => {
                                  await window.api?.manualTrade(row.symbol, 'SELL');
                                  setToast({ message: `Manual SELL order placed for ${stripUSDT(row.symbol)}`, type: 'success' });
                                }} 
                                disabled={!row.position}
                                className={`px-2.5 py-1 rounded text-[9px] font-bold transition-all ${row.position ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 'text-slate-600 cursor-not-allowed opacity-40'}`}
                              >
                                SELL
                              </button>
                              <button 
                                onClick={() => window.api?.toggleBotManualMode(row.symbol, !row.manual)}
                                className={`px-2.5 py-1 rounded text-[9px] font-bold transition-all ${row.manual ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                              >
                                {row.manual ? 'MANUAL' : 'AUTO'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="h-10"></div>

              {/* Logs Section */}
              <div className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Activity size={14} className="text-emerald-400" /> Recent Activity
                  </h3>
                  <button onClick={() => setLogs([])} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold">Clear Logs</button>
                </div>
                <div className="max-h-48 overflow-y-auto p-4 flex flex-col gap-2 font-mono text-[13px] custom-scrollbar bg-slate-900/40">
                  {logs.length === 0 ? (
                    <div className="text-slate-600 italic">No activity recorded yet...</div>
                  ) : logs.map((log, i) => (
                    <div key={i} className="flex gap-3 border-l-2 border-slate-700 pl-3 py-1 hover:border-indigo-500 transition-colors">
                      <span className="text-slate-500 shrink-0">[{new Date(log.timestamp || Date.now()).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', '')}]</span>
                      <div className="flex justify-between w-full pr-2">
                        <span className={log.side === 'BUY' ? 'text-emerald-400 font-bold' : log.side === 'SELL' ? 'text-rose-400 font-bold' : 'text-indigo-300'}>
                          {log.side ? `${log.side} ${stripUSDT(log.symbol)} @ ${log.price}` : log.message || JSON.stringify(log)}
                        </span>
                        {log.side === 'SELL' && log.pnl !== undefined && (
                          <span className={log.pnl >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>
                            {log.pnl >= 0 ? '+' : ''}${log.pnl.toFixed(4)} ({(log.roi * 100).toFixed(2)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="max-w-2xl bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-8 shadow-2xl">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Settings className="text-indigo-400" /> Bot Configuration
              </h3>
              
              <div className="grid gap-8">
                {/* Mode Selection */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Trading Mode</label>
                  <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700">
                    <button 
                      onClick={() => toggleTradingMode()}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tradingMode === 'SIMULATION' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      SIMULATION
                    </button>
                    <button 
                      onClick={() => toggleTradingMode()}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tradingMode === 'LIVE' ? 'bg-rose-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      LIVE
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 italic">
                    {tradingMode === 'LIVE' ? '⚠️ WARNING: Real orders will be placed on your Binance account.' : 'Simulation mode uses paper trading logic with your real balance.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  {/* Strategy Selection */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Active Strategy</label>
                    <select 
                      value={settings.active_strategy}
                      onChange={(e) => updateSetting('active_strategy', e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    >
                      <option value="SNIPER">SNIPER (Fast Scalping)</option>
                      <option value="HUNTER">HUNTER (Swing Trading)</option>
                      <option value="BOX">BOX (Range Breakout)</option>
                      <option value="QUICK_EXIT">QUICK EXIT (Close Only)</option>
                    </select>
                  </div>

                  {/* Max Trades */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Max Concurrent Trades</label>
                    <input 
                      type="number" 
                      value={settings.max_concurrent_trades}
                      onChange={(e) => updateSetting('max_concurrent_trades', e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  {/* Capital Type */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Allocation Type</label>
                    <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700">
                      <button 
                        onClick={() => updateSetting('capital_type', 'PERCENTAGE')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${settings.capital_type === 'PERCENTAGE' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        % EQUITY
                      </button>
                      <button 
                        onClick={() => updateSetting('capital_type', 'FIXED')}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${settings.capital_type === 'FIXED' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        $ FIXED
                      </button>
                    </div>
                  </div>

                  {/* Capital Value */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Amount ({settings.capital_type === 'PERCENTAGE' ? '%' : '$'})</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        value={settings.capital_value}
                        onChange={(e) => updateSetting('capital_value', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-indigo-500 transition-colors pl-8"
                      />
                      <span className="absolute left-3 top-3 text-slate-500 font-bold">
                        {settings.capital_type === 'PERCENTAGE' ? '%' : '$'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="mt-12 pt-8 border-t border-slate-800/60">
                <h3 className="text-sm font-bold text-rose-400 uppercase tracking-widest mb-4">Danger Zone</h3>
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-6 flex items-center justify-between shadow-xl shadow-rose-950/20">
                  <div>
                    <h4 className="font-bold text-rose-100 mb-1 caps">Reset {tradingMode} Statistics</h4>
                    <p className="text-xs text-slate-500">Permanently delete all historical trade data and reset profit metrics for this mode.</p>
                  </div>
                  <button 
                    onClick={handleResetStats}
                    className="bg-rose-600/20 hover:bg-rose-600 border border-rose-600/30 text-rose-400 hover:text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                  >
                    RESET STATS
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className="bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-indigo-400/50">
            <Zap size={18} className="text-amber-400 animate-pulse" />
            <span className="font-bold tracking-tight text-sm uppercase">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}
