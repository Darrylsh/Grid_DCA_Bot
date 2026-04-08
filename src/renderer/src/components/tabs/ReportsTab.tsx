import React from 'react'
import { FileText, Activity } from 'lucide-react'
import { useAppContext } from '@renderer/context/AppContext'

export function ReportsTab(): React.ReactElement {
  const {
    tradingMode,
    reportStart,
    setReportStart,
    reportEnd,
    setReportEnd,
    reportLoading,
    reportData,
    stripUSDT
  } = useAppContext()

  return (
    <div className="max-w-4xl bg-slate-800/40 backdrop-blur-md border border-slate-700/50 rounded-2xl shadow-2xl flex flex-col overflow-hidden h-full">
      <div className="p-6 border-b border-slate-700/50 bg-slate-800/60 flex items-center justify-between shadow-sm">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <FileText className="text-indigo-400" /> PnL Report ({tradingMode})
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
              Start Date
            </span>
            <input
              type="date"
              value={reportStart}
              onChange={(e) => setReportStart(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              style={{ colorScheme: 'dark' }}
            />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
              End Date
            </span>
            <input
              type="date"
              value={reportEnd}
              onChange={(e) => setReportEnd(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              style={{ colorScheme: 'dark' }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {reportLoading ? (
          <div className="flex justify-center items-center h-48">
            <Activity className="animate-spin text-indigo-400" size={32} />
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl overflow-hidden shadow-inner">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/80 text-slate-300 text-xs uppercase tracking-wider border-b border-slate-700/50">
                <tr>
                  <th className="px-6 py-4">Symbol</th>
                  <th className="px-6 py-4 text-right">Winning Sells</th>
                  <th className="px-6 py-4 text-right">Losing Sells</th>
                  <th className="px-6 py-4 text-right">Realized PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {(() => {
                  const summary: Record<string, { wins: number; losses: number; pnl: number }> = {}
                  reportData.forEach((t) => {
                    if (t.side === 'SELL') {
                      if (!summary[t.symbol]) summary[t.symbol] = { wins: 0, losses: 0, pnl: 0 }
                      summary[t.symbol].pnl += Number(t.pnl || 0)
                      if (t.pnl && t.pnl > 0) summary[t.symbol].wins++
                      else if (t.pnl && t.pnl < 0) summary[t.symbol].losses++
                    }
                  })
                  const rows = Object.entries(summary).sort((a, b) => b[1].pnl - a[1].pnl)
                  const totalPnl = rows.reduce((acc, row) => acc + row[1].pnl, 0)

                  if (rows.length === 0) {
                    return (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-slate-500 italic">
                          No sell trades recorded in this period.
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <>
                      {rows.map(([sym, data]) => (
                        <tr key={sym} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-slate-200">
                            {stripUSDT(sym)}
                          </td>
                          <td className="px-6 py-4 text-right text-emerald-400 font-medium">
                            {data.wins}
                          </td>
                          <td className="px-6 py-4 text-right text-rose-400 font-medium">
                            {data.losses}
                          </td>
                          <td
                            className={`px-6 py-4 text-right font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                          >
                            ${data.pnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-800/50 border-t-2 border-slate-700">
                        <td className="px-6 py-4 font-bold text-slate-200" colSpan={3}>
                          TOTAL REALIZED PNL
                        </td>
                        <td
                          className={`px-6 py-4 text-right font-bold text-lg ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                        >
                          ${totalPnl.toFixed(2)}
                        </td>
                      </tr>
                    </>
                  )
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
