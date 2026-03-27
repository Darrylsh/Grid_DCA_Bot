// strategies/quickexit.js
// QUICK_EXIT strategy configuration — Designed to exit positions at a minor profit.
// Stops all automated buy-ins by setting impossible entry thresholds.
// Arms a tight trailing stop at 0.7% profit with a 0.2% trail distance.

const QUICK_EXIT = {
    DISABLE_ATR_SCALING: true,
    VOLUME_MULTIPLIER: 10,        // Effectively irrelevant for exit
    BULL_THRESH: 1.0,             // 100% - stops automated entries
    BEAR_THRESH: -1.0,            // -100%
    BTC_STRENGTH_THRESHOLD: 1.0,  // Stops entries
    TRAIL_ACTIVATION: 0.007,      // +0.7% arms tight trail to recover fees + minor profit
    TRAIL_DELTA: 0.002,           // 0.2% very tight trail
    HARD_STOP: -0.99,             // Effectively disabled
    MID_TRAIL_ACTIVATION: 0,      // Disabled
    MID_TRAIL_DELTA: 0.01,        // Disabled
    HEADROOM_REQUIRED: 0.01,
    HISTORY_LENGTH: 14400,
    MICRO_SHORT: 60,
    MICRO_LONG: 900,
    MACRO_SHORT: 900,
    MACRO_LONG: 3600,
    SWING_WINDOW: 30,
    ATR_CANDLE_PERIOD: 60,
    ATR_BASELINE: 0.003,
    SLOPE_THRESH: 0.01,           // High threshold to stop entries
    BOUNCE_PROXIMITY: 0.01,
    COOLDOWN_MS: 3600000,         // 1 hour cooldown (irrelevant but long)
    MAX_RSI: 10,                   // Effectively blocks entries
    SLIPPAGE_TOLERANCE: 0.001,
    VOLUME_CAP_MULT: 10
};

export default QUICK_EXIT;
