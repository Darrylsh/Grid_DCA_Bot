// @ts-nocheck
import { getTickHistory } from './db';
import { RegimeFilter, shouldEnter, checkTrailingStop, getScaledConfig, calculateRSI } from './algos';
import STRATEGIES from './strategies/index';

/**
 * Runs a high-fidelity backtest using historical price ticks.
 * @param symbol The trading pair (e.g. 'SOLUSDT')
 * @param strategyName The strategy key (e.g. 'SNIPER')
 * @param startTime ISO date string
 * @param endTime ISO date string
 * @param onProgress Callback for percentage updates
 */
export async function runBacktest(symbol, strategyName, startTime, endTime, initialEquityArg, isDecoupled = false, onProgress) {
    const initialEquity = (isNaN(initialEquityArg) || initialEquityArg <= 0) ? 1000 : initialEquityArg;
    console.log(`[BACKTEST] Starting simulation for ${symbol} using ${strategyName} (Equity: $${initialEquity})...`);
    
    // 1. Fetch Tick History
    const ticks = await getTickHistory(symbol, startTime, endTime);
    if (ticks.length === 0) {
        return { error: 'No live tick data found in the selected range.' };
    }

    const firstTick = ticks[0];
    const lastTick = ticks[ticks.length - 1];
    console.log(`[BACKTEST] Processing ${ticks.length.toLocaleString()} ticks from ${firstTick.recorded_at.toISOString()} to ${lastTick.recorded_at.toISOString()}`);

    // 2. Initialize Simulated Environment
    const filter = new RegimeFilter();
    const strategyConfig = STRATEGIES[strategyName];
    if (!strategyConfig) return { error: `Strategy ${strategyName} not found.` };

    let position = null; // { entryPrice, quantity, highWaterMark, entryTime }
    const trades = [];
    let equity = initialEquity; 
    
    // Tracking for the virtual 60-second boundary (mirrors evaluateEntries in bot.ts)
    const EVAL_INTERVAL_MS = 60 * 1000;
    let lastEvalTime = firstTick.recorded_at.getTime();
    let consecutiveBulls = 0;

    // 3. Simulation Loop
    for (let i = 0; i < ticks.length; i++) {
        const tick = ticks[i];
        const currentTime = tick.recorded_at.getTime();
        
        // Prevent blocking the event loop for too long on large datasets
        if (i % 50000 === 0) await new Promise(resolve => setTimeout(resolve, 0));

        // Feed tick into the filter (mimics processTick)
        // Note: For backtesting, we don't have cumulative dailyVolume here easily, 
        // so we pass volume directly as directVolume.
        filter.addTick(symbol, tick.price, 0, 14400, tick.volume);

        // --- EXIT LOGIC (Checked on every tick) ---
        if (position) {
            if (!strategyConfig) {
                console.error(`[BT ERROR] Strategy config lost for ${symbol}`);
                return { error: 'Simulation corrupted: Strategy config lost.' };
            }
            const exit = checkTrailingStop(tick.price, position.entryPrice, position.highWaterMark, 'BULL', strategyConfig);
            if (exit && exit.shouldSell) {
                // Execute Exit
                const exitPrice = tick.price;
                const pnl = (exitPrice - position.entryPrice) * position.quantity;
                const roi = (exitPrice - position.entryPrice) / position.entryPrice;
                
                equity *= (1 + roi);

                trades.push({
                    symbol,
                    side: 'SELL',
                    price: exitPrice,
                    quantity: position.quantity,
                    entryPrice: position.entryPrice,
                    pnl,
                    roi,
                    equity, // Tracking for chart
                    reason: exit.reason || 'MANUAL',
                    timestamp: tick.recorded_at.toISOString(),
                    holdTime: (currentTime - position.entryTimestamp) / (60 * 1000) // minutes
                });

                console.log(`[BT SELL] ${symbol} @ $${exitPrice.toFixed(4)} | ROI: ${(roi * 100).toFixed(2)}% | Reason: ${exit.reason}`);
                position = null;
                consecutiveBulls = 0;
            } else if (position) {
                // Update HWM
                position.highWaterMark = Math.max(position.highWaterMark, tick.price);
            }
        }

        // --- ENTRY LOGIC (Checked on 60s virtual boundaries) ---
        if (currentTime - lastEvalTime >= EVAL_INTERVAL_MS) {
            lastEvalTime = currentTime;

            // Report progress every 10 minutes of virtual time or so
            if (onProgress && i % 5000 === 0) {
                const progress = Math.round((i / ticks.length) * 100);
                onProgress(progress);
            }

            if (!position) {
                const history = filter.getHistory(symbol);
                if (history && history.length >= 60) {
                    const lastPrice = history[history.length - 1].price;
                    const { micro: regime, macro: macroRegime } = filter.getRegime(symbol, strategyConfig);
                    const rsi5m = calculateRSI(history, 14, 300);
                    const scaledConfig = getScaledConfig(symbol, history, strategyConfig);

                    // Note: In backtest, we skip BTC Guard / Resistance for simplicity 
                    // or we could mock them if the user had BTC ticks in the same period.
                    // For now, let's assume valid macro condition.
                    const entryCheck = shouldEnter(
                        symbol, regime, false, 'BULL', 
                        [{ symbol }], history, lastPrice, 
                        0.01, scaledConfig, macroRegime, 
                        isDecoupled, true, rsi5m, null
                    );

                    if (entryCheck === true) {
                        consecutiveBulls++;
                        if (consecutiveBulls >= 2) {
                            // Execute Buy
                            const quantity = initialEquity / lastPrice; // Use full initial budget per slot for simulation
                            position = {
                                entryPrice: lastPrice,
                                quantity: quantity,
                                highWaterMark: lastPrice,
                                entryTimestamp: currentTime
                            };

                            trades.push({
                                symbol,
                                side: 'BUY',
                                price: lastPrice,
                                quantity,
                                equity, // Tracking for chart
                                timestamp: tick.recorded_at.toISOString(),
                                reason: 'SIGNAL'
                            });
                            console.log(`[BT BUY] ${symbol} @ $${lastPrice.toFixed(4)}`);
                        }
                    } else {
                        consecutiveBulls = 0;
                    }
                }
            }
        }
    }

    // 4. Calculate Final Stats
    const sellTrades = trades.filter(t => t.side === 'SELL');
    const realizedPnl = sellTrades.reduce((sum, t) => sum + t.pnl, 0);
    const realizedRoi = sellTrades.length > 0 ? sellTrades.reduce((sum, t) => sum + t.roi, 0) / sellTrades.length : 0;
    
    let unrealizedPnl = 0;
    let unrealizedRoi = 0;
    let hasOpenPosition = false;

    if (position && position.entryPrice > 0) {
        const lastTickPrice = ticks[ticks.length - 1].price;
        unrealizedPnl = (lastTickPrice - position.entryPrice) * position.quantity;
        unrealizedRoi = (lastTickPrice - position.entryPrice) / position.entryPrice;
        hasOpenPosition = true;
    }

    const wins = sellTrades.filter(t => t.pnl > 0).length;
    const winRate = sellTrades.length > 0 ? (wins / sellTrades.length) * 100 : 0;

    // 5. Sample Tick History for Charting (Max 1000 points)
    const sampleRate = Math.max(1, Math.floor(ticks.length / 1000));
    const chartData = [];
    for (let i = 0; i < ticks.length; i += sampleRate) {
        chartData.push({ t: ticks[i].recorded_at.getTime(), p: ticks[i].price });
    }

        const finalOpenEquity = isFinite(equity * (1 + (hasOpenPosition ? unrealizedRoi : 0))) ? (equity * (1 + (hasOpenPosition ? unrealizedRoi : 0))) : equity;
    
    return {
        symbol,
        strategy: strategyName,
        totalTrades: sellTrades.length,
        winRate,
        avgRoi: realizedRoi,
        realizedPnl,
        unrealizedPnl,
        unrealizedRoi,
        hasOpenPosition,
        finalEquity: finalOpenEquity,
        totalPnl: finalOpenEquity - initialEquity,
        totalRoi: (finalOpenEquity - initialEquity) / initialEquity,
        trades: trades,
        chartData,         range: {
            start: firstTick.recorded_at.toISOString(),
            end: lastTick.recorded_at.toISOString(),
            ticksProcessed: ticks.length
        }
    };
}
