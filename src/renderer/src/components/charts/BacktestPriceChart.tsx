import React from 'react'
import type { BacktestResults } from '@shared/types'

interface BacktestPriceChartProps {
  results: BacktestResults | null
}

export const BacktestPriceChart: React.FC<BacktestPriceChartProps> = ({ results }) => {
  if (!results?.chartData || results.chartData.length < 2) return null
  const { chartData, trades } = results
  const prices = chartData.map((d) => d.p)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const priceRange = maxPrice - minPrice || 1
  const pPadding = priceRange * 0.15
  const bottom = minPrice - pPadding
  const totalRange = priceRange + 2 * pPadding
  const startTime = chartData[0].t
  const endTime = chartData[chartData.length - 1].t
  const timeRange = endTime - startTime || 1
  const points = chartData
    .map((d) => {
      const x = ((d.t - startTime) / timeRange) * 100
      const y = 100 - ((d.p - bottom) / totalRange) * 100
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="h-72 w-full bg-slate-900/50 rounded-2xl border border-slate-700/30 overflow-hidden relative group mt-4 mb-8 shadow-inner shadow-black/20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(79,70,229,0.05),transparent)] pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none opacity-20">
        {[0, 0.25, 0.5, 0.75, 1].map((scale) => {
          const price = bottom + (1 - scale) * totalRange
          return (
            <div
              key={scale}
              className="absolute w-full h-[1px] border-t border-dashed border-slate-500"
              style={{ top: `${scale * 100}%` }}
            >
              <span className="absolute left-2 -top-2 text-[8px] font-mono font-bold text-slate-400 bg-slate-900/80 px-1 rounded">
                ${price.toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full opacity-80 group-hover:opacity-100 transition-opacity"
      >
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
      <div className="absolute inset-0 pointer-events-none">
        {trades.slice(0, 500).map((trade, i) => {
          const tTime = new Date(trade.timestamp).getTime()
          const x = ((tTime - startTime) / timeRange) * 100
          const y = 100 - ((trade.price - bottom) / totalRange) * 100
          if (x < 0 || x > 100) return null
          const isBuy = trade.side === 'BUY'
          const isBase = trade.reason === 'BASE_SHARE'
          return (
            <div
              key={i}
              className={`absolute w-2 h-2 rounded-full border border-slate-900 shadow-lg pointer-events-auto cursor-help ${isBase ? 'bg-amber-400 shadow-amber-400/30' : isBuy ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-rose-500 shadow-rose-500/20'}`}
              style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              title={`${trade.reason} @ $${trade.price?.toFixed(4)}${trade.pnl != null ? ` | PnL: $${trade.pnl?.toFixed(2)}` : ''}`}
            />
          )
        })}
      </div>
      <div className="absolute bottom-1 left-0 w-full flex justify-between px-2 opacity-40 text-[7px] font-mono font-bold text-slate-500 pointer-events-none">
        {[0, 0.25, 0.5, 0.75, 1].map((scale) => {
          const time = startTime + scale * timeRange
          const d = new Date(time)
          return (
            <div key={scale} className="flex flex-col items-center">
              <span>{d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span>
            </div>
          )
        })}
      </div>
      <div className="absolute top-4 right-6 flex gap-4 backdrop-blur-sm bg-slate-900/40 p-3 rounded-xl border border-slate-800/50">
        {[
          { color: 'bg-amber-400', label: 'Base' },
          { color: 'bg-emerald-500', label: 'Buy' },
          { color: 'bg-rose-500', label: 'Sell' }
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${item.color}`} />
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
