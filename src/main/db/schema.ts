import {
  pgTable,
  serial,
  text,
  doublePrecision,
  bigint,
  boolean,
  primaryKey,
  index,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const trades = pgTable(
  'trades',
  {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(),
    price: doublePrecision('price').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    timestamp: bigint('timestamp', { mode: 'number' }).default(
      sql`(extract(epoch from now()) * 1000)::bigint`
    ),
    pnl: doublePrecision('pnl').default(0),
    roi: doublePrecision('roi').default(0),
    mode: text('mode').default('LIVE'),
    reason: text('reason').default(''),
    fee: doublePrecision('fee').default(0)
  },
  (t) => ({
    unq: uniqueIndex('unq_trades_event').on(
      t.symbol,
      t.side,
      t.price,
      t.quantity,
      t.timestamp,
      t.mode
    ),
    idxMode: index('idx_trades_mode').on(t.mode)
  })
)

export const whitelist = pgTable('whitelist', {
  symbol: text('symbol').primaryKey(),
  active: boolean('active').default(true),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(
    sql`(extract(epoch from now()) * 1000)::bigint`
  )
})

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const gridState = pgTable(
  'grid_state',
  {
    symbol: text('symbol').notNull(),
    mode: text('mode').notNull(),
    basePrice: doublePrecision('base_price').notNull(),
    baseQuantity: doublePrecision('base_quantity').notNull(),
    baseEntryCost: doublePrecision('base_entry_cost').notNull(),
    isPaused: boolean('is_paused').default(false),
    updatedAt: bigint('updated_at', { mode: 'number' }).default(
      sql`(extract(epoch from now()) * 1000)::bigint`
    )
  },
  (t) => ({
    pk: primaryKey({ columns: [t.symbol, t.mode] })
  })
)

export const gridLevels = pgTable(
  'grid_levels',
  {
    id: serial('id').primaryKey(),
    symbol: text('symbol').notNull(),
    mode: text('mode').notNull(),
    buyPrice: doublePrecision('buy_price').notNull(),
    sellPrice: doublePrecision('sell_price').notNull(),
    quantity: doublePrecision('quantity').notNull(),
    cost: doublePrecision('cost').notNull(),
    status: text('status').default('PENDING_SELL'),
    binanceSellOrderId: text('binance_sell_order_id'),
    createdAt: bigint('created_at', { mode: 'number' }).default(
      sql`(extract(epoch from now()) * 1000)::bigint`
    ),
    filledAt: bigint('filled_at', { mode: 'number' })
  },
  (t) => ({
    idxSymbolMode: index('idx_grid_levels_symbol_mode').on(t.symbol, t.mode, t.status)
  })
)

export const candleCache = pgTable(
  'candle_cache',
  {
    symbol: text('symbol').notNull(),
    openTime: bigint('open_time', { mode: 'number' }).notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.symbol, t.openTime] }),
    idxSymbolTime: index('idx_candle_cache_symbol_time').on(t.symbol, t.openTime)
  })
)
