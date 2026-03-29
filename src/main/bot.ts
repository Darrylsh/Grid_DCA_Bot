// @ts-nocheck
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });
import { Spot } from '@binance/connector';
import { initDb, getWhitelist, logTrade, savePosition, deletePosition, getActivePositions, updateHighWaterMark, getSettings, saveTickBatch, pruneOldTicks, getDecoupledWhitelist, updatePositionManualMode } from './db';
import { RegimeFilter, checkTrailingStop, shouldEnter, STRATEGIES, getScaledConfig, calculateRSI } from './algos';
import { EventEmitter } from 'events';

// Initialize Binance API keys from .env
const apiKey = process.env['BINANCE_API_KEY'];
const apiSecret = process.env['BINANCE_API_SECRET'];

// If API key is provided, use it. Otherwise, initialize without keys just for market data
const client = apiKey ? new Spot(apiKey, apiSecret) : new Spot();

const regimeFilter = new RegimeFilter();

// Helper to refresh streams if needed (e.g. after buy/sell)
const refreshStreams = () => {
    const whitelistSymbols = currentWhitelist.map(i => typeof i === 'string' ? i : i.symbol);
    const monitoringSet = new Set([...whitelistSymbols, ...Object.keys(activePositions), 'BTCUSDT']);
    botEvents.emit('monitoring_update', Array.from(monitoringSet));
    if (wsClient) reloadWhitelist(currentWhitelist).catch(e => console.error('Refresh fail:', e));
};

// In-memory state
let activePositions = {}; // { symbol: { entryPrice, quantity, highWaterMark } }
let currentWhitelist = [];
let coinStrategies = {}; // { symbol: strategyName }
let currentDecoupledList = [];
let wsClient = null; // Store websocket client instance
let streamGeneration = 0; // Prevent zombie ticks from re-adding symbols
let lastTicks = {}; // { symbol: timestamp } - Watchdog to detect silent individual disconnects
let balances = { USDT: 0, BNB: 0 }; // Store balances
let consecutiveBullSignals = {}; // { symbol: { count, lastTickTime } }
let cooldowns = {}; // { symbol: timestamp } tracks when a coin was last sold
let manualModes = {}; // { symbol: true }
let indicatorCache = {}; // { symbol: { strategyConfig, rsi5m, lastCalc } }
let dailyBoxBounds = {}; // { symbol: { low, high, updatedAt } }
const COOLDOWN_PERIOD = 15 * 60 * 1000; // 15 minutes in milliseconds
// MAX_CONCURRENT_TRADES is now dynamic via currentSettings.max_concurrent_trades

// --- Tick Recording Buffer ---
// Accumulates ticks in memory and flushes to PostgreSQL in batches
// to avoid hammering the DB on every WebSocket message.
let tickBuffer = {}; // { symbol: [{ price, volume, recorded_at }] }

const bufferTick = (symbol, price, volume, trade_id = null, timestamp = null) => {
    if (!tickBuffer[symbol]) tickBuffer[symbol] = [];
    tickBuffer[symbol].push({ 
        price, 
        volume, 
        recorded_at: timestamp ? new Date(timestamp) : new Date(),
        trade_id: trade_id
    });
};

const flushTickBuffer = async () => {
    const symbols = Object.keys(tickBuffer);
    if (symbols.length === 0) return;

    // Swap buffer immediately so incoming ticks aren't missed during async writes
    const snapshot = tickBuffer;
    tickBuffer = {};

    for (const symbol of symbols) {
        const ticks = snapshot[symbol];
        if (!ticks || ticks.length === 0) continue;
        try {
            await saveTickBatch(symbol, ticks);
        } catch (e) {
            console.error(`[TICK RECORD] Failed to save ${ticks.length} ticks for ${symbol}:`, e.message);
        }
    }
};

const startTickRecording = () => {
    // Flush tick buffer to DB every 60 seconds
    setInterval(flushTickBuffer, 60 * 1000);
    console.log('[TICK RECORD] Tick recording started — flushing every 60s.');

    // Prune ticks older than 30 days once per day
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        pruneOldTicks(30).catch(e => console.error('[TICK PRUNE] Error:', e.message));
    }, TWENTY_FOUR_HOURS);
};

let symbolFilters = {}; // symbol -> { stepSize }

let currentMode = 'SIMULATION'; // or 'LIVE'
let botStartTime: number | null = null;
let currentSettings = {
    trading_mode: 'SIMULATION',
    capital_type: 'PERCENTAGE',
    capital_value: '5',
    active_strategy: 'SNIPER',
    max_concurrent_trades: '3'
};

// UI Communication
const botEvents = new EventEmitter();

// Fetch stepSize and other filters from Binance
const updateFilters = async () => {
    if (!apiKey) return;
    try {
        // Wrap exchangeInfo in a 10s timeout to prevent startup hangs
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Binance exchangeInfo timeout after 10s')), 10000));
        const exchangeInfo = client.exchangeInfo();
        const response = await Promise.race([exchangeInfo, timeout]);
        
        const filters = {};
        response.data.symbols.forEach(s => {
            const lotSize = s.filters.find(f => f.filterType === 'LOT_SIZE');
            const priceFilter = s.filters.find(f => f.filterType === 'PRICE_FILTER');
            if (lotSize || priceFilter) {
                filters[s.symbol] = {
                    stepSize: lotSize ? parseFloat(lotSize.stepSize) : 0,
                    tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : 0
                };
            }
        });
        symbolFilters = filters;
        console.log(`Updated exchange filters for ${Object.keys(symbolFilters).length} symbols.`);
    } catch (e) {
        console.error('[API WARNING] Error updating exchange filters (using cached/default):', e.message);
        // We don't throw; let the bot try to continue with what it has
    }
};

// Fetch the actual free balance for a specific asset from Binance
const fetchAssetBalance = async (asset) => {
    if (!apiKey || !apiSecret) return 0;
    try {
        const response = await client.account();
        const found = response.data.balances.find(b => b.asset === asset);
        return parseFloat(found ? found.free : 0);
    } catch (e) {
        console.error(`Error fetching balance for ${asset}:`, e);
        return 0;
    }
};

// Historical Backfill to warm up indicators
const backfillHistory = async (symbols) => {
    console.log(`[BACKFILL] Pre-loading history for ${symbols.length} symbols...`);

    for (const symbol of symbols) {
        const strategyName = coinStrategies[symbol] || currentSettings.active_strategy || 'SNIPER';
        const strategyConfig = STRATEGIES[strategyName];
        const warmupSeconds = Math.max(strategyConfig.MACRO_LONG, 4500);
        const candleCount = Math.ceil(warmupSeconds / 60) + 10;
        const limit = Math.min(1000, candleCount);
        try {
            const response = await client.klines(symbol, '1m', { limit });
            const klines = response.data;

            klines.forEach(k => {
                const closePrice = parseFloat(k[4]);
                const volume = parseFloat(k[5]);
                // Stretch: Add 60 ticks per 1m candle to maintain the second-based timeframe of the MAs
                for (let i = 0; i < 60; i++) {
                    regimeFilter.addTick(symbol, closePrice, 0, strategyConfig.HISTORY_LENGTH, volume / 60);
                }
            });
            console.log(`[BACKFILL] ${symbol}: Loaded ${klines.length} minutes of history (${klines.length * 60} ticks).`);
        } catch (e) {
            console.error(`[BACKFILL ERROR] Failed for ${symbol}:`, e.message);
        }
    }
};

// Trade Execution Logic
const executeTrade = async (symbol, side, price, reason = 'UNKNOWN') => {
    let quantity;
    let limitPrice = null;
    let capitalAmount = 0;
    const strategyName = coinStrategies[symbol] || currentSettings.active_strategy || 'SNIPER';
    const strategyConfig = STRATEGIES[strategyName];
    const tolerance = strategyConfig.SLIPPAGE_TOLERANCE || 0.001;

    if (side === 'BUY') {
        capitalAmount = 100; // default
        const capVal = parseFloat(currentSettings.capital_value) || 0;
        if (currentSettings.capital_type === 'PERCENTAGE') {
            const investedVal = Object.values(activePositions).reduce((sum, pos) => sum + (pos.quantity * pos.entryPrice), 0);
            const totalEquity = balances.USDT + investedVal;
            capitalAmount = totalEquity * (capVal / 100);
            console.log(`[SIZING] Total Equity: $${totalEquity.toFixed(2)} (Free: $${balances.USDT.toFixed(2)}, Invested: $${investedVal.toFixed(2)}). Slot Size: $${capitalAmount.toFixed(2)}`);
        } else {
            capitalAmount = capVal; // Fixed amount
        }

        if (capitalAmount > balances.USDT) {
            console.log(`[SKIP BUY] ${symbol}: Need $${capitalAmount.toFixed(2)} but only $${balances.USDT.toFixed(2)} available.`);
            return;
        }

        quantity = capitalAmount / price;
        limitPrice = price * (1 + tolerance);
    } else {
        quantity = activePositions[symbol].quantity;
        limitPrice = price * (1 - tolerance);
    }

    // Apply Exchange Filters (Rounding to stepSize and tickSize)
    const filter = symbolFilters[symbol];
    if (filter) {
        if (filter.stepSize) {
            const roundedQty = Math.floor(quantity / filter.stepSize) * filter.stepSize;
            const precision = filter.stepSize.toString().split('.')[1]?.length || 0;
            quantity = parseFloat(roundedQty.toFixed(precision));
        }
        if (filter.tickSize && limitPrice) {
            // For buys, round UP to ensure we don't accidentally exceed tolerance downward.
            // For sells, round DOWN to ensure we don't accidentally exceed tolerance upward.
            const roundedPrice = side === 'BUY' 
                ? Math.ceil(limitPrice / filter.tickSize) * filter.tickSize
                : Math.floor(limitPrice / filter.tickSize) * filter.tickSize;
            const precision = filter.tickSize.toString().split('.')[1]?.length || 0;
            limitPrice = parseFloat(roundedPrice.toFixed(precision));
        }
    }

    // === LIVE MODE: Execute real Binance orders ===
    if (currentMode === 'LIVE') {
        try {
            let orderResult;
            const useLimitIOC = (reason !== 'HARD_STOP'); // All TP and Buys use LIMIT IOC

            if (side === 'BUY') {
                if (useLimitIOC) {
                    console.log(`[LIVE ORDER - LIMIT IOC] Placing BUY on ${symbol} for ${quantity} @ $${limitPrice}. Tolerance: ${tolerance * 100}%`);
                    orderResult = await client.newOrder(symbol, 'BUY', 'LIMIT', {
                        quantity: quantity.toString(),
                        price: limitPrice.toString(),
                        timeInForce: 'IOC'
                    });
                } else {
                    console.log(`[LIVE ORDER] Placing MARKET BUY on ${symbol} for $${capitalAmount.toFixed(2)}...`);
                    orderResult = await client.newOrder(symbol, 'BUY', 'MARKET', {
                        quoteOrderQty: capitalAmount.toFixed(2)
                    });
                }
            } else {
                if (useLimitIOC) {
                    console.log(`[LIVE ORDER - LIMIT IOC] Placing SELL on ${symbol} for ${quantity} @ $${limitPrice}. Tolerance: ${tolerance * 100}%`);
                    orderResult = await client.newOrder(symbol, 'SELL', 'LIMIT', {
                        quantity: quantity.toString(),
                        price: limitPrice.toString(),
                        timeInForce: 'IOC'
                    });
                } else {
                    console.log(`[LIVE ORDER] Placing MARKET SELL on ${symbol} for ${quantity} units...`);
                    orderResult = await client.newOrder(symbol, 'SELL', 'MARKET', {
                        quantity: quantity.toString()
                    });
                }
            }

            // Extract actual fill price and quantity from the Binance response
            const fills = orderResult.data.fills || [];
            if (fills.length > 0) {
                const totalQty = fills.reduce((sum, f) => sum + parseFloat(f.qty), 0);
                const totalCost = fills.reduce((sum, f) => sum + (parseFloat(f.price) * parseFloat(f.qty)), 0);
                const avgFillPrice = totalCost / totalQty;
                price = avgFillPrice;  // Use actual fill price
                quantity = totalQty;   // Use actual fill quantity
                console.log(`[LIVE FILL] ${side} ${symbol}: ${totalQty} @ avg $${avgFillPrice.toFixed(6)}`);
            }

            // Refresh balance immediately after a live trade
            fetchBalances();
        } catch (e) {
            console.error(`[LIVE ORDER FAILED] ${side} ${symbol}:`, e.response ? e.response.data : e.message);
            return; // Abort — do not record a trade that failed on the exchange
        }
    }

    let pnl = 0;
    let roi = 0;
    if (side === 'SELL') {
        const entryPrice = activePositions[symbol].entryPrice;
        pnl = (price - entryPrice) * quantity;
        roi = (price - entryPrice) / entryPrice;
        delete activePositions[symbol];
        await deletePosition(symbol, currentMode); // Persist closure

        // Apply strategy cooldown to prevent immediate reentry into chop
        cooldowns[symbol] = Date.now();
    } else if (side === 'BUY') {
        const currentPos = activePositions[symbol];
        if (currentPos) {
            // COST AVERAGING LOGIC: Calculate weighted average
            const oldQty = currentPos.quantity;
            const oldEntry = currentPos.entryPrice;
            const newTotalQty = oldQty + quantity;
            const newAveragedEntry = ((oldEntry * oldQty) + (price * quantity)) / newTotalQty;

            console.log(`[DCA] Averaging ${symbol}: Old Entry $${oldEntry.toFixed(6)}, New Entry $${newAveragedEntry.toFixed(6)}. Total Qty: ${newTotalQty.toFixed(6)}`);

            activePositions[symbol].entryPrice = newAveragedEntry;
            activePositions[symbol].quantity = newTotalQty;
            activePositions[symbol].highWaterMark = price; // Reset HWM to current price to prevent immediate trailing stop triggers
            await savePosition(symbol, activePositions[symbol], currentMode);
        } else {
            // Standard first entry
            const isManual = !!manualModes[symbol];
            const position = { entryPrice: price, quantity, highWaterMark: price, mode: currentMode, isManual };
            activePositions[symbol] = position;
            await savePosition(symbol, position, currentMode); // Persist opening
        }

        // Fetch actual Binance balance for this asset (includes dust) so sell quantity is pre-loaded
        const baseAsset = symbol.replace('USDT', '');
        const actualBalance = await fetchAssetBalance(baseAsset);
        if (actualBalance > activePositions[symbol].quantity) {
            console.log(`[DUST SWEEP] ${symbol}: Bot recorded ${activePositions[symbol].quantity.toFixed(6)}, but account holds ${actualBalance.toFixed(6)}. Using full balance.`);
            activePositions[symbol].quantity = actualBalance;
            await savePosition(symbol, activePositions[symbol], currentMode);
        }
    }

    // Refresh streams to ensure we are subbed to active positions even if not in whitelist
    refreshStreams();

    // Log to DB
    const currentRegime = regimeFilter.getRegime(symbol);
    await logTrade({
        symbol, side, price, quantity, pnl, roi, algo_regime: currentRegime.micro || currentRegime, reason
    }, currentMode);

    // Broadcast to UI
    botEvents.emit('trade_executed', {
        symbol, side, price, quantity, pnl, roi, regime: currentRegime.micro || currentRegime, timestamp: new Date()
    });

    console.log(`Executed ${side} on ${symbol} at ${price}. PnL: ${pnl.toFixed(4)}`);

    // Force immediate UI update
    try {
        const { micro: regime, macro: macroRegime, isBouncing } = regimeFilter.getRegime(symbol, strategyConfig);
        const cache = indicatorCache[symbol] || {};
        const isManual = !!manualModes[symbol];
        const boxBounds = dailyBoxBounds[symbol] || null;
        broadcastSymbolUpdate(symbol, price, regime, macroRegime, isBouncing, cache.rsi5m || null, isManual, strategyConfig, boxBounds);
    } catch (e) {
        console.error(`[FORCE REFRESH FAIL] ${symbol}:`, e.message);
    }
};

// Periodic fetch of daily high/low for the BOX strategy
const refreshBoxBounds = async () => {
    const whitelistSymbols = currentWhitelist.map(i => typeof i === 'string' ? i : i.symbol);
    const symbolsToFetch = Array.from(new Set([...whitelistSymbols, ...Object.keys(activePositions)]));
    
    for (const symbol of symbolsToFetch) {
        if (symbol === 'BTCUSDT') continue;
        try {
            const response = await client.klines(symbol, '1d', { limit: 2 });
            const klines = response.data;
            if (klines && klines.length >= 2) {
                const prevDay = klines[0]; // Index 0 is the previous completed day
                dailyBoxBounds[symbol] = {
                    low: parseFloat(prevDay[3]),
                    high: parseFloat(prevDay[2]),
                    updatedAt: Date.now()
                };
            }
        } catch (e) {
            console.error(`[BOX] Failed to fetch bounds for ${symbol}:`, e.message);
        }
    }
    console.log(`[BOX] Refreshed daily bounds for ${Object.keys(dailyBoxBounds).length} symbols.`);
};

// Process incoming WebSocket price updates
const processTick = async (symbol, currentPrice, currentVolume, generation, tradeId, timestamp) => {
    // Ignore ticks from old/dead streams
    if (generation !== streamGeneration) return;

    const now = Date.now();
    const prevTickTime = lastTicks[symbol] || now;
    lastTicks[symbol] = now;
    
    const strategyName = coinStrategies[symbol] || currentSettings.active_strategy || 'SNIPER';
    const baseConfig = STRATEGIES[strategyName];

    // Tick Padding: If more than 1.5 seconds have passed since the last tick,
    // inject synthetic ticks to keep MAs synchronized with 1-second time units.
    const gapMs = now - prevTickTime;
    if (gapMs > 1500) {
        const secondsToPad = Math.floor(gapMs / 1000);
        // Cap padding to 5 minutes to avoid memory spikes during long outages
        const safePad = Math.min(300, secondsToPad);
        for (let i = 0; i < safePad; i++) {
            regimeFilter.addTick(symbol, currentPrice, 0, baseConfig.HISTORY_LENGTH, 0, baseConfig.VOLUME_CAP_MULT);
        }
    }

    regimeFilter.addTick(symbol, currentPrice, currentVolume, baseConfig.HISTORY_LENGTH, null, baseConfig.VOLUME_CAP_MULT);
    bufferTick(symbol, currentPrice, currentVolume, tradeId, timestamp); // Record for backtest history
    const { micro: regime, macro: macroRegime, isBouncing, zScore, autocorrelation, obi, atr } = regimeFilter.getRegime(symbol, baseConfig);
    const btcData = regimeFilter.getRegime('BTCUSDT', baseConfig); // Core Market Guard regime
    const btcRegime = btcData.micro;
    const btcMacroDiff = btcData.macroDiff || 0;

    // Filter out BNB pairs
    if (symbol.startsWith('BNB')) return;

    const symbolHistory = regimeFilter.getHistory(symbol);

    // Performance Throttling: Recalculate indicators at most once every 250ms per symbol.
    // In high-volatility spikes, we can see 100+ aggTrades per second; recalculating 
    // O(n) history on every tick is a massive event-loop bottleneck.
    let cache = indicatorCache[symbol] || { lastCalc: 0 };
    if (now - cache.lastCalc > 250) {
        cache.strategyConfig = getScaledConfig(symbol, symbolHistory, baseConfig);
        cache.rsi5m = calculateRSI(symbolHistory, 14, 300);
        cache.lastCalc = now;
        indicatorCache[symbol] = cache;
    }

    const strategyConfig = cache.strategyConfig;
    const rsi5m = cache.rsi5m;

    const isManual = !!manualModes[symbol];

    const boxBounds = dailyBoxBounds[symbol] || null;

    // Check existing positions
    if (activePositions[symbol]) {
        const entryPrice = activePositions[symbol].entryPrice;
        let highWaterMark = activePositions[symbol].highWaterMark;

        // Update High Water Mark
        if (currentPrice > highWaterMark) {
            activePositions[symbol].highWaterMark = currentPrice;
            highWaterMark = currentPrice;
            // Non-blocking background save to prevent DB latency from stalling the tick loop
            updateHighWaterMark(symbol, currentPrice, currentMode).catch(e => console.error(`[DB ERROR] HWM save failed for ${symbol}:`, e));
        }

        if (!isManual) {
            const trailStop = checkTrailingStop(currentPrice, entryPrice, highWaterMark, macroRegime, strategyConfig, boxBounds, atr, regime);

            if (trailStop.shouldSell) {
                console.log(`[${trailStop.reason}] Selling ${symbol}. High was ${highWaterMark}. Sell at ${currentPrice}. Macro: ${macroRegime}`);
                await executeTrade(symbol, 'SELL', currentPrice, trailStop.reason);
            }
        }
    }
    broadcastSymbolUpdate(symbol, currentPrice, regime, macroRegime, isBouncing, rsi5m, isManual, strategyConfig, boxBounds, zScore, autocorrelation, obi);
};

const broadcastSymbolUpdate = (symbol, currentPrice, regime, macroRegime, isBouncing, rsi5m, isManual, strategyConfig, boxBounds) => {
    let trailingStatus = '-';
    if (activePositions[symbol]) {
        const entryPrice = activePositions[symbol].entryPrice;
        const highestRoi = (activePositions[symbol].highWaterMark - entryPrice) / entryPrice;
        if (highestRoi >= strategyConfig.TRAIL_ACTIVATION) trailingStatus = 'TRAILING';
        else if (strategyConfig.MID_TRAIL_ACTIVATION && highestRoi >= strategyConfig.MID_TRAIL_ACTIVATION) trailingStatus = 'MID_TRAIL';
        else trailingStatus = 'PROTECTIVE';
    }

    botEvents.emit('market_update', {
        symbol,
        currentPrice,
        regime,
        macroRegime,
        position: activePositions[symbol] || null,
        confirmationCount: consecutiveBullSignals[symbol] ? consecutiveBullSignals[symbol].count : 0,
        manual: isManual,
        atrMultiplier: strategyConfig.atrMultiplier || 1.0,
        isBouncing: isBouncing || false,
        rsi5m: rsi5m !== null ? Math.round(rsi5m) : null,
        trailingStatus,
        botStartTime,
        trailActivation: strategyConfig.TRAIL_ACTIVATION,
        midTrailActivation: strategyConfig.MID_TRAIL_ACTIVATION,
        boxBounds
    });
};


const connectWebSocket = () => {
    streamGeneration += 1;
    const currentGen = streamGeneration;

    const whitelistSymbols = currentWhitelist.map(i => typeof i === 'string' ? i : i.symbol);
    const monitoringSet = new Set([...whitelistSymbols, ...Object.keys(activePositions), 'BTCUSDT']);
    const monitoringList = Array.from(monitoringSet);
    console.log(`[GEN ${currentGen}] Connecting WebSockets for ${monitoringList.length} pairs...`);

    // Notify UI of exactly what we are monitoring
    botEvents.emit('monitoring_update', monitoringList);

    if (monitoringList.length === 0) return;

    // @binance/connector websocket structure
    const callbacks = {
        open: () => console.log(`[GEN ${currentGen}] Connected to Binance WebSocket`),
        close: () => console.log(`[GEN ${currentGen}] Binance WebSocket Closed`),
        error: (err) => console.error(`[GEN ${currentGen}] Binance WebSocket Error:`, err),
        message: data => {
            try {
                const parsed = JSON.parse(data);
                // AggTrade stream format: https://binance-docs.github.io/apidocs/spot/en/#aggregate-trade-streams
                if (parsed.e === 'aggTrade') {
                    const symbol = parsed.s;
                    const price = parseFloat(parsed.p);
                    const volume = parseFloat(parsed.q);
                    const tradeId = parsed.a; // Aggregate trade ID
                    const timestamp = parsed.T; // Exchange timestamp
                    processTick(symbol, price, volume, currentGen, tradeId, timestamp).catch(e => console.error(e));
                }
                // BookTicker stream format: https://binance-docs.github.io/apidocs/spot/en/#individual-symbol-book-ticker-streams
                else if (parsed.e === 'bookTicker') {
                    const symbol = parsed.s;
                    const bidQty = parseFloat(parsed.B);
                    const askQty = parseFloat(parsed.A);
                    regimeFilter.updateOrderBook(symbol, bidQty, askQty);
                }
            } catch (e) { }
        }
    };

    // Subscribing to aggregate trades AND book tickers for all symbols
    const streams = [];
    monitoringList.forEach(sym => {
        if (sym && typeof sym === 'string') {
            streams.push(`${sym.toLowerCase()}@aggTrade`);
            streams.push(`${sym.toLowerCase()}@bookTicker`);
        }
    });

    // We import WebsocketStream
    const { WebsocketStream } = require('@binance/connector');
    wsClient = new WebsocketStream({ callbacks });

    // Stream one by one
    streams.forEach(stream => {
        wsClient.subscribe(stream);
    });
};

// ---------------------------------------------------------------------------
// 60-Second Entry Evaluation Loop
// Mirrors backtest LIVE_TICKS behavior: all real ticks are fed into RegimeFilter
// on every aggTrade (in processTick), but signal evaluation happens once per
// 60-second boundary — exactly like the backtest. This prevents noisy intra-minute
// aggTrades from resetting the confirmation counter before the MAs can absorb them.
// ---------------------------------------------------------------------------
let entryEvalRunning = false;
let isBotRunning = false;
let botIntervals: NodeJS.Timeout[] = []; // Guard against overlapping async runs

const evaluateEntries = async () => {
    if (entryEvalRunning) return; // Skip if previous run hasn't finished
    entryEvalRunning = true;
    try {
        const now = Date.now();
        const maxConcurrent = parseInt(currentSettings.max_concurrent_trades || 3);

        for (const item of currentWhitelist) {
            const symbol = typeof item === 'string' ? item : item.symbol;

            if (symbol.startsWith('BNB')) continue;
            if (activePositions[symbol]) {
                // Already holding — clear any stale signal state
                if (consecutiveBullSignals[symbol]) delete consecutiveBullSignals[symbol];
                continue;
            }
            if (manualModes[symbol]) continue;

            const strategyName = coinStrategies[symbol] || currentSettings.active_strategy || 'SNIPER';
            const baseConfig = STRATEGIES[strategyName];

            // Cooldown guard
            const cooldownMs = baseConfig.COOLDOWN_MS || COOLDOWN_PERIOD;
            if (cooldowns[symbol] && (now - cooldowns[symbol] < cooldownMs)) {
                if (consecutiveBullSignals[symbol]) delete consecutiveBullSignals[symbol];
                continue;
            }

            // Snapshot the current state of the RegimeFilter (same as backtest end-of-window sample)
            const symbolHistory = regimeFilter.getHistory(symbol);
            if (!symbolHistory || symbolHistory.length === 0) continue;

            const lastPrice = symbolHistory[symbolHistory.length - 1].price;
            const scaledConfig = getScaledConfig(symbol, symbolHistory, baseConfig);
            const rsi5m = calculateRSI(symbolHistory, 14, 300);
            const { micro: regime, macro: macroRegime, isBouncing, zScore, autocorrelation, obi } = regimeFilter.getRegime(symbol, baseConfig);
            const btcData = regimeFilter.getRegime('BTCUSDT', baseConfig);
            const btcRegime = btcData.micro;
            const btcMacroDiff = btcData.macroDiff || 0;
            const isDecoupled = currentDecoupledList.includes(symbol);
            const boxBounds = dailyBoxBounds[symbol] || null;

            const entryCheck = shouldEnter(
                symbol, regime, false, btcRegime,
                currentWhitelist, symbolHistory, lastPrice,
                btcMacroDiff, scaledConfig, macroRegime,
                isDecoupled, false, rsi5m, boxBounds,
                zScore, autocorrelation, obi
            );

            if (entryCheck === true) {
                const state = consecutiveBullSignals[symbol] || { count: 0 };
                state.count += 1;
                consecutiveBullSignals[symbol] = state;

                // 2 consecutive 60-second windows of BULL = buy (matches backtest signalsRequired)
                const signalsRequired = 2;
                console.log(`[SIGNAL] ${symbol} ${regime}/${macroRegime} (${state.count}/${signalsRequired}). RSI: ${rsi5m !== null ? Math.round(rsi5m) : 'n/a'}. Bounce: ${isBouncing}`);

                if (state.count >= signalsRequired) {
                    if (Object.keys(activePositions).length >= maxConcurrent) {
                        console.log(`[SKIP BUY] ${symbol}: Already at max ${maxConcurrent} concurrent positions.`);
                        delete consecutiveBullSignals[symbol];
                        continue;
                    }
                    const entryLabel = isBouncing ? 'BOUNCE ENTRY' : (regime === 'RECOVERY' ? 'DIP BUY ENTRY' : 'ENTRY SIGNAL');
                    console.log(`[${entryLabel}] Buying ${symbol} after ${state.count} consecutive 60s ${regime} windows. Bounce: ${isBouncing}`);
                    await executeTrade(symbol, 'BUY', lastPrice, entryLabel);
                    delete consecutiveBullSignals[symbol];
                }
            } else {
                // Log block reason and reset counter — same as backtest consecutive reset on non-BULL window
                if (entryCheck && entryCheck.allowed === false) {
                    const reason = entryCheck.reason;
                    const advice = entryCheck.advice;

                    if (advice === 'MOON_POTENTIAL') {
                        console.log(`[ADVISORY - MOON POTENTIAL] ${symbol} blocked by ${reason} but showing extreme momentum. Manual entry worthy?`);
                    } else if (reason.startsWith('BTC_TOO_WEAK')) {
                        console.log(`[BLOCKED - BTC WEAK] ${symbol}: ${reason}`);
                    } else if (reason.startsWith('RSI_TOO_HIGH')) {
                        console.log(`[BLOCKED - RSI] ${symbol}: ${reason}`);
                    } else {
                        console.log(`[BLOCKED] ${symbol}: ${reason}`);
                    }
                }
                if (consecutiveBullSignals[symbol]) delete consecutiveBullSignals[symbol];
            }
        }
    } finally {
        entryEvalRunning = false;
    }
};

const startBot = async function startBot() {
    if (isBotRunning) {
        console.log('[BOT] Already running. Skipping initialization.');
        return;
    }
    isBotRunning = true;
    botStartTime = Date.now();
    await initDb();
    const whitelist = await getWhitelist();
    currentWhitelist = whitelist; // Array of {symbol, strategy}
    coinStrategies = {};
    whitelist.forEach(i => { 
        if (i.strategy) {
            coinStrategies[i.symbol] = i.strategy;
            console.log(`[INIT] Per-Coin Strategy: ${i.symbol} -> ${i.strategy}`);
        }
    });

    // Load Settings
    const settings = await getSettings();
    Object.assign(currentSettings, settings);
    currentMode = currentSettings.trading_mode || 'SIMULATION';

    // Load persisted positions for current mode
    await loadPositionsForMode();
    await updateFilters(); // Initial filters fetch

    const whitelistSymbols = currentWhitelist.map(i => typeof i === 'string' ? i : i.symbol);
    console.log(`Starting bot with whitelist: ${whitelistSymbols.join(', ')}`);
    console.log(`Mode: ${currentMode}, Capital: ${currentSettings.capital_value} ${currentSettings.capital_type}`);

    // Historical Backfill to warm up indicators
    const monitoringSet = new Set([...whitelistSymbols, ...Object.keys(activePositions), 'BTCUSDT']);
    await backfillHistory(Array.from(monitoringSet));

    connectWebSocket();
    await refreshBoxBounds();
    startTickRecording(); // Begin buffered tick recording to DB

    // Clear any existing intervals (paranoia check)
    botIntervals.forEach(clearInterval);
    botIntervals = [];

    // 60-second entry evaluation loop — mirrors backtest LIVE_TICKS signal timing
    evaluateEntries(); // Run immediately after warmup
    botIntervals.push(setInterval(evaluateEntries, 60 * 1000));

    // 30-second DB sync to support multi-instance / web bot coexistence
    botIntervals.push(setInterval(syncWithDatabase, 30 * 1000));

    // Refresh daily bounds every hour
    botIntervals.push(setInterval(refreshBoxBounds, 60 * 60 * 1000));

    // Fetch initial balances and start refresh cycle
    fetchBalances();
    botIntervals.push(setInterval(fetchBalances, 30 * 1000)); // Update every 30s

    // WebSocket Watchdog: If no ticks received for 1 minute, reconnect
    botIntervals.push(setInterval(() => {
        const now = Date.now();
        const whitelistSymbols = currentWhitelist.map(i => typeof i === 'string' ? i : i.symbol);
        const monitoringList = Array.from(new Set([...whitelistSymbols, ...Object.keys(activePositions), 'BTCUSDT']));
        
        let deadDetected = false;
        for (const symbol of monitoringList) {
            const lastTick = lastTicks[symbol];
            if (!lastTick) continue; // Not started yet
            
            const inactiveTime = now - lastTick;
            if (inactiveTime > 90000) { // 90 seconds (allow some buffer for low volume)
                console.warn(`[WATCHDOG] Stream dead for ${symbol} (${Math.floor(inactiveTime / 1000)}s). Attempting full reconnection...`);
                deadDetected = true;
                break;
            }
        }

        if (deadDetected) {
            // Reset all to prevent reconnection loop if internet is completely down
            monitoringList.forEach(s => lastTicks[s] = now);
            reloadWhitelist(currentWhitelist).catch(e => console.error('[WATCHDOG] Reconnect fail:', e));
        }

        // Market Pulse: Every minute, log a summary of what the bot is seeing
        const globalStrategyConfig = STRATEGIES[currentSettings.active_strategy || 'SNIPER'];
        const btcRegime = regimeFilter.getRegime('BTCUSDT', globalStrategyConfig);
        const summary = currentWhitelist.map(item => {
            const symbol = item.symbol;
            const strategyName = coinStrategies[symbol] || currentSettings.active_strategy || 'SNIPER';
            const strategyConfig = STRATEGIES[strategyName];
            const { micro, macro } = regimeFilter.getRegime(symbol, strategyConfig);
            const history = regimeFilter.data[symbol];
            
            // Latency indicator
            const lastTick = lastTicks[symbol];
            const latency = lastTick ? Math.round((now - lastTick) / 1000) : '?';
            const latencyStr = latency > 5 ? ` ⏰${latency}s` : '';

            let diff = '0.00%';
            if (history && history.length >= 60) {
                const sMA = history.slice(-60).reduce((sum, t) => sum + t.price, 0) / 60;
                const lMA = history.slice(-900).reduce((sum, t) => sum + t.price, 0) / Math.min(history.length, 900);
                diff = ((sMA - lMA) / lMA * 100).toFixed(2) + '%';
            }
            return `${symbol.replace('USDT', '')}: ${micro}/${macro} (${diff}${latencyStr})`;
        }).join(' | ');
        const activeCount = Object.keys(activePositions).length;
        console.log(`[MARKET PULSE] BTC: ${btcRegime.micro}/${btcRegime.macro} | ${summary} | Active: ${activeCount}`);
    }, 60000)); // Check every minute
};

const fetchBalances = async () => {
    if (!apiKey || !apiSecret) return;
    try {
        const response = await client.account();
        const usdt = response.data.balances.find(b => b.asset === 'USDT');
        const bnb = response.data.balances.find(b => b.asset === 'BNB');
        balances.USDT = parseFloat(usdt ? usdt.free : 0);
        balances.BNB = parseFloat(bnb ? bnb.free : 0);
        botEvents.emit('balance_update', balances);

        // Staking Reward Sync: Check actual exchange balances for active positions
        if (currentMode === 'LIVE') {
            for (const symbol in activePositions) {
                const asset = symbol.replace('USDT', '');
                const balanceItem = response.data.balances.find(b => b.asset === asset);
                const actualQty = parseFloat(balanceItem ? balanceItem.free : 0);
                const recordedQty = activePositions[symbol].quantity;

                // If exchange balance is higher than our records, treat as staking reward (bought at 0)
                if (actualQty > recordedQty + 0.000001) {
                    const oldEntry = activePositions[symbol].entryPrice;
                    // Math: Total Cost (oldEntry * recordedQty) / New Total Qty
                    const newEntry = (oldEntry * recordedQty) / actualQty;

                    console.log(`[STAKING SYNC] ${symbol}: Rewarded ${ (actualQty - recordedQty).toFixed(6) } coins. New Entry: $${newEntry.toFixed(6)} (was $${oldEntry.toFixed(6)})`);

                    activePositions[symbol].quantity = actualQty;
                    activePositions[symbol].entryPrice = newEntry;
                    await savePosition(symbol, activePositions[symbol], currentMode);
                }
            }
        }
    } catch (e) {
        console.error('Error fetching balances:', e);
    }
};

const reloadDecoupledList = async () => {
    currentDecoupledList = await getDecoupledWhitelist();
    console.log('[DECOUPLED] Updated decoupled list:', currentDecoupledList);
};

const reloadWhitelist = async (newWhitelistItems) => {
    currentWhitelist = newWhitelistItems;
    coinStrategies = {};
    newWhitelistItems.forEach(i => { 
        if (i.strategy) {
            coinStrategies[i.symbol] = i.strategy;
        }
        // Reset confirmation counts for any symbol in the whitelist to give 
        // the potentially new strategy a fresh start.
        delete consecutiveBullSignals[i.symbol];
    });
    const whitelistSymbols = currentWhitelist.map(i => typeof i === 'string' ? i : i.symbol);
    console.log(`Whitelist reloaded: ${whitelistSymbols.join(', ')} (Signals reset)`);

    if (wsClient) {
        console.log(`Stopping generation ${streamGeneration} to prevent ghost ticks.`);
        try {
            if (typeof wsClient.disconnect === 'function') wsClient.disconnect();
            // Forceful cleanup of underlying socket if available
            if (wsClient.ws) wsClient.ws.terminate();
        } catch (e) {
            console.error('Error closing old stream:', e);
        }
    }
    await updateFilters(); // Refresh stepSize filters
    await refreshBoxBounds(); // Ensure bounds for any new whitelist additions
    connectWebSocket();
};

const loadPositionsForMode = async () => {
    activePositions = {}; // Clear memory
    const loadedPositions = await getActivePositions(currentMode);
    Object.assign(activePositions, loadedPositions);
    
    // Sync manual modes state from loaded positions
    for (const symbol in loadedPositions) {
        if (loadedPositions[symbol].isManual) {
            manualModes[symbol] = true;
        } else {
            delete manualModes[symbol];
        }
    }

    if (Object.keys(activePositions).length > 0) {
        console.log(`Loaded ${Object.keys(activePositions).length} active ${currentMode} positions. Manual modes: ${Object.keys(manualModes).length}`);
    }
};

const syncWithDatabase = async () => {
    try {
        const loadedPositions = await getActivePositions(currentMode);
        let changed = false;

        // Add or update positions
        for (const symbol in loadedPositions) {
            if (!activePositions[symbol]) {
                activePositions[symbol] = loadedPositions[symbol];
                console.log(`[SYNC] New position detected from DB: ${symbol}`);
                changed = true;
            } else {
                activePositions[symbol].quantity = loadedPositions[symbol].quantity;
                activePositions[symbol].entryPrice = loadedPositions[symbol].entryPrice;
                activePositions[symbol].highWaterMark = Math.max(activePositions[symbol].highWaterMark, loadedPositions[symbol].highWaterMark);
                activePositions[symbol].isManual = loadedPositions[symbol].isManual;
            }

            // Sync manual modes
            if (loadedPositions[symbol].isManual) {
                manualModes[symbol] = true;
            } else {
                delete manualModes[symbol];
            }
        }

        // Remove closed positions
        for (const symbol in activePositions) {
            if (!loadedPositions[symbol]) {
                console.log(`[SYNC] Position ${symbol} closed elsewhere. Removing locally.`);
                delete activePositions[symbol];
                changed = true;
            }
        }

        if (changed) refreshStreams();

        // Sync core settings
        const settings = await getSettings();
        if (settings.max_concurrent_trades) currentSettings.max_concurrent_trades = settings.max_concurrent_trades;
        if (settings.active_strategy) currentSettings.active_strategy = settings.active_strategy;
        
    } catch (e) {
        console.error('[SYNC ERROR]:', e);
    }
};

const updateSettingsLocally = async (newSettings) => {
    const oldMode = currentMode;
    const oldStrategy = currentSettings.active_strategy;
    Object.assign(currentSettings, newSettings);
    currentMode = currentSettings.trading_mode || 'SIMULATION';

    if (oldMode !== currentMode || oldStrategy !== currentSettings.active_strategy) {
        console.log(`Switching state: Mode ${currentMode}, Strategy ${currentSettings.active_strategy}`);
        consecutiveBullSignals = {}; // reset signals on switch
        cooldowns = {};
    }

    if (oldMode !== currentMode) {
        await loadPositionsForMode();
        await refreshBoxBounds();
        refreshStreams(); // Update subscriptions based on new active positions
    }
};

const executeManualTrade = async (symbol, side) => {
    if (side === 'SELL' && !activePositions[symbol]) {
        throw new Error(`Cannot manually sell ${symbol}: No active position.`);
    }
    // Removed restriction on Manual Buy if position exists to allow for Manual DCA / Cost Averaging


    // Get last price
    const history = regimeFilter.data[symbol];
    const price = history && history.length > 0 ? history[history.length - 1].price : null;
    if (!price) {
        throw new Error(`Cannot execute manual trade for ${symbol}: No price data available.`);
    }

    console.log(`[MANUAL OVERRIDE] Executing ${side} on ${symbol} at ~${price}`);
    await executeTrade(symbol, side, price, 'MANUAL');
    return true;
};

const toggleBotManualMode = async (symbol, enable) => {
    if (enable) {
        manualModes[symbol] = true;
    } else {
        delete manualModes[symbol];
    }
    
    // Persist to DB if there's an active position
    if (activePositions[symbol]) {
        activePositions[symbol].isManual = !!enable;
        await updatePositionManualMode(symbol, !!enable, currentMode);
    }

    console.log(`[MANUAL MODE] ${symbol} set to ${enable}`);
    refreshStreams();
};

const getUnrealizedPnl = () => {
    let total = 0;
    for (const symbol in activePositions) {
        const pos = activePositions[symbol];
        const history = regimeFilter.data[symbol];
        const currentPrice = history && history.length > 0 ? history[history.length - 1].price : pos.entryPrice;
        total += (currentPrice - pos.entryPrice) * pos.quantity;
    }
    return total;
};

export const getLivePositions = () => activePositions;
export const getCurrentMode = () => currentMode;
export {
    startBot,
    reloadWhitelist,
    botEvents,
    balances,
    updateSettingsLocally,
    executeManualTrade,
    toggleBotManualMode,
    reloadDecoupledList,
    getUnrealizedPnl
};
