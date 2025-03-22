const express = require('express');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const app = express();

app.use(express.static('public'));

let lastPrices = { LDOUSDT: 0, AVAXUSDT: 0, XLMUSDT: 0, HBARUSDT: 0, BATUSDT: 0, AAVEUSDT: 0 };
let sentiment = { long: 0, short: 0, total: 0 };
let trades = {
  LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  XLMUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  HBARUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  BATUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }
};
const TRADE_AMOUNT = 100;
const BINANCE_FEE = 0.001;

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
    checkTradeStatus(parsedData.s, lastPrices[parsedData.s]);
  }
});

async function fetchKlines(symbol) {
  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=1000`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Klines data is not an array');
    return data;
  } catch (error) {
    console.error(`Ошибка получения свечей для ${symbol}:`, error);
    return [];
  }
}

async function fetchOrderBook(symbol) {
  try {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10`);
    const data = await response.json();
    const bidVolume = data.bids.reduce((sum, bid) => sum + parseFloat(bid[1]), 0);
    const askVolume = data.asks.reduce((sum, ask) => sum + parseFloat(ask[1]), 0);
    return { bidVolume, askVolume };
  } catch (error) {
    console.error(`Ошибка получения глубины рынка для ${symbol}:`, error);
    return { bidVolume: 0, askVolume: 0 };
  }
}

async function fetchNewsSentiment() {
  try {
    const response = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://coindesk.com/feed');
    const data = await response.json();
    if (!data.items || !Array.isArray(data.items)) return 0;
    const sentimentScore = data.items.slice(0, 5).reduce((sum, item) => {
      const title = item.title.toLowerCase();
      return sum + (title.includes('bull') || title.includes('up') ? 0.1 : title.includes('bear') || title.includes('down') ? -0.1 : 0);
    }, 0) / 5;
    return sentimentScore;
  } catch (error) {
    console.error('Ошибка получения новостей:', error);
    return 0;
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

function calculateVWMACD(klines) {
  const prices = klines.map(k => parseFloat(k[4]));
  const volumes = klines.map(k => parseFloat(k[5]));
  const ema12 = calculateEMA(12, prices.slice(-26).map((p, i) => p * volumes[i + klines.length - 26] / volumes.slice(-26).reduce((a, b) => a + b)));
  const ema26 = calculateEMA(26, prices.slice(-26).map((p, i) => p * volumes[i + klines.length - 26] / volumes.slice(-26).reduce((a, b) => a + b)));
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

function calculateCMO(klines) {
  const period = 9;
  const prices = klines.slice(-period).map(k => parseFloat(k[4]));
  const gains = prices.slice(1).map((p, i) => p > prices[i] ? p - prices[i] : 0).reduce((a, b) => a + b, 0);
  const losses = prices.slice(1).map((p, i) => p < prices[i] ? prices[i] - p : 0).reduce((a, b) => a + b, 0);
  return (gains - losses) / (gains + losses) * 100 || 0;
}

function calculateHeikinAshi(klines) {
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2] || last;
  const haClose = (parseFloat(last[1]) + parseFloat(last[2]) + parseFloat(last[3]) + parseFloat(last[4])) / 4;
  const haOpen = prev ? (parseFloat(prev[1]) + parseFloat(prev[4])) / 2 : parseFloat(last[1]);
  const haHigh = Math.max(parseFloat(last[2]), haOpen, haClose);
  const haLow = Math.min(parseFloat(last[3]), haOpen, haClose);
  return { open: haOpen, high: haHigh, low: haLow, close: haClose };
}

function calculateMomentum(closes, period = 10) {
  return closes[closes.length - 1] - closes[closes.length - 1 - period] || 0;
}

function calculateWilliamsR(klines) {
  const period = 14;
  const recent = klines.slice(-period);
  const high = Math.max(...recent.map(k => parseFloat(k[2])));
  const low = Math.min(...recent.map(k => parseFloat(k[3])));
  const close = parseFloat(recent[recent.length - 1][4]);
  return ((high - close) / (high - low)) * -100 || 0;
}

function calculateROC(closes, period = 12) {
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period] || current;
  return ((current - past) / past) * 100 || 0;
}

function calculateIchimoku(klines) {
  const tenkanSen = (Math.max(...klines.slice(-9).map(k => parseFloat(k[2]))) + Math.min(...klines.slice(-9).map(k => parseFloat(k[3])))) / 2;
  const kijunSen = (Math.max(...klines.slice(-26).map(k => parseFloat(k[2]))) + Math.min(...klines.slice(-26).map(k => parseFloat(k[3])))) / 2;
  const senkouSpanA = (tenkanSen + kijunSen) / 2;
  const senkouSpanB = (Math.max(...klines.slice(-52).map(k => parseFloat(k[2]))) + Math.min(...klines.slice(-52).map(k => parseFloat(k[3])))) / 2;
  const chikouSpan = parseFloat(klines[klines.length - 1][4]);
  return { tenkanSen, kijunSen, senkouSpanA, senkouSpanB, chikouSpan };
}

function calculatePivotPoints(klines) {
  const last = klines[klines.length - 1];
  const high = parseFloat(last[2]);
  const low = parseFloat(last[3]);
  const close = parseFloat(last[4]);
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  const r2 = pivot + (high - low);
  const s2 = pivot - (high - low);
  return { pivot, r1, s1, r2, s2 };
}

function calculateFibonacci(klines) {
  const period = 50;
  const recent = klines.slice(-period);
  const high = Math.max(...recent.map(k => parseFloat(k[2])));
  const low = Math.min(...recent.map(k => parseFloat(k[3])));
  const diff = high - low;
  return {
    level0: low,
    level236: low + 0.236 * diff,
    level382: low + 0.382 * diff,
    level5: low + 0.5 * diff,
    level618: low + 0.618 * diff,
    level1: high
  };
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

function backtestSignal(symbol, direction, entry, stopLoss, takeProfit, klines) {
  const recentKlines = klines.slice(-200);
  let longWins = 0, longLosses = 0, shortWins = 0, shortLosses = 0;
  for (let i = 0; i < recentKlines.length - 1; i++) {
    const high = parseFloat(recentKlines[i + 1][2]);
    const low = parseFloat(recentKlines[i + 1][3]);
    if (high >= takeProfit) longWins++;
    else if (low <= stopLoss) longLosses++;
    if (low <= takeProfit) shortWins++;
    else if (high >= stopLoss) shortLosses++;
  }
  const winRateLong = longWins / (longWins + longLosses) || 0;
  const winRateShort = shortWins / (shortWins + shortLosses) || 0;
  return { winRateLong, winRateShort };
}

async function aiTradeDecision(symbol, newsSentiment) {
  const klines = await fetchKlines(symbol);
  const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
  if (closes.length === 0) return {
    direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0,
    rsi: 0, ema50: 0, ema200: 0, macd: { histogram: 0 }, vwmacd: { histogram: 0 }, bollinger: { upper: 0, middle: 0, lower: 0 },
    vwap: 0, atr: 0, stochastic: { k: 0, d: 0 }, adx: 0, cci: 0, cmo: 0, obv: 0, sar: 0, heikin: { close: 0 },
    momentum: 0, williamsR: 0, roc: 0, ichimoku: { tenkanSen: 0, kijunSen: 0 }, pivot: { pivot: 0, r1: 0, s1: 0 },
    fibonacci: { level5: 0 }, orderBook: { bidVolume: 0, askVolume: 0 }, pattern: 'Отсутствует', prediction: 0, levels: { support: 0, resistance: 0 },
    winRateLong: 0, winRateShort: 0
  };

  const price = lastPrices[symbol] || closes[closes.length - 1];
  const rsi = calculateRSI(closes);
  const ema50 = calculateEMA(50, closes.slice(-50));
  const ema200 = calculateEMA(200, closes);
  const macd = calculateMACD(closes);
  const vwmacd = calculateVWMACD(klines);
  const bollinger = calculateBollinger(closes);
  const vwap = calculateVWAP(klines);
  const atr = calculateATR(klines);
  const stochastic = calculateStochastic(klines);
  const adx = calculateADX(klines);
  const cci = calculateCCI(klines);
  const cmo = calculateCMO(klines);
  const obv = calculateOBV(klines);
  const sar = calculateParabolicSAR(klines);
  const heikin = calculateHeikinAshi(klines);
  const momentum = calculateMomentum(closes);
  const williamsR = calculateWilliamsR(klines);
  const roc = calculateROC(closes);
  const ichimoku = calculateIchimoku(klines);
  const pivot = calculatePivotPoints(klines);
  const fibonacci = calculateFibonacci(klines);
  const orderBook = await fetchOrderBook(symbol);
  const pattern = detectCandlePattern(klines);
  const prediction = trainPredictionModel(klines);
  const levels = findLevels(closes);

  const rsiNorm = (rsi - 50) / 50;
  const macdNorm = macd.histogram / Math.abs(macd.line) || 0;
  const vwmacdNorm = vwmacd.histogram / Math.abs(vwmacd.line) || 0;
  const bollingerPosition = (price - bollinger.middle) / (bollinger.upper - bollinger.lower);
  const vwapDistance = (price - vwap) / price;
  const atrNorm = atr / price;
  const stochNorm = (stochastic.k - 50) / 50;
  const adxNorm = (adx - 25) / 25;
  const cciNorm = cci / 100;
  const cmoNorm = cmo / 50;
  const predNorm = (prediction - price) / price;
  const sarDirection = price > sar ? 1 : -1;
  const heikinTrend = heikin.close > heikin.open ? 1 : -1;
  const momNorm = momentum / price;
  const williamsNorm = (williamsR + 50) / 50;
  const rocNorm = roc / 100;
  const ichimokuTrend = price > ichimoku.kijunSen ? 1 : -1;
  const pivotPosition = (price - pivot.pivot) / (pivot.r1 - pivot.s1);
  const fibPosition = (price - fibonacci.level0) / (fibonacci.level1 - fibonacci.level0);
  const orderBookPressure = (orderBook.bidVolume - orderBook.askVolume) / (orderBook.bidVolume + orderBook.askVolume) || 0;

  const weights = {
    rsi: -0.3, macd: 0.25, vwmacd: 0.3, bollinger: -0.2, vwap: -0.1, atr: 0.1,
    stochastic: -0.3, adx: 0.4, cci: -0.35, cmo: -0.25, prediction: 0.6, sar: 0.15,
    heikin: 0.2, momentum: 0.15, williamsR: -0.2, roc: 0.15, ichimoku: 0.25,
    pivot: -0.15, fibonacci: -0.2, orderBook: 0.2, news: 0.3
  };

  const score = (weights.rsi * rsiNorm) + (weights.macd * macdNorm) + (weights.vwmacd * vwmacdNorm) +
                (weights.bollinger * bollingerPosition) + (weights.vwap * vwapDistance) + (weights.atr * atrNorm) +
                (weights.stochastic * stochNorm) + (weights.adx * adxNorm) + (weights.cci * cciNorm) +
                (weights.cmo * cmoNorm) + (weights.prediction * predNorm) + (weights.sar * sarDirection) +
                (weights.heikin * heikinTrend) + (weights.momentum * momNorm) + (weights.williamsR * williamsNorm) +
                (weights.roc * rocNorm) + (weights.ichimoku * ichimokuTrend) + (weights.pivot * pivotPosition) +
                (weights.fibonacci * fibPosition) + (weights.orderBook * orderBookPressure) + (weights.news * newsSentiment);

  const confidence = Math.min(95, Math.max(5, Math.abs(score) * 100));
  let direction = score > 0 ? 'Лонг' : score < 0 ? 'Шорт' : 'Нейтрально';
  const entry = price;
  const stopLoss = direction === 'Лонг' ? price - atr * 1.5 : price + atr * 1.5;
  const takeProfit = direction === 'Лонг' ? price + atr * 3 : price - atr * 3;

  const backtest = backtestSignal(symbol, direction, entry, stopLoss, takeProfit, klines);
  if (confidence < 50 || (rsi > 40 && rsi < 60 && Math.abs(score) < 0.5)) direction = 'Нейтрально';

  return {
    direction, entry, stopLoss, takeProfit, confidence, rsi, ema50, ema200, macd, vwmacd, bollinger,
    vwap, atr, stochastic, adx, cci, cmo, obv, sar, heikin, momentum, williamsR, roc, ichimoku,
    pivot, fibonacci, orderBook, pattern, prediction, levels, winRateLong: backtest.winRateLong * 100, winRateShort: backtest.winRateShort * 100
  };
}

function checkTradeStatus(symbol, currentPrice) {
  const tradeData = trades[symbol];
  if (tradeData && tradeData.active) {
    const { entry, stopLoss, takeProfit, direction } = tradeData.active;
    if (direction === 'Лонг') {
      if (currentPrice <= stopLoss) {
        const loss = TRADE_AMOUNT * (entry - stopLoss);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalLoss += loss + commission;
        tradeData.stopCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} + комиссия: ${commission.toFixed(2)}`);
      } else if (currentPrice >= takeProfit) {
        const profit = TRADE_AMOUNT * (takeProfit - entry);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} - комиссия: ${commission.toFixed(2)}`);
      }
    } else if (direction === 'Шорт') {
      if (currentPrice >= stopLoss) {
        const loss = TRADE_AMOUNT * (stopLoss - entry);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalLoss += loss + commission;
        tradeData.stopCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} + комиссия: ${commission.toFixed(2)}`);
      } else if (currentPrice <= takeProfit) {
        const profit = TRADE_AMOUNT * (entry - takeProfit);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} - комиссия: ${commission.toFixed(2)}`);
      }
    }
  }
}

function manageTrades(symbol, entry, stopLoss, takeProfit, direction, confidence, klines) {
  const tradeData = trades[symbol];
  if (tradeData.active || confidence < 50) return;

  tradeData.active = { direction, entry, stopLoss, takeProfit };
  tradeData.openCount++;
  console.log(`${symbol}: Сделка ${direction} открыта: entry=${entry}, stopLoss=${stopLoss}, takeProfit=${takeProfit}`);
}

async function updateMarketSentiment() {
  const topPairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOGEUSDT', 'DOTUSDT', 'TRXUSDT', 'SHIBUSDT',
                    'MATICUSDT', 'LINKUSDT', 'LTCUSDT', 'BCHUSDT', 'XLMUSDT', 'AVAXUSDT', 'LDOUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  const newsSentiment = await fetchNewsSentiment();
  sentiment = { long: 0, short: 0, total: topPairs.length };

  for (const symbol of topPairs) {
    const klines = await fetchKlines(symbol);
    const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
    if (closes.length === 0) continue;

    const price = closes[closes.length - 1];
    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const score = (rsi - 50) / 50 + macd.histogram / Math.abs(macd.line) + newsSentiment;
    if (score > 0) sentiment.long++;
    else if (score < 0) sentiment.short++;
  }
}

app.get('/data', async (req, res) => {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  let recommendations = {};
  const newsSentiment = await fetchNewsSentiment();
  await updateMarketSentiment();

  for (let symbol of symbols) {
    const decision = await aiTradeDecision(symbol, newsSentiment);
    recommendations[symbol] = decision;
    manageTrades(symbol, decision.entry, decision.stopLoss, decision.takeProfit, decision.direction, decision.confidence, await fetchKlines(symbol));
  }

  res.json({ prices: lastPrices, recommendations, sentiment, trades });
});

app.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});
