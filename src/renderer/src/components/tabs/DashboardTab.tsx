import {
  Activity,
  DollarSign,
  Percent,
  Zap,
  RotateCcw,
  TrendingDown,
  Trash2,
  TrendingUp,
  Layers,
  CheckCircle,
  Shuffle,
  Receipt,
  Pause,
  Play
} from 'lucide-react'
import React from 'react'
import { useAppContext } from '@renderer/context/AppContext'
import type { MarketUpdate, GridLevel } from '@shared/types'

export function DashboardTab(): React.ReactElement {
  const {
    stats,
    tickFlashing,
    marketData,
    stripUSDT,
    registeringSymbol,
    handleSetBase,
    handleDeleteBaseShare,
    setToast,
    setMarketData,
    logs,
    setLogs
  } = useAppContext()

  const totalPnl = stats.totalPnl + stats.unrealizedPnl
  const principal = 727.4
  const roi = totalPnl / principal
  const daysRunning = stats.firstTradeTime
    ? Math.max(1, (Date.now() - stats.firstTradeTime) / (1000 * 60 * 60 * 24))
    : 1
  const safeRoi = Math.max(-0.999, roi)
  const apyFraction = Math.pow(1 + safeRoi, 365 / daysRunning) - 1
  const apyPercent = apyFraction * 100
  const annualProfit = apyFraction * principal

  return (
    <>
      {/* Stats Grid */}
      <div className="grid grid-cols-7 gap-2 mb-8 text-[10px]">
        {[
          {
            label: 'Realized PNL',
            value: `$${stats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            icon: DollarSign,
            color: stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
            bg: 'bg-emerald-500/10'
          },
          {
            label: 'Total Fees',
            value: `$${stats.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            icon: Receipt,
            color: 'text-amber-400',
            bg: 'bg-amber-500/10'
          },
          {
            label: 'Portfolio ROI',
            value: `${(roi * 100).toFixed(2)}%`,
            icon: Percent,
            color: totalPnl >= 0 ? 'text-blue-400' : 'text-rose-400',
            bg: 'bg-blue-500/10'
          },
          {
            label: 'Projected APY',
            value: (
              <div className="flex flex-col">
                <span>
                  {apyPercent > 0 ? '+' : ''}
                  {apyPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%
                </span>
                <span className="text-[9px] opacity-60 font-normal">
                  ≈ $
                  {annualProfit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                  /yr
                </span>
              </div>
            ),
            icon: TrendingUp,
            color: apyPercent >= 0 ? 'text-indigo-400' : 'text-rose-400',
            bg: 'bg-indigo-500/10'
          },
          {
            label: 'Win Rate',
            value: `${stats.winRate.toFixed(1)}%`,
            icon: CheckCircle,
            color: 'text-purple-400',
            bg: 'bg-purple-500/10'
          },
          {
            label: 'Fill Rate',
            value: `${stats.fillRate.toFixed(1)}%`,
            icon: Shuffle,
            color: 'text-indigo-400',
            bg: 'bg-indigo-500/10'
          },
          {
            label: 'Unrealized PNL',
            value: `$${stats.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            icon: Zap,
            color: stats.unrealizedPnl >= 0 ? 'text-amber-400' : 'text-rose-400',
            bg: 'bg-amber-500/10'
          }
        ].map((stat, i) => (
          <div
            key={i}
            className="bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl p-4 flex items-center gap-3 hover:bg-slate-800/60 transition-colors"
          >
            <div className={`p-2 rounded-xl ${stat.bg} ${stat.color}`}>
              <stat.icon size={20} />
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">
                {stat.label}
              </p>
              <h3 className={`text-xl font-bold font-mono tracking-tight ${stat.color}`}>
                {stat.value}
              </h3>
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
            <span
              className={`w-2 h-2 rounded-full transition-all duration-75 ${tickFlashing ? 'bg-emerald-400 scale-150' : 'bg-emerald-600 animate-pulse'}`}
            />
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
                <th className="p-4 font-medium">% to Grid</th>
                <th className="p-4 font-medium">Grid Levels</th>
                <th className="p-4 font-medium text-amber-400">Current PnL</th>
                <th className="p-4 font-medium text-emerald-400">Total PnL</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {Object.values(marketData).length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-3">
                      <RotateCcw size={32} className="animate-spin text-slate-600" />
                      Waiting for market data streams...
                    </div>
                  </td>
                </tr>
              ) : (
                Object.values(marketData)
                  .sort((a: MarketUpdate, b: MarketUpdate) =>
                    a.hasBaseShare === b.hasBaseShare
                      ? a.symbol.localeCompare(b.symbol)
                      : a.hasBaseShare
                        ? -1
                        : 1
                  )
                  .map((row: MarketUpdate) => {
                    const pct = row.pctFromBase
                    const isUp = pct != null && pct >= 0
                    const levels: GridLevel[] = row.gridLevels || []
                    return (
                      <tr key={row.symbol} className="hover:bg-slate-700/20 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full ${row.hasBaseShare ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' : 'bg-slate-600'}`}
                            />
                            <span className="font-bold">{stripUSDT(row.symbol)}</span>
                          </div>
                        </td>
                        <td className="p-4 font-mono font-bold">
                          ${row.currentPrice?.toFixed(4) ?? '-'}
                        </td>
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
                          ) : (
                            <span className="text-slate-600 italic text-xs">No base share</span>
                          )}
                        </td>
                        <td className="p-4">
                          {pct != null ? (
                            <span
                              className={`flex items-center gap-1 font-mono font-bold ${row.trailActive ? 'text-amber-400' : isUp ? 'text-emerald-400' : 'text-rose-400'}`}
                            >
                              {row.trailActive ? (
                                '\u{1F512}'
                              ) : isUp ? (
                                <TrendingUp size={14} />
                              ) : (
                                <TrendingDown size={14} />
                              )}
                              {pct >= 0 ? '+' : ''}
                              {pct.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          {row.pctToGrid != null ? (
                            <span className="flex items-center gap-1 font-mono font-bold text-indigo-400">
                              +{row.pctToGrid.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          {levels.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-indigo-400">
                                {levels.length} pending sell{levels.length !== 1 ? 's' : ''}
                              </span>
                              <span className="text-[9px] text-slate-500">
                                Targets:{' '}
                                {levels
                                  .slice(0, 2)
                                  .map((l) => `$${l.sellPrice?.toFixed(4)}`)
                                  .join(', ')}
                                {levels.length > 2 ? ` +${levels.length - 2}` : ''}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          {row.activeSharePnl != null ? (
                            <span
                              className={`font-mono font-bold ${row.activeSharePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                            >
                              {row.activeSharePnl >= 0 ? '+' : ''}${row.activeSharePnl?.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="p-4 border-l border-slate-700/30">
                          {row.totalUnrealizedPnl != null ? (
                            <span
                              className={`font-mono font-bold ${row.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                            >
                              {row.totalUnrealizedPnl >= 0 ? '+' : ''}$
                              {row.totalUnrealizedPnl?.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!row.hasBaseShare ? (
                              <button
                                onClick={() => handleSetBase(row.symbol)}
                                disabled={registeringSymbol === row.symbol}
                                className="px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 rounded-lg text-[10px] font-bold transition-colors border border-amber-500/30"
                              >
                                {registeringSymbol === row.symbol ? 'BUYING...' : 'SET BASE'}
                              </button>
                            ) : (
                              <div className="flex gap-2 items-center">
                                <button
                                  onClick={async () => {
                                    await window.api.togglePause(row.symbol)
                                    setToast({
                                      message: `${stripUSDT(row.symbol)} grid buying ${row.isPaused ? 'resumed' : 'paused'}`,
                                      type: 'info'
                                    })
                                  }}
                                  className={`p-1.5 rounded-lg transition-all border ${row.isPaused ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30' : 'bg-slate-700 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 border-slate-600'}`}
                                  title={row.isPaused ? 'Resume Buying' : 'Pause Buying'}
                                >
                                  {row.isPaused ? <Play size={14} /> : <Pause size={14} />}
                                </button>
                                <button
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Sell base share for ${stripUSDT(row.symbol)}?`
                                      )
                                    ) {
                                      window.api.sellBaseShare(row.symbol).then(() => {
                                        setToast({
                                          message: `Base share sold for ${stripUSDT(row.symbol)}`,
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
                                {levels.length > 0 && (
                                  <button
                                    onClick={async () => {
                                      const lowest = [...levels].sort(
                                        (a, b) => a.sellPrice - b.sellPrice
                                      )[0]
                                      if (
                                        window.confirm(
                                          `Sell lowest grid level for ${stripUSDT(row.symbol)}?\n` +
                                            `Target: $${lowest.sellPrice.toFixed(4)}\n` +
                                            `Quantity: ${lowest.quantity.toFixed(6)}\n` +
                                            `Market sell at current price (~$${row.currentPrice?.toFixed(4)})`
                                        )
                                      ) {
                                        await window.api.sellLowestGridLevel(row.symbol)
                                        setToast({
                                          message: `Grid level sold for ${stripUSDT(row.symbol)}`,
                                          type: 'success'
                                        })
                                        window.api.getGridState().then(setMarketData)
                                      }
                                    }}
                                    className="px-2 py-1.5 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg text-[10px] font-bold transition-colors border border-amber-500/20"
                                  >
                                    GRID SELL
                                  </button>
                                )}
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
                              <button
                                onClick={async () => {
                                  if (
                                    window.confirm(
                                      `Cancel all ${levels.length} pending grid sells for ${stripUSDT(row.symbol)}?`
                                    )
                                  ) {
                                    await window.api.clearGridLevels(row.symbol)
                                    setToast({
                                      message: `Grid levels cleared for ${stripUSDT(row.symbol)}`,
                                      type: 'info'
                                    })
                                  }
                                }}
                                className="px-2 py-1.5 bg-slate-700 text-slate-400 hover:text-rose-400 rounded-lg text-[10px] font-bold transition-colors"
                              >
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
          <button
            onClick={() => setLogs([])}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase font-bold"
          >
            Clear
          </button>
        </div>
        <div className="max-h-48 overflow-y-auto p-4 flex flex-col gap-2 font-mono text-[13px] custom-scrollbar bg-slate-900/40">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">No activity recorded yet...</div>
          ) : (
            logs.map((log, i) => (
              <div
                key={i}
                className="flex gap-3 border-l-2 border-slate-700 pl-3 py-1 hover:border-indigo-500 transition-colors"
              >
                <span className="text-slate-500 shrink-0">
                  [
                  {log.timestamp
                    ? new Date(Number(log.timestamp))
                        .toLocaleString([], {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })
                        .replace(',', '')
                    : 'No Time'}
                  ]
                </span>
                <div className="flex justify-between w-full pr-2">
                  <span
                    className={
                      log.side === 'BUY'
                        ? 'text-emerald-400 font-bold'
                        : log.side === 'SELL'
                          ? 'text-rose-400 font-bold'
                          : 'text-indigo-300'
                    }
                  >
                    {log.side
                      ? `${log.side} ${stripUSDT(log.symbol)} @ $${Number(log.price).toFixed(4)} [${log.reason || ''}]`
                      : log.message || JSON.stringify(log)}
                  </span>
                  {log.side === 'SELL' && log.pnl !== undefined && (
                    <span
                      className={
                        log.pnl >= 0 ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'
                      }
                    >
                      {log.pnl >= 0 ? '+' : ''}${Number(log.pnl).toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
