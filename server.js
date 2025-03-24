const express = require('express');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const app = express();

app.use(express.static('public'));

let lastPrices = { LDOUSDT: 0, AVAXUSDT: 0, XLMUSDT: 0, HBARUSDT: 0, BATUSDT: 0, AAVEUSDT: 0, BTCUSDT: 0, ETHUSDT: 0 };
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
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];
let lastRecommendations = {};
let tradeHistory = {};

console.log('Сброс состояния trades при запуске сервера');
for (const symbol in trades) {
  trades[symbol].active = null;
}

const wss = new WebSocket('wss://fstream.binance.com/ws');
wss.on('open', () => {
  console.log('WebSocket подключён');
  ['ldousdt', 'avaxusdt', 'xlmusdt', 'hbarusdt', 'batusdt', 'aaveusdt', 'btcusdt', 'ethusdt'].forEach(symbol => {
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

async function fetchKlines(symbol, timeframe) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=500`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Klines data is not an array');
    console.log(`Получены свечи для ${symbol} на ${timeframe}: ${data.length} свечей`);
    return data;
  } catch (error) {
    console.error(`Ошибка получения свечей для ${symbol} на ${timeframe}:`, error.message);
    return [];
  }
}

function calculateNadarayaWatsonEnvelope(closes, bandwidth = 8, multiplier = 3) {
  const n = closes.length;
  let upper = new Array(n).fill(0);
  let lower = new Array(n).fill(0);
  let smooth = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    let sumWeights = 0;
    let sumWeightedValues = 0;
    for (let j = 0; j < n; j++) {
      const weight = Math.exp(-Math.pow(i - j, 2) / (2 * bandwidth * bandwidth));
      sumWeights += weight;
      sumWeightedValues += weight * closes[j];
    }
    smooth[i] = sumWeightedValues / sumWeights;
  }

  const residuals = closes.map((c, i) => Math.abs(c - smooth[i]));
  const mad = calculateMedian(residuals);
  upper = smooth.map(s => s + multiplier * mad);
  lower = smooth.map(s => s - multiplier * mad);

  return { upper: upper[n - 1], lower: lower[n - 1], smooth: smooth[n - 1] };
}

function calculateMedian(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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

function calculateEMA(period, prices) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateFibonacciLevels(nwLower, nwUpper) {
  const range = nwUpper - nwLower;
  return {
    fib05: nwLower + range * 0.5,
    fib0618: nwLower + range * 0.618
  };
}

function detectEngulfing(klines) {
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

function calculateHorizontalVolume(klines) {
  const closes = klines.map(k => parseFloat(k[4]));
  const bins = 20;
  const range = Math.max(...closes) - Math.min(...closes);
  const binSize = range / bins;
  const volumeBins = Array(bins).fill(0);
  klines.forEach(kline => {
    const close = parseFloat(kline[4]);
    const volume = parseFloat(kline[5]);
    const bin = Math.min(bins - 1, Math.floor((close - Math.min(...closes)) / binSize));
    volumeBins[bin] += volume;
  });
  const maxVolumeIndex = volumeBins.indexOf(Math.max(...volumeBins));
  return Math.min(...closes) + maxVolumeIndex * binSize;
}

function calculateCorrelation(symbol, klinesSymbol, klinesBTC) {
  const closesSymbol = klinesSymbol.slice(-20).map(k => parseFloat(k[4]));
  const closesBTC = klinesBTC.slice(-20).map(k => parseFloat(k[4]));
  if (closesSymbol.length < 20 || closesBTC.length < 20) return 0;
  const meanSymbol = closesSymbol.reduce((a, b) => a + b, 0) / 20;
  const meanBTC = closesBTC.reduce((a, b) => a + b, 0) / 20;
  let numerator = 0, denomSymbol = 0, denomBTC = 0;
  for (let i = 0; i < 20; i++) {
    const diffSymbol = closesSymbol[i] - meanSymbol;
    const diffBTC = closesBTC[i] - meanBTC;
    numerator += diffSymbol * diffBTC;
    denomSymbol += diffSymbol * diffSymbol;
    denomBTC += diffBTC * diffBTC;
  }
  return numerator / Math.sqrt(denomSymbol * denomBTC) || 0;
}

async function aiTradeDecision(symbol, klinesByTimeframe) {
  const price = lastPrices[symbol] || 0;
  const btcPrice = lastPrices['BTCUSDT'] || 0;
  const ethPrice = lastPrices['ETHUSDT'] || 0;
  let recommendations = {};

  for (const tf of TIMEFRAMES) {
    const klines = klinesByTimeframe[tf] || [];
    const closes = klines.length > 0 ? klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c)) : [price];
    const nw = closes.length > 1 ? calculateNadarayaWatsonEnvelope(closes) : { upper: price * 1.05, lower: price * 0.95, smooth: price };
    const obv = closes.length > 1 ? calculateOBV(klines) : 0;
    const ema200 = closes.length > 1 ? calculateEMA(200, closes) : price;
    const ema100 = closes.length > 1 ? calculateEMA(100, closes) : price;
    const ema365 = closes.length > 1 ? calculateEMA(365, closes) : price;
    const ema1460 = closes.length > 1 ? (closes.length >= 1460 ? calculateEMA(1460, closes.slice(-1460)) : calculateEMA(closes.length, closes)) : price;
    const fib = calculateFibonacciLevels(nw.lower, nw.upper);
    const engulfing = closes.length > 1 ? detectEngulfing(klines) : 'none';
    const horizontalVolume = closes.length > 1 ? calculateHorizontalVolume(klines.slice(-50)) : price;
    const btcKlines = await fetchKlines('BTCUSDT', tf) || [];
    const correlationBTC = closes.length > 1 && btcKlines.length > 1 ? calculateCorrelation(symbol, klines, btcKlines) : 0;

    const max20 = closes.length > 20 ? Math.max(...closes.slice(-20)) : price;
    const min20 = closes.length > 20 ? Math.min(...closes.slice(-20)) : price;
    const range20 = closes.length > 20 ? (max20 - min20) / closes[closes.length - 1] : 0;
    const market = range20 < 0.02 ? 'Флет' : price > nw.smooth && price > (closes.length > 20 ? closes[closes.length - 20] : price) ? 'Восходящий' : 'Нисходящий';
    const lastTouch = price > nw.upper ? 'upper' : price < nw.lower ? 'lower' : 'none';
    const trend = lastTouch === 'upper' ? 'down' : lastTouch === 'lower' ? 'up' : 'none';
    const forecast = trend === 'up' ? 'рост' : 'падение';
    const pivot = trend === 'up' ? Math.max(fib.fib05, ema200, horizontalVolume) : Math.min(fib.fib05, ema200, horizontalVolume);
    const outsideChannel = price > nw.upper || price < nw.lower;
    const blinkDirection = outsideChannel ? (price > nw.upper ? 'green' : 'red') : '';

    let direction = 'Нет';
    let confidence = 0;
    let reasoning = '';
    const threshold = nw.upper * 0.005;

    if (price > nw.upper + threshold && price <= nw.upper * 1.05) {
      if (market !== 'Нисходящий' || (market === 'Нисходящий' && obv < 0 && (engulfing === 'bearish' || btcPrice > lastPrices['BTCUSDT'] * 0.995))) {
        direction = 'Шорт';
        confidence = Math.round(50 + (price - nw.upper) / threshold * 10 + (obv < 0 ? 10 : 0) + (engulfing === 'bearish' ? 10 : 0) + (correlationBTC > 0.7 ? 10 : 0));
        reasoning = `Цена (${price}) пробила верхнюю границу (${nw.upper}), рынок: ${market}, OBV падает (${obv}), ${engulfing === 'bearish' ? 'медвежье поглощение, ' : ''}корреляция с BTC (${correlationBTC}). Возможен ретест уровня ${nw.upper.toFixed(4)}.`;
      }
    } else if (price < nw.lower - threshold && price >= nw.lower * 0.95) {
      if (market !== 'Восходящий' || (market === 'Восходящий' && obv > 0 && (engulfing === 'bullish' || btcPrice < lastPrices['BTCUSDT'] * 1.005))) {
        direction = 'Лонг';
        confidence = Math.round(50 + (nw.lower - price) / threshold * 10 + (obv > 0 ? 10 : 0) + (engulfing === 'bullish' ? 10 : 0) + (correlationBTC > 0.7 ? 10 : 0));
        reasoning = `Цена (${price}) пробила нижнюю границу (${nw.lower}), рынок: ${market}, OBV растёт (${obv}), ${engulfing === 'bullish' ? 'бычье поглощение, ' : ''}корреляция с BTC (${correlationBTC}). Возможен ретест уровня ${nw.lower.toFixed(4)}.`;
      }
    } else {
      reasoning = `Цена (${price}) внутри канала (${nw.lower}–${nw.upper}), рынок: ${market}, нет чёткого пробоя. Возможна консолидация, OBV: ${obv}.`;
    }

    if (tradeHistory[symbol] && tradeHistory[symbol][tf]) {
      const pastTrades = tradeHistory[symbol][tf];
      const lastTrade = pastTrades[pastTrades.length - 1];
      if (lastTrade && lastTrade.result === 'loss' && lastTrade.direction === direction) {
        confidence = Math.max(0, confidence - 10);
      }
    }

    confidence = Math.min(confidence, 100);

    const entry = price;
    const stopLoss = direction === 'Лонг' ? entry - threshold : direction === 'Шорт' ? entry + threshold : entry;
    const takeProfit = direction === 'Лонг' ? entry + threshold * 2 : direction === 'Шорт' ? entry - threshold * 2 : entry;
    const profit = direction === 'Лонг' ? takeProfit - entry : entry - takeProfit;
    const risk = direction === 'Лонг' ? entry - stopLoss : stopLoss - entry;
    const rrr = risk > 0 ? Math.round(profit / risk) : 0;

    if (lastRecommendations[symbol] && lastRecommendations[symbol][tf]) {
      const prevConfidence = lastRecommendations[symbol][tf].confidence;
      confidence = Math.min(Math.max(confidence, prevConfidence - 5), prevConfidence + 5);
    }

    const marketState = `Рынок сейчас ${market === 'Флет' ? 'в боковике' : market === 'Восходящий' ? 'растёт' : 'падает'}, вероятность прибыли ${confidence >= 50 ? 'высокая' : 'средняя'}, ждём ${forecast === 'рост' ? 'роста' : 'падения'}.`;

    recommendations[tf] = { direction, entry, stopLoss, takeProfit, confidence, rrr: rrr > 0 ? `1/${rrr}` : '0/0', market, trend, pivot, reasoning, forecast, marketState, outsideChannel, blinkDirection };
  }

  lastRecommendations[symbol] = recommendations;
  return recommendations;
}

function checkTradeStatus(symbol, currentPrice) {
  const tradeData = trades[symbol];
  if (tradeData && tradeData.active) {
    const { entry, stopLoss, takeProfit, direction, timeframe } = tradeData.active;
    console.log(`Проверка статуса сделки для ${symbol}: currentPrice=${currentPrice}, entry=${entry}, stopLoss=${stopLoss}, takeProfit=${takeProfit}, direction=${direction}`);
    if (direction === 'Лонг') {
      if (currentPrice <= stopLoss) {
        const loss = TRADE_AMOUNT * (entry - stopLoss);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalLoss += loss + commission;
        tradeData.stopCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
        if (!tradeHistory[symbol]) tradeHistory[symbol] = {};
        if (!tradeHistory[symbol][timeframe]) tradeHistory[symbol][timeframe] = [];
        tradeHistory[symbol][timeframe].push({ direction, result: 'loss' });
      } else if (currentPrice >= takeProfit) {
        const profit = TRADE_AMOUNT * (takeProfit - entry);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
        if (!tradeHistory[symbol]) tradeHistory[symbol] = {};
        if (!tradeHistory[symbol][timeframe]) tradeHistory[symbol][timeframe] = [];
        tradeHistory[symbol][timeframe].push({ direction, result: 'profit' });
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
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
        if (!tradeHistory[symbol]) tradeHistory[symbol] = {};
        if (!tradeHistory[symbol][timeframe]) tradeHistory[symbol][timeframe] = [];
        tradeHistory[symbol][timeframe].push({ direction, result: 'loss' });
      } else if (currentPrice <= takeProfit) {
        const profit = TRADE_AMOUNT * (entry - takeProfit);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
        if (!tradeHistory[symbol]) tradeHistory[symbol] = {};
        if (!tradeHistory[symbol][timeframe]) tradeHistory[symbol][timeframe] = [];
        tradeHistory[symbol][timeframe].push({ direction, result: 'profit' });
      }
    }
  }
}

app.get('/data', async (req, res) => {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  let recommendations = {};

  try {
    console.log('Начало обработки /data');
    for (const symbol of symbols) {
      let klinesByTimeframe = {};
      for (const tf of TIMEFRAMES) {
        klinesByTimeframe[tf] = await fetchKlines(symbol, tf);
      }
      recommendations[symbol] = await aiTradeDecision(symbol, klinesByTimeframe);
      console.log(`Рекомендации для ${symbol} сформированы: ${JSON.stringify(recommendations[symbol])}`);
    }

    let activeTradeSymbol = null;
    for (const s in trades) {
      if (trades[s].active) {
        activeTradeSymbol = s;
        console.log(`Найдена активная сделка для ${s}: ${JSON.stringify(trades[s].active)}`);
        break;
      }
    }

    if (!activeTradeSymbol) {
      console.log('Активных сделок нет, ищу новую');
      let bestTrade = null;
      for (const sym of symbols) {
        if (!recommendations[sym]) {
          console.log(`Нет рекомендаций для ${sym}`);
          continue;
        }
        for (const tf of TIMEFRAMES) {
          const rec = recommendations[sym][tf];
          console.log(`Проверка ${sym} ${tf}: direction=${rec.direction}, confidence=${rec.confidence}, outsideChannel=${rec.outsideChannel}`);
          if (rec && rec.direction !== 'Нет' && rec.confidence >= 50 && rec.outsideChannel) {
            if (!bestTrade || rec.confidence > bestTrade.confidence) {
              bestTrade = { symbol: sym, timeframe: tf, ...rec };
              console.log(`Обновлена лучшая сделка: ${sym} ${tf}, confidence=${rec.confidence}`);
            }
          }
        }
      }
      if (bestTrade) {
        const tradeData = trades[bestTrade.symbol];
        tradeData.active = { direction: bestTrade.direction, entry: bestTrade.entry, stopLoss: bestTrade.stopLoss, takeProfit: bestTrade.takeProfit, timeframe: bestTrade.timeframe };
        tradeData.openCount++;
        console.log(`${bestTrade.symbol} (${bestTrade.timeframe}): Сделка ${bestTrade.direction} открыта: entry=${bestTrade.entry}, stopLoss=${bestTrade.stopLoss}, takeProfit=${bestTrade.takeProfit}, confidence=${bestTrade.confidence}`);
      } else {
        console.log('Нет подходящей сделки для открытия: недостаточная вероятность или нет пробоя');
      }
    } else {
      console.log(`Активная сделка уже существует для ${activeTradeSymbol}, новая не открывается`);
    }
    console.log('Отправка ответа клиенту');
    res.json({ prices: lastPrices, recommendations, trades });
  } catch (error) {
    console.error('Ошибка в app.get("/data"):', error);
    res.status(500).json({ error: 'Ошибка сервера при обработке данных', details: error.message });
  }
});

app.post('/reset-stats', (req, res) => {
  for (const symbol in trades) {
    trades[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
  }
  console.log('Статистика сброшена');
  res.sendStatus(200);
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
