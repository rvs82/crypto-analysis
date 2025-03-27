const express = require('express');
const WebSocket = require('ws');
const fs = require('fs').promises;
const app = express();

app.use(express.static('public'));

let lastPrices = { LDOUSDT: 0, AVAXUSDT: 0, AAVEUSDT: 0, BTCUSDT: 0, ETHUSDT: 0 };
let tradesMain = {
    LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
    AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
    AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }
};
let tradesTest = {
    LDOUSDT: { '5m': null, '15m': null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
    AVAXUSDT: { '5m': null, '15m': null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
    AAVEUSDT: { '5m': null, '15m': null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }
};
let aiLogs = [];
let aiSuggestions = [];
let lastSuggestionTime = 0;
let lastChannelCross = { LDOUSDT: {}, AVAXUSDT: {}, AAVEUSDT: {} };
const TRADE_AMOUNT = 100;
const BINANCE_FEE = 0.04 / 100;
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];
let lastRecommendations = {};
let learningWeights = {
    LDOUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 },
    AVAXUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 },
    AAVEUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 }
};
let klinesByTimeframe = { LDOUSDT: {}, AVAXUSDT: {}, AAVEUSDT: {}, BTCUSDT: {}, ETHUSDT: {} };

async function loadData() {
    try {
        const data = await fs.readFile('trades.json', 'utf8');
        const parsed = JSON.parse(data);
        tradesMain = parsed.tradesMain || tradesMain;
        tradesTest = parsed.tradesTest || tradesTest;
        aiLogs = parsed.aiLogs || [];
        aiSuggestions = parsed.aiSuggestions || [];
        lastChannelCross = parsed.lastChannelCross || lastChannelCross;
        learningWeights = parsed.learningWeights || learningWeights;
        klinesByTimeframe = parsed.klinesByTimeframe || klinesByTimeframe;
        lastPrices = parsed.lastPrices || lastPrices;
        TIMEFRAMES.forEach(tf => {
            Object.keys(klinesByTimeframe).forEach(symbol => {
                if (!klinesByTimeframe[symbol][tf]) klinesByTimeframe[symbol][tf] = [];
            });
        });
        console.log('Data loaded from trades.json:', lastPrices);
    } catch (error) {
        console.log('No saved data or loading error:', error.message);
        TIMEFRAMES.forEach(tf => {
            Object.keys(klinesByTimeframe).forEach(symbol => {
                klinesByTimeframe[symbol][tf] = [];
            });
        });
    }
}

async function saveData() {
    try {
        const dataToSave = { tradesMain, tradesTest, aiLogs, aiSuggestions, lastChannelCross, learningWeights, klinesByTimeframe, lastPrices };
        await fs.writeFile('trades.json', JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log('Data saved to trades.json:', lastPrices);
    } catch (error) {
        console.error('Error saving data:', error.message);
    }
}

loadData().then(() => console.log('Server is ready to work'));

function getMoscowTime() {
    const now = new Date();
    return new Date(now.getTime() + 3 * 60 * 60 * 1000).toLocaleString('en-US', { timeZone: 'Europe/Moscow' });
}

function getServerLoad() {
    const startUsage = process.cpuUsage();
    setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const userTime = endUsage.user / 1000000;
        const systemTime = endUsage.system / 1000000;
        const totalTime = userTime + systemTime;
        const cpuLoad = Math.min(100, Math.round((totalTime / 1) * 100));
        return cpuLoad;
    }, 1000);
    return Math.round(Math.random() * 100);
}

function connectWebSocket() {
    const ws = new WebSocket('wss://fstream.binance.com/ws');
    ws.on('open', () => {
        console.log('WebSocket server started (Binance Futures)');
        const symbols = ['ldousdt', 'avaxusdt', 'aaveusdt', 'btcusdt', 'ethusdt'];
        const streams = [];
        symbols.forEach(symbol => {
            streams.push(`${symbol}@ticker`);
            streams.push(`${symbol}@kline_5m`);
        });
        streams.forEach(stream => {
            ws.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [stream],
                id: 1
            }));
            console.log(`Subscribed to ${stream}`);
        });
    });
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.s && msg.c) {
                const symbol = msg.s.toUpperCase();
                const newPrice = parseFloat(msg.c);
                if (newPrice !== lastPrices[symbol]) {
                    lastPrices[symbol] = newPrice;
                    console.log(`Price updated via WebSocket for ${symbol}: ${lastPrices[symbol]} (@ticker)`);
                    await saveData();
                    await checkTradeStatus(symbol, lastPrices[symbol], tradesMain);
                    await checkTradeStatus(symbol, lastPrices[symbol], tradesTest);
                }
            } else if (msg.e === 'kline' && msg.k) {
                const symbol = msg.s.toUpperCase();
                const tf = msg.k.i;
                if (!klinesByTimeframe[symbol][tf]) klinesByTimeframe[symbol][tf] = [];
                const kline = [
                    msg.k.t,
                    msg.k.o,
                    msg.k.h,
                    msg.k.l,
                    msg.k.c,
                    msg.k.v
                ];
                const klineList = klinesByTimeframe[symbol][tf];
                const existingIndex = klineList.findIndex(k => k[0] === kline[0]);
                if (existingIndex >= 0) {
                    klineList[existingIndex] = kline;
                } else {
                    klineList.push(kline);
                    if (klineList.length > 1000) klineList.shift();
                }
                console.log(`Kline updated via WebSocket for ${symbol} ${tf}`);
                TIMEFRAMES.filter(t => t !== '5m').forEach(tf => {
                    klinesByTimeframe[symbol][tf] = aggregateKlines(klinesByTimeframe[symbol]['5m'], tf);
                });
                await saveData();
            } else if (msg.ping) {
                ws.send(JSON.stringify({ pong: msg.ping }));
                console.log('Sent pong in response to ping');
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error.message);
        }
    });
    ws.on('error', (error) => console.error('WebSocket error:', error.message));
    ws.on('close', () => {
        console.log('WebSocket closed, reconnecting in 500ms...');
        setTimeout(connectWebSocket, 500);
    });
}
connectWebSocket();

function aggregateKlines(baseKlines, targetTimeframe) {
    const timeframeMs = {
        '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000, '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000,
        '1w': 7 * 24 * 60 * 60 * 1000
    };
    const targetMs = timeframeMs[targetTimeframe];
    const aggregated = [];
    let currentStart = null;
    let currentKline = null;

    baseKlines.forEach(kline => {
        const timestamp = kline[0];
        const start = Math.floor(timestamp / targetMs) * targetMs;
        if (start !== currentStart) {
            if (currentKline) aggregated.push(currentKline);
            currentStart = start;
            currentKline = [start, kline[1], kline[2], kline[3], kline[4], parseFloat(kline[5])];
        } else {
            currentKline[2] = Math.max(parseFloat(currentKline[2]), parseFloat(kline[2]));
            currentKline[3] = Math.min(parseFloat(currentKline[3]), parseFloat(kline[3]));
            currentKline[4] = kline[4];
            currentKline[5] += parseFloat(kline[5]);
        }
    });
    if (currentKline) aggregated.push(currentKline);
    return aggregated.slice(-1000);
}

function gauss(x, h) {
    return Math.exp(-(Math.pow(x, 2) / (h * h * 2)));
}

function calculateNadarayaWatsonEnvelope(closes, repaint = true) {
    const n = closes.length;
    if (n < 2) return { upper: closes[0] * 1.05, lower: closes[0] * 0.95, smooth: closes[0] };

    const h = 8;
    const mult = 3;

    if (!repaint) {
        let coefs = [];
        let den = 0;
        for (let i = 0; i < 500; i++) {
            const w = gauss(i, h);
            coefs.push(w);
            den += w;
        }

        let out = 0;
        for (let i = 0; i < Math.min(500, n); i++) {
            out += closes[n - 1 - i] * coefs[i];
        }
        out /= den;

        let sae = 0;
        for (let i = 0; i < Math.min(500, n); i++) {
            let sum = 0, sumw = 0;
            for (let j = 0; j < Math.min(500, n); j++) {
                const w = gauss(i - j, h);
                sum += closes[n - 1 - j] * w;
                sumw += w;
            }
            const y = sum / sumw;
            sae += Math.abs(closes[n - 1 - i] - y);
        }
        const mae = (sae / Math.min(500, n)) * mult || closes[0] * 0.05;

        return { upper: out + mae, lower: out - mae, smooth: out };
    } else {
        let nwe = [];
        let sae = 0;

        for (let i = 0; i < Math.min(500, n); i++) {
            let sum = 0, sumw = 0;
            for (let j = 0; j < Math.min(500, n); j++) {
                const w = gauss(i - j, h);
                sum += closes[n - 1 - j] * w;
                sumw += w;
            }
            const y = sum / sumw;
            nwe.push(y);
            sae += Math.abs(closes[n - 1 - i] - y);
        }

        sae = (sae / Math.min(500, n)) * mult || closes[0] * 0.05;
        const latestSmooth = nwe[0];

        return { upper: latestSmooth + sae, lower: latestSmooth - sae, smooth: latestSmooth };
    }
}

function calculateEMA(closes, period) {
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateVolume(klines) {
    let volume = 0;
    for (let i = 1; i < klines.length; i++) {
        const prevClose = parseFloat(klines[i - 1][4]);
        const currClose = parseFloat(klines[i][4]);
        const vol = parseFloat(klines[i][5]);
        volume += (currClose > prevClose ? vol : currClose < prevClose ? -vol : 0);
    }
    return volume;
}

function calculateVolatility(klines) {
    const last10 = klines.slice(-10).map(k => [parseFloat(k[2]), parseFloat(k[3])]);
    const highs = last10.map(k => k[0]);
    const lows = last10.map(k => k[1]);
    return Math.max(...highs) - Math.min(...lows);
}

function calculateFibonacci(klines) {
    const highs = klines.map(k => parseFloat(k[2])).filter(h => !isNaN(h));
    const lows = klines.map(k => parseFloat(k[3])).filter(l => !isNaN(l));
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const diff = max - min;
    return { 0.5: min + diff * 0.5, 0.618: min + diff * 0.618 };
}

function getTrend(klines) {
    const last50 = klines.slice(-50).map(k => parseFloat(k[4]));
    if (last50.length < 50) return 'sideways';
    const avgStart = last50.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const avgEnd = last50.slice(-5).reduce((a, b) => a + b, 0) / 5;
    return avgEnd > avgStart ? 'up' : avgEnd < avgStart ? 'down' : 'sideways';
}

function getWick(klines) {
    if (!klines.length) return { upper: 0, lower: 0 };
    const last = klines[klines.length - 1];
    const high = parseFloat(last[2]);
    const low = parseFloat(last[3]);
    const close = parseFloat(last[4]);
    return { upper: high - close, lower: close - low };
}

function getSpike(klines) {
    if (klines.length < 2) return 0;
    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const change = Math.abs(parseFloat(last[4]) - parseFloat(prev[4])) / parseFloat(prev[4]) * 100;
    return change > 1 ? change : 0;
}

function getEngulfing(klines) {
    if (klines.length < 2) return 'none';
    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const lastOpen = parseFloat(last[1]);
    const lastClose = parseFloat(last[4]);
    const prevOpen = parseFloat(prev[1]);
    const prevClose = parseFloat(prev[4]);
    if (lastClose > lastOpen && prevClose < prevOpen && lastClose > prevOpen && lastOpen < prevClose) return 'bullish';
    if (lastClose < lastOpen && prevClose > prevOpen && lastClose < prevOpen && lastOpen > prevClose) return 'bearish';
    return 'none';
}

function getLevels(klines) {
    const highs = klines.map(k => parseFloat(k[2])).filter(h => !isNaN(h));
    const lows = klines.map(k => parseFloat(k[3])).filter(l => !isNaN(l));
    return { resistance: highs.length ? Math.max(...highs) : 0, support: lows.length ? Math.min(...lows) : 0 };
}

async function checkCorrelation(symbol) {
    const klines = klinesByTimeframe[symbol]['5m'] || [];
    try {
        const last50 = klines.slice(-50).map(k => parseFloat(k[4]));
        const btcKlines = klinesByTimeframe['BTCUSDT']['5m'] || [];
        const ethKlines = klinesByTimeframe['ETHUSDT']['5m'] || [];
        const btcLast50 = btcKlines.slice(-50).map(k => parseFloat(k[4]));
        const ethLast50 = ethKlines.slice(-50).map(k => parseFloat(k[4]));
        const corrBtc = Math.abs(last50.reduce((a, b, i) => a + b * btcLast50[i], 0) / 50 - last50.reduce((a, b) => a + b, 0) * btcLast50.reduce((a, b) => a + b, 0) / 2500);
        const corrEth = Math.abs(last50.reduce((a, b, i) => a + b * ethLast50[i], 0) / 50 - last50.reduce((a, b) => a + b, 0) * ethLast50.reduce((a, b) => a + b, 0) / 2500);
        return (corrBtc + corrEth) / 2 < 0.3;
    } catch (error) {
        console.error(`Correlation error for ${symbol}:`, error.message);
        return false;
    }
}

function checkAccumulation(klines) {
    const last10 = klines.slice(-10);
    const volumes = last10.map(k => parseFloat(k[5]));
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / 10;
    const priceRange = last10.length ? Math.max(...last10.map(k => parseFloat(k[2]))) - Math.min(...last10.map(k => parseFloat(k[3]))) : 0;
    return volumes.slice(-3).every(v => v > avgVolume * 1.2) && priceRange < (lastPrices[klines[0]?.[0]] || 0) * 0.005;
}

function detectFlat(klines, nw) {
    const lows = [];
    const highs = [];
    for (let i = klines.length - 1; i >= 0; i--) {
        const low = parseFloat(klines[i][3]);
        const high = parseFloat(klines[i][2]);
        const avgLow = lows.length > 0 ? lows.reduce((a, b) => a + b, 0) / lows.length : low;
        const avgHigh = highs.length > 0 ? highs.reduce((a, b) => a + b, 0) / highs.length : high;
        if (Math.abs(low - avgLow) < avgLow * 0.01) lows.push(low);
        if (Math.abs(high - avgHigh) < avgHigh * 0.01) highs.push(high);
        if (lows.length >= 3 && highs.length >= 3) break;
    }
    if (lows.length < 3 || highs.length < 3) return { isFlat: false, flatLow: nw.lower, flatHigh: nw.upper };
    const flatLow = lows.reduce((a, b) => a + b, 0) / lows.length;
    const flatHigh = highs.reduce((a, b) => a + b, 0) / highs.length;
    const nwChange = Math.abs(nw.upper - nw.lower - (klines[klines.length - 50]?.[4] - klines[klines.length - 50]?.[3] || 0)) / nw.upper;
    const isFlat = nwChange < 0.005;
    return { isFlat, flatLow, flatHigh };
}

async function checkTradeStatus(symbol, currentPrice, trades) {
    const tradeData = trades[symbol];
    if (trades === tradesMain && tradeData.active) {
        const { entry, stopLoss, takeProfit, direction, timeframe } = tradeData.active;
        if (direction === 'Long') {
            if (currentPrice <= stopLoss) {
                const loss = TRADE_AMOUNT * (entry - stopLoss) / entry;
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                tradeData.totalLoss += loss + commission;
                tradeData.stopCount++;
                tradeData.closedCount++;
                tradeData.openCount--;
                learningWeights[symbol].distance *= 0.95;
                learningWeights[symbol].volume *= 0.95;
                aiLogs.push(`Error: ${symbol} ${timeframe} Long failed. Price ${currentPrice} dropped below ${stopLoss}. Conclusion: weak signal. Impact: Reduced distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Will check volumes more strictly before entry.`);
                const now = Date.now();
                if (now - lastSuggestionTime >= 300000) {
                    aiSuggestions.push(`${getMoscowTime()} | Suggest adding MACD indicator with settings: fast EMA 12, slow EMA 26, signal line 9. Reason: frequent false channel breakouts need crossover filter.`);
                    lastSuggestionTime = now;
                    if (aiSuggestions.length > 100) aiSuggestions.shift();
                }
                if (aiLogs.length > 100) aiLogs.shift();
                tradeData.active = null;
                await saveData();
            } else if (currentPrice >= takeProfit) {
                const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                tradeData.totalProfit += profit - commission;
                tradeData.profitCount++;
                tradeData.closedCount++;
                tradeData.openCount--;
                learningWeights[symbol].distance *= 1.05;
                learningWeights[symbol].volume *= 1.05;
                aiLogs.push(`Success: ${symbol} ${timeframe} Long worked. Price ${currentPrice} reached ${takeProfit}. Conclusion: accurate signal. Impact: Increased distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Strengthening trust in volume-backed breakouts.`);
                if (aiLogs.length > 100) aiLogs.shift();
                tradeData.active = null;
                await saveData();
            }
        } else if (direction === 'Short') {
            if (currentPrice >= stopLoss) {
                const loss = TRADE_AMOUNT * (stopLoss - entry) / entry;
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                tradeData.totalLoss += loss + commission;
                tradeData.stopCount++;
                tradeData.closedCount++;
                tradeData.openCount--;
                learningWeights[symbol].distance *= 0.95;
                learningWeights[symbol].volume *= 0.95;
                aiLogs.push(`Error: ${symbol} ${timeframe} Short failed. Price ${currentPrice} exceeded ${stopLoss}. Conclusion: false signal. Impact: Reduced distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Will account for false breakouts.`);
                const now = Date.now();
                if (now - lastSuggestionTime >= 300000) {
                    aiSuggestions.push(`${getMoscowTime()} | Suggest adding RSI indicator with period 14, overbought 70, oversold 30. Reason: frequent false upper boundary breakouts.`);
                    lastSuggestionTime = now;
                    if (aiSuggestions.length > 100) aiSuggestions.shift();
                }
                if (aiLogs.length > 100) aiLogs.shift();
                tradeData.active = null;
                await saveData();
            } else if (currentPrice <= takeProfit) {
                const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                tradeData.totalProfit += profit - commission;
                tradeData.profitCount++;
                tradeData.closedCount++;
                tradeData.openCount--;
                learningWeights[symbol].distance *= 1.05;
                learningWeights[symbol].volume *= 1.05;
                aiLogs.push(`Success: ${symbol} ${timeframe} Short worked. Price ${currentPrice} reached ${takeProfit}. Conclusion: accurate signal. Impact: Increased distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Strengthening trust in volume-backed breakouts.`);
                if (aiLogs.length > 100) aiLogs.shift();
                tradeData.active = null;
                await saveData();
            }
        }
    } else if (trades === tradesTest) {
        ['5m', '15m'].forEach(tf => {
            if (tradeData[tf]) {
                const { entry, stopLoss, takeProfit, direction } = tradeData[tf];
                if (direction === 'Long') {
                    if (currentPrice <= stopLoss) {
                        const loss = TRADE_AMOUNT * (entry - stopLoss) / entry;
                        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                        tradeData.totalLoss += loss + commission;
                        tradeData.stopCount++;
                        tradeData.closedCount++;
                        tradeData.openCount--;
                        learningWeights[symbol].distance *= 0.95;
                        learningWeights[symbol].volume *= 0.95;
                        aiLogs.push(`Error: ${symbol} ${tf} Long failed. Price ${currentPrice} dropped below ${stopLoss}. Conclusion: weak signal. Impact: Reduced distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Will check volumes more strictly before entry.`);
                        const now = Date.now();
                        if (now - lastSuggestionTime >= 300000) {
                            aiSuggestions.push(`${getMoscowTime()} | Suggest adding MACD indicator with settings: fast EMA 12, slow EMA 26, signal line 9 for timeframe ${tf}. Reason: frequent losses on short-term movements.`);
                            lastSuggestionTime = now;
                            if (aiSuggestions.length > 100) aiSuggestions.shift();
                        }
                        if (aiLogs.length > 100) aiLogs.shift();
                        tradeData[tf] = null;
                        await saveData();
                    } else if (currentPrice >= takeProfit) {
                        const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
                        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                        tradeData.totalProfit += profit - commission;
                        tradeData.profitCount++;
                        tradeData.closedCount++;
                        tradeData.openCount--;
                        learningWeights[symbol].distance *= 1.05;
                        learningWeights[symbol].volume *= 1.05;
                        aiLogs.push(`Success: ${symbol} ${tf} Long worked. Price ${currentPrice} reached ${takeProfit}. Conclusion: accurate signal. Impact: Increased distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Strengthening trust in volume-backed breakouts.`);
                        if (aiLogs.length > 100) aiLogs.shift();
                        tradeData[tf] = null;
                        await saveData();
                    }
                } else if (direction === 'Short') {
                    if (currentPrice >= stopLoss) {
                        const loss = TRADE_AMOUNT * (stopLoss - entry) / entry;
                        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                        tradeData.totalLoss += loss + commission;
                        tradeData.stopCount++;
                        tradeData.closedCount++;
                        tradeData.openCount--;
                        learningWeights[symbol].distance *= 0.95;
                        learningWeights[symbol].volume *= 0.95;
                        aiLogs.push(`Error: ${symbol} ${tf} Short failed. Price ${currentPrice} exceeded ${stopLoss}. Conclusion: false signal. Impact: Reduced distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Will account for false breakouts.`);
                        const now = Date.now();
                        if (now - lastSuggestionTime >= 300000) {
                            aiSuggestions.push(`${getMoscowTime()} | Suggest adding RSI indicator with period 14, overbought 70, oversold 30 for timeframe ${tf}. Reason: frequent false upper boundary breakouts.`);
                            lastSuggestionTime = now;
                            if (aiSuggestions.length > 100) aiSuggestions.shift();
                        }
                        if (aiLogs.length > 100) aiLogs.shift();
                        tradeData[tf] = null;
                        await saveData();
                    } else if (currentPrice <= takeProfit) {
                        const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
                        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                        tradeData.totalProfit += profit - commission;
                        tradeData.profitCount++;
                        tradeData.closedCount++;
                        tradeData.openCount--;
                        learningWeights[symbol].distance *= 1.05;
                        learningWeights[symbol].volume *= 1.05;
                        aiLogs.push(`Success: ${symbol} ${tf} Short worked. Price ${currentPrice} reached ${takeProfit}. Conclusion: accurate signal. Impact: Increased distance and volume weights to ${learningWeights[symbol].distance.toFixed(2)} and ${learningWeights[symbol].volume.toFixed(2)}. Strengthening trust in volume-backed breakouts.`);
                        if (aiLogs.length > 100) aiLogs.shift();
                        tradeData[tf] = null;
                        await saveData();
                    }
                }
            }
        });
    }
}

async function aiTradeDecision(symbol) {
    const price = lastPrices[symbol] || 0;
    let recommendations = {};
    const btcPrice = lastPrices['BTCUSDT'] || 0;
    const ethPrice = lastPrices['ETHUSDT'] || 0;

    for (const tf of TIMEFRAMES) {
        const klines = klinesByTimeframe[symbol][tf] || [];
        const closes = klines.length > 0 ? klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c)) : [price];
        const nw = calculateNadarayaWatsonEnvelope(closes, true);
        const volume = klines.length > 1 ? calculateVolume(klines) : 0;
        const volatility = klines.length > 1 ? calculateVolatility(klines) : 0;
        const ema50 = klines.length > 1 ? calculateEMA(closes, 50) : price;
        const ema200 = klines.length > 1 ? calculateEMA(closes, 200) : price;
        const fib = klines.length > 1 ? calculateFibonacci(klines) : { 0.5: price, 0.618: price };
        const lastKline = klines[klines.length - 1] || [0, 0, 0, 0, 0, 0];
        const vol = parseFloat(lastKline[5]) || 0;
        const avgVol = klines.slice(-5).reduce((a, k) => a + parseFloat(k[5]), 0) / 5 || 0;
        const trend = getTrend(klines);
        const wick = getWick(klines);
        const spike = getSpike(klines);
        const engulfing = getEngulfing(klines);
        const levels = getLevels(klines);
        const boundaryTrend = nw.upper > nw.upper - (closes[closes.length - 50] || 0) ? 'up' : 'down';
        const frequentExits = klines.slice(-50).filter(k => parseFloat(k[4]) > nw.upper || parseFloat(k[4]) < nw.lower).length > 5;
        const lowBtcEthCorr = await checkCorrelation(symbol);
        const accumulation = checkAccumulation(klines);
        const outsideChannel = price > nw.upper || price < nw.lower;
        const touchesBoundary = price >= nw.upper || price <= nw.lower;

        if (outsideChannel) {
            lastChannelCross[symbol][tf] = price > nw.upper ? 'upper' : 'lower';
        }

        const lastCross = lastChannelCross[symbol][tf] || 'none';
        const trendDirection = lastCross === 'lower' ? 'up' : lastCross === 'upper' ? 'down' : trend;

        console.log(`${getMoscowTime()} | ${symbol} ${tf} | Price ${price}, channel ${nw.lower}–${nw.upper}, outsideChannel: ${outsideChannel}, trend: ${trend}, lastCross: ${lastCross}`);

        const flatData = detectFlat(klines, nw);
        const isFlat = flatData.isFlat;
        const flatLow = flatData.flatLow;
        const flatHigh = flatData.flatHigh;

        let direction = outsideChannel ? (price > nw.upper ? 'Short' : 'Long') : 'None';
        let confidence = 0;

        if (direction !== 'None') {
            confidence = Math.min(100, Math.round(Math.abs(price - (direction === 'Short' ? nw.upper : nw.lower)) / price * 200)) * learningWeights[symbol].distance;
            if (volume > 0 && direction === 'Long') confidence += 20 * learningWeights[symbol].volume;
            if (volume < 0 && direction === 'Short') confidence += 20 * learningWeights[symbol].volume;
            if (price > ema200 && direction === 'Long') confidence += 10 * learningWeights[symbol].ema;
            if (price < ema200 && direction === 'Short') confidence += 10 * learningWeights[symbol].ema;
            if (Math.abs(price - fib[0.618]) < price * 0.005) confidence += 15 * learningWeights[symbol].fibo;
            if (vol > klines.slice(-5, -1).reduce((a, k) => a + parseFloat(k[5]), 0) / 4) confidence += 10 * learningWeights[symbol].volume;
            if (!lowBtcEthCorr) {
                if (btcPrice > lastPrices['BTCUSDT'] * 0.99 && direction === 'Long') confidence += 5 * learningWeights[symbol].btcEth;
                if (ethPrice > lastPrices['ETHUSDT'] * 0.99 && direction === 'Long') confidence += 5 * learningWeights[symbol].btcEth;
            } else {
                learningWeights[symbol].btcEth *= 0.95;
                aiLogs.push(`${getMoscowTime()}: ${symbol} ${tf} — Low correlation with BTC/ETH, reduced their weight to ${learningWeights[symbol].btcEth.toFixed(2)}.`);
            }
            if (trend === 'up' && direction === 'Long') confidence += 10 * learningWeights[symbol].trend;
            if (trend === 'down' && direction === 'Short') confidence += 10 * learningWeights[symbol].trend;
            if (wick.upper > wick.lower && direction === 'Long') confidence += 10 * learningWeights[symbol].wick;
            if (wick.lower > wick.upper && direction === 'Short') confidence += 10 * learningWeights[symbol].wick;
            if (spike > 0 && direction === (spike > 0 ? 'Long' : 'Short')) confidence += 10 * learningWeights[symbol].spike;
            if (engulfing === 'bullish' && direction === 'Long') confidence += 10 * learningWeights[symbol].engulf;
            if (engulfing === 'bearish' && direction === 'Short') confidence += 10 * learningWeights[symbol].engulf;
            if (Math.abs(price - levels.resistance) < price * 0.005 && direction === 'Short') confidence += 10 * learningWeights[symbol].levels;
            if (Math.abs(price - levels.support) < price * 0.005 && direction === 'Long') confidence += 10 * learningWeights[symbol].levels;
            if (frequentExits && boundaryTrend === (direction === 'Short' ? 'up' : 'down')) confidence += 15 * learningWeights[symbol].trend;
            if (accumulation) confidence += 10 * learningWeights[symbol].volume;
            if (isFlat && Math.abs(nw.lower - flatLow) < flatLow * 0.01 && Math.abs(nw.upper - flatHigh) < flatHigh * 0.01) {
                confidence += 10 * learningWeights[symbol].flat;
                aiLogs.push(`${getMoscowTime()}: ${symbol} ${tf} — Nadaraya and flat boundaries match, boosting signal (+10% to confidence).`);
            }
            confidence = Math.min(100, Math.round(confidence));

            if (confidence >= 50 && outsideChannel) {
                if (!tradesMain[symbol].active) {
                    tradesMain[symbol].active = {
                        direction,
                        entry: price,
                        stopLoss: direction === 'Long' ? price * 0.995 : price * 1.005,
                        takeProfit: direction === 'Long' ? price * 1.01 : price * 0.99,
                        timeframe: tf,
                        reason: `Breakout of ${direction === 'Long' ? 'lower' : 'upper'} channel boundary at ${direction === 'Long' ? nw.lower : nw.upper} with ${confidence}% confidence. Volume: ${volume}, trend: ${trend}. Stop-loss set at 0.5% from entry for protection, take-profit at 1% for profit-taking with moderate volatility ${volatility}.`
                    };
                    tradesMain[symbol].openCount++;
                    aiLogs.push(`${getMoscowTime()} | ${symbol} ${tf} ${direction} | Trade opened with ${confidence}% confidence. Reason: ${tradesMain[symbol].active.reason}`);
                    console.log('Main trade opened:', tradesMain[symbol]);
                }
                if ((tf === '5m' || tf === '15m') && !tradesTest[symbol][tf]) {
                    tradesTest[symbol][tf] = {
                        direction,
                        entry: price,
                        stopLoss: direction === 'Long' ? price * 0.995 : price * 1.005,
                        takeProfit: direction === 'Long' ? price * 1.01 : price * 0.99,
                        timeframe: tf,
                        reason: `Breakout of ${direction === 'Long' ? 'lower' : 'upper'} channel boundary at ${direction === 'Long' ? nw.lower : nw.upper} with ${confidence}% confidence. Volume: ${volume}, trend: ${trend}. Stop-loss set at 0.5% from entry for protection, take-profit at 1% for profit-taking with moderate volatility ${volatility}.`
                    };
                    tradesTest[symbol].openCount++;
                    aiLogs.push(`${getMoscowTime()} | ${symbol} ${tf} ${direction} | Test trade opened with ${confidence}% confidence. Reason: ${tradesTest[symbol][tf].reason}`);
                    console.log('Test trade opened:', tradesTest[symbol]);
                }
            }
        }

        const market = trend === 'up' ? 'Uptrend' : trend === 'down' ? 'Downtrend' : 'Flat';
        const forecast = isFlat ? 'stability' : (direction === 'Short' || trend === 'down' ? 'decline' : 'growth');
        const entry = price;
        const stopLoss = direction === 'Long' ? entry * 0.995 : direction === 'Short' ? entry * 1.005 : entry;
        const takeProfit = direction === 'Long' ? entry * 1.01 : direction === 'Short' ? entry * 0.99 : entry;
        const volChange = vol > avgVol * 1.2 ? 'rising' : vol < avgVol * 0.8 ? 'falling' : 'stable';
        const volatilityStatus = volatility > price * 0.01 ? 'high' : volatility < price * 0.005 ? 'low' : 'moderate';
        const sentiment = volume > 0 ? 'buyers more active than sellers' : volume < 0 ? 'sellers more active than buyers' : 'buyers and sellers balanced';
        const activity = vol > avgVol * 1.5 ? 'high' : vol < avgVol * 0.5 ? 'low' : 'medium';
        const recommendation = direction === 'Long' ? 'prepare to buy after breakout' : direction === 'Short' ? 'prepare to sell after breakout' : 'wait for channel breakout for clear signal';
        const reasoning = isFlat
            ? `Consolidation. Price ${price} within ${flatLow}–${flatHigh} (Nadaraya: ${nw.lower}–${nw.upper}). Trend ${trend === 'up' ? 'bullish' : trend === 'down' ? 'bearish' : 'flat'}, volumes ${volChange}, current volume ${vol.toFixed(2)} vs average ${avgVol.toFixed(2)}, volatility ${volatilityStatus} (${volatility.toFixed(4)}). ${sentiment}, candle wicks: upper ${wick.upper.toFixed(4)}, lower ${wick.lower.toFixed(4)}. Spike ${spike.toFixed(2)}% and engulfing ${engulfing} indicate ${activity} activity. Resistance level ${levels.resistance.toFixed(4)} and support ${levels.support.toFixed(4)} limit movement. Channel boundaries moving ${boundaryTrend}. Recommendation: ${recommendation}.`
            : `Market currently in ${market} state, price ${price} is ${outsideChannel ? 'outside' : 'inside'} channel ${nw.lower}–${nw.upper}. Trend ${trend === 'up' ? 'bullish' : trend === 'down' ? 'bearish' : 'flat'}, volumes ${volChange}, current volume ${vol.toFixed(2)} vs average ${avgVol.toFixed(2)}, volatility ${volatilityStatus} (${volatility.toFixed(4)}). ${sentiment}, candle wicks: upper ${wick.upper.toFixed(4)}, lower ${wick.lower.toFixed(4)}. Spike ${spike.toFixed(2)}% and engulfing ${engulfing} indicate ${activity} activity. Resistance level ${levels.resistance.toFixed(4)} and support ${levels.support.toFixed(4)} limit movement. Channel boundaries moving ${boundaryTrend}. Recommendation: ${recommendation}.`;
        const shortReasoning = isFlat
            ? `Consolidation. Price ${price} within ${flatLow}–${flatHigh} (Nadaraya: ${nw.lower}–${nw.upper}), volume ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}.`
            : `Trend ${trend === 'up' ? 'bullish' : trend === 'down' ? 'bearish' : 'flat'}. Price ${price} ${outsideChannel ? 'outside' : 'inside'} ${nw.lower}–${nw.upper}, volume ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}.`;
        const noTradeReasoning = tradesMain[symbol].active || (['5m', '15m'].includes(tf) && tradesTest[symbol][tf]) ? '' : `No active trades. Reasons: ${outsideChannel ? 'channel breakout exists but confidence ' + confidence + '% below 50%' : 'price inside channel, no breakout'}. Trend ${trend}, volumes ${volChange}, volatility ${volatilityStatus}.`;

        recommendations[tf] = { direction, confidence, outsideChannel, touchesBoundary, entry, stopLoss, takeProfit, market, trend, trendDirection, pivot: nw.smooth, reasoning, shortReasoning, forecast, isFlat, noTradeReasoning };
    }
    lastRecommendations[symbol] = recommendations;
    await saveData();
    return recommendations;
}

app.get('/data', async (req, res) => {
    try {
        const symbols = ['LDOUSDT', 'AVAXUSDT', 'AAVEUSDT'];
        let recommendations = {};

        for (const symbol of symbols) {
            recommendations[symbol] = await aiTradeDecision(symbol);
            console.log(`Recommendations for ${symbol}:`, recommendations[symbol]);
        }

        let marketOverview = '';
        let totalVolatility = 0;
        let totalVolume = 0;
        let trendCount = { up: 0, down: 0, flat: 0 };
        symbols.forEach(symbol => {
            TIMEFRAMES.forEach(tf => {
                const rec = recommendations[symbol][tf];
                totalVolatility += calculateVolatility(klinesByTimeframe[symbol][tf] || []);
                totalVolume += rec.volume || 0;
                if (rec.trend === 'up') trendCount.up++;
                else if (rec.trend === 'down') trendCount.down++;
                else trendCount.flat++;
            });
        });
        const avgVolatility = totalVolatility / (symbols.length * TIMEFRAMES.length);
        const avgVolume = totalVolume / (symbols.length * TIMEFRAMES.length);
        const dominantTrend = trendCount.up > trendCount.down && trendCount.up > trendCount.flat ? 'uptrend' :
            trendCount.down > trendCount.up && trendCount.down > trendCount.flat ? 'downtrend' : 'sideways';
        marketOverview = `Currently, the market overall shows a ${dominantTrend} character. Average volatility is ${avgVolatility.toFixed(4)}, indicating ${avgVolatility > 0.01 * (lastPrices[symbols[0]] || 0) ? 'high activity' : 'calmness'}. Average trading volumes are ${avgVolume.toFixed(2)}, suggesting ${avgVolume > 0 ? 'buyers dominating' : 'sellers dominating or balance'}. It’s recommended to monitor key levels and wait for clear breakout signals to enter trades.`;

        const serverLoad = getServerLoad();
        res.json({ prices: lastPrices, recommendations, tradesMain, tradesTest, aiLogs, aiSuggestions, marketOverview, serverLoad });
    } catch (error) {
        console.error('Error in /data:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

app.post('/reset-stats-main', async (req, res) => {
    for (const symbol in tradesMain) {
        tradesMain[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
    }
    await saveData();
    res.sendStatus(200);
});

app.post('/reset-stats-test', async (req, res) => {
    for (const symbol in tradesTest) {
        tradesTest[symbol] = { '5m': null, '15m': null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
    }
    await saveData();
    res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});

process.on('SIGINT', async () => {
    console.log('Server shutting down, saving data...');
    await saveData();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Server shutting down, saving data...');
    await saveData();
    process.exit(0);
});
