const express = require('express');
const WebSocket = require('ws');
const fs = require('fs').promises;
const app = express();

app.use(express.static('public'));

let lastPrices = { LDOUSDT: 0, AVAXUSDT: 0, AAVEUSDT: 0, BTCUSDT: 0, ETHUSDT: 0 };
let tradesMain = {};
let tradesTest = {};
let aiLogs = [];
let aiLearnings = [];
let aiMistakes = [];
const TRADE_AMOUNT = 100;
const BINANCE_FEE = 0.001;
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];
let lastRecommendations = {};
let learningWeights = {};
let klinesByTimeframe = { LDOUSDT: {}, AVAXUSDT: {}, AAVEUSDT: {}, BTCUSDT: {}, ETHUSDT: {} };

async function loadData() {
    try {
        const data = await fs.readFile('trades.json', 'utf8');
        const parsed = JSON.parse(data);
        tradesMain = parsed.tradesMain || { 
            LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 } 
        };
        tradesTest = parsed.tradesTest || { 
            LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 } 
        };
        aiLogs = parsed.aiLogs || [];
        aiLearnings = parsed.aiLearnings || [];
        aiMistakes = parsed.aiMistakes || [];
        learningWeights = parsed.learningWeights || { 
            LDOUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 }, 
            AVAXUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 }, 
            AAVEUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 } 
        };
        klinesByTimeframe = parsed.klinesByTimeframe || { LDOUSDT: {}, AVAXUSDT: {}, AAVEUSDT: {}, BTCUSDT: {}, ETHUSDT: {} };
        TIMEFRAMES.forEach(tf => {
            Object.keys(klinesByTimeframe).forEach(symbol => {
                if (!klinesByTimeframe[symbol][tf]) klinesByTimeframe[symbol][tf] = [];
            });
        });
        console.log('Данные загружены из trades.json');
    } catch (error) {
        console.log('Нет сохранённых данных или ошибка загрузки:', error.message);
        tradesMain = { 
            LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 } 
        };
        tradesTest = { 
            LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }, 
            AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 } 
        };
        aiLogs = [];
        aiLearnings = [];
        aiMistakes = [];
        learningWeights = { 
            LDOUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 }, 
            AVAXUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 }, 
            AAVEUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 } 
        };
        klinesByTimeframe = { LDOUSDT: {}, AVAXUSDT: {}, AAVEUSDT: {}, BTCUSDT: {}, ETHUSDT: {} };
        TIMEFRAMES.forEach(tf => {
            Object.keys(klinesByTimeframe).forEach(symbol => klinesByTimeframe[symbol][tf] = []);
        });
    }
}

async function saveData() {
    try {
        const dataToSave = { tradesMain, tradesTest, aiLogs, aiLearnings, aiMistakes, learningWeights, klinesByTimeframe };
        await fs.writeFile('trades.json', JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log('Данные сохранены в trades.json');
    } catch (error) {
        console.error('Ошибка сохранения данных:', error.message);
    }
}

loadData().then(() => console.log('Сервер готов к работе'));

function getMoscowTime() { 
    const now = new Date(); 
    return new Date(now.getTime() + 3 * 60 * 60 * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }); 
}

function connectWebSocket() {
    const ws = new WebSocket('wss://fstream.binance.com/ws');
    ws.on('open', () => {
        console.log('WebSocket сервер запущен (Binance Futures)');
        const symbols = ['ldousdt', 'avaxusdt', 'aaveusdt', 'btcusdt', 'ethusdt'];
        const streams = [];
        symbols.forEach(symbol => {
            streams.push(`${symbol}@ticker`, `${symbol}@kline_5m`); // Ограничиваемся 5m для стабильности
        });
        streams.forEach(stream => {
            ws.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [stream],
                id: 1
            }));
            console.log(`Подписка на ${stream} отправлена`);
        });
    });
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.s && msg.c) { // @ticker
                const symbol = msg.s.toUpperCase();
                const newPrice = parseFloat(msg.c);
                if (newPrice !== lastPrices[symbol]) {
                    lastPrices[symbol] = newPrice;
                    console.log(`Обновлена цена через WebSocket для ${symbol}: ${lastPrices[symbol]} (@ticker)`);
                    await checkTradeStatus(symbol, lastPrices[symbol], tradesMain);
                    await checkTradeStatus(symbol, lastPrices[symbol], tradesTest);
                }
            } else if (msg.e === 'kline' && msg.k) { // @kline_5m
                const symbol = msg.s.toUpperCase();
                const tf = msg.k.i;
                if (!klinesByTimeframe[symbol][tf]) klinesByTimeframe[symbol][tf] = [];
                const kline = [
                    msg.k.t, // Время открытия
                    msg.k.o, // Цена открытия
                    msg.k.h, // Максимум
                    msg.k.l, // Минимум
                    msg.k.c, // Цена закрытия
                    msg.k.v  // Объём
                ];
                const klineList = klinesByTimeframe[symbol][tf];
                const existingIndex = klineList.findIndex(k => k[0] === kline[0]);
                if (existingIndex >= 0) {
                    klineList[existingIndex] = kline; // Обновляем существующую свечу
                } else {
                    klineList.push(kline); // Добавляем новую свечу
                    if (klineList.length > 1000) klineList.shift(); // Ограничиваем до 1000
                }
                console.log(`Обновлена свеча через WebSocket для ${symbol} ${tf}`);
                // Экстраполируем для других таймфреймов
                TIMEFRAMES.filter(t => t !== '5m').forEach(tf => {
                    const baseKlines = klinesByTimeframe[symbol]['5m'];
                    klinesByTimeframe[symbol][tf] = aggregateKlines(baseKlines, tf);
                });
            } else if (msg.ping) {
                ws.send(JSON.stringify({ pong: msg.ping }));
                console.log('Отправлен pong в ответ на ping');
            }
        } catch (error) {
            console.error('Ошибка обработки WebSocket-сообщения:', error.message);
        }
    });
    ws.on('error', (error) => console.error('WebSocket ошибка:', error.message));
    ws.on('close', () => {
        console.log('WebSocket закрыт, переподключение через 500 мс...');
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
            currentKline = [start, kline[1], kline[2], kline[3], kline[4], kline[5]];
        } else {
            currentKline[2] = Math.max(currentKline[2], kline[2]); // High
            currentKline[3] = Math.min(currentKline[3], kline[3]); // Low
            currentKline[4] = kline[4]; // Close
            currentKline[5] = parseFloat(currentKline[5]) + parseFloat(kline[5]); // Volume
        }
    });
    if (currentKline) aggregated.push(currentKline);
    return aggregated.slice(-1000); // Ограничиваем до 1000
}

function gauss(x, h) { return Math.exp(-(Math.pow(x, 2) / (h * h * 2))); }
function calculateNadarayaWatsonEnvelope(closes) { 
    const n = closes.length; 
    let smooth = 0, sumWeights = 0;
    for (let j = 0; j < Math.min(499, n - 1); j++) { 
        const w = gauss(0 - j, 8); 
        sumWeights += w; 
        smooth += closes[n - 1 - j] * w; 
    } 
    smooth /= sumWeights; 
    let sae = 0; 
    for (let i = 0; i < Math.min(499, n - 1); i++) { 
        let sum = 0, sumw = 0; 
        for (let j = 0; j < Math.min(499, n - 1); j++) { 
            const w = gauss(i - j, 8); 
            sum += closes[n - 1 - j] * w; 
            sumw += w; 
        } 
        const y = sum / sumw; 
        sae += Math.abs(closes[n - 1 - i] - y); 
    } 
    const mae = (sae / Math.min(499, n - 1)) * 3; 
    return { upper: smooth + mae, lower: smooth - mae, smooth }; 
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
    const avgStart = last50.slice(0, 5).reduce((a, b) => a + b, 0) / 5; 
    const avgEnd = last50.slice(-5).reduce((a, b) => a + b, 0) / 5; 
    return avgEnd > avgStart ? 'вверх' : avgEnd < avgStart ? 'вниз' : 'боковик'; 
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
    if (klines.length < 2) return 'нет'; 
    const last = klines[klines.length - 1]; 
    const prev = klines[klines.length - 2]; 
    const lastOpen = parseFloat(last[1]); 
    const lastClose = parseFloat(last[4]); 
    const prevOpen = parseFloat(prev[1]); 
    const prevClose = parseFloat(prev[4]); 
    if (lastClose > lastOpen && prevClose < prevOpen && lastClose > prevOpen && lastOpen < prevClose) return 'бычье'; 
    if (lastClose < lastOpen && prevClose > prevOpen && lastClose < prevOpen && lastOpen > prevClose) return 'медвежье'; 
    return 'нет'; 
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
        console.error(`Ошибка корреляции для ${symbol}:`, error.message); 
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
    if (tradeData && tradeData.active) { 
        const { entry, stopLoss, takeProfit, direction, timeframe } = tradeData.active; 
        if (direction === 'Лонг') { 
            if (currentPrice <= stopLoss) { 
                const loss = TRADE_AMOUNT * (entry - stopLoss) / entry; 
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2; 
                tradeData.totalLoss += loss + commission; 
                tradeData.stopCount++; 
                tradeData.closedCount++; 
                tradeData.openCount--; 
                learningWeights[symbol].distance *= 0.95; 
                learningWeights[symbol].volume *= 0.95; 
                aiLogs.push(`${getMoscowTime()} | ${symbol} ${timeframe} Лонг | Убыток -${(loss + commission).toFixed(2)} USDT | Цена упала до ${currentPrice.toFixed(4)}, стоп-лосс ${stopLoss.toFixed(4)}. Снижаю вес расстояния и объёмов.`); 
                aiMistakes.push(`Ошибка: ${symbol} ${timeframe} Лонг не сработал. Цена ${currentPrice.toFixed(4)} не удержалась выше ${stopLoss.toFixed(4)}. Вывод: слабый сигнал.`); 
                if (aiLogs.length > 10) aiLogs.shift(); 
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
                aiLogs.push(`${getMoscowTime()} | ${symbol} ${timeframe} Лонг | Прибыль +${(profit - commission).toFixed(2)} USDT | Цена выросла до ${currentPrice.toFixed(4)}, профит ${takeProfit.toFixed(4)}. Повышаю вес расстояния и объёмов.`); 
                aiLearnings.push(`Успех: ${symbol} ${timeframe} Лонг сработал. Цена ${currentPrice.toFixed(4)} достигла ${takeProfit.toFixed(4)}. Вывод: точный сигнал.`); 
                if (aiLogs.length > 10) aiLogs.shift(); 
                tradeData.active = null; 
                await saveData();
            } 
        } else if (direction === 'Шорт') { 
            if (currentPrice >= stopLoss) { 
                const loss = TRADE_AMOUNT * (stopLoss - entry) / entry; 
                const commission = TRADE_AMOUNT * BINANCE_FEE * 2; 
                tradeData.totalLoss += loss + commission; 
                tradeData.stopCount++; 
                tradeData.closedCount++; 
                tradeData.openCount--; 
                learningWeights[symbol].distance *= 0.95; 
                learningWeights[symbol].volume *= 0.95; 
                aiLogs.push(`${getMoscowTime()} | ${symbol} ${timeframe} Шорт | Убыток -${(loss + commission).toFixed(2)} USDT | Цена выросла до ${currentPrice.toFixed(4)}, стоп-лосс ${stopLoss.toFixed(4)}. Снижаю вес расстояния и объёмов.`); 
                aiMistakes.push(`Ошибка: ${symbol} ${timeframe} Шорт не сработал. Цена ${currentPrice.toFixed(4)} превысила ${stopLoss.toFixed(4)}. Вывод: ложный сигнал.`); 
                if (aiLogs.length > 10) aiLogs.shift(); 
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
                aiLogs.push(`${getMoscowTime()} | ${symbol} ${timeframe} Шорт | Прибыль +${(profit - commission).toFixed(2)} USDT | Цена упала до ${currentPrice.toFixed(4)}, профит ${takeProfit.toFixed(4)}. Повышаю вес расстояния и объёмов.`); 
                aiLearnings.push(`Успех: ${symbol} ${timeframe} Шорт сработал. Цена ${currentPrice.toFixed(4)} достигла ${takeProfit.toFixed(4)}. Вывод: точный сигнал.`); 
                if (aiLogs.length > 10) aiLogs.shift(); 
                tradeData.active = null; 
                await saveData();
            } 
        } 
    } 
}

async function aiTradeDecision(symbol) {
    const price = lastPrices[symbol] || 0;
    let recommendations = {};
    const btcPrice = lastPrices['BTCUSDT'];
    const ethPrice = lastPrices['ETHUSDT'];
    for (const tf of TIMEFRAMES) {
        const klines = klinesByTimeframe[symbol][tf] || [];
        const closes = klines.length > 0 ? klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c)) : [price];
        const nw = closes.length > 1 ? calculateNadarayaWatsonEnvelope(closes) : { upper: price * 1.05, lower: price * 0.95, smooth: price };
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
        const boundaryTrend = nw.upper > nw.upper - (closes[closes.length - 50] || 0) ? 'вверх' : 'вниз';
        const frequentExits = klines.slice(-50).filter(k => parseFloat(k[4]) > nw.upper || parseFloat(k[4]) < nw.lower).length > 5;
        const lowBtcEthCorr = await checkCorrelation(symbol);
        const accumulation = checkAccumulation(klines);
        const outsideChannel = price > nw.upper || price < nw.lower;
        const touchesBoundary = price >= nw.upper || price <= nw.lower;
        console.log(`${getMoscowTime()} | ${symbol} ${tf} | Цена ${price.toFixed(4)}, канал ${nw.lower.toFixed(4)}–${nw.upper.toFixed(4)}, touchesBoundary: ${touchesBoundary}, outsideChannel: ${outsideChannel}`);

        const flatData = detectFlat(klines, nw);
        const isFlat = flatData.isFlat;
        const flatLow = flatData.flatLow;
        const flatHigh = flatData.flatHigh;

        let direction = outsideChannel ? (price > nw.upper ? 'Шорт' : 'Лонг') : 'Нет';
        let confidence = 0;
        if (direction !== 'Нет') {
            confidence = Math.min(100, Math.round(Math.abs(price - (direction === 'Шорт' ? nw.upper : nw.lower)) / price * 200)) * learningWeights[symbol].distance;
            if (volume > 0 && direction === 'Лонг') confidence += 20 * learningWeights[symbol].volume;
            if (volume < 0 && direction === 'Шорт') confidence += 20 * learningWeights[symbol].volume;
            if (price > ema200 && direction === 'Лонг') confidence += 10 * learningWeights[symbol].ema;
            if (price < ema200 && direction === 'Шорт') confidence += 10 * learningWeights[symbol].ema;
            if (Math.abs(price - fib[0.618]) < price * 0.005) confidence += 15 * learningWeights[symbol].fibo;
            if (vol > klines.slice(-5, -1).reduce((a, k) => a + parseFloat(k[5]), 0) / 4) confidence += 10 * learningWeights[symbol].volume;
            if (!lowBtcEthCorr) {
                if (btcPrice > lastPrices['BTCUSDT'] * 0.99 && direction === 'Лонг') confidence += 5 * learningWeights[symbol].btcEth;
                if (ethPrice > lastPrices['ETHUSDT'] * 0.99 && direction === 'Лонг') confidence += 5 * learningWeights[symbol].btcEth;
            } else {
                learningWeights[symbol].btcEth *= 0.95;
                aiLearnings.push(`${getMoscowTime()}: ${symbol} ${tf} — Низкая корреляция с BTC/ETH, уменьшил их вес до ${learningWeights[symbol].btcEth.toFixed(2)}.`);
                await saveData();
            }
            if (trend === 'вверх' && direction === 'Лонг') confidence += 10 * learningWeights[symbol].trend;
            if (trend === 'вниз' && direction === 'Шорт') confidence += 10 * learningWeights[symbol].trend;
            if (wick.upper > wick.lower && direction === 'Лонг') confidence += 10 * learningWeights[symbol].wick;
            if (wick.lower > wick.upper && direction === 'Шорт') confidence += 10 * learningWeights[symbol].wick;
            if (spike > 0 && direction === (spike > 0 ? 'Лонг' : 'Шорт')) confidence += 10 * learningWeights[symbol].spike;
            if (engulfing === 'бычье' && direction === 'Лонг') confidence += 10 * learningWeights[symbol].engulf;
            if (engulfing === 'медвежье' && direction === 'Шорт') confidence += 10 * learningWeights[symbol].engulf;
            if (Math.abs(price - levels.resistance) < price * 0.005 && direction === 'Шорт') confidence += 10 * learningWeights[symbol].levels;
            if (Math.abs(price - levels.support) < price * 0.005 && direction === 'Лонг') confidence += 10 * learningWeights[symbol].levels;
            if (frequentExits && boundaryTrend === (direction === 'Шорт' ? 'вверх' : 'вниз')) confidence += 15 * learningWeights[symbol].trend;
            if (accumulation) confidence += 10 * learningWeights[symbol].volume;
            if (isFlat && Math.abs(nw.lower - flatLow) < flatLow * 0.01 && Math.abs(nw.upper - flatHigh) < flatHigh * 0.01) {
                confidence += 10 * learningWeights[symbol].flat;
                aiLearnings.push(`${getMoscowTime()}: ${symbol} ${tf} — Совпадение границ Nadaraya и боковика усиливает сигнал (+10% к confidence).`);
                await saveData();
            }
            confidence = Math.min(100, Math.round(confidence));
        }

        const market = isFlat ? 'Флет' : outsideChannel ? (price > nw.upper ? 'Восходящий' : 'Нисходящий') : 'Флет';
        const forecast = isFlat ? 'стабильность' : (direction === 'Шорт' || trend === 'вниз' ? 'падение' : 'рост');
        const entry = price;
        const stopLoss = direction === 'Лонг' ? entry * 0.995 : direction === 'Шорт' ? entry * 1.005 : entry;
        const takeProfit = direction === 'Лонг' ? entry * 1.01 : direction === 'Шорт' ? entry * 0.99 : entry;
        const volChange = vol > avgVol * 1.2 ? 'растут' : vol < avgVol * 0.8 ? 'падают' : 'стабильны';
        const volatilityStatus = volatility > price * 0.01 ? 'высокая' : volatility < price * 0.005 ? 'низкая' : 'умеренная';
        const sentiment = volume > 0 ? 'покупатели активнее продавцов' : volume < 0 ? 'продавцы активнее покупателей' : 'покупатели и продавцы в равновесии';
        const activity = vol > avgVol * 1.5 ? 'высокая' : vol < avgVol * 0.5 ? 'низкая' : 'средняя';
        const recommendation = direction === 'Лонг' ? 'готовиться к покупке после пробоя' : direction === 'Шорт' ? 'готовиться к продаже после пробоя' : 'ждать пробоя канала для чёткого сигнала';
        const reasoning = isFlat 
            ? `Консолидация. Цена ${price.toFixed(4)} в границах ${flatLow.toFixed(4)}–${flatHigh.toFixed(4)} (Nadaraya: ${nw.lower.toFixed(4)}–${nw.upper.toFixed(4)}). Тренд ${trend}, объёмы ${volChange}, текущий объём ${vol.toFixed(2)} против среднего ${avgVol.toFixed(2)}, волатильность ${volatilityStatus} (${volatility.toFixed(4)}). ${sentiment}, хвосты свечи: верхний ${wick.upper.toFixed(4)}, нижний ${wick.lower.toFixed(4)}. Скачок ${spike.toFixed(2)}% и поглощение ${engulfing} показывают ${activity} активность. Уровень сопротивления ${levels.resistance.toFixed(4)} и поддержка ${levels.support.toFixed(4)} ограничивают движение. Границы канала движутся ${boundaryTrend}. Рекомендация: ${recommendation}.`
            : `Рынок сейчас в состоянии ${market}, цена ${price.toFixed(4)} находится ${outsideChannel ? 'вне' : 'внутри'} канала ${nw.lower.toFixed(4)}–${nw.upper.toFixed(4)}. Тренд ${trend}, объёмы ${volChange}, текущий объём ${vol.toFixed(2)} против среднего ${avgVol.toFixed(2)}, волатильность ${volatilityStatus} (${volatility.toFixed(4)}). ${sentiment}, хвосты свечи: верхний ${wick.upper.toFixed(4)}, нижний ${wick.lower.toFixed(4)}. Скачок ${spike.toFixed(2)}% и поглощение ${engulfing} показывают ${activity} активность. Уровень сопротивления ${levels.resistance.toFixed(4)} и поддержка ${levels.support.toFixed(4)} ограничивают движение. Границы канала движутся ${boundaryTrend}. Рекомендация: ${recommendation}.`;
        const shortReasoning = isFlat 
            ? `Консолидация. Цена ${price.toFixed(4)} в границах ${flatLow.toFixed(4)}–${flatHigh.toFixed(4)} (Nadaraya: ${nw.lower.toFixed(4)}–${nw.upper.toFixed(4)}), объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}.`
            : `Тренд ${trend}. Цена ${price.toFixed(4)} ${outsideChannel ? 'вне' : 'внутри'} ${nw.lower.toFixed(4)}–${nw.upper.toFixed(4)}, объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}.`;

        recommendations[tf] = { direction, confidence, outsideChannel, touchesBoundary, entry, stopLoss, takeProfit, market, trend, pivot: nw.smooth, reasoning, shortReasoning, forecast, isFlat };
    }
    lastRecommendations[symbol] = recommendations;
    return recommendations;
}

app.get('/data', async (req, res) => { 
    const symbols = ['LDOUSDT', 'AVAXUSDT', 'AAVEUSDT']; 
    let recommendations = {}; 
    try { 
        for (const symbol of symbols) { 
            recommendations[symbol] = await aiTradeDecision(symbol); 
            console.log(`Рекомендации для ${symbol}:`, recommendations[symbol]); 
        } 

        let activeTradeSymbolMain = null; 
        for (const s in tradesMain) { 
            if (tradesMain[s].active) { 
                activeTradeSymbolMain = s; 
                break; 
            } 
        } 

        if (!activeTradeSymbolMain) { 
            let bestTrade = null; 
            for (const sym of symbols) { 
                for (const tf of TIMEFRAMES) { 
                    const rec = recommendations[sym][tf]; 
                    if (rec.direction !== 'Нет' && rec.confidence >= 50 && rec.outsideChannel) { 
                        if (!bestTrade || rec.confidence > bestTrade.confidence) { 
                            bestTrade = { symbol: sym, timeframe: tf, ...rec }; 
                        } 
                    } 
                } 
            } 
            if (bestTrade) { 
                tradesMain[bestTrade.symbol].active = { 
                    direction: bestTrade.direction, 
                    entry: bestTrade.entry, 
                    stopLoss: bestTrade.stopLoss, 
                    takeProfit: bestTrade.takeProfit, 
                    timeframe: bestTrade.timeframe 
                }; 
                tradesMain[bestTrade.symbol].openCount++; 
                aiLogs.push(`${getMoscowTime()} | ${bestTrade.symbol} ${bestTrade.timeframe} ${bestTrade.direction} | Открыта сделка с уверенностью ${bestTrade.confidence}%. Условия выполнены: пробой канала, цена ${bestTrade.entry.toFixed(4)}.`); 
                console.log('Открыта основная сделка:', tradesMain[bestTrade.symbol]); 
                await saveData();
            } else { 
                aiLogs.push(`${getMoscowTime()} | Нет сделок | Условия не выполнены: нет сигнала с уверенностью >= 50% и пробоем канала.`); 
            } 
            if (aiLogs.length > 10) aiLogs.shift(); 
        } 

        let activeTradeSymbolTest = null; 
        for (const s in tradesTest) { 
            if (tradesTest[s].active) { 
                activeTradeSymbolTest = s; 
                break; 
            } 
        } 

        if (!activeTradeSymbolTest) { 
            let bestTrade = null; 
            for (const sym of symbols) { 
                const rec = recommendations[sym]['5m']; 
                if (rec.direction !== 'Нет' && rec.confidence >= 50 && rec.outsideChannel) { 
                    if (!bestTrade || rec.confidence > bestTrade.confidence) { 
                        bestTrade = { symbol: sym, timeframe: '5m', ...rec }; 
                    } 
                } 
            } 
            if (bestTrade) { 
                tradesTest[bestTrade.symbol].active = { 
                    direction: bestTrade.direction, 
                    entry: bestTrade.entry, 
                    stopLoss: bestTrade.stopLoss, 
                    takeProfit: bestTrade.takeProfit, 
                    timeframe: bestTrade.timeframe 
                }; 
                tradesTest[bestTrade.symbol].openCount++; 
                aiLogs.push(`${getMoscowTime()} | ${bestTrade.symbol} 5m ${bestTrade.direction} | Открыта тестовая сделка с уверенностью ${bestTrade.confidence}%. Условия выполнены: пробой канала, цена ${bestTrade.entry.toFixed(4)}.`); 
                console.log('Открыта тестовая сделка:', tradesTest[bestTrade.symbol]); 
                await saveData();
            } else { 
                aiLogs.push(`${getMoscowTime()} | Нет тестовых сделок (5m) | Условия не выполнены: нет сигнала с уверенностью >= 50% и пробоем канала.`); 
            } 
            if (aiLogs.length > 10) aiLogs.shift(); 
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
                if (rec.trend === 'вверх') trendCount.up++; 
                else if (rec.trend === 'вниз') trendCount.down++; 
                else trendCount.flat++; 
            }); 
        }); 
        const avgVolatility = totalVolatility / (symbols.length * TIMEFRAMES.length); 
        const avgVolume = totalVolume / (symbols.length * TIMEFRAMES.length); 
        const dominantTrend = trendCount.up > trendCount.down && trendCount.up > trendCount.flat ? 'восходящий' : 
                             trendCount.down > trendCount.up && trendCount.down > trendCount.flat ? 'нисходящий' : 'боковой'; 
        marketOverview = `На данный момент рынок в целом демонстрирует ${dominantTrend} характер. Средняя волатильность составляет ${avgVolatility.toFixed(4)}, что указывает на ${avgVolatility > 0.01 * (lastPrices[symbols[0]] || 0) ? 'высокую активность' : 'спокойствие'}. Объёмы торгов в среднем ${avgVolume.toFixed(2)}, что говорит о ${avgVolume > 0 ? 'преобладании покупателей' : 'преобладании продавцов или равновесии'}. Рекомендуется следить за ключевыми уровнями и ждать чётких сигналов пробоя для входа в сделки.`; 

        res.json({ prices: lastPrices, recommendations, tradesMain, tradesTest, aiLogs, aiLearnings, aiMistakes, marketOverview }); 
    } catch (error) { 
        console.error('Ошибка /data:', error); 
        res.status(500).json({ error: 'Ошибка сервера', details: error.message }); 
    } 
});

app.post('/reset-stats-main', (req, res) => { 
    for (const symbol in tradesMain) { 
        tradesMain[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }; 
    } 
    saveData().then(() => res.sendStatus(200));
});

app.post('/reset-stats-test', (req, res) => { 
    for (const symbol in tradesTest) { 
        tradesTest[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }; 
    } 
    saveData().then(() => res.sendStatus(200));
});

const port = process.env.PORT || 10000;
app.listen(port, () => { 
    console.log(`Сервер запущен на порту ${port}`); 
});

process.on('SIGINT', async () => {
    console.log('Сервер завершает работу, сохраняю данные...');
    await saveData();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Сервер завершает работу, сохраняю данные...');
    await saveData();
    process.exit(0);
});
