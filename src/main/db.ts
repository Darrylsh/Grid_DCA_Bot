// @ts-nocheck
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Initialize the PostgreSQL connection pool
const pool = new Pool({
  host: process.env['DB_HOST'] || 'localhost',
  port: process.env['DB_PORT'] || 5432,
  user: process.env['DB_USER'],
  password: process.env['DB_PASS'],
  database: process.env['DB_NAME'],
  max: 20, // max number of clients in the pool
  idleTimeoutMillis: 30000,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Initialize tables if they don't exist
const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        side VARCHAR(10) NOT NULL, -- 'BUY' or 'SELL'
        price NUMERIC NOT NULL,
        quantity NUMERIC NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pnl NUMERIC DEFAULT 0,
        roi NUMERIC DEFAULT 0,
        algo_regime VARCHAR(20),
        mode VARCHAR(20) DEFAULT 'LIVE'
      );
    `);

    await client.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'LIVE';`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS whitelist (
        symbol VARCHAR(20) PRIMARY KEY,
        active BOOLEAN DEFAULT true,
        strategy VARCHAR(50),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`ALTER TABLE whitelist ADD COLUMN IF NOT EXISTS strategy VARCHAR(50);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS decoupled_whitelist (
        symbol VARCHAR(20) PRIMARY KEY,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS active_positions (
        symbol VARCHAR(20),
        entry_price NUMERIC NOT NULL,
        quantity NUMERIC NOT NULL,
        high_water_mark NUMERIC NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        mode VARCHAR(20) DEFAULT 'LIVE',
        PRIMARY KEY (symbol, mode)
      );
    `);

    await client.query(`ALTER TABLE active_positions ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'LIVE';`);
    try {
      await client.query(`ALTER TABLE active_positions DROP CONSTRAINT active_positions_pkey;`);
      await client.query(`ALTER TABLE active_positions ADD PRIMARY KEY (symbol, mode);`);
    } catch (e) { }

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value VARCHAR(255) NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tick_history (
        id         BIGSERIAL PRIMARY KEY,
        symbol     VARCHAR(20) NOT NULL,
        price      NUMERIC NOT NULL,
        volume     NUMERIC NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        trade_id   BIGINT,
        UNIQUE (symbol, trade_id)
      );
    `);

    // BRIN index: much cheaper to maintain than B-tree for append-only time-series data
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tick_history_symbol_time
      ON tick_history USING BRIN (symbol, recorded_at);
    `);

    // Ensure the unique constraint exists for ON CONFLICT support
    try {
      await client.query(`ALTER TABLE tick_history ADD CONSTRAINT unique_symbol_trade UNIQUE (symbol, trade_id);`);
    } catch (e) { }

    // Insert some default pairs if empty
    const res = await client.query('SELECT COUNT(*) FROM whitelist');
    if (parseInt(res.rows[0].count) === 0) {
      await client.query(`
            INSERT INTO whitelist (symbol, active) VALUES 
            ('BTCUSDT', true),
            ('ETHUSDT', true),
            ('SOLUSDT', true)
        `);
    }

    // Default settings
    const settingsRes = await client.query('SELECT COUNT(*) FROM settings');
    if (parseInt(settingsRes.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO settings (key, value) VALUES
        ('trading_mode', 'SIMULATION'),
        ('capital_type', 'PERCENTAGE'),
        ('capital_value', '5'),
        ('active_strategy', 'SNIPER'),
        ('max_concurrent_trades', '3'),
        ('window_state', '{"width":900,"height":670,"x":null,"y":null,"isMaximized":false}')
      `);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
};

const getSettings = async () => {
  const result = await pool.query('SELECT key, value FROM settings');
  const settings = {};
  result.rows.forEach(r => { settings[r.key] = r.value; });
  return settings;
};

const updateSetting = async (key, value) => {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [key, value]
  );
};

const getWhitelist = async () => {
  const result = await pool.query('SELECT symbol, strategy FROM whitelist WHERE active = true');
  return result.rows.map(row => ({ symbol: row.symbol, strategy: row.strategy }));
};

const updateWhitelist = async (whitelistItems) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE whitelist SET active = false'); // Deactivate all

    for (const item of whitelistItems) {
      const { symbol, strategy } = item;
      await client.query(`
                INSERT INTO whitelist (symbol, active, strategy) 
                VALUES ($1, true, $2) 
                ON CONFLICT (symbol) DO UPDATE SET active = true, strategy = $2, updated_at = CURRENT_TIMESTAMP
            `, [symbol.toUpperCase(), strategy]);
    }
    await client.query('COMMIT');
    return await getWhitelist();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

const getDecoupledWhitelist = async () => {
  const result = await pool.query('SELECT symbol FROM decoupled_whitelist');
  return result.rows.map(row => row.symbol);
};

const updateDecoupledWhitelist = async (symbols) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM decoupled_whitelist'); // Reset

    for (const symbol of symbols) {
      await client.query(`
                INSERT INTO decoupled_whitelist (symbol) 
                VALUES ($1) 
                ON CONFLICT (symbol) DO NOTHING
            `, [symbol.toUpperCase()]);
    }
    await client.query('COMMIT');
    return await getDecoupledWhitelist();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

const logTrade = async (tradeData, mode = 'LIVE') => {
  const { symbol, side, price, quantity, pnl = 0, roi = 0, algo_regime = 'UNKNOWN' } = tradeData;
  const result = await pool.query(
    'INSERT INTO trades (symbol, side, price, quantity, pnl, roi, algo_regime, mode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [symbol, side, price, quantity, pnl, roi, algo_regime, mode]
  );
  return result.rows[0];
};

const clearTradeHistory = async (mode = 'LIVE') => {
  await pool.query('DELETE FROM trades WHERE mode = $1', [mode]);
  return true;
};

const getMetrics = async (mode = 'LIVE') => {
  // Calculate total PNL from all trades, but Average ROI and Win Rate only from completed (SELL) trades
  // This prevents BUY orders (0% roi) from diluting the perceived average.
  const result = await pool.query(`
        SELECT 
            SUM(pnl) as total_pnl,
            AVG(CASE WHEN side = 'SELL' THEN roi END) as avg_roi,
            COUNT(CASE WHEN pnl > 0 AND side = 'SELL' THEN 1 END)::float / NULLIF(COUNT(CASE WHEN side = 'SELL' THEN 1 END), 0) * 100 as win_rate,
            COUNT(CASE WHEN side = 'SELL' THEN 1 END) as total_trades
        FROM trades
        WHERE mode = $1;
    `, [mode]);
  const row = result.rows[0];
  return {
    totalPnl: parseFloat(row.total_pnl || 0),
    avgRoi: parseFloat(row.avg_roi || 0),
    winRate: parseFloat(row.win_rate || 0),
    totalTrades: parseInt(row.total_trades || 0)
  };
};

const savePosition = async (symbol, data, mode = 'LIVE') => {
  const { entryPrice, quantity, highWaterMark } = data;
  await pool.query(
    `INSERT INTO active_positions (symbol, entry_price, quantity, high_water_mark, mode) 
     VALUES ($1, $2, $3, $4, $5) 
     ON CONFLICT (symbol, mode) DO UPDATE SET 
     entry_price = $2, quantity = $3, high_water_mark = $4, updated_at = CURRENT_TIMESTAMP`,
    [symbol, entryPrice, quantity, highWaterMark, mode]
  );
};

const deletePosition = async (symbol, mode = 'LIVE') => {
  await pool.query('DELETE FROM active_positions WHERE symbol = $1 AND mode = $2', [symbol, mode]);
};

const getActivePositions = async (mode = 'LIVE') => {
  const result = await pool.query('SELECT * FROM active_positions WHERE mode = $1', [mode]);
  const positions = {};
  result.rows.forEach(row => {
    positions[row.symbol] = {
      entryPrice: parseFloat(row.entry_price),
      quantity: parseFloat(row.quantity),
      highWaterMark: parseFloat(row.high_water_mark),
      mode: row.mode
    };
  });
  return positions;
};

const updateHighWaterMark = async (symbol, price, mode = 'LIVE') => {
  await pool.query('UPDATE active_positions SET high_water_mark = $1 WHERE symbol = $2 AND mode = $3', [price, symbol, mode]);
};

const getRecentTrades = async (mode = 'LIVE', limit = 50) => {
  const result = await pool.query(
    'SELECT * FROM trades WHERE mode = $1 ORDER BY timestamp DESC LIMIT $2',
    [mode, limit]
  );
  return result.rows.map(row => ({
    ...row,
    price: parseFloat(row.price),
    quantity: parseFloat(row.quantity),
    pnl: parseFloat(row.pnl),
    roi: parseFloat(row.roi)
  }));
};

// --- Tick History (for backtesting) ---

// Bulk-insert a batch of ticks for a single symbol.
// ticks: [{ price, volume, recorded_at }]
const saveTickBatch = async (symbol, ticks) => {
  if (!ticks || ticks.length === 0) return;

  // Build a multi-row INSERT for efficiency
  const values = [];
  const params = [];
  ticks.forEach((t, i) => {
    const base = i * 5;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(symbol, t.price, t.volume, t.recorded_at || new Date(), t.trade_id || null);
  });

  await pool.query(
    `INSERT INTO tick_history (symbol, price, volume, recorded_at, trade_id) 
     VALUES ${values.join(', ')}
     ON CONFLICT (symbol, trade_id) DO NOTHING`,
    params
  );
};

// Fetch tick history for a symbol within a time range, ordered oldest-first.
const getTickHistory = async (symbol, fromTime, toTime) => {
  const result = await pool.query(
    `SELECT price, volume, recorded_at
     FROM tick_history
     WHERE symbol = $1
       AND recorded_at >= $2
       AND recorded_at <= $3
     ORDER BY recorded_at ASC`,
    [symbol, fromTime, toTime]
  );
  return result.rows.map(r => ({
    price: parseFloat(r.price),
    volume: parseFloat(r.volume),
    recorded_at: r.recorded_at
  }));
};

// Delete ticks older than maxAgeDays (default 30 days) to enforce rolling window.
const pruneOldTicks = async (maxAgeDays = 30) => {
  const result = await pool.query(
    `DELETE FROM tick_history WHERE recorded_at < NOW() - INTERVAL '1 day' * $1`,
    [maxAgeDays]
  );
  const deleted = result.rowCount || 0;
  if (deleted > 0) console.log(`[TICK PRUNE] Removed ${deleted} tick records older than ${maxAgeDays} days.`);
  return deleted;
};

export {
  pool,
  initDb,
  getWhitelist,
  updateWhitelist,
  logTrade,
  clearTradeHistory,
  getMetrics,
  savePosition,
  deletePosition,
  getActivePositions,
  updateHighWaterMark,
  getRecentTrades,
  getSettings,
  updateSetting,
  getDecoupledWhitelist,
  updateDecoupledWhitelist,
  saveTickBatch,
  getTickHistory,
  pruneOldTicks
};
