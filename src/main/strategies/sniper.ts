// strategies/sniper.js
// SNIPER strategy configuration — fast, short-timeframe scalping mode.
// Trades on 1–15 minute micro regimes with tight trailing stops.

const SNIPER = {
    VOLUME_MULTIPLIER: 1.5,
    BULL_THRESH: 0.004,
    BEAR_THRESH: -0.001,
    BTC_STRENGTH_THRESHOLD: 0.0005,
    TRAIL_ACTIVATION: 0.015,      // +1.5% arms tight trail
    TRAIL_DELTA: 0.004,           // 0.4% tight trail
    HARD_STOP: -0.99,             // Effectively disabled (hold long term)
    MID_TRAIL_ACTIVATION: 0,      // Disabled for Sniper — only the main trail is used
    MID_TRAIL_DELTA: 0.006,       // (inactive, kept for Hunter parity)
    HEADROOM_REQUIRED: 0.015,
    HISTORY_LENGTH: 14400,  // 4 hours max memory
    MICRO_SHORT: 60,        // 1 min
    MICRO_LONG: 900,        // 15 mins
    MACRO_SHORT: 900,       // 15 mins
    MACRO_LONG: 3600,       // 60 mins
    SWING_WINDOW: 30,       // 30 seconds each side for resistance
    ATR_CANDLE_PERIOD: 60,  // 1-minute candles for ATR
    ATR_BASELINE: 0.003,    // 0.3% baseline ATR (typical 1m range)
    SLOPE_THRESH: 0.00005,  // 0.005% minimum acceleration
    BOUNCE_PROXIMITY: 0.01, // 1% — how close to macro long MA qualifies as a bounce zone
    COOLDOWN_MS: 15 * 60 * 1000, // 15 minutes
    MAX_RSI: 70,             // Block automated entries if RSI > 70
    SLIPPAGE_TOLERANCE: 0.001, // 0.1% limit price offset
    VOLUME_CAP_MULT: 10      // Cap individual tick volume at 10x 5m average
};

export default SNIPER;
