// @ts-nocheck
import { getTickHistory } from './db';
import { RegimeFilter, shouldEnter, checkTrailingStop, getScaledConfig, calculateRSI } from './algos';
import STRATEGIES from './strategies/index';

/**
 * Runs a high-fidelity chunked backtest using historical price ticks.
 * Processes data in 4-hour segments to prevent memory overflow (OOM).
 */
export async function runBacktest(symbol, strategyName, startTime, endTime, initialEquityArg, isDecoupled = false, onUpdate) {
    const initialEquity = (isNaN(initialEquityArg) || initialEquityArg <= 0) ? 1000 : initialEquityArg;
    console.log(`[BACKTEST] Starting chunked simulation for ${symbol} using ${strategyName} (Equity: $${initialEquity})...`);
    
    // 1. Initialize Simulated Environment (State lives across chunks)
    const filter = new RegimeFilter();
    const btcFilter = new RegimeFilter();
    const strategyConfig = STRATEGIES[strategyName];
    if (!strategyConfig) return { error: `Strategy ${strategyName} not found.` };

    let position = null; // { entryPrice, quantity, highWaterMark, entryTimestamp }
    const trades = [];
    let equity = initialEquity; 
    let totalFeesPaid = 0;
    const FEE_RATE = 0.001; // 0.1% fee (Binance standard)
    
    const EVAL_INTERVAL_MS = 60 * 1000;
    let lastEvalTime = null;
    let consecutiveBulls = 0;
    let btcIdx = 0;
    
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const CHUNK_MS = 4 * 60 * 60 * 1000; // 4 hour chunks
    
    // Dynamic sampling: aim for ~1500-2000 points across the whole range
    const totalDurationMs = endMs - startMs;
    const CHART_SAMPLE_INTERVAL_MS = Math.max(60000, Math.floor(totalDurationMs / 1500));
    let lastChartSampleTime = 0;
    
    let ticksProcessed = 0;
    let firstTick = null;
    let lastTick = null;
    const chartData = [];

    // 2. Chunked Processing Loop
    for (let currentMs = startMs; currentMs < endMs; currentMs += CHUNK_MS) {
        const chunkEndMs = Math.min(currentMs + CHUNK_MS, endMs);
        const chunkStart = new Date(currentMs).toISOString();
        const chunkEnd = new Date(chunkEndMs).toISOString();

        // Fetch segment
        const [ticks, btcTicks] = await Promise.all([
            getTickHistory(symbol, chunkStart, chunkEnd),
            getTickHistory('BTCUSDT', chunkStart, chunkEnd)
        ]);

        if (ticks.length > 0) {
            if (!firstTick) firstTick = ticks[0];
            lastTick = ticks[ticks.length - 1];
        }
        btcIdx = 0; // Reset index for this btcTicks segment

        // 3. Simulation Loop for Chunk
        for (let i = 0; i < ticks.length; i++) {
            const tick = ticks[i];
            const currentTime = tick.recorded_at.getTime();
            
            if (!lastEvalTime) lastEvalTime = currentTime;

            // Prevent blocking
            if (i % 20000 === 0) await new Promise(resolve => setTimeout(resolve, 0));

            // Feed coin filter
            filter.addTick(symbol, tick.price, 0, 14400, tick.volume);

            // Time-based sampling for chart to ensure full coverage
            if (currentTime - lastChartSampleTime >= CHART_SAMPLE_INTERVAL_MS) {
               chartData.push({ t: currentTime, p: tick.price });
               lastChartSampleTime = currentTime;
            }

            // Sync BTC ticks in THIS chunk
            while (btcIdx < btcTicks.length && btcTicks[btcIdx].recorded_at.getTime() <= currentTime) {
                const bTick = btcTicks[btcIdx];
                btcFilter.addTick('BTCUSDT', bTick.price, 0, 14400, bTick.volume);
                btcIdx++;
            }

            // --- EXIT LOGIC ---
            if (position) {
                const exit = checkTrailingStop(tick.price, position.entryPrice, position.highWaterMark, 'BULL', strategyConfig);
                if (exit && exit.shouldSell) {
                    const exitPrice = tick.price;
                    
                    // Apply SELL fee
                    const sellFee = (position.quantity * exitPrice) * FEE_RATE;
                    totalFeesPaid += sellFee;
                    
                    const grossRoi = (exitPrice - position.entryPrice) / position.entryPrice;
                    const grossPnl = grossRoi * (position.quantity * position.entryPrice);
                    const netPnl = grossPnl - sellFee; 
                    
                    // Update equity with net result
                    // Note: We already paid the BUY fee at entry, so we just add the price diff and subtract the sell fee
                    equity = (equity + grossPnl) - sellFee;

                    trades.push({
                        symbol,
                        side: 'SELL',
                        price: exitPrice,
                        quantity: position.quantity,
                        entryPrice: position.entryPrice,
                        pnl: netPnl,
                        roi: netPnl / (position.quantity * position.entryPrice),
                        equity,
                        fee: sellFee,
                        reason: exit.reason || 'MANUAL',
                        timestamp: tick.recorded_at.toISOString(),
                        holdTime: (currentTime - position.entryTimestamp) / (60 * 1000)
                    });
                    position = null;
                    consecutiveBulls = 0;
                } else {
                    position.highWaterMark = Math.max(position.highWaterMark, tick.price);
                }
            }

            // --- ENTRY LOGIC ---
            if (currentTime - lastEvalTime >= EVAL_INTERVAL_MS) {
                lastEvalTime = currentTime;

                if (!position) {
                    const history = filter.getHistory(symbol);
                    if (history && history.length >= 60) {
                        const lastPrice = history[history.length - 1].price;
                        const { micro: regime, macro: macroRegime } = filter.getRegime(symbol, strategyConfig);
                        const rsi5m = calculateRSI(history, 14, 300);
                        const scaledConfig = getScaledConfig(symbol, history, strategyConfig);

                        const { micro: btcRegime, macroDiff: btcMacroDiff } = btcFilter.getRegime('BTCUSDT', STRATEGIES.SNIPER);

                        const entryCheck = shouldEnter(
                            symbol, regime, false, btcRegime, 
                            [{ symbol }], history, lastPrice, 
                            btcMacroDiff || 0, scaledConfig, macroRegime, 
                            isDecoupled, true, rsi5m, null
                        );

                        if (entryCheck === true) {
                            consecutiveBulls++;
                            if (consecutiveBulls >= 2) {
                                // Assume 1000 USDT per trade (or current equity if less)
                                const tradeValue = Math.min(1000, equity);
                                
                                // Apply BUY fee immediately
                                const buyFee = tradeValue * FEE_RATE;
                                totalFeesPaid += buyFee;
                                equity -= buyFee;

                                const quantity = tradeValue / lastPrice;
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
                                    equity,
                                    fee: buyFee,
                                    timestamp: tick.recorded_at.toISOString(),
                                    reason: 'SIGNAL'
                                });
                            }
                        } else {
                            consecutiveBulls = 0;
                        }
                    }
                }
            }
        }
        ticksProcessed += ticks.length;

        // --- Interim Stream Update ---
        if (onUpdate && firstTick) {
            const progress = Math.round(((currentMs - startMs) / (endMs - startMs)) * 100);
            
            // Calculate interim stats
            const sellTrades = trades.filter(t => t.side === 'SELL');
            const wins = sellTrades.filter(t => t.pnl > 0).length;
            const winRate = sellTrades.length > 0 ? (wins / sellTrades.length) * 100 : 0;

            let currentUnrealizedRoi = 0;
            if (position && lastTick) {
                currentUnrealizedRoi = (lastTick.price - position.entryPrice) / position.entryPrice;
            }
            const currentFinalEquity = equity * (1 + currentUnrealizedRoi);

            onUpdate(progress, {
                symbol,
                strategy: strategyName,
                totalTrades: sellTrades.length,
                winRate,
                finalEquity: currentFinalEquity,
                totalFees: totalFeesPaid,
                totalPnl: currentFinalEquity - initialEquity,
                totalRoi: (currentFinalEquity - initialEquity) / initialEquity,
                trades: [...trades],
                chartData: [...chartData],
                range: {
                    start: firstTick.recorded_at.toISOString(),
                    end: lastTick.recorded_at.toISOString(),
                    ticksProcessed
                }
            });
        }
    }

    if (!firstTick) {
        return { error: 'No live tick data found in the selected range.' };
    }

    // 4. Final Calculation
    const finalSellTrades = trades.filter(t => t.side === 'SELL');
    const finalWins = finalSellTrades.filter(t => t.pnl > 0).length;
    const finalWinRate = finalSellTrades.length > 0 ? (finalWins / finalSellTrades.length) * 100 : 0;
    
    let finalUnrealizedRoi = 0;
    if (position && lastTick) {
        finalUnrealizedRoi = (lastTick.price - position.entryPrice) / position.entryPrice;
    }
    const absoluteFinalEquity = equity * (1 + finalUnrealizedRoi);
    
    const results = {
        symbol,
        strategy: strategyName,
        totalTrades: finalSellTrades.length,
        winRate: finalWinRate,
        finalEquity: absoluteFinalEquity,
        totalFees: totalFeesPaid,
        totalPnl: absoluteFinalEquity - initialEquity,
        totalRoi: (absoluteFinalEquity - initialEquity) / initialEquity,
        trades: trades,
        chartData: chartData,
        range: {
            start: firstTick.recorded_at.toISOString(),
            end: lastTick.recorded_at.toISOString(),
            ticksProcessed
        }
    };

    if (onUpdate) onUpdate(100, results);
    return results;
}
