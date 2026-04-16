import React from 'react'
import { BarChart2, Settings, FileText, Microscope, DollarSign, Clock } from 'lucide-react'
import { RobotIcon } from '@renderer/components/icons/RobotIcon'
import { useAppContext } from '@renderer/context/AppContext'

export function Sidebar(): React.ReactElement {
  const {
    activeTab,
    setActiveTab,
    isConnected,
    tickFlashing,
    botStartTime,
    uptime,
    versions,
    balances,
    whitelist,
    newSymbol,
    setNewSymbol,
    marketData,
    handleAddSymbol,
    handleRemoveSymbol,
    stripUSDT
  } = useAppContext()

  const isMismatch = versions
    ? (() => {
        const backendParts = versions.backend.split('.')
        const expectedParts = versions.expectedBackend?.split('.') || []
        return expectedParts.length >= 2 && expectedParts[0] !== 'unknown'
          ? backendParts[0] !== expectedParts[0] || backendParts[1] !== expectedParts[1]
          : versions.frontend !== versions.backend
      })()
    : false

  return (
    <aside
      className={`w-72 bg-slate-800/50 backdrop-blur-md border-r border-slate-700/50 flex flex-col p-4 shadow-xl ${
        !isConnected ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <div className="flex items-center gap-3 mb-8 mt-4">
        <div className="p-2 bg-indigo-500/20 rounded-lg text-white">
          <RobotIcon size={24} />
        </div>
        <div>
          <h1 className="font-bold text-lg tracking-tight">Grid DCA Bot</h1>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span
              className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)] transition-all duration-75 ${
                tickFlashing ? 'bg-emerald-400 scale-150' : 'bg-emerald-600 animate-pulse'
              }`}
            />
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

      <div style={{ height: '16px' }} />
      <nav className="flex flex-col gap-2 mb-6">
        {[
          { id: 'dashboard', icon: BarChart2, label: 'Dashboard' },
          { id: 'settings', icon: Settings, label: 'Settings' },
          { id: 'reports', icon: FileText, label: 'Reports' },
          { id: 'backtest', icon: Microscope, label: 'Backtest Lab' }
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === id
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
            }`}
          >
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
          <span className="text-lg font-mono tracking-tighter">
            $
            {balances.USDT.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })}
          </span>
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
          <span className="bg-slate-700/50 text-slate-400 py-0.5 px-2 rounded-full font-mono">
            {whitelist.length}
          </span>
        </h3>
        <div className="flex gap-2 mb-4 px-1">
          <input
            type="text"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
            placeholder="ADD PAIR..."
            onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 font-bold"
          />
          <button
            onClick={handleAddSymbol}
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 rounded-lg transition-colors font-bold"
          >
            +
          </button>
        </div>
        <ul className="flex flex-col gap-1.5 overflow-y-auto pr-1 custom-scrollbar">
          {whitelist.map((sym) => {
            const row = marketData[sym]
            const hasBase = row?.hasBaseShare
            return (
              <li
                key={sym}
                className="flex items-center gap-2 p-2 bg-slate-800/40 border border-slate-700/50 rounded-lg group transition-all hover:border-slate-600"
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    hasBase ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]' : 'bg-slate-600'
                  }`}
                  title={hasBase ? 'Base share active' : 'No base share'}
                />
                <span className="font-bold text-xs text-slate-200 tracking-wide flex-1">
                  {stripUSDT(sym)}
                </span>
                {row?.currentPrice && (
                  <span className="text-[10px] font-mono text-slate-400">
                    ${row.currentPrice.toFixed(4)}
                  </span>
                )}
                <button
                  onClick={() => handleRemoveSymbol(sym)}
                  className="text-slate-600 hover:text-rose-500 transition-colors text-lg leading-none"
                >
                  &times;
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Version Display */}
      {versions && (
        <div className="mt-4 pt-4 border-t border-slate-700/30">
          <div
            className={`text-[10px] font-mono px-3 py-1.5 rounded-full w-fit mx-auto ${
              isMismatch ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700/50 text-slate-500'
            }`}
            title={`UI: v${versions.frontend}  |  Server: v${versions.backend} ${
              isMismatch ? `(Expected v${versions.expectedBackend})` : ''
            }`}
          >
            {isMismatch ? '⚠ ' : ''}
            UI v{versions.frontend}✓ / Srv v{versions.backend}
          </div>
        </div>
      )}
    </aside>
  )
}
