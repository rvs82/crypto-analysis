const express = require('express');
const WebSocket = require('ws');
const fs = require('fs').promises;
const app = express();

app.use(express.static('public'));

// Глобальные переменные
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
const BINANCE_FEE = 0.04 / 100; // 0.04% комиссия Binance Futures
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];
let lastRecommendations = {};
let learningWeights = {
    LDOUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 },
    AVAXUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 },
    AAVEUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1, flat: 1 }
};
let klinesByTimeframe = { LDOUSDT: {}, AVAXUSDT: {}, AAVEUSDT: {}, BTCUSDT: {}, ETHUSDT: {} };

// Загрузка данных из файла
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

// Сохранение данных в файл
async function saveData() {
    try {
        const dataToSave = { tradesMain, tradesTest, aiLogs, aiSuggestions, lastChannelCross, learningWeights, klinesByTimeframe, lastPrices };
        await fs.writeFile('trades.json', JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log('Данные сохранены в trades.json:', lastPrices);
    } catch (error) {
        console.error('Ошибка сохранения данных:', error.message);
    }
}

loadData().then(() => console.log('Сервер готов к работе'));

// Получение времени в Москве (UTC+3)
function getMoscowTime() {
    const now = new Date();
    return new Date(now.getTime() + 3 * 60 * 60 * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

// Расчёт нагрузки CPU (приближённо через Node.js)
function getServerLoad() {
    const startUsage = process.cpuUsage();
    return new Promise((resolve) => {
        setTimeout(() => {
            const endUsage = process.cpuUsage(startUsage);
            const userTime = endUsage.user / 1000000; // Перевод в секунды
            const systemTime = endUsage.system / 1000000;
            const totalTime = userTime + systemTime;
            const cpuLoad = Math.min(100, Math.round((totalTime / 1) * 100)); // Процент за 1 секунду
            resolve(cpuLoad);
        }, 1000);
    });
}

// Подключение к WebSocket Binance Futures
function connectWebSocket() {
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
    ws.on('message', async (data) => { // Исправлено: добавлено async
        try {
            const msg = JSON.parse(data);
            if (msg.s && msg.c) { // @ticker
                const symbol = msg.s.toUpperCase();
                const newPrice = parseFloat(msg.c);
                if (newPrice !== lastPrices[symbol]) {
                    lastPrices[symbol] = newPrice;
                    console.log(`Обновлена цена через WebSocket для ${symbol}: ${lastPrices[symbol]} (@ticker)`);
                    await saveData();
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
