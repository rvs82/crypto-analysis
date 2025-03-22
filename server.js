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

async function fetchKlines(symbol) {
  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=300`);
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

function calculateBollinger(prices) {
  const period = 20;
  const sma = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(prices.slice(-period).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period);
  return { upper: sma + 2 * stdDev, middle: sma, lower: sma - 2 * stdDev };
}

function calculateVWAP(klines) {
  const recentKlines = klines.slice(-288);
  const vwap = recentKlines.reduce((sum, kline) => {
    const typicalPrice = (parseFloat(kline[2]) + parseFloat(kline[3]) + parseFloat(kline[4])) / 3;
    return sum + typicalPrice * parseFloat(kline[5]);
  }, 0) / recentKlines.reduce((sum, kline) => sum + parseFloat(kline[5]), 0);
  return vwap;
}

function calculateATR(klines) {
  const trs = klines.slice(-15).map((kline, i) => {
    if (i === 0) return parseFloat(kline[2]) - parseFloat(kline[3]);
    const high = parseFloat(kline[2]);
    const low = parseFloat(kline[3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  });
  return trs.reduce((a, b) => a + b, 0) / 14;
}

function calculateStochastic(klines) {
  const period = 14;
  const recent = klines.slice(-period);
  const high = Math.max(...recent.map(k => parseFloat(k[2])));
  const low = Math.min(...recent.map(k => parseFloat(k[3])));
  const close = parseFloat(recent[recent.length - 1][4]);
  const k = (close - low) / (high - low) * 100 || 50;
  const dValues = klines.slice(-17, -3).map((_, i) => {
    const sub = klines.slice(i, i + 14);
    const subHigh = Math.max(...sub.map(k => parseFloat(k[2])));
    const subLow = Math.min(...sub.map(k => parseFloat(k[3])));
    const subClose = parseFloat(sub[sub.length - 1][4]);
    return (subClose - subLow) / (subHigh - subLow) * 100 || 50;
  });
  const d = dValues.reduce((a, b) => a + b, 0) / dValues.length;
  return { k, d };
}

function calculateADX(klines) {
  const period = 14;
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const prevHigh = parseFloat(klines[i - 1][2]);
    const prevLow = parseFloat(klines[i - 1][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    const plus = high - prevHigh;
    const minus = prevLow - low;
    plusDM.push(plus > minus && plus > 0 ? plus : 0);
    minusDM.push(minus > plus && minus > 0 ? minus : 0);
  }
  const atr = calculateEMA(period, tr.slice(-period));
  const plusDI = 100 * calculateEMA(period, plusDM.slice(-period)) / atr;
  const minusDI = 100 * calculateEMA(period, minusDM.slice(-period)) / atr;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 || 0;
  return calculateEMA(14, [dx, dx, dx, dx, dx, dx, dx, dx, dx, dx, dx, dx, dx, dx]);
}

function calculateCCI(klines) {
  const period = 20;
  const recent = klines.slice(-period);
  const typicalPrices = recent.map(k => (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3);
  const sma = typicalPrices.reduce((a, b) => a + b, 0) / period;
  const meanDeviation = typicalPrices.reduce((a, b) => a + Math.abs(b - sma), 0) / period;
  const currentTypical = (parseFloat(recent[recent.length - 1][2]) + parseFloat(recent[recent.length - 1][3]) + parseFloat(recent[recent.length - 1][4])) / 3;
  return (currentTypical - sma) / (0.015 * meanDeviation) || 0;
}

function calculateOBV(klines) {
  let obv = 0;
  for (let i = 1; i < klines.length; i++) {
    const close = parseFloat(klines[i][4]);
    const prevClose = parseFloat(klines[i - 1][4]);
    const volume = parseFloat(klines[i][5]);
    if (close > prevClose) obv += volume;
    else if (close < prevClose) obv -= volume;
  }
  return obv;
}

function calculateParabolicSAR(klines) {
  let sar = parseFloat(klines[0][3]);
  let ep = parseFloat(klines[0][2]);
  let af = 0.02;
  let isUptrend = true;
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    sar = sar + af * (ep - sar);
    if (isUptrend) {
      sar = Math.min(sar, parseFloat(klines[i - 1][3]), parseFloat(klines[i - 2]?.[3] || klines[i - 1][3]));
      if (sar > low) {
        isUptrend = false;
        sar = ep;
        ep = low;
        af = 0.02;
      } else if (high > ep) {
        ep = high;
        af = Math.min(af + 0.02, 0.2);
      }
    } else {
      sar = Math.max(sar, parseFloat(klines[i - 1][2]), parseFloat(klines[i - 2]?.[2] || klines[i - 1][2]));
      if (sar < high) {
        isUptrend = true;
        sar = ep;
        ep = high;
        af = 0.02;
      } else if (low < ep) {
        ep = low;
        af = Math.min(af + 0.02, 0.2);
      }
    }
  }
  return sar;
}

function detectCandlePattern(klines) {
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2] || last;
  const open = parseFloat(last[1]), high = parseFloat(last[2]), low = parseFloat(last[3]), close = parseFloat(last[4]);
  const prevOpen = parseFloat(prev[1]), prevClose = parseFloat(prev[4]);
  const body = Math.abs(close - open), upperShadow = high - Math.max(open, close), lowerShadow = Math.min(open, close) - low;
  if (lowerShadow > 2 * body && upperShadow < 0.1 * body && prevClose > prevOpen) return "Молот (Бычий)";
  if (close > prevOpen && open < prevClose && close > prevClose && open < prevOpen) return "Бычье Поглощение";
  return "Отсутствует";
}

function trainPredictionModel(klines) {
  const closes = klines.slice(-10).map(k => parseFloat(k[4]));
  if (closes.length < 10) return closes[closes.length - 1] || 0;
  const trend = (closes[closes.length - 1] - closes[0]) / 10;
  const prediction = closes[closes.length - 1] + trend * 288;
  return Math.max(closes[closes.length - 1] * 0.8, Math.min(closes[closes.length - 1] * 1.2, prediction));
}

function findLevels(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  return { support: sorted[Math.floor(sorted.length * 0.1)], resistance: sorted[Math.floor(sorted.length * 0.9)] };
}

async function aiTradeDecision(symbol) {
  const klines = await fetchKlines(symbol);
  const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
  if (closes.length === 0) return {
    direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0,
    rsi: 0, ema50: 0, ema200: 0, macd: { histogram: 0 }, bollinger: { upper: 0, middle: 0, lower: 0 },
    vwap: 0, atr: 0, stochastic: { k: 0, d: 0 }, adx: 0, cci: 0, obv: 0, sar: 0, pattern: 'Отсутствует', prediction: 0, levels: { support: 0, resistance: 0 }
  };

  const price = lastPrices[symbol];
  const rsi = calculateRSI(closes);
  const ema50 = calculateEMA(50, closes.slice(-50));
  const ema200 = calculateEMA(200, closes);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollinger(closes);
  const vwap = calculateVWAP(klines);
  const atr = calculateATR(klines);
  const stochastic = calculateStochastic(klines);
  const adx = calculateADX(klines);
  const cci = calculateCCI(klines);
  const obv = calculateOBV(klines);
  const sar = calculateParabolicSAR(klines);
  const pattern = detectCandlePattern(klines);
  const prediction = trainPredictionModel(klines);
  const levels = findLevels(closes);

  const rsiNorm = (rsi - 50) / 50;
  const macdNorm = macd.histogram / Math.abs(macd.line) || 0;
  const bollingerPosition = (price - bollinger.middle) / (bollinger.upper - bollinger.lower);
  const vwapDistance = (price - vwap) / price;
  const atrNorm = atr / price;
  const stochNorm = (stochastic.k - 50) / 50;
  const adxNorm = (adx - 25) / 25;
  const cciNorm = cci / 100;
  const predNorm = (prediction - price) / price;
  const sarDirection = price > sar ? 1 : -1;

  const weights = {
    rsi: -0.3, macd: 0.25, bollinger: -0.2, vwap: -0.1, atr: 0.1,
    stochastic: -0.3, adx: 0.4, cci: -0.35, prediction: 0.6, sar: 0.15
  };

  const score = (weights.rsi * rsiNorm) + (weights.macd * macdNorm) + (weights.bollinger * bollingerPosition) +
                (weights.vwap * vwapDistance) + (weights.atr * atrNorm) + (weights.stochastic * stochNorm) +
                (weights.adx * adxNorm) + (weights.cci * cciNorm) + (weights.prediction * predNorm) +
                (weights.sar * sarDirection);

  const confidence = Math.min(95, Math.max(5, Math.abs(score) * 100));
  let direction = score > 0 ? 'Лонг' : score < 0 ? 'Шорт' : 'Нейтрально';
  const entry = price;
  const stopLoss = direction === 'Лонг' ? price - atr * 1.5 : price + atr * 1.5;
  const takeProfit = direction === 'Лонг' ? price + atr * 3 : price - atr * 3;

  if (confidence < 5) direction = 'Нейтрально'; // Порог снижен до 5

  return {
    direction, entry, stopLoss, takeProfit, confidence, rsi, ema50, ema200, macd, bollinger,
    vwap, atr, stochastic, adx, cci, obv, sar, pattern, prediction, levels
  };
}

app.get('/data', async (req, res) => {
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
