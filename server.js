const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.static('public'));

let lastPrices = { LDOUSDT: 0, AVAXUSDT: 0, AAVEUSDT: 0, BTCUSDT: 0, ETHUSDT: 0 };
let tradesMain = {
  LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }
};
let tradesTest = {
  LDOUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  AVAXUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 },
  AAVEUSDT: { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 }
};
let aiLogs = [];
let aiLearnings = [];
let aiMistakes = [];
const TRADE_AMOUNT = 100;
const BINANCE_FEE = 0.001;
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];
let lastRecommendations = {};
let learningWeights = {
  LDOUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1 },
  AVAXUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1 },
  AAVEUSDT: { distance: 1, volume: 1, ema: 1, fibo: 1, btcEth: 1, trend: 1, wick: 1, spike: 1, engulf: 1, reaction: 1, balance: 1, levels: 1 }
};

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i < retries - 1) {
        console.log(`Попытка ${i + 1} не удалась: ${error.message}. Повтор через ${delay}мс`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

async function fetchKlines(symbol, timeframe) {
  try {
    const response = await fetchWithRetry(`https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=1000`);
    return response;
  } catch (error) {
    console.error(`Ошибка свечей ${symbol} ${timeframe}:`, error.message);
    return [];
  }
}

async function updatePrices() {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'AAVEUSDT', 'BTCUSDT', 'ETHUSDT'];
  for (const symbol of symbols) {
    try {
      const data = await fetchWithRetry(`https://api.binance.us/api/v3/ticker/price?symbol=${symbol}`);
      lastPrices[symbol] = parseFloat(data.price) || lastPrices[symbol];
      console.log(`Обновлена цена для ${symbol}: ${lastPrices[symbol]}`);
      checkTradeStatus(symbol, lastPrices[symbol], tradesMain);
      checkTradeStatus(symbol, lastPrices[symbol], tradesTest);
    } catch (error) {
      console.error(`Ошибка загрузки цены для ${symbol}:`, error.message);
    }
  }
}

setInterval(updatePrices, 10000);
updatePrices();

function gauss(x, h) {
  return Math.exp(-(Math.pow(x, 2) / (h * h * 2)));
}

function calculateNadarayaWatsonEnvelope(closes) {
  const n = closes.length;
  let smooth = 0;
  let sumWeights = 0;

  for (let j = 0; j < Math.min(499, n - 1); j++) {
    const w = gauss(0 - j, 8);
    sumWeights += w;
    smooth += closes[n - 1 - j] * w;
  }
  smooth /= sumWeights;

  let sae = 0;
  for (let i = 0; i < Math.min(499, n - 1); i++) {
    let sum = 0;
    let sumw = 0;
    for (let j = 0; j < Math.min(499, n - 1); j++) {
      const w = gauss(i - j, 8);
      sum += closes[n - 1 - j] * w;
      sumw += w;
    }
    const y = sum / sumw;
    sae += Math.abs(closes[n - 1 - i] - y);
  }
  const mae = (sae / Math.min(499, n - 1)) * 3;

  const upper = smooth + mae;
  const lower = smooth - mae;

  return { upper, lower, smooth };
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
  const last = klines[klines.length - 1];
  const high = parseFloat(last[2]);
  const low = parseFloat(last[3]);
  const close = parseFloat(last[4]);
  const upperWick = high - close;
  const lowerWick = close - low;
  return { upper: upperWick, lower: lowerWick };
}

function getSpike(klines) {
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const change = Math.abs(parseFloat(last[4]) - parseFloat(prev[4])) / parseFloat(prev[4]) * 100;
  return change > 1 ? change : 0;
}

function getEngulfing(klines) {
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
  return { resistance: Math.max(...highs), support: Math.min(...lows) };
}

async function checkCorrelation(symbol, klines) {
  try {
    const last50 = klines.slice(-50).map(k => parseFloat(k[4]));
    const btcKlines = await fetchKlines('BTCUSDT', '5m');
    const ethKlines = await fetchKlines('ETHUSDT', '5m');
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
  const priceRange = Math.max(...last10.map(k => parseFloat(k[2]))) - Math.min(...last10.map(k => parseFloat(k[3])));
  return volumes.slice(-3).every(v => v > avgVolume * 1.2) && priceRange < (lastPrices[klines[0][0]] || 0) * 0.005;
}

async function aiTradeDecision(symbol, klinesByTimeframe) {
  const price = lastPrices[symbol] || 0;
  let recommendations = {};
  const btcPrice = lastPrices['BTCUSDT'];
  const ethPrice = lastPrices['ETHUSDT'];

  for (const tf of TIMEFRAMES) {
    const klines = klinesByTimeframe[tf] || [];
    const closes = klines.length > 0 ? klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c)) : [price];
    const nw = closes.length > 1 ? calculateNadarayaWatsonEnvelope(closes) : { upper: price * 1.05, lower: price * 0.95, smooth: price };
    const volume = klines.length > 1 ? calculateVolume(klines) : 0;
    const ema50 = klines.length > 1 ? calculateEMA(closes, 50) : price;
    const ema200 = klines.length > 1 ? calculateEMA(closes, 200) : price;
    const fib = klines.length > 1 ? calculateFibonacci(klines) : { 0.5: price, 0.618: price };
    const lastKline = klines[klines.length - 1] || [0, 0, 0, 0, 0, 0];
    const vol = parseFloat(lastKline[5]) || 0;
    const trend = getTrend(klines);
    const wick = getWick(klines);
    const spike = getSpike(klines);
    const engulfing = getEngulfing(klines);
    const levels = getLevels(klines);
    const boundaryTrend = nw.upper > nw.upper - (closes[closes.length - 50] || 0) ? 'вверх' : 'вниз';
    const frequentExits = klines.slice(-50).filter(k => parseFloat(k[4]) > nw.upper || parseFloat(k[4]) < nw.lower).length > 5;
    const lowBtcEthCorr = await checkCorrelation(symbol, klines);
    const accumulation = checkAccumulation(klines);

    const outsideChannel = price > nw.upper || price < nw.lower;
    const direction = outsideChannel ? (price > nw.upper ? 'Шорт' : 'Лонг') : 'Нет';
    const market = outsideChannel ? (price > nw.upper ? 'Восходящий' : 'Нисходящий') : 'Флет';
    const forecast = direction === 'Шорт' || (direction === 'Нет' && trend === 'вниз') ? 'падение' : 'рост';
    let confidence = 0;

    if (direction !== 'Нет') {
      confidence += Math.min(100, Math.round(Math.abs(price - (direction === 'Шорт' ? nw.upper : nw.lower)) / price * 200)) * learningWeights[symbol].distance;
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
        aiLearnings.push(`${new Date().toLocaleString()}: ${symbol} ${tf} — Низкая корреляция с BTC/ETH, уменьшил их вес до ${learningWeights[symbol].btcEth.toFixed(2)}.`);
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
      confidence = Math.min(100, Math.round(confidence));
    }

    const entry = price;
    const stopLoss = direction === 'Лонг' ? entry * 0.995 : direction === 'Шорт' ? entry * 1.005 : entry;
    const takeProfit = direction === 'Лонг' ? entry * 1.01 : direction === 'Шорт' ? entry * 0.99 : entry;
    const reasoning = direction === 'Шорт' ? 
      `Тренд ${trend}. Цена ${price.toFixed(4)} выше верхней ${nw.upper.toFixed(4)}, объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}. Хвост вверх ${wick.upper.toFixed(4)}, вниз ${wick.lower.toFixed(4)}, скачок ${spike.toFixed(2)}%, поглощение ${engulfing}. Уровень сопротивления ${levels.resistance.toFixed(4)}, поддержка ${levels.support.toFixed(4)}. Границы канала движутся ${boundaryTrend}. ${accumulation ? 'Накопление объёмов — возможен разворот или продолжение.' : ''}` : 
      direction === 'Лонг' ? 
      `Тренд ${trend}. Цена ${price.toFixed(4)} ниже нижней ${nw.lower.toFixed(4)}, объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}. Хвост вверх ${wick.upper.toFixed(4)}, вниз ${wick.lower.toFixed(4)}, скачок ${spike.toFixed(2)}%, поглощение ${engulfing}. Уровень сопротивления ${levels.resistance.toFixed(4)}, поддержка ${levels.support.toFixed(4)}. Границы канала движутся ${boundaryTrend}. ${accumulation ? 'Накопление объёмов — возможен разворот или продолжение.' : ''}` : 
      `Тренд ${trend}. Цена ${price.toFixed(4)} внутри ${nw.lower.toFixed(4)}–${nw.upper.toFixed(4)}, объём ${volume.toFixed(2)}, EMA200 ${ema200.toFixed(4)}. Хвост вверх ${wick.upper.toFixed(4)}, вниз ${wick.lower.toFixed(4)}, скачок ${spike.toFixed(2)}%, поглощение ${engulfing}. Уровень сопротивления ${levels.resistance.toFixed(4)}, поддержка ${levels.support.toFixed(4)}. Границы канала движутся ${boundaryTrend}. ${accumulation ? 'Накопление объёмов — возможен разворот или продолжение.' : ''}`;

    recommendations[tf] = { direction, confidence, outsideChannel, entry, stopLoss, takeProfit, market, trend, pivot: nw.smooth, reasoning, forecast };
  }

  lastRecommendations[symbol] = recommendations;
  return recommendations;
}

function checkTradeStatus(symbol, currentPrice, trades) {
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
        aiLogs.push(`${new Date().toLocaleString()} | ${symbol} ${timeframe} Лонг | Убыток -${(loss + commission).toFixed(2)} USDT | Цена упала до ${currentPrice.toFixed(4)}, стоп-лосс ${stopLoss.toFixed(4)}. Слишком слабый сигнал, снижаю вес расстояния и объёмов. Жду чётких трендов.`); 
        aiMistakes.push(`Ошибка: ${symbol} ${timeframe} Лонг не сработал. Цена ${currentPrice.toFixed(4)} не удержалась выше ${stopLoss.toFixed(4)}. Вывод: сигнал был слабым, нужно больше объёмов.`); 
        if (aiLogs.length > 10) aiLogs.shift();
        tradeData.active = null;
      } else if (currentPrice >= takeProfit) {
        const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        learningWeights[symbol].distance *= 1.05;
        learningWeights[symbol].volume *= 1.05;
        aiLogs.push(`${new Date().toLocaleString()} | ${symbol} ${timeframe} Лонг | Прибыль +${(profit - commission).toFixed(2)} USDT | Цена выросла до ${currentPrice.toFixed(4)}, профит ${takeProfit.toFixed(4)}. Хороший сигнал, повышаю вес расстояния и объёмов. Ищу похожие возможности.`); 
        aiLearnings.push(`Успех: ${symbol} ${timeframe} Лонг сработал. Цена ${currentPrice.toFixed(4)} достигла ${takeProfit.toFixed(4)}. Вывод: расстояние от канала и объёмы дали точный сигнал.`); 
        if (aiLogs.length > 10) aiLogs.shift();
        tradeData.active = null;
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
        aiLogs.push(`${new Date().toLocaleString()} | ${symbol} ${timeframe} Шорт | Убыток -${(loss + commission).toFixed(2)} USDT | Цена выросла до ${currentPrice.toFixed(4)}, стоп-лосс ${stopLoss.toFixed(4)}. Ошибка в сигнале, снижаю вес расстояния и объёмов. Проверяю уровни.`); 
        aiMistakes.push(`Ошибка: ${symbol} ${timeframe} Шорт не сработал. Цена ${currentPrice.toFixed(4)} превысила ${stopLoss.toFixed(4)}. Вывод: сигнал был ложным, нужно больше подтверждений от тренда.`); 
        if (aiLogs.length > 10) aiLogs.shift();
        tradeData.active = null;
      } else if (currentPrice <= takeProfit) {
        const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        learningWeights[symbol].distance *= 1.05;
        learningWeights[symbol].volume *= 1.05;
        aiLogs.push(`${new Date().toLocaleString()} | ${symbol} ${timeframe} Шорт | Прибыль +${(profit - commission).toFixed(2)} USDT | Цена упала до ${currentPrice.toFixed(4)}, профит ${takeProfit.toFixed(4)}. Удачный сигнал, повышаю вес расстояния и объёмов. Ищу новые шорты.`); 
        aiLearnings.push(`Успех: ${symbol} ${timeframe} Шорт сработал. Цена ${currentPrice.toFixed(4)} достигла ${takeProfit.toFixed(4)}. Вывод: расстояние от канала и объёмы подтвердили падение.`); 
        if (aiLogs.length > 10) aiLogs.shift();
        tradeData.active = null;
      }
    }
  }
}

app.get('/data', async (req, res) => {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'AAVEUSDT'];
  let recommendations = {};

  try {
    for (const symbol of symbols) {
      let klinesByTimeframe = {};
      for (const tf of TIMEFRAMES) {
        klinesByTimeframe[tf] = await fetchKlines(symbol, tf);
      }
      recommendations[symbol] = await aiTradeDecision(symbol, klinesByTimeframe);
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
        aiLogs.push(`${new Date().toLocaleString()} | ${bestTrade.symbol} ${bestTrade.timeframe} ${bestTrade.direction} | Открыта сделка с уверенностью ${bestTrade.confidence}%. Условия выполнены: пробой канала, цена ${bestTrade.entry.toFixed(4)}.`);
        console.log('Открыта основная сделка:', tradesMain[bestTrade.symbol]);
      } else {
        aiLogs.push(`${new Date().toLocaleString()} | Нет сделок | Условия не выполнены: нет сигнала с уверенностью >= 50% и пробоем канала.`);
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
        aiLogs.push(`${new Date().toLocaleString()} | ${bestTrade.symbol} 5m ${bestTrade.direction} | Открыта тестовая сделка с уверенностью ${bestTrade.confidence}%. Условия выполнены: пробой канала, цена ${bestTrade.entry.toFixed(4)}.`);
        console.log('Открыта тестовая сделка:', tradesTest[bestTrade.symbol]);
      } else {
        aiLogs.push(`${new Date().toLocaleString()} | Нет тестовых сделок (5m) | Условия не выполнены: нет сигнала с уверенностью >= 50% и пробоем канала.`);
      }
      if (aiLogs.length > 10) aiLogs.shift();
    }

    res.json({ prices: lastPrices, recommendations, tradesMain, tradesTest, aiLogs, aiLearnings, aiMistakes });
  } catch (error) {
    console.error('Ошибка /data:', error);
    res.status(500).json({ error: 'Ошибка сервера', details: error.message });
  }
});

app.post('/reset-stats-main', (req, res) => {
  for (const symbol in tradesMain) {
    tradesMain[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
  }
  res.sendStatus(200);
});

app.post('/reset-stats-test', (req, res) => {
  for (const symbol in tradesTest) {
    tradesTest[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
