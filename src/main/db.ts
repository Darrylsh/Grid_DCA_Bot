// @ts-nocheck
import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

// Store the DB in the user's app data directory so it persists across installs
const DB_PATH = app
  ? path.join(app.getPath('userData'), 'gridbot.db')
  : path.join(__dirname, '../../gridbot.db')

let db: Database.Database

const getDb = (): Database.Database => {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL') // Better concurrent read performance
    db.pragma('foreign_keys = ON')
  }
  return db
}

// ---------------------------------------------------------------------------
// Schema Initialization
// ---------------------------------------------------------------------------
const initDb = async (): Promise<void> => {
  const database = getDb()

  database.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      pnl REAL DEFAULT 0,
      roi REAL DEFAULT 0,
      mode TEXT DEFAULT 'LIVE',
      reason TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS whitelist (
      symbol TEXT PRIMARY KEY,
      active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grid_state (
      symbol TEXT NOT NULL,
      mode TEXT NOT NULL,
      base_price REAL NOT NULL,
      base_quantity REAL NOT NULL,
      base_entry_cost REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, mode)
    );

    CREATE TABLE IF NOT EXISTS grid_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      mode TEXT NOT NULL,
      buy_price REAL NOT NULL,
      sell_price REAL NOT NULL,
      quantity REAL NOT NULL,
      cost REAL NOT NULL,
      status TEXT DEFAULT 'PENDING_SELL',
      binance_sell_order_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      filled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_grid_levels_symbol_mode
      ON grid_levels (symbol, mode, status);

    CREATE TABLE IF NOT EXISTS candle_cache (
      symbol TEXT NOT NULL,
      open_time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (symbol, open_time)
    );

    CREATE INDEX IF NOT EXISTS idx_candle_cache_symbol_time
      ON candle_cache (symbol, open_time);
  `)

  // Seed defaults if settings table is empty
  const count = database.prepare('SELECT COUNT(*) as cnt FROM settings').get() as { cnt: number }
  if (count.cnt === 0) {
    const insert = database.prepare(
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
    )
    const insertMany = database.transaction((rows: [string, string][]) => {
      for (const [key, value] of rows) insert.run(key, value)
    })
    insertMany([
      ['trading_mode', 'LIVE'],
      ['capital_type', 'FIXED'],
      ['capital_value', '100'],
      ['grid_step_percent', '3'],
      ['window_state', '{"width":1200,"height":750,"x":null,"y":null,"isMaximized":false}']
    ])
  }

  // Seed default whitelist if empty
  const wlCount = database.prepare('SELECT COUNT(*) as cnt FROM whitelist').get() as { cnt: number }
  if (wlCount.cnt === 0) {
    database.prepare("INSERT OR IGNORE INTO whitelist (symbol, active) VALUES ('BTCUSDT', 1)").run()
  }

  console.log(`[DB] SQLite initialized at: ${DB_PATH}`)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const getSettings = (): Record<string, string> => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const settings: Record<string, string> = {}
  rows.forEach((r) => {
    settings[r.key] = r.value
  })
  return settings
}

const updateSetting = (key: string, value: string): void => {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .run(key, value, value)
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------
const getWhitelist = (): string[] => {
  const rows = getDb().prepare('SELECT symbol FROM whitelist WHERE active = 1').all() as {
    symbol: string
  }[]
  return rows.map((r) => r.symbol)
}

const updateWhitelist = (symbols: string[]): string[] => {
  const database = getDb()
  const tx = database.transaction(() => {
    database.prepare('UPDATE whitelist SET active = 0').run()
    const upsert = database.prepare(
      'INSERT INTO whitelist (symbol, active) VALUES (?, 1) ON CONFLICT(symbol) DO UPDATE SET active = 1, updated_at = datetime(\'now\')'
    )
    for (const symbol of symbols) {
      upsert.run(symbol.toUpperCase())
    }
  })
  tx()
  return getWhitelist()
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------
const logTrade = (tradeData: {
  symbol: string
  side: string
  price: number
  quantity: number
  pnl?: number
  roi?: number
  reason?: string
}, mode = 'LIVE'): void => {
  const { symbol, side, price, quantity, pnl = 0, roi = 0, reason = '' } = tradeData
  getDb()
    .prepare(
      'INSERT INTO trades (symbol, side, price, quantity, pnl, roi, mode, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(symbol, side, price, quantity, pnl, roi, mode, reason)
}

const getRecentTrades = (mode = 'LIVE', limit = 50): any[] => {
  return getDb()
    .prepare('SELECT * FROM trades WHERE mode = ? ORDER BY timestamp DESC LIMIT ?')
    .all(mode, limit) as any[]
}

const clearTradeHistory = (mode = 'LIVE'): boolean => {
  getDb().prepare('DELETE FROM trades WHERE mode = ?').run(mode)
  return true
}

const wipeAllData = (mode = 'LIVE'): boolean => {
  const database = getDb()
  database.prepare('DELETE FROM trades WHERE mode = ?').run(mode)
  database.prepare('DELETE FROM grid_state WHERE mode = ?').run(mode)
  database.prepare('DELETE FROM grid_levels WHERE mode = ?').run(mode)
  return true
}

const getMetrics = (mode = 'LIVE'): { totalPnl: number; avgRoi: number; winRate: number; totalTrades: number } => {
  const row = getDb()
    .prepare(
      `SELECT
        COALESCE(SUM(pnl), 0) as total_pnl,
        COALESCE(AVG(CASE WHEN side = 'SELL' THEN roi END), 0) as avg_roi,
        COALESCE(
          CAST(COUNT(CASE WHEN pnl > 0 AND side = 'SELL' THEN 1 END) AS REAL) /
          NULLIF(COUNT(CASE WHEN side = 'SELL' THEN 1 END), 0) * 100
        , 0) as win_rate,
        COUNT(CASE WHEN side = 'SELL' THEN 1 END) as total_trades
      FROM trades WHERE mode = ?`
    )
    .get(mode) as any

  return {
    totalPnl: row.total_pnl || 0,
    avgRoi: row.avg_roi || 0,
    winRate: row.win_rate || 0,
    totalTrades: row.total_trades || 0
  }
}

// ---------------------------------------------------------------------------
// Grid State (base share tracking)
// ---------------------------------------------------------------------------
const getGridState = (mode = 'LIVE'): Record<string, { basePrice: number; baseQuantity: number; baseEntryCost: number }> => {
  const rows = getDb()
    .prepare('SELECT * FROM grid_state WHERE mode = ?')
    .all(mode) as any[]
  const state: Record<string, any> = {}
  rows.forEach((r) => {
    state[r.symbol] = {
      basePrice: r.base_price,
      baseQuantity: r.base_quantity,
      baseEntryCost: r.base_entry_cost
    }
  })
  return state
}

const saveGridState = (
  symbol: string,
  data: { basePrice: number; baseQuantity: number; baseEntryCost: number },
  mode = 'LIVE'
): void => {
  getDb()
    .prepare(
      `INSERT INTO grid_state (symbol, mode, base_price, base_quantity, base_entry_cost)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol, mode) DO UPDATE SET
         base_price = ?, base_quantity = ?, base_entry_cost = ?, updated_at = datetime('now')`
    )
    .run(symbol, mode, data.basePrice, data.baseQuantity, data.baseEntryCost,
         data.basePrice, data.baseQuantity, data.baseEntryCost)
}

const deleteGridState = (symbol: string, mode = 'LIVE'): void => {
  getDb().prepare('DELETE FROM grid_state WHERE symbol = ? AND mode = ?').run(symbol, mode)
}

// ---------------------------------------------------------------------------
// Grid Levels (individual DCA buy + pending sell)
// ---------------------------------------------------------------------------
const getGridLevels = (symbol: string, mode = 'LIVE'): any[] => {
  return getDb()
    .prepare('SELECT * FROM grid_levels WHERE symbol = ? AND mode = ? AND status = ? ORDER BY buy_price DESC')
    .all(symbol, mode, 'PENDING_SELL') as any[]
}

const getAllActiveGridLevels = (mode = 'LIVE'): any[] => {
  return getDb()
    .prepare('SELECT * FROM grid_levels WHERE mode = ? AND status = ?')
    .all(mode, 'PENDING_SELL') as any[]
}

const saveGridLevel = (data: {
  symbol: string
  mode: string
  buyPrice: number
  sellPrice: number
  quantity: number
  cost: number
  binanceSellOrderId?: string
}): number => {
  const result = getDb()
    .prepare(
      `INSERT INTO grid_levels (symbol, mode, buy_price, sell_price, quantity, cost, binance_sell_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.symbol, data.mode, data.buyPrice, data.sellPrice,
      data.quantity, data.cost, data.binanceSellOrderId || null
    )
  return result.lastInsertRowid as number
}

const markGridLevelFilled = (id: number): void => {
  getDb()
    .prepare('UPDATE grid_levels SET status = ?, filled_at = datetime(\'now\') WHERE id = ?')
    .run('FILLED', id)
}

const deleteAllGridLevels = (symbol: string, mode = 'LIVE'): void => {
  getDb().prepare('DELETE FROM grid_levels WHERE symbol = ? AND mode = ?').run(symbol, mode)
}

const updateGridLevelOrderId = (id: number, orderId: string): void => {
  getDb()
    .prepare('UPDATE grid_levels SET binance_sell_order_id = ? WHERE id = ?')
    .run(orderId, id)
}

// ---------------------------------------------------------------------------
// Candle Cache (for backtesting)
// ---------------------------------------------------------------------------
const saveCandleBatch = (symbol: string, candles: {
  openTime: number; open: number; high: number; low: number; close: number; volume: number
}[]): void => {
  if (!candles || candles.length === 0) return
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO candle_cache (symbol, open_time, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const tx = getDb().transaction(() => {
    for (const c of candles) {
      insert.run(symbol, c.openTime, c.open, c.high, c.low, c.close, c.volume)
    }
  })
  tx()
}

const getCachedCandles = (symbol: string, fromMs: number, toMs: number): any[] => {
  return getDb()
    .prepare(
      'SELECT * FROM candle_cache WHERE symbol = ? AND open_time >= ? AND open_time <= ? ORDER BY open_time ASC'
    )
    .all(symbol, fromMs, toMs) as any[]
}

const getEarliestCachedCandle = (symbol: string): number | null => {
  const row = getDb()
    .prepare('SELECT MIN(open_time) as min_time FROM candle_cache WHERE symbol = ?')
    .get(symbol) as { min_time: number | null }
  return row.min_time
}

const getLatestCachedCandle = (symbol: string): number | null => {
  const row = getDb()
    .prepare('SELECT MAX(open_time) as max_time FROM candle_cache WHERE symbol = ?')
    .get(symbol) as { max_time: number | null }
  return row.max_time
}

export {
  initDb,
  getSettings,
  updateSetting,
  getWhitelist,
  updateWhitelist,
  logTrade,
  getRecentTrades,
  clearTradeHistory,
  wipeAllData,
  getMetrics,
  getGridState,
  saveGridState,
  deleteGridState,
  getGridLevels,
  getAllActiveGridLevels,
  saveGridLevel,
  markGridLevelFilled,
  deleteAllGridLevels,
  updateGridLevelOrderId,
  saveCandleBatch,
  getCachedCandles,
  getEarliestCachedCandle,
  getLatestCachedCandle
}
