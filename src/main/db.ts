import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, sql, desc, asc, sum, avg, count } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './db/schema';

// Connection details from .env
const {
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_HOST,
  DB_PORT,
} = process.env;

const connectionString = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

const pool = new pg.Pool({ connectionString });
const db = drizzle(pool, { schema });

// ---------------------------------------------------------------------------
// Schema Initialization
// ---------------------------------------------------------------------------
const initDb = async (): Promise<void> => {
  console.log('[DB] Ensuring PostgreSQL tables exist...');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        timestamp BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
        pnl DOUBLE PRECISION DEFAULT 0,
        roi DOUBLE PRECISION DEFAULT 0,
        mode TEXT DEFAULT 'LIVE',
        reason TEXT DEFAULT '',
        fee DOUBLE PRECISION DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS whitelist (
        symbol TEXT PRIMARY KEY,
        active BOOLEAN DEFAULT TRUE,
        updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS grid_state (
        symbol TEXT NOT NULL,
        mode TEXT NOT NULL,
        base_price DOUBLE PRECISION NOT NULL,
        base_quantity DOUBLE PRECISION NOT NULL,
        base_entry_cost DOUBLE PRECISION NOT NULL,
        updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
        PRIMARY KEY (symbol, mode)
      );

      CREATE TABLE IF NOT EXISTS grid_levels (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        mode TEXT NOT NULL,
        buy_price DOUBLE PRECISION NOT NULL,
        sell_price DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        cost DOUBLE PRECISION NOT NULL,
        status TEXT DEFAULT 'PENDING_SELL',
        binance_sell_order_id TEXT,
        created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000),
        filled_at BIGINT,
        CONSTRAINT grid_levels_symbol_mode_status_idx UNIQUE (symbol, mode, status, id)
      );

      CREATE TABLE IF NOT EXISTS candle_cache (
        symbol TEXT NOT NULL,
        open_time BIGINT NOT NULL,
        open DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        close DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (symbol, open_time)
      );
    `);
    console.log(`[DB] Postgres initialized at: ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  } catch (e: any) {
    console.error('[DB] Initialization error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const getSettings = async (): Promise<Record<string, string>> => {
  const rows = await db.select().from(schema.settings);
  const settings: Record<string, string> = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  return settings;
}

const updateSetting = async (key: string, value: string): Promise<void> => {
  await db.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value }
    });
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------
const getWhitelist = async (): Promise<string[]> => {
  const rows = await db.select()
    .from(schema.whitelist)
    .where(eq(schema.whitelist.active, true));
  return rows.map((r) => r.symbol);
}

const updateWhitelist = async (symbols: string[]): Promise<string[]> => {
  await db.transaction(async (tx) => {
    await tx.update(schema.whitelist).set({ active: false });
    for (const symbol of symbols) {
      const sym = symbol.toUpperCase();
      await tx.insert(schema.whitelist)
        .values({ symbol: sym, active: true, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: schema.whitelist.symbol,
          set: { active: true, updatedAt: Date.now() }
        });
    }
  });
  return getWhitelist();
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------
const logTrade = async (tradeData: {
  symbol: string
  side: string
  price: number
  quantity: number
  pnl?: number
  roi?: number
  fee?: number
  reason?: string
  timestamp?: number
}, mode = 'LIVE'): Promise<void> => {
  const { symbol, side, price, quantity, pnl = 0, roi = 0, fee = 0, reason = '', timestamp = Date.now() } = tradeData;
  await db.insert(schema.trades).values({
    symbol, side, price, quantity, pnl, roi, fee, mode, reason, timestamp
  });
}

const getRecentTrades = async (mode = 'LIVE', limit = 50): Promise<any[]> => {
  return await db.select()
    .from(schema.trades)
    .where(eq(schema.trades.mode, mode))
    .orderBy(desc(schema.trades.id))
    .limit(limit);
}

const getTradesByTimeRange = async (mode = 'LIVE', startMs: number, endMs: number): Promise<any[]> => {
  return await db.select()
    .from(schema.trades)
    .where(and(
      eq(schema.trades.mode, mode),
      sql`timestamp >= ${startMs} AND timestamp <= ${endMs}`
    ))
    .orderBy(asc(schema.trades.timestamp));
}

const clearTradeHistory = async (mode = 'LIVE'): Promise<boolean> => {
  await db.delete(schema.trades).where(eq(schema.trades.mode, mode));
  return true;
}

const wipeAllData = async (mode = 'LIVE'): Promise<boolean> => {
  await db.delete(schema.trades).where(eq(schema.trades.mode, mode));
  await db.delete(schema.gridState).where(eq(schema.gridState.mode, mode));
  await db.delete(schema.gridLevels).where(eq(schema.gridLevels.mode, mode));
  return true;
}

const getMetrics = async (mode = 'LIVE'): Promise<{ totalPnl: number; totalFees: number; avgRoi: number; winRate: number; fillRate: number; totalTrades: number }> => {
  const [row] = await db.select({
    totalPnl: sum(schema.trades.pnl),
    totalFees: sum(schema.trades.fee),
    avgRoi: avg(sql`CASE WHEN side = 'SELL' THEN roi END`),
    winCount: count(sql`CASE WHEN pnl > 0 AND side = 'SELL' THEN 1 END`),
    sellCount: count(sql`CASE WHEN side = 'SELL' THEN 1 END`),
    buyCount: count(sql`CASE WHEN side = 'BUY' THEN 1 END`),
    totalTrades: count(sql`CASE WHEN side = 'SELL' THEN 1 END`)
  })
  .from(schema.trades)
  .where(eq(schema.trades.mode, mode));

  const totalPnl = Number(row.totalPnl) || 0;
  const totalFees = Number(row.totalFees) || 0;
  const avgRoi = Number(row.avgRoi) || 0;
  const winCount = Number(row.winCount) || 0;
  const sellCount = Number(row.sellCount) || 0;
  const buyCount = Number(row.buyCount) || 0;
  const totalTrades = Number(row.totalTrades) || 0;

  const winRate = sellCount > 0 ? (winCount / sellCount) * 100 : 0;
  const fillRate = buyCount > 0 ? (sellCount / buyCount) * 100 : 0;

  return {
    totalPnl,
    totalFees,
    avgRoi,
    winRate,
    fillRate,
    totalTrades
  }
}

// ---------------------------------------------------------------------------
// Grid State (base share tracking)
// ---------------------------------------------------------------------------
const getGridState = async (mode = 'LIVE'): Promise<Record<string, { basePrice: number; baseQuantity: number; baseEntryCost: number }>> => {
  const rows = await db.select().from(schema.gridState).where(eq(schema.gridState.mode, mode));
  const state: Record<string, any> = {};
  rows.forEach((r) => {
    state[r.symbol] = {
      basePrice: r.basePrice,
      baseQuantity: r.baseQuantity,
      baseEntryCost: r.baseEntryCost
    };
  });
  return state;
}

const saveGridState = async (
  symbol: string,
  data: { basePrice: number; baseQuantity: number; baseEntryCost: number },
  mode = 'LIVE'
): Promise<void> => {
  await db.insert(schema.gridState)
    .values({
      symbol, mode, basePrice: data.basePrice, baseQuantity: data.baseQuantity, baseEntryCost: data.baseEntryCost
    })
    .onConflictDoUpdate({
      target: [schema.gridState.symbol, schema.gridState.mode],
      set: {
        basePrice: data.basePrice,
        baseQuantity: data.baseQuantity,
        baseEntryCost: data.baseEntryCost,
        updatedAt: Date.now()
      }
    });
}

const deleteGridState = async (symbol: string, mode = 'LIVE'): Promise<void> => {
  await db.delete(schema.gridState)
    .where(and(eq(schema.gridState.symbol, symbol), eq(schema.gridState.mode, mode)));
}

// ---------------------------------------------------------------------------
// Grid Levels (individual DCA buy + pending sell)
// ---------------------------------------------------------------------------
const getGridLevels = async (symbol: string, mode = 'LIVE'): Promise<any[]> => {
  return await db.select()
    .from(schema.gridLevels)
    .where(and(
      eq(schema.gridLevels.symbol, symbol),
      eq(schema.gridLevels.mode, mode),
      eq(schema.gridLevels.status, 'PENDING_SELL')
    ))
    .orderBy(desc(schema.gridLevels.buyPrice));
}

const getAllActiveGridLevels = async (mode = 'LIVE'): Promise<any[]> => {
  return await db.select()
    .from(schema.gridLevels)
    .where(and(
      eq(schema.gridLevels.mode, mode),
      eq(schema.gridLevels.status, 'PENDING_SELL')
    ));
}

const saveGridLevel = async (data: {
  symbol: string
  mode: string
  buyPrice: number
  sellPrice: number
  quantity: number
  cost: number
  binanceSellOrderId?: string
}): Promise<number> => {
  const [result] = await db.insert(schema.gridLevels)
    .values({
      symbol: data.symbol,
      mode: data.mode,
      buyPrice: data.buyPrice,
      sellPrice: data.sellPrice,
      quantity: data.quantity,
      cost: data.cost,
      binanceSellOrderId: data.binanceSellOrderId || null
    })
    .returning({ id: schema.gridLevels.id });
  return result.id;
}

const markGridLevelFilled = async (id: number): Promise<void> => {
  await db.update(schema.gridLevels)
    .set({ status: 'FILLED', filledAt: Date.now() })
    .where(eq(schema.gridLevels.id, id));
}

const deleteAllGridLevels = async (symbol: string, mode = 'LIVE'): Promise<void> => {
  await db.delete(schema.gridLevels)
    .where(and(eq(schema.gridLevels.symbol, symbol), eq(schema.gridLevels.mode, mode)));
}

const updateGridLevelOrderId = async (id: number, orderId: string): Promise<void> => {
  await db.update(schema.gridLevels)
    .set({ binanceSellOrderId: orderId })
    .where(eq(schema.gridLevels.id, id));
}

// ---------------------------------------------------------------------------
// Candle Cache (for backtesting)
// ---------------------------------------------------------------------------
const saveCandleBatch = async (symbol: string, candles: {
  openTime: number; open: number; high: number; low: number; close: number; volume: number
}[]): Promise<void> => {
  if (!candles || candles.length === 0) return;
  
  const batchSize = 500;
  for (let i = 0; i < candles.length; i += batchSize) {
    const batch = candles.slice(i, i + batchSize).map(c => ({
      symbol,
      openTime: Math.floor(c.openTime),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
    await db.insert(schema.candleCache).values(batch).onConflictDoNothing();
  }
}

const getCachedCandles = async (symbol: string, fromMs: number, toMs: number): Promise<any[]> => {
  return await db.select()
    .from(schema.candleCache)
    .where(and(
      eq(schema.candleCache.symbol, symbol),
      sql`open_time >= ${fromMs} AND open_time <= ${toMs}`
    ))
    .orderBy(asc(schema.candleCache.openTime));
}

const getEarliestCachedCandle = async (symbol: string): Promise<number | null> => {
  const [row] = await db.select({ minTime: sql`MIN(open_time)` })
    .from(schema.candleCache)
    .where(eq(schema.candleCache.symbol, symbol));
  return row?.minTime ? Number(row.minTime) : null;
}

const getLatestCachedCandle = async (symbol: string): Promise<number | null> => {
  const [row] = await db.select({ maxTime: sql`MAX(open_time)` })
    .from(schema.candleCache)
    .where(eq(schema.candleCache.symbol, symbol));
  return row?.maxTime ? Number(row.maxTime) : null;
}

export {
  initDb,
  getSettings,
  updateSetting,
  getWhitelist,
  updateWhitelist,
  logTrade,
  getRecentTrades,
  getTradesByTimeRange,
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
