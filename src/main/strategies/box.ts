// strategies/box.js
// BOX strategy configuration — Range-bound breakout/reversion mode.
// Uses previous day's High (top) and Low (bottom) as the trading "box".
// Entry: Price in bottom 20% of the box.
// Exit: Controlled by trailing stop or hitting the top of the box.

const BOX = {
    VOLUME_MULTIPLIER: 1.1,       // Very relaxed volume confirmation
    BULL_THRESH: 0.001,           // Relaxed trend requirement
    BEAR_THRESH: -0.001,
    BTC_STRENGTH_THRESHOLD: 0,    // Relaxed BTC guard
    TRAIL_ACTIVATION: 0.02,       // +2.0% arms trail
    TRAIL_DELTA: 0.005,           // 0.5% trail
    HARD_STOP: -0.05,             // 5% hard floor safety
    MID_TRAIL_ACTIVATION: 0.01,   // +1.0% starts trailing
    MID_TRAIL_DELTA: 0.007,       // 0.7% trail
    HEADROOM_REQUIRED: 0.01,
    HISTORY_LENGTH: 86400,        // 24 hours for indicator context
    MICRO_SHORT: 300,             // 5 mins
    MICRO_LONG: 3600,             // 60 mins
    MACRO_SHORT: 3600,            // 60 mins
    MACRO_LONG: 14400,            // 4 hours
    SWING_WINDOW: 120,            // 2 minutes for resistance
    ATR_CANDLE_PERIOD: 900,       // 15-minute ATR
    ATR_BASELINE: 0.015,
    SLOPE_THRESH: 0.00005,
    BOUNCE_PROXIMITY: 0.015,
    COOLDOWN_MS: 60 * 60 * 1000,  // 1 hour cooldown for range trades
    MAX_RSI: 75,                  // Very relaxed RSI
    SLIPPAGE_TOLERANCE: 0.0015,
    VOLUME_CAP_MULT: 15,
    
    // Strategy Specifics
    BOX_BUY_ZONE: 0.20,           // Bottom 20% of daily range
    BOX_SELL_ZONE: 0.85,          // Top 15% of daily range (optional exit trigger)
    ATR_STOP_MULTIPLIER: 3.5,
    TECHNICAL_EXIT: true,
    BREAKEVEN_PROTECTION: 0.008
};

export default BOX;
