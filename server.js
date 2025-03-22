const express = require('express');
const WebSocket = require('ws');
const app = express();

app.use(express.static('public'));

let lastPrices = { LDOUSDT: 0, AVAXUSDT: 0, XLMUSDT: 0, HBARUSDT: 0, BATUSDT: 0, AAVEUSDT: 0 };
let sentiment = { long: 0, short: 0 };

const wss = new WebSocket('wss://fstream.binance.com/ws');
wss.on('open', () => {
  console.log('WebSocket подключён');
  ['ldousdt', 'avaxusdt', 'xlmusdt', 'hbarusdt', 'batusdt', 'aaveusdt'].forEach(symbol => {
    wss.send(JSON.stringify({ method: "SUBSCRIBE", params: [`${symbol}@ticker`], id: 1 }));
  });
});

wss.on('message', (data) => {
  const parsedData = JSON.parse(data);
  if (parsedData.s && lastPrices[parsedData.s]) {
    lastPrices[parsedData.s] = parseFloat(parsedData.c) || 0;
    console.log(`Обновлена цена для ${parsedData.s}: ${lastPrices[parsedData.s]}`);
  }
});

async function fetchPricesFromRestAPI() {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  for (let symbol of symbols) {
    try {
      const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
      const data = await response.json();
      lastPrices[symbol] = parseFloat(data.price) || 0;
    } catch (error) {
      console.error(`Ошибка получения цены для ${symbol}:`, error);
    }
  }
}

async function fetchKlines(symbol) {
  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=50`);
    return await response.json();
  } catch (error) {
    console.error(`Ошибка получения свечей для ${symbol}:`, error);
    return [];
  }
}

function calculateEMA(period, prices) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(closes) {
  const deltas = closes.slice(-15).slice(1).map((c, i) => c - closes[closes.length - 15 + i]);
  const gains = deltas.map(d => d > 0 ? d : 0).reduce((a, b) => a + b, 0) / 14;
  const losses = deltas.map(d => d < 0 ? -d : 0).reduce((a, b) => a + b, 0) / 14;
  const rs = gains / losses || Infinity;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
  const ema12 = calculateEMA(12, prices.slice(-26));
  const ema26 = calculateEMA(26, prices.slice(-26));
  const macd = ema12 - ema26;
  const signal = calculateEMA(9, prices.slice(-9).map((_, i) => calculateEMA(12, prices.slice(-26 + i, -14 + i)) - calculateEMA(26, prices.slice(-26 + i))));
  return { line: macd, signal: signal, histogram: macd - signal };
}

async function aiTradeDecision(symbol) {
  const klines = await fetchKlines(symbol);
  const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
  if (closes.length === 0) return { direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0 };

  const price = lastPrices[symbol];
  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const prediction = closes[closes.length - 1] + (closes[closes.length - 1] - closes[0]) / 50 * 288;

  const score = (prediction - price) / price * 0.6 + macd.histogram * 0.25 - (rsi - 50) / 50 * 0.3;
  const confidence = Math.min(95, Math.max(5, Math.abs(score) * 100));

  let direction = score > 0 ? 'Лонг' : score < 0 ? 'Шорт' : 'Нейтрально';
  if (rsi > 40 && rsi < 60 && Math.abs(score) < 0.5) direction = 'Нейтрально';

  const entry = price;
  const stopLoss = direction === 'Лонг' ? price * 0.99 : price * 1.01;
  const takeProfit = direction === 'Лонг' ? price * 1.03 : price * 0.97;
  const profit = direction === 'Лонг' ? takeProfit - entry : entry - takeProfit;
  const risk = direction === 'Лонг' ? entry - stopLoss : stopLoss - entry;
  const rrr = profit / risk;

  if (rrr < 3 || confidence < 60) direction = 'Нейтрально';

  return { direction, entry, stopLoss, takeProfit, confidence };
}

app.get('/data', async (req, res) => {
  await fetchPricesFromRestAPI();
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  let recommendations = {};
  sentiment = { long: 0, short: 0 };

  for (let symbol of symbols) {
    recommendations[symbol] = await aiTradeDecision(symbol);
    if (recommendations[symbol].direction === 'Лонг') sentiment.long++;
    else if (recommendations[symbol].direction === 'Шорт') sentiment.short++;
  }

  res.json({ prices: lastPrices, recommendations, sentiment });
});

app.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});
