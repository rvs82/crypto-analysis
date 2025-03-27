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
let orderBookHistory = {
    LDOUSDT: { bids: [], asks: [] },
    AVAXUSDT: { bids: [], asks: [] },
    AAVEUSDT: { bids: [], asks: [] }
};
const TRADE_AMOUNT = 100;
const BINANCE_FEE = 0.04 / 100;
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d'];
const EMA_PERIODS = [50, 200];
const MAX_CANDLES = 500;
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
        orderBookHistory = parsed.orderBookHistory || orderBookHistory;
        TIMEFRAMES.forEach(tf => {
            Object.keys(klinesByTimeframe).forEach(symbol => {
                if (!klinesByTimeframe[symbol][tf]) klinesByTimeframe[symbol][tf] = [];
            });
        });
        console.log('Data loaded from trades.json');
    } catch (error) {
        console.log('No saved data or loading error:', error.message);
        TIMEFRAMES.forEach(tf => {
            Object.keys(klinesByTimeframe).forEach(symbol => {
                klinesByTimeframe[symbol][tf] = [];
            });
        });
    }
}

const throttle = (func, limit) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};
const saveDataThrottled = throttle(async () => {
    try {
        const dataToSave = { tradesMain, tradesTest, aiLogs, aiSuggestions, lastChannelCross, learningWeights, klinesByTimeframe, lastPrices, orderBookHistory };
        await fs.writeFile('trades.json', JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log('Data saved to trades.json');
    } catch (error) {
        console.error('Error saving data:', error.message);
    }
}, 30000);

loadData().then(() => console.log('Server is ready to work'));

function getMoscowTime() {
    const now = new Date();
    return new Date(now.getTime() + 3 * 60 * 60 * 1000).toLocaleString('en-US', { timeZone: 'Europe/Moscow' });
}

function getServerLoad() {
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
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.s && msg.c) {
                const symbol = msg.s.toUpperCase();
                lastPrices[symbol] = parseFloat(msg.c);
                console.log(`Price updated: ${symbol}: ${lastPrices[symbol]}`);
                if (tradesMain[symbol]) checkTradeStatus(symbol, lastPrices[symbol], tradesMain);
                if (tradesTest[symbol]) checkTradeStatus(symbol, lastPrices[symbol], tradesTest);
            } else if (msg.e === 'kline' && msg.k) {
                const symbol = msg.s.toUpperCase();
                const tf = msg.k.i;
                if (!TIMEFRAMES.includes(tf)) return;
                const kline = [msg.k.t, msg.k.o, msg.k.h, msg.k.l, msg.k.c, msg.k.v];
                const klineList = klinesByTimeframe[symbol][tf];
                const existingIndex = klineList.findIndex(k => k[0] === kline[0]);
                if (existingIndex >= 0) klineList[existingIndex] = kline;
                else {
                    klineList.push(kline);
                    if (klineList.length > MAX_CANDLES) klineList.shift();
                }
                TIMEFRAMES.filter(t => t !== '5m').forEach(tf => {
                    klinesByTimeframe[symbol][tf] = aggregateKlines(klinesByTimeframe[symbol]['5m'], tf).slice(-MAX_CANDLES);
                });
                saveDataThrottled();
            } else if (msg.ping) {
                ws.send(JSON.stringify({ pong: msg.ping }));
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error.message);
        }
    });
    ws.on('error', (error) => console.error('WebSocket error:', error.message));
    ws.on('close', () => {
        console.log('WebSocket closed, reconnecting...');
        setTimeout(connectWebSocket, 1000 + Math.random() * 1000);
    });
}

function connectOrderBookWebSocket() {
    const ws = new WebSocket('wss://fstream.binance.com/ws');
    ws.on('open', () => {
        console.log('Order Book WebSocket started');
        const symbols = ['ldousdt', 'avaxusdt', 'aaveusdt'];
        symbols.forEach(symbol => {
            ws.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [`${symbol}@depth20@100ms`],
                id: 2
            }));
            console.log(`Subscribed to ${symbol}@depth20@100ms`);
        });
    });
    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.e === 'depthUpdate' && msg.s) {
            const symbol = msg.s.toUpperCase();
            const bids = msg.b.map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }));
            const asks = msg.a.map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }));
            orderBookHistory[symbol].bids.push(...bids);
            orderBookHistory[symbol].asks.push(...asks);
            if (orderBookHistory[symbol].bids.length > 5000) orderBookHistory[symbol].bids.shift();
            if (orderBookHistory[symbol].asks.length > 5000) orderBookHistory[symbol].asks.shift();
            saveDataThrottled();
        }
    });
    ws.on('error', (error) => console.error('Order Book WebSocket error:', error.message));
    ws.on('close', () => {
        console.log('Order Book WebSocket closed, reconnecting...');
        setTimeout(connectOrderBookWebSocket, 1000 + Math.random() * 1000);
    });
}

function aggregateKlines(baseKlines, targetTimeframe) {
    const timeframeMs = {
        '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000, '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000
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
    return aggregated.slice(-MAX_CANDLES);
}

function gauss(x, h) {
    return Math.exp(-(Math.pow(x, 2) / (h * h * 2)));
}

function calculateNadarayaWatsonEnvelope(closes) {
    const n = Math.min(closes.length, MAX_CANDLES);
    if (n < 2) return { upper: closes[0] * 1.05, lower: closes[0] * 0.95, smooth: closes[0] };
    
    const h = 8;
    const mult = 3;
    let nwe = [], sae = 0;

    for (let i = 0; i < Math.min(499, n); i++) {
        let sum = 0, sumw = 0;
        for (let j = 0; j < Math.min(499, n); j++) {
            const w = gauss(i - j, h);
            sum += closes[n - 1 - j] * w;
            sumw += w;
        }
        const y = sum / sumw;
        nwe.push(y);
        sae += Math.abs(closes[n - 1 - i] - y);
    }

    sae = (sae / Math.min(499, n)) * mult || closes[0] * 0.05;
    const latestSmooth = nwe[0];
    return { upper: latestSmooth + sae, lower: latestSmooth - sae, smooth: latestSmooth };
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

function analyzeOrderBook(symbol) {
    const bids = orderBookHistory[symbol].bids;
    const asks = orderBookHistory[symbol].asks;

    const bidLevels = {};
    const askLevels = {};
    bids.forEach(bid => {
        bidLevels[bid.price] = (bidLevels[bid.price] || 0) + bid.qty;
    });
    asks.forEach(ask => {
        askLevels[ask.price] = (askLevels[ask.price] || 0) + ask.qty;
    });

    const bidPrices = Object.keys(bidLevels).map(parseFloat).sort((a, b) => b - a);
    const askPrices = Object.keys(askLevels).map(parseFloat).sort((a, b) => a - b);
    const support = bidPrices.length ? bidPrices.reduce((max, p) => bidLevels[p] > bidLevels[max] ? p : max, bidPrices[0]) : 0;
    const resistance = askPrices.length ? askPrices.reduce((max, p) => askLevels[p] > askLevels[max] ? p : max, askPrices[0]) : 0;

    return { support, resistance };
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

function checkTradeStatus(symbol, currentPrice, trades) {
    const tradeData = trades[symbol];
    if (trades === tradesMain && tradeData && tradeData.active) {
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
                aiLogs.push(`Error: ${symbol} ${timeframe} Long failed. Price ${currentPrice} dropped below ${stopLoss}.`);
                tradeData.active = null;
                saveDataThrottled();
            } else if (currentPrice >= takeProfit) {
                const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                tradeData.totalProfit += profit - commission;
                tradeData.profitCount++;
                tradeData.closedCount++;
                tradeData.openCount--;
                learningWeights[symbol].distance *= 1.05;
                learningWeights[symbol].volume *= 1.05;
                aiLogs.push(`Success: ${symbol} ${timeframe} Long worked. Price ${currentPrice} reached ${takeProfit}.`);
                tradeData.active = null;
                saveDataThrottled();
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
                aiLogs.push(`Error: ${symbol} ${timeframe} Short failed. Price ${currentPrice} exceeded ${stopLoss}.`);
                tradeData.active = null;
                saveDataThrottled();
            } else if (currentPrice <= takeProfit) {
                const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                tradeData.totalProfit += profit - commission;
                tradeData.profitCount++;
                tradeData.closedCount++;
                tradeData.openCount--;
                learningWeights[symbol].distance *= 1.05;
                learningWeights[symbol].volume *= 1.05;
                aiLogs.push(`Success: ${symbol} ${timeframe} Short worked. Price ${currentPrice} reached ${takeProfit}.`);
                tradeData.active = null;
                saveDataThrottled();
            }
        }
    } else if (trades === tradesTest && tradeData) {
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
                        aiLogs.push(`Error: ${symbol} ${tf} Long failed. Price ${currentPrice} dropped below ${stopLoss}.`);
                        tradeData[tf] = null;
                        saveDataThrottled();
                    } else if (currentPrice >= takeProfit) {
                        const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
                        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                        tradeData.totalProfit += profit - commission;
                        tradeData.profitCount++;
                        tradeData.closedCount++;
                        tradeData.openCount--;
                        learningWeights[symbol].distance *= 1.05;
                        learningWeights[symbol].volume *= 1.05;
                        aiLogs.push(`Success: ${symbol} ${tf} Long worked. Price ${currentPrice} reached ${takeProfit}.`);
                        tradeData[tf] = null;
                        saveDataThrottled();
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
                        aiLogs.push(`Error: ${symbol} ${tf} Short failed. Price ${currentPrice} exceeded ${stopLoss}.`);
                        tradeData[tf] = null;
                        saveDataThrottled();
                    } else if (currentPrice <= takeProfit) {
                        const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
                        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
                        tradeData.totalProfit += profit - commission;
                        tradeData.profitCount++;
                        tradeData.closedCount++;
                        tradeData.openCount--;
                        learningWeights[symbol].distance *= 1.05;
                        learningWeights[symbol].volume *= 1.05;
                        aiLogs.push(`Success: ${symbol} ${tf} Short worked. Price ${currentPrice} reached ${takeProfit}.`);
                        tradeData[tf] = null;
                        saveDataThrottled();
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
        const nw = calculateNadarayaWatsonEnvelope(closes);

        const volume = calculateVolume(klines);
        const ema50 = closes.length > 50 ? calculateEMA(closes.slice(-50), 50) : price;
        const ema200 = closes.length > 200 ? calculateEMA(closes.slice(-200), 200) : price;
        const fib = calculateFibonacci(klines);
        const trend = getTrend(klines);
        const wick = getWick(klines);
        const spike = getSpike(klines);
        const engulfing = getEngulfing(klines);
        const levels = analyzeOrderBook(symbol);
        const boundaryTrend = nw.upper > nw.upper - (closes[closes.length - 50] || 0) ? 'up' : 'down';
        const frequentExits = klines.slice(-50).filter(k => parseFloat(k[4]) > nw.upper || parseFloat(k[4]) < nw.lower).length > 5;
        const lowBtcEthCorr = await checkCorrelation(symbol);
        const accumulation = checkAccumulation(klines);
        const outsideChannel = price > nw.upper || price < nw.lower;
        const retestLiquidity = klines.slice(-10).some(k => parseFloat(k[3]) <= levels.support || parseFloat(k[2]) >= levels.resistance);
        const lastKline = klines[klines.length - 1] || [0, 0, 0, 0, price, 0];
        const vol = parseFloat(lastKline[5]) || 0;
        const avgVol = klines.slice(-5).reduce((a, k) => a + parseFloat(k[5]), 0) / 5 || 0;
        const balance = Math.abs(volume) < avgVol * 0.1 ? 'balanced' : volume > 0 ? 'buyers' : 'sellers';

        const forecast = outsideChannel ? (price > nw.upper ? 'decline' : 'growth') : 'stability';
        let confidence = 0;

        if (outsideChannel) {
            confidence = Math.min(100, Math.round(Math.abs(price - (price > nw.upper ? nw.upper : nw.lower)) / price * 200));
            if (volume > 0 && forecast === 'growth') confidence += 15;
            if (volume < 0 && forecast === 'decline') confidence += 15;
            if (price > ema200 && forecast === 'growth') confidence += 10;
            if (price < ema200 && forecast === 'decline') confidence += 10;
            if (Math.abs(price - fib[0.618]) < price * 0.005) confidence += 10;
            if (!lowBtcEthCorr && ((btcPrice > lastPrices['BTCUSDT'] * 0.99 && forecast === 'growth') || (ethPrice < lastPrices['ETHUSDT'] * 1.01 && forecast === 'decline'))) confidence += 5;
            if (trend === 'up' && forecast === 'growth') confidence += 10;
            if (trend === 'down' && forecast === 'decline') confidence += 10;
            if (wick.upper > wick.lower && forecast === 'decline') confidence += 8;
            if (wick.lower > wick.upper && forecast === 'growth') confidence += 8;
            if (spike > 0 && ((spike > 0 && forecast === 'growth') || (spike < 0 && forecast === 'decline'))) confidence += 8;
            if (engulfing === 'bullish' && forecast === 'growth') confidence += 10;
            if (engulfing === 'bearish' && forecast === 'decline') confidence += 10;
            if (Math.abs(price - levels.resistance) < price * 0.005 && forecast === 'decline') confidence += 15;
            if (Math.abs(price - levels.support) < price * 0.005 && forecast === 'growth') confidence += 15;
            if (frequentExits && boundaryTrend === (forecast === 'decline' ? 'up' : 'down')) confidence += 15;
            if (accumulation) confidence += 12;
            if (retestLiquidity) confidence += 10;
            if (balance === 'balanced') confidence -= 5;
            confidence = Math.min(100, confidence);
        }

        if (confidence >= 50 && outsideChannel) {
            if (!tradesMain[symbol].active) {
                tradesMain[symbol].active = {
                    direction: forecast === 'growth' ? 'Long' : 'Short',
                    entry: price,
                    stopLoss: forecast === 'growth' ? price * 0.995 : price * 1.005,
                    takeProfit: forecast === 'growth' ? price * 1.01 : price * 0.99,
                    timeframe: tf,
                    reason: `${forecast === 'growth' ? 'Growth' : 'Decline'} predicted with ${confidence}% confidence. Support: ${levels.support}, Resistance: ${levels.resistance}.`
                };
                tradesMain[symbol].openCount++;
                aiLogs.push(`${getMoscowTime()} | ${symbol} ${tf} ${tradesMain[symbol].active.direction} opened. Confidence: ${confidence}%.`);
            }
            if ((tf === '5m' || tf === '15m') && !tradesTest[symbol][tf]) {
                tradesTest[symbol][tf] = { ...tradesMain[symbol].active };
                tradesTest[symbol].openCount++;
                aiLogs.push(`${getMoscowTime()} | ${symbol} ${tf} Test ${tradesTest[symbol][tf].direction} opened. Confidence: ${confidence}%.`);
            }
        }

        recommendations[tf] = {
            forecast,
            confidence,
            outsideChannel,
            trend,
            ema50,
            ema200,
            support: levels.support,
            resistance: levels.resistance,
            reason: `Forecast: ${forecast}, Confidence: ${confidence}%. Price ${price}, Channel ${nw.lower}-${nw.upper}, Trend: ${trend}, Volume: ${volume}, EMA50: ${ema50}, EMA200: ${ema200}, Support: ${levels.support}, Resistance: ${levels.resistance}.`
        };
    }
    lastRecommendations[symbol] = recommendations;
    await saveDataThrottled();
    return recommendations;
}

app.get('/data', async (req, res) => {
    try {
        const symbols = ['LDOUSDT', 'AVAXUSDT', 'AAVEUSDT'];
        let recommendations = {};

        for (const symbol of symbols) {
            recommendations[symbol] = await aiTradeDecision(symbol);
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
        marketOverview = `Currently, the market overall shows a ${dominantTrend} character. Average volatility is ${avgVolatility.toFixed(4)}, Average trading volumes are ${avgVolume.toFixed(2)}.`;

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
    await saveDataThrottled();
    res.sendStatus(200);
});

app.post('/reset-stats-test', async (req, res) => {
    for (const symbol in tradesTest) {
        tradesTest[symbol] = { '5m': null, '15m': null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
    }
    await saveDataThrottled();
    res.sendStatus(200);
});

connectWebSocket();
connectOrderBookWebSocket();

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server started on port ${port}`);
});

process.on('SIGINT', async () => {
    console.log('Server shutting down, saving data...');
    await saveDataThrottled();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Server shutting down, saving data...');
    await saveDataThrottled();
    process.exit(0);
});
