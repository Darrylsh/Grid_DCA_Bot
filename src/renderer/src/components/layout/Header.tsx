import React from 'react'
import { useAppContext } from '@renderer/context/AppContext'

export function Header(): React.ReactElement {
  const { activeTab, tradingMode, toggleTradingMode } = useAppContext()

  return (
    <header className="flex justify-between items-center mb-8 mt-4">
      <div>
        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
          {activeTab === 'dashboard'
            ? 'Grid DCA Dashboard'
            : activeTab === 'settings'
              ? 'Bot Configuration'
              : activeTab === 'reports'
                ? 'Performance Reports'
                : 'Backtest Research Lab'}
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          {activeTab === 'dashboard'
            ? 'Live grid monitoring — buy shares on dips, sell at profit targets'
            : activeTab === 'settings'
              ? 'Configure grid parameters and trading options'
              : activeTab === 'reports'
                ? 'Analyze executed trades and realized profit over time'
                : 'Simulate grid strategy against historical 1-minute candle data'}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-full px-4 py-2 flex items-center gap-3">
          <span
            className={`text-sm font-semibold ${tradingMode === 'LIVE' ? 'text-rose-400' : 'text-indigo-300'}`}
          >
            {tradingMode}
          </span>
          <div
            onClick={toggleTradingMode}
            className={`w-10 h-6 rounded-full relative cursor-pointer transition-colors ${tradingMode === 'LIVE' ? 'bg-rose-500' : 'bg-slate-600'}`}
          >
            <div
              className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${tradingMode === 'LIVE' ? 'translate-x-4' : ''}`}
            />
          </div>
        </div>
      </div>
    </header>
  )
}
