// strategies/hunter.js
// HUNTER strategy configuration — slow, longer-timeframe swing mode.
// Trades on 15min–4hr macro regimes with wider trailing stops.

const HUNTER = {
    VOLUME_MULTIPLIER: 1.2,
    BULL_THRESH: 0.002,           // Lowered from 0.004 to catch breakouts earlier
    BEAR_THRESH: -0.002,
    BTC_STRENGTH_THRESHOLD: 0.0005,
    TRAIL_ACTIVATION: 0.0275,       // +2.75% arms trail
    TRAIL_DELTA: 0.01,            // 1.0% trail (same as mid — single continuous trail)
    HARD_STOP: -0.99,             // Effectively disabled (hold long term)
    MID_TRAIL_ACTIVATION: 0.0175, // +1.75% starts trailing
    MID_TRAIL_DELTA: 0.0125,      // 1.25% trail
    HEADROOM_REQUIRED: 0.03,
    HISTORY_LENGTH: 86400,  // 24 hours max memory
    MICRO_SHORT: 300,       // 5 mins
    MICRO_LONG: 3600,       // 60 mins
    MACRO_SHORT: 3600,      // 60 mins
    MACRO_LONG: 14400,      // 4 hours
    SWING_WINDOW: 120,      // 2 minutes each side for resistance
    ATR_CANDLE_PERIOD: 900, // 15-minute candles for ATR
    ATR_BASELINE: 0.015,    // 1.5% baseline ATR (typical 15m range)
    SLOPE_THRESH: 0.0001,   // 0.01% acceleration
    BOUNCE_PROXIMITY: 0.015, // 1.5% — wider bounce zone for slower Hunter timeframes
    COOLDOWN_MS: 30 * 60 * 1000, // 30 minutes for swing strategy
    MAX_RSI: 72,              // Raised from 65 to align with backtest behavior (swing strategy needs room)
    SLIPPAGE_TOLERANCE: 0.0015, // 0.15% limit price offset
    VOLUME_CAP_MULT: 15       // Cap individual tick volume at 15x 5m average
};

export default HUNTER;
