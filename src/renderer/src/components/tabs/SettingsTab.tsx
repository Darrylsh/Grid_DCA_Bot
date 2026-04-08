import React from 'react'
import { Settings } from 'lucide-react'
import { useAppContext } from '@renderer/context/AppContext'

export function SettingsTab(): React.ReactElement {
  const {
    tradingMode,
    setTradingMode,
    settings,
    updateSetting,
    handleResetStats,
    handleWipeAllData
  } = useAppContext()

  return (
    <div className="max-w-2xl bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-8 shadow-2xl">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <Settings className="text-indigo-400" /> Grid Bot Configuration
      </h3>
      <div className="grid gap-8">
        {/* Trading Mode */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Trading Mode
          </label>
          <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-700">
            {['SIMULATION', 'LIVE'].map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setTradingMode(mode)
                  window.api.saveSettings({ key: 'trading_mode', value: mode })
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${tradingMode === mode ? (mode === 'LIVE' ? 'bg-rose-500 text-white shadow-lg' : 'bg-indigo-500 text-white shadow-lg') : 'text-slate-500 hover:text-slate-300'}`}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-1 italic">
            {tradingMode === 'LIVE'
              ? '⚠️ Real orders will be placed on Binance.'
              : 'Simulation tracks grid levels in memory without placing real orders.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8">
          {/* Share Amount */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Share Amount (USDT)
            </label>
            <div className="relative">
              <input
                type="number"
                value={settings.capital_value}
                onChange={(e) => updateSetting('capital_value', e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-indigo-500 transition-colors pl-8"
              />
              <span className="absolute left-3 top-3 text-slate-500 font-bold">$</span>
            </div>
            <p className="text-xs text-slate-500 italic">
              Fixed USDT amount per grid share purchase.
            </p>
          </div>

          {/* Grid Step */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Grid Step (%)
            </label>
            <div className="relative">
              <input
                type="number"
                value={settings.grid_step_percent}
                step="0.5"
                min="0.5"
                max="20"
                onChange={(e) => updateSetting('grid_step_percent', e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-indigo-500 transition-colors pr-8"
              />
              <span className="absolute right-3 top-3 text-slate-500 font-bold">%</span>
            </div>
            <p className="text-xs text-slate-500 italic">
              Buy/sell trigger distance from reference price.
            </p>
          </div>
        </div>

        {/* Trailing Stop */}
        <div className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Trail Stop Trigger (levels)
            </label>
            <input
              type="number"
              value={settings.trailing_stop_levels || '3'}
              min="1"
              max="20"
              step="1"
              onChange={(e) => updateSetting('trailing_stop_levels', e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-xs text-slate-500 italic">
              Levels above entry to arm the trailing stop (e.g. 3 = +6% at 2% grid).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Trail Stop Distance (×grid)
            </label>
            <div className="relative">
              <input
                type="number"
                value={settings.trailing_stop_pct || '0.5'}
                min="0.1"
                max="2"
                step="0.1"
                onChange={(e) => updateSetting('trailing_stop_pct', e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm w-full focus:outline-none focus:border-amber-500 transition-colors pr-8"
              />
              <span className="absolute right-3 top-3 text-slate-500 font-bold text-xs">×g</span>
            </div>
            <p className="text-xs text-slate-500 italic">
              Stop distance as fraction of grid step (0.5 = ½ grid = 1% at 2% grid).
            </p>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-12 pt-8 border-t border-slate-800/60">
        <h3 className="text-sm font-bold text-rose-400 uppercase tracking-widest mb-4">
          Danger Zone
        </h3>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between p-4 bg-slate-800/40 border border-slate-700/50 rounded-2xl">
            <div>
              <h4 className="text-white font-bold mb-1">Reset {tradingMode} Trade History</h4>
              <p className="text-slate-400 text-xs">
                Permanently delete all trade logs and reset profit metrics.
              </p>
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
              <p className="text-slate-400 text-xs">
                Delete EVERYTHING: Base shares, grid levels, and history.
              </p>
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
  )
}
