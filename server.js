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
  try {
    const parsedData = JSON.parse(data);
    const symbol = parsedData.s;
    if (symbol && lastPrices.hasOwnProperty(symbol)) {
      lastPrices[symbol] = parseFloat(parsedData.c) || 0;
      console.log(`Обновлена цена для ${symbol}: ${lastPrices[symbol]}`);
      checkTradeStatus(symbol, lastPrices[symbol]);
    }
  } catch (error) {
    console.error('Ошибка парсинга WebSocket:', error);
  }
});

async function fetchKlines(symbol) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1000`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Klines data is not an array');
    console.log(`Получены свечи для ${symbol}`);
    return data;
  } catch (error) {
    console.error(`Ошибка получения свечей для ${symbol}:`, error.message);
    return [];
  }
}

async function fetchNewsSentiment() {
  try {
    const response = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://coindesk.com/feed');
    const data = await response.json();
    if (!data.items || !Array.isArray(data.items)) return 0;
    return data.items.slice(0, 5).reduce((sum, item) => {
      const title = item.title.toLowerCase();
      return sum + (title.includes('bull') || title.includes('up') ? 0.1 : title.includes('bear') || title.includes('down') ? -0.1 : 0);
    }, 0) / 5;
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

function calculateSMA(period, prices) {
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
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

function calculateBollingerBands(closes) {
  const period = 20;
  const sma = calculateSMA(period, closes);
  const stdDev = Math.sqrt(closes.slice(-period).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period);
  return { upper: sma + 2 * stdDev, middle: sma, lower: sma - 2 * stdDev };
}

function calculateStochastic(klines) {
  const period = 14;
  const recent = klines.slice(-period);
  const high = Math.max(...recent.map(k => parseFloat(k[2])));
  const low = Math.min(...recent.map(k => parseFloat(k[3])));
  const close = parseFloat(recent[recent.length - 1][4]);
  const k = (close - low) / (high - low) * 100 || 50;
  const d = calculateSMA(3, [k, k, k]);
  return { k, d };
}

function calculateCCI(klines) {
  const period = 20;
  const recent = klines.slice(-period);
  const typicalPrices = recent.map(k => (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3);
  const sma = calculateSMA(period, typicalPrices);
  const meanDeviation = typicalPrices.reduce((a, b) => a + Math.abs(b - sma), 0) / period;
  const currentTypical = (parseFloat(recent[recent.length - 1][2]) + parseFloat(recent[recent.length - 1][3]) + parseFloat(recent[recent.length - 1][4])) / 3;
  return (currentTypical - sma) / (0.015 * meanDeviation) || 0;
}

function calculateWilliamsR(klines) {
  const period = 14;
  const recent = klines.slice(-period);
  const high = Math.max(...recent.map(k => parseFloat(k[2])));
  const low = Math.min(...recent.map(k => parseFloat(k[3])));
  const close = parseFloat(recent[recent.length - 1][4]);
  return ((high - close) / (high - low)) * -100 || 0;
}

function calculateROC(closes) {
  const period = 12;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period] || current;
  return ((current - past) / past) * 100 || 0;
}

function calculateMomentum(closes) {
  const period = 10;
  return closes[closes.length - 1] - closes[closes.length - 1 - period] || 0;
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

function calculateIchimoku(klines) {
  const tenkanSen = (Math.max(...klines.slice(-9).map(k => parseFloat(k[2]))) + Math.min(...klines.slice(-9).map(k => parseFloat(k[3])))) / 2;
  const kijunSen = (Math.max(...klines.slice(-26).map(k => parseFloat(k[2]))) + Math.min(...klines.slice(-26).map(k => parseFloat(k[3])))) / 2;
  const senkouSpanA = (tenkanSen + kijunSen) / 2;
  const senkouSpanB = (Math.max(...klines.slice(-52).map(k => parseFloat(k[2]))) + Math.min(...klines.slice(-52).map(k => parseFloat(k[3])))) / 2;
  const chikouSpan = parseFloat(klines[klines.length - 1][4]);
  return { tenkanSen, kijunSen, senkouSpanA, senkouSpanB, chikouSpan };
}

function calculateVWAP(klines) {
  const recentKlines = klines.slice(-288);
  const vwap = recentKlines.reduce((sum, kline) => {
    const typicalPrice = (parseFloat(kline[2]) + parseFloat(kline[3]) + parseFloat(kline[4])) / 3;
    return sum + typicalPrice * parseFloat(kline[5]);
  }, 0) / recentKlines.reduce((sum, kline) => sum + parseFloat(kline[5]), 0);
  return vwap;
}

function calculateCMO(klines) {
  const period = 9;
  const prices = klines.slice(-period).map(k => parseFloat(k[4]));
  const gains = prices.slice(1).map((p, i) => p > prices[i] ? p - prices[i] : 0).reduce((a, b) => a + b, 0);
  const losses = prices.slice(1).map((p, i) => p < prices[i] ? prices[i] - p : 0).reduce((a, b) => a + b, 0);
  return (gains - losses) / (gains + losses) * 100 || 0;
}

function calculateMFI(klines) {
  const period = 14;
  const recent = klines.slice(-period);
  let positiveMF = 0, negativeMF = 0;
  for (let i = 1; i < recent.length; i++) {
    const typicalPrice = (parseFloat(recent[i][2]) + parseFloat(recent[i][3]) + parseFloat(recent[i][4])) / 3;
    const prevTypicalPrice = (parseFloat(recent[i - 1][2]) + parseFloat(recent[i - 1][3]) + parseFloat(recent[i - 1][4])) / 3;
    const rawMF = typicalPrice * parseFloat(recent[i][5]);
    if (typicalPrice > prevTypicalPrice) positiveMF += rawMF;
    else if (typicalPrice < prevTypicalPrice) negativeMF += rawMF;
  }
  const moneyRatio = positiveMF / (negativeMF || 1);
  return 100 - (100 / (1 + moneyRatio));
}

function calculateTRIX(closes) {
  const ema1 = calculateEMA(15, closes);
  const ema2 = calculateEMA(15, [ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1, ema1]);
  const ema3 = calculateEMA(15, [ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2, ema2]);
  return ((ema3 - calculateEMA(15, closes.slice(-16, -1))) / calculateEMA(15, closes.slice(-16, -1))) * 100 || 0;
}

function calculateKeltnerChannels(klines) {
  const period = 20;
  const ema = calculateEMA(period, klines.map(k => parseFloat(k[4])));
  const atr = calculateATR(klines);
  return { upper: ema + 2 * atr, middle: ema, lower: ema - 2 * atr };
}

function calculateDonchianChannels(klines) {
  const period = 20;
  const recent = klines.slice(-period);
  const high = Math.max(...recent.map(k => parseFloat(k[2])));
  const low = Math.min(...recent.map(k => parseFloat(k[3])));
  return { upper: high, middle: (high + low) / 2, lower: low };
}

function calculateAroon(klines) {
  const period = 25;
  const recent = klines.slice(-period);
  const highIdx = recent.map(k => parseFloat(k[2])).lastIndexOf(Math.max(...recent.map(k => parseFloat(k[2]))));
  const lowIdx = recent.map(k => parseFloat(k[3])).lastIndexOf(Math.min(...recent.map(k => parseFloat(k[3]))));
  const aroonUp = ((period - highIdx) / period) * 100;
  const aroonDown = ((period - lowIdx) / period) * 100;
  return { up: aroonUp, down: aroonDown };
}

function calculateChaikinOscillator(klines) {
  const periodShort = 3;
  const periodLong = 10;
  let adl = 0;
  for (let i = 0; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const close = parseFloat(klines[i][4]);
    const volume = parseFloat(klines[i][5]);
    const moneyFlowMultiplier = ((close - low) - (high - close)) / (high - low) || 0;
    adl += moneyFlowMultiplier * volume;
  }
  const adlShort = calculateEMA(periodShort, [adl, adl, adl]);
  const adlLong = calculateEMA(periodLong, [adl, adl, adl, adl, adl, adl, adl, adl, adl, adl]);
  return adlShort - adlLong;
}

function calculateUltimateOscillator(klines) {
  const period1 = 7, period2 = 14, period3 = 28;
  let bpSum1 = 0, bpSum2 = 0, bpSum3 = 0;
  let trSum1 = 0, trSum2 = 0, trSum3 = 0;
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const close = parseFloat(klines[i][4]);
    const prevClose = parseFloat(klines[i - 1][4]);
    const bp = close - Math.min(low, prevClose);
    const tr = Math.max(high, prevClose) - Math.min(low, prevClose);
    if (i <= period1) { bpSum1 += bp; trSum1 += tr; }
    if (i <= period2) { bpSum2 += bp; trSum2 += tr; }
    if (i <= period3) { bpSum3 += bp; trSum3 += tr; }
  }
  const avg1 = bpSum1 / trSum1 || 0;
  const avg2 = bpSum2 / trSum2 || 0;
  const avg3 = bpSum3 / trSum3 || 0;
  return (4 * avg1 + 2 * avg2 + avg3) / 7 * 100;
}

function calculateLinearRegressionSlope(closes) {
  const period = 20;
  const x = Array.from({ length: period }, (_, i) => i + 1);
  const y = closes.slice(-period);
  const xMean = x.reduce((a, b) => a + b, 0) / period;
  const yMean = y.reduce((a, b) => a + b, 0) / period;
  const numerator = x.reduce((sum, xi, i) => sum + (xi - xMean) * (y[i] - yMean), 0);
  const denominator = x.reduce((sum, xi) => sum + Math.pow(xi - xMean, 2), 0);
  return numerator / denominator || 0;
}

function findLevels(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
  const priceRange = Math.max(...closes) - Math.min(...closes);
  const bins = 50;
  const binSize = priceRange / bins;
  const density = Array(bins).fill(0);
  closes.forEach(price => {
    const bin = Math.min(bins - 1, Math.floor((price - Math.min(...closes)) / binSize));
    density[bin] += 1;
  });
  const sortedBins = density.map((d, i) => ({ density: d, price: Math.min(...closes) + i * binSize }))
    .sort((a, b) => b.density - a.density);
  return { support: sortedBins[Math.floor(sortedBins.length * 0.75)].price, resistance: sortedBins[Math.floor(sortedBins.length * 0.25)].price };
}

function predictPrice(klines, rsi, macd) {
  const period = 20;
  const recent = klines.slice(-period);
  const x = recent.map((_, i) => [
    i,
    parseFloat(_[4]),
    parseFloat(_[5]),
    i === period - 1 ? rsi : calculateRSI(recent.map(k => parseFloat(k[4])).slice(0, i + 1)),
    i === period - 1 ? macd.histogram : calculateMACD(recent.map(k => parseFloat(k[4])).slice(0, i + 1)).histogram
  ]);
  const y = recent.map(k => parseFloat(k[4]));
  const xMean = x[0].map((_, col) => x.reduce((sum, row) => sum + row[col], 0) / period);
  const yMean = y.reduce((a, b) => a + b, 0) / period;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < period; i++) {
    let xDiffSum = 0;
    for (let j = 0; j < xMean.length; j++) xDiffSum += (x[i][j] - xMean[j]);
    numerator += xDiffSum * (y[i] - yMean);
    denominator += xDiffSum * xDiffSum;
  }
  const slope = numerator / (denominator || 1);
  const intercept = yMean - slope * xMean.reduce((a, b) => a + b, 0) / xMean.length;
  const nextX = [period, y[period - 1], parseFloat(recent[recent.length - 1][5]), rsi, macd.histogram];
  return intercept + slope * nextX.reduce((a, b) => a + b, 0) / nextX.length;
}

async function aiTradeDecision(symbol, newsSentiment, klines) {
  const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
  if (closes.length === 0) return { direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0, rrr: '0/0', indicators: {} };

  const price = lastPrices[symbol] || closes[closes.length - 1];
  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const atr = calculateATR(klines);
  const adx = calculateADX(klines);
  const sma20 = calculateSMA(20, closes);
  const bollinger = calculateBollingerBands(closes);
  const stochastic = calculateStochastic(klines);
  const cci = calculateCCI(klines);
  const williamsR = calculateWilliamsR(klines);
  const roc = calculateROC(closes);
  const momentum = calculateMomentum(closes);
  const obv = calculateOBV(klines);
  const sar = calculateParabolicSAR(klines);
  const ichimoku = calculateIchimoku(klines);
  const vwap = calculateVWAP(klines);
  const cmo = calculateCMO(klines);
  const mfi = calculateMFI(klines);
  const trix = calculateTRIX(closes);
  const keltner = calculateKeltnerChannels(klines);
  const donchian = calculateDonchianChannels(klines);
  const aroon = calculateAroon(klines);
  const chaikin = calculateChaikinOscillator(klines);
  const ultimate = calculateUltimateOscillator(klines);
  const linRegSlope = calculateLinearRegressionSlope(closes);
  const levels = findLevels(klines);
  const predictedPrice = predictPrice(klines, rsi, macd);

  const indicators = {
    rsi: rsi.toFixed(2),
    macd_line: macd.line.toFixed(4), macd_signal: macd.signal.toFixed(4), macd_histogram: macd.histogram.toFixed(4),
    atr: atr.toFixed(4),
    adx: adx.toFixed(2),
    sma20: sma20.toFixed(4),
    bollinger_upper: bollinger.upper.toFixed(4), bollinger_middle: bollinger.middle.toFixed(4), bollinger_lower: bollinger.lower.toFixed(4),
    stochastic_k: stochastic.k.toFixed(2), stochastic_d: stochastic.d.toFixed(2),
    cci: cci.toFixed(2),
    williamsR: williamsR.toFixed(2),
    roc: roc.toFixed(2),
    momentum: momentum.toFixed(4),
    obv: obv.toFixed(0),
    sar: sar.toFixed(4),
    ichimoku_tenkan: ichimoku.tenkanSen.toFixed(4), ichimoku_kijun: ichimoku.kijunSen.toFixed(4), ichimoku_senkouA: ichimoku.senkouSpanA.toFixed(4), ichimoku_senkouB: ichimoku.senkouSpanB.toFixed(4), ichimoku_chikou: ichimoku.chikouSpan.toFixed(4),
    vwap: vwap.toFixed(4),
    cmo: cmo.toFixed(2),
    mfi: mfi.toFixed(2),
    trix: trix.toFixed(2),
    keltner_upper: keltner.upper.toFixed(4), keltner_middle: keltner.middle.toFixed(4), keltner_lower: keltner.lower.toFixed(4),
    donchian_upper: donchian.upper.toFixed(4), donchian_middle: donchian.middle.toFixed(4), donchian_lower: donchian.lower.toFixed(4),
    aroon_up: aroon.up.toFixed(2), aroon_down: aroon.down.toFixed(2),
    chaikin: chaikin.toFixed(2),
    ultimate: ultimate.toFixed(2),
    linRegSlope: linRegSlope.toFixed(4),
    support: levels.support.toFixed(4), resistance: levels.resistance.toFixed(4)
  };

  // Фильтры для исключения слабых сигналов
  if (adx < 20 || atr / price > 0.05 || stochastic.k > 80 || stochastic.k < 20 || cci > 100 || cci < -100 || williamsR > -20 || williamsR < -80 || price > bollinger.upper || price < bollinger.lower || mfi > 80 || mfi < 20 || price > keltner.upper || price < keltner.lower) {
    return { direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0, rrr: '0/0', indicators };
  }

  const recentCloses = closes.slice(-10);
  let confidences = [];
  for (let i = 0; i < recentCloses.length; i++) {
    const subCloses = closes.slice(0, closes.length - 10 + i + 1);
    const subKlines = klines.slice(0, klines.length - 10 + i + 1);
    const subRsi = calculateRSI(subCloses);
    const subMacd = calculateMACD(subCloses);
    const subAdx = calculateADX(subKlines);
    const subScore = (subRsi - 50) / 50 + subMacd.histogram / Math.abs(subMacd.line) + (subAdx - 25) / 25 + newsSentiment;
    confidences.push(Math.abs(subScore) * 10);
  }
  const confidenceStability = Math.max(...confidences) - Math.min(...confidences);
  const rawConfidence = confidences[confidences.length - 1];
  const confidence = Math.round(rawConfidence * (1 - confidenceStability / 50) + (predictedPrice > price ? 15 : -15));

  let direction = rsi > 45 && macd.line > macd.signal && price > sma20 ? 'Лонг' : rsi < 55 && macd.line < macd.signal && price < sma20 ? 'Шорт' : 'Нейтрально';

  const tradeData = trades[symbol];
  let entry, stopLoss, takeProfit;

  if (tradeData.active) {
    direction = tradeData.active.direction;
    entry = tradeData.active.entry;
    stopLoss = tradeData.active.stopLoss;
    takeProfit = tradeData.active.takeProfit;
  } else {
    entry = price;
    if (direction === 'Лонг' && confidence >= 50 && confidenceStability <= 25) {
      stopLoss = entry - atr; // Риск = 1 ATR
      takeProfit = entry + atr * 2; // Прибыль = 2 ATR
      tradeData.active = { direction, entry, stopLoss, takeProfit };
      tradeData.openCount++;
      console.log(`${symbol}: Сделка ${direction} открыта: entry=${entry}, stopLoss=${stopLoss}, takeProfit=${takeProfit}, confidence=${confidence}, stability=${confidenceStability}, adx=${adx}`);
    } else if (direction === 'Шорт' && confidence >= 50 && confidenceStability <= 25) {
      stopLoss = entry + atr; // Риск = 1 ATR
      takeProfit = entry - atr * 2; // Прибыль = 2 ATR
      tradeData.active = { direction, entry, stopLoss, takeProfit };
      tradeData.openCount++;
      console.log(`${symbol}: Сделка ${direction} открыта: entry=${entry}, stopLoss=${stopLoss}, takeProfit=${takeProfit}, confidence=${confidence}, stability=${confidenceStability}, adx=${adx}`);
    } else {
      stopLoss = takeProfit = entry;
      direction = 'Нейтрально';
    }
  }

  const profit = direction === 'Лонг' ? takeProfit - entry : entry - takeProfit;
  const risk = direction === 'Лонг' ? entry - stopLoss : stopLoss - entry;
  const rrr = risk > 0 ? Math.round(profit / risk) : 0;

  return { direction, entry, stopLoss, takeProfit, confidence, rrr: rrr > 0 ? `1/${rrr}` : '0/0', indicators };
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

async function updateMarketSentiment() {
  const topPairs = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOGEUSDT', 'DOTUSDT', 'SHIBUSDT', 'TRXUSDT',
    'MATICUSDT', 'AVAXUSDT', 'LTCUSDT', 'LINKUSDT', 'XLMUSDT', 'BCHUSDT', 'ALGOUSDT', 'VETUSDT', 'XMRUSDT', 'ETCUSDT'
  ];
  sentiment = { long: 0, short: 0, total: 0 };

  for (const symbol of topPairs) {
    const klines = await fetchKlines(symbol);
    if (klines.length === 0) continue;
    const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
    if (closes.length === 0) continue;

    sentiment.total++;
    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const adx = calculateADX(klines);
    const score = (rsi - 50) / 50 + macd.histogram / Math.abs(macd.line) + (adx - 25) / 25;
    if (score > 0) sentiment.long++;
    else if (score < 0) sentiment.short++;
  }

  sentiment.long = Math.round((sentiment.long / sentiment.total) * 100);
  sentiment.short = Math.round((sentiment.short / sentiment.total) * 100);
  console.log('Sentiment updated:', sentiment);
}

app.get('/data', async (req, res) => {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  let recommendations = {};
  const newsSentiment = await fetchNewsSentiment();
  await updateMarketSentiment();

  for (const symbol of symbols) {
    try {
      const klines = await fetchKlines(symbol);
      recommendations[symbol] = await aiTradeDecision(symbol, newsSentiment, klines);
    } catch (error) {
      console.error(`Ошибка обработки ${symbol}:`, error);
      recommendations[symbol] = { direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0, rrr: '0/0', indicators: {} };
    }
  }

  console.log('Sending data:', { prices: lastPrices, recommendations, sentiment, trades });
  res.json({ prices: lastPrices, recommendations, sentiment, trades });
});

// Используем порт от Render или 3000 локально
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
