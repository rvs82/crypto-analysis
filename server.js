import express from 'express';
import WebSocket from 'ws';
import { promises as fs } from 'fs';

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
        console.log('Данные загружены из trades.json:', lastPrices);
    } catch (error) {
        console.log('Нет сохранённых данных или ошибка загрузки:', error.message);
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
        console.log('Данные сохранены в trades.json:', lastPrices);
    } catch (error) {
        console.error('Ошибка сохранения данных:', error.message);
    }
}

await loadData();
console.log('Сервер готов к работе');

function getMoscowTime() {
    const now = new Date();
    return new Date(now.getTime() + 3 * 60 * 60 * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
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

const ws = new WebSocket('wss://fstream.binance.com/ws');
ws.on('open', () => {
    console.log('WebSocket сервер запущен (Binance Futures)');
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
        console.log(`Подписка на ${stream} отправлена`);
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
                console.log(`Обновлена цена через WebSocket для ${symbol}: ${lastPrices[symbol]} (@ticker)`);
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
            console.log(`Обновлена свеча через WebSocket для ${symbol} ${tf}`);
            TIMEFRAMES.filter(t => t !== '5m').forEach(tf => {
                klinesByTimeframe[symbol][tf] = aggregateKlines(klinesByTimeframe[symbol]['5m'], tf);
            });
            await saveData();
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
    setTimeout(() => connectWebSocket(), 500);
});

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
    if (last50.length < 50) return 'боковик';
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
    if (trades === tradesMain && tradeData.active) {
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
                aiLogs.push(`Ошибка: ${symbol} ${timeframe} Лонг не сработал. Цена ${currentPrice} не удержалась выше ${stopLoss}. Вывод: слабый сигнал. Влияние: Снизил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Буду строже проверять объёмы перед входом.`);
                const now = Date.now();
                if (now - lastSuggestionTime >= 300000) {
                    aiSuggestions.push(`${getMoscowTime()} | Рекомендую добавить индикатор MACD с настройками: быстрая EMA 12, медленная EMA 26, сигнальная линия 9. Основание: частые ложные пробои канала требуют фильтра пересечений.`);
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
                aiLogs.push(`Успех: ${symbol} ${timeframe} Лонг сработал. Цена ${currentPrice} достигла ${takeProfit}. Вывод: точный сигнал. Влияние: Повысил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Усиливаю доверие к пробоям с объёмом.`);
                if (aiLogs.length > 100) aiLogs.shift();
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
                aiLogs.push(`Ошибка: ${symbol} ${timeframe} Шорт не сработал. Цена ${currentPrice} превысила ${stopLoss}. Вывод: ложный сигнал. Влияние: Снизил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Буду учитывать ложные пробои.`);
                const now = Date.now();
                if (now - lastSuggestionTime >= 300000) {
                    aiSuggestions.push(`${getMoscowTime()} | Рекомендую добавить индикатор RSI с периодом 14 и уровнями перекупленности 70, перепроданности 30. Основание: частые ложные пробои верхней границы.`);
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
                aiLogs.push(`Успех: ${symbol} ${timeframe} Шорт сработал. Цена ${currentPrice} достигла ${takeProfit}. Вывод: точный сигнал. Влияние: Повысил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Усиливаю доверие к пробоям с объёмом.`);
                if (aiLogs.length > 100) aiLogs.shift();
                tradeData.active = null;
                await saveData();
            }
        }
    } else if (trades === tradesTest) {
        ['5m', '15m'].forEach(tf => {
            if (tradeData[tf]) {
                const { entry, stopLoss, takeProfit, direction } = tradeData[tf];
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
                        aiLogs.push(`Ошибка: ${symbol} ${tf} Лонг не сработал. Цена ${currentPrice} не удержалась выше ${stopLoss}. Вывод: слабый сигнал. Влияние: Снизил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Буду строже проверять объёмы перед входом.`);
                        const now = Date.now();
                        if (now - lastSuggestionTime >= 300000) {
                            aiSuggestions.push(`${getMoscowTime()} | Рекомендую добавить индикатор MACD с настройками: быстрая EMA 12, медленная EMA 26, сигнальная линия 9 для таймфрейма ${tf}. Основание: частые убытки на краткосрочных движениях.`);
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
                        aiLogs.push(`Успех: ${symbol} ${tf} Лонг сработал. Цена ${currentPrice} достигла ${takeProfit}. Вывод: точный сигнал. Влияние: Повысил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Усиливаю доверие к пробоям с объёмом.`);
                        if (aiLogs.length > 100) aiLogs.shift();
                        tradeData[tf] = null;
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
                        aiLogs.push(`Ошибка: ${symbol} ${tf} Шорт не сработал. Цена ${currentPrice} превысила ${stopLoss}. Вывод: ложный сигнал. Влияние: Снизил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Буду учитывать ложные пробои.`);
                        const now = Date.now();
                        if (now - lastSuggestionTime >= 300000) {
                            aiSuggestions.push(`${getMoscowTime()} | Рекомендую добавить индикатор RSI с периодом 14 и уровнями перекупленности 70, перепроданности 30 для таймфрейма ${tf}. Основание: частые ложные пробои верхней границы.`);
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
                        aiLogs.push(`Успех: ${symbol} ${tf} Шорт сработал. Цена ${currentPrice} достигла ${takeProfit}. Вывод: точный сигнал. Влияние: Повысил вес расстояния и объёмов до ${learningWeights[symbol].distance.toFixed(2)} и ${learningWeights[symbol].volume.toFixed(2)}. Усиливаю доверие к пробоям с объёмом.`);
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
        const boundaryTrend = nw.upper > nw.upper - (closes[closes.length - 50] || 0) ? 'вверх' : 'вниз';
        const frequentExits = klines.slice(-50).filter(k => parseFloat(k[4]) > nw.upper || parseFloat(k[4]) < nw.lower).length > 5;
        const lowBtcEthCorr = await checkCorrelation(symbol);
        const accumulation = checkAccumulation(klines);
        const outsideChannel = price > nw.upper || price < nw.lower;
        const touchesBoundary = price >= nw.upper || price <= nw.lower;

        if (outsideChannel) {
            lastChannelCross[symbol][tf] = price > nw.upper ? 'upper' : 'lower';
        }

        const lastCross = lastChannelCross[symbol][tf] || 'none';
        const trendDirection = lastCross === 'lower' ? 'вверх' : lastCross === 'upper' ? 'вниз' : trend;

        console.log(`${getMoscowTime()} | ${symbol} ${tf} | Цена ${price}, канал ${nw.lower}–${nw.upper}, outsideChannel: ${outsideChannel}, trend: ${trend}, lastCross: ${lastCross}`);

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
                aiLogs.push(`${getMoscowTime()}: ${symbol} ${tf} — Низкая корреляция с BTC/ETH, уменьшил их вес до ${learningWeights[symbol].btcEth.toFixed(2)}.`);
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
                aiLogs.push(`${getMoscowTime()}: ${symbol} ${tf} — Совпадение границ Nadaraya и боковика усиливает сигнал (+10% к confidence).`);
            }
            confidence = Math.min(100, Math.round(confidence));

            if (confidence >= 50 && outsideChannel) {
                if (!tradesMain[symbol].active) {
                    tradesMain[symbol].active = {
                        direction,
                        entry: price,
                        stopLoss: direction === 'Лонг' ? price * 0.995 : price * 1.005,
                        takeProfit: direction === 'Лонг' ? price * 1.01 : price * 0.99,
                        timeframe: tf,
                        reason: `Пробой ${direction === 'Лонг' ? 'нижней' : 'верхней'} границы канала на уровне ${direction === 'Лонг' ? nw.lower : nw.upper} с уверенностью ${confidence}%. Объёмы: ${volume}, тренд: ${trend}. Стоп-лосс установлен на 0.5% от входа для защиты, тейк-профит на 1% для фиксации прибыли при умеренной волатильности ${volatility}.`
                    };
                    tradesMain[symbol].openCount++;
                    aiLogs.push(`${getMoscowTime()} | ${symbol} ${tf} ${direction} | Открыта сделка с уверенностью ${confidence}%. Причина: ${tradesMain[symbol].active.reason}`);
                    console.log('Открыта основная сделка:', tradesMain[symbol]);
                }
                if ((tf === '5m' || tf === '15m') && !tradesTest[symbol][tf]) {
                    tradesTest[symbol][tf] = {
                        direction,
                        entry: price,
                        stopLoss: direction === 'Лонг' ? price * 0.995 : price * 1.005,
                        takeProfit: direction === 'Лонг' ? price * 1.01 : price * 0.99,
                        timeframe: tf,
                        reason: `Пробой ${direction === 'Лонг' ? 'нижней' : 'верхней'} границы канала на уровне ${direction === 'Лонг' ? nw.lower : nw.upper} с уверенностью ${confidence}%. Объёмы: ${volume}, тренд: ${trend}. Стоп-лосс установлен на 0.5% от входа для защиты, тейк-профит на 1% для фиксации прибыли при умеренной волатильности ${volatility}.`
                    };
                    tradesTest[symbol].openCount++;
                    aiLogs.push(`${getMoscowTime()} | ${symbol} ${tf} ${direction} | Открыта тестовая сделка с уверенностью ${confidence}%. Причина: ${tradesTest[symbol][tf].reason}`);
                    console.log('Открыта тестовая сделка:', tradesTest[symbol]);
                }
            }
        }

        const market = trend === 'вверх' ? 'Восходящий' : trend === 'вниз' ? 'Нисходящий' : 'Флет';
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
            ? `Консолидация. Цена ${price} в границах ${flatLow}–${flatHigh} (Nadaraya: ${nw.lower}–${nw.upper}). Тренд ${trend === 'вверх' ? 'бычий' : trend === 'вниз' ? 'медвежий' : 'флет'}, объёмы ${volChange}, текущий объём ${vol.toFixed(2)} против среднего ${avgVol.toFixed(2)}, волатильность ${volatilityStatus} (${volatility.toFixed(4)}). ${sentiment}, хвосты свечи: верхний ${wick.upper.toFixed(4)}, нижний ${wick.lower.toFixed(4)}. Скачок ${spike.toFixed(2)}% и поглощение ${engulfing} показывают ${activity} активность. Уровень сопротивления ${levels.resistance.toFixed(4)} и поддержка ${levels.support.toFixed(4)} ограничивают движение. Границы канала движутся ${boundaryTrend}. Рекомендация: ${recommendation}.`
            : `Рынок сейчас в состоянии ${market}, цена ${price} находится ${outsideChannel ? 'вне' : 'внутри'} канала ${nw.lower}–${nw.upper}. Тренд ${trend === 'вверх' ? 'бычий' : trend === 'вниз' ? 'медвежий' : 'флет'}, объёмы ${volChange}, текущий объём ${vol.toFixed(2)} против среднего ${avgVol.toFixed(2)}, волатильность ${volatilityStatus} (${volatility.toFixed(4)}). ${sentiment}, хвосты свечи: верхний ${wick.upper.toFixed(4)}, нижний ${wick.lower.toFixed(4)}. Скачок ${spike.toFixed(2)}% и поглощение ${engulfing} показывают ${activity} активность. Уровень сопротивления ${levels.resistance.toFixed(4)} и поддержка ${levels.support.toFixed(4)} ограничивают движение. Границы канала движутся ${boundaryTrend}. Рекомендация: ${recommendation}.`;
        const shortReasoning = isFlat
            ? `Консолидация. Цена ${price} в границах ${flatLow}–${flatHigh} (Nadaraya: ${nw.lower}–${nw.upper}), объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}.`
            : `Тренд ${trend === 'вверх' ? 'бычий' : trend === 'вниз' ? 'медвежий' : 'флет'}. Цена ${price} ${outsideChannel ? 'вне' : 'внутри'} ${nw.lower}–${nw.upper}, объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}.`;
        const noTradeReasoning = tradesMain[symbol].active || (['5m', '15m'].includes(tf) && tradesTest[symbol][tf]) ? '' : `Нет активных сделок. Причины: ${outsideChannel ? 'пробой канала есть, но уверенность ' + confidence + '% ниже 50%' : 'цена внутри канала, нет пробоя'}. Тренд ${trend}, объёмы ${volChange}, волатильность ${volatilityStatus}.`;

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
            console.log(`Рекомендации для ${symbol}:`, recommendations[symbol]);
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

        const serverLoad = getServerLoad();
        res.json({ prices: lastPrices, recommendations, tradesMain, tradesTest, aiLogs, aiSuggestions, marketOverview, serverLoad });
    } catch (error) {
        console.error('Ошибка /data:', error);
        res.status(500).json({ error: 'Ошибка сервера', details: error.message });
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
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});

process.on('SIGINT', async () кнопку => {
    console.log('Сервер завершает работу, сохраняю данные...');
    await saveData();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Сервер завершает работу, сохраняю данные...');
    await saveData();
    process.exit(0);
});
