import React from 'react'
import { Activity, Play } from 'lucide-react'
import { BacktestPriceChart } from '@renderer/components/charts/BacktestPriceChart'
import { useAppContext } from '@renderer/context/AppContext'
import type { Trade } from '@shared/types'

export function BacktestTab(): React.ReactElement {
  const {
    btSymbol,
    setBtSymbol,
    whitelist,
    stripUSDT,
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
    setBtStatus
  } = useAppContext()

  const handleRunBacktest = async (): Promise<void> => {
    setBtResults(null)
    setBtLoading(true)
    setBtError(null)
    setBtProgress(0)
    setBtStatus('Starting...')
    try {
      const res = await window.api.runBacktest(
        btSymbol,
        btStart,
        btEnd,
        parseFloat(btShareAmount),
        parseFloat(btGridStep)
      )
      if (res?.error) setBtError(res.error)
      else setBtResults(res)
    } catch (e: unknown) {
      setBtError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setBtLoading(false)
      setBtStatus('')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
        {/* Symbol */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            Symbol
          </label>
          <select
            value={btSymbol}
            onChange={(e) => setBtSymbol(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold appearance-none cursor-pointer"
          >
            {whitelist.map((sym) => (
              <option key={sym} value={sym}>
                {stripUSDT(sym)}
              </option>
            ))}
            {whitelist.length === 0 && <option value="">Add symbols first</option>}
          </select>
        </div>
        {/* Start */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            Start Date
          </label>
          <input
            type="date"
            value={btStart}
            onChange={(e) => setBtStart(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
            style={{ colorScheme: 'dark' }}
          />
        </div>
        {/* End */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            End Date
          </label>
          <input
            type="date"
            value={btEnd}
            onChange={(e) => setBtEnd(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
            style={{ colorScheme: 'dark' }}
          />
        </div>
        {/* Share Amount */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            Share Amount ($)
          </label>
          <input
            type="number"
            value={btShareAmount}
            onChange={(e) => setBtShareAmount(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold"
          />
        </div>
        {/* Grid Step */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            Grid Step (%)
          </label>
          <input
            type="number"
            value={btGridStep}
            onChange={(e) => setBtGridStep(e.target.value)}
            step="0.5"
            min="0.5"
            max="20"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-bold"
          />
        </div>
        {/* Run Button */}
        <div className="flex items-end md:col-span-5">
          <button
            onClick={handleRunBacktest}
            disabled={btLoading || !btSymbol}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg transition-all flex items-center justify-center gap-2 h-[38px]"
          >
            {btLoading ? <Activity size={18} className="animate-spin" /> : <Play size={18} />}
            {btLoading ? btStatus || `RUNNING... ${btProgress}%` : 'START SIMULATION'}
          </button>
        </div>
      </div>

      {btLoading && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4">
          <div className="flex justify-between text-xs text-slate-400 mb-2 font-mono">
            <span>{btStatus}</span>
            <span>{btProgress}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${btProgress}%` }}
            />
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
              {
                label: 'Realized PnL',
                value: `${btResults.realizedPnl >= 0 ? '+' : ''}$${Number(btResults.realizedPnl).toFixed(2)}`,
                color: btResults.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              },
              {
                label: 'Unrealized PnL',
                value: `${btResults.unrealizedPnl >= 0 ? '+' : ''}$${Number(btResults.unrealizedPnl).toFixed(2)}`,
                color: btResults.unrealizedPnl >= 0 ? 'text-amber-400' : 'text-rose-400'
              },
              {
                label: 'Total ROI',
                value: `${((btResults.totalRoi || 0) * 100).toFixed(2)}%`,
                color: btResults.totalRoi >= 0 ? 'text-emerald-400' : 'text-rose-400'
              },
              {
                label: 'Grid Buys',
                value: btResults.gridLevelCount,
                color: 'text-indigo-400'
              },
              {
                label: 'Sells Filled',
                value: btResults.totalTrades,
                color: 'text-emerald-400'
              },
              {
                label: 'Pending Sells',
                value: btResults.pendingLevels,
                color: 'text-amber-400'
              },
              {
                label: 'Total Fees',
                value: `-$${Number(btResults.totalFees).toFixed(2)}`,
                color: 'text-rose-400'
              }
            ].map((s, i) => (
              <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                  {s.label}
                </p>
                <h3 className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</h3>
              </div>
            ))}
          </div>

          <div className="mb-6">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 ml-1">
              Price Chart & Grid Trades
            </p>
            <BacktestPriceChart results={btResults} />
          </div>

          {/* Trade table */}
          <div className="bg-slate-800/20 border border-slate-700/30 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-700/30 font-bold text-sm text-slate-300 flex justify-between">
              Simulation Trade Log
              <span className="text-slate-500 font-mono text-xs">
                {(btResults.range?.start || '').split('T')[0]} →{' '}
                {(btResults.range?.end || '').split('T')[0]} (
                {btResults.range?.candlesProcessed?.toLocaleString()} candles)
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
                  {btResults.trades.slice(0, 1000).map((t: Trade, i: number) => (
                    <tr
                      key={i}
                      className="border-b border-slate-700/20 hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="p-4 text-slate-400">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-300">
                            {new Date(t.timestamp).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] opacity-60 text-indigo-300">
                            {new Date(t.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.side === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="p-4 font-bold">${Number(t.price).toFixed(4)}</td>
                      <td className="p-4 text-slate-400">{Number(t.quantity).toFixed(6)}</td>
                      <td
                        className={`p-4 font-bold ${t.pnl && t.pnl > 0 ? 'text-emerald-400' : t.pnl && t.pnl < 0 ? 'text-rose-400' : 'text-slate-400'}`}
                      >
                        {t.pnl != null
                          ? `${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(4)}`
                          : '-'}
                      </td>
                      <td className="p-4 text-[10px] text-slate-500 italic uppercase">
                        {t.reason || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
