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
let learningWeights = { LDOUSDT: 1, AVAXUSDT: 1, XLMUSDT: 1, HBARUSDT: 1, BATUSDT: 1, AAVEUSDT: 1 };

function connectWebSocket() {
  const wss = new WebSocket('wss://stream.binance.us:9443/ws', { handshakeTimeout: 10000 });

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
      console.error('Ошибка обработки сообщения WebSocket:', error);
    }
  });

  wss.on('error', (error) => {
    console.error('Ошибка WebSocket:', error.message);
    wss.close();
  });

  wss.on('close', () => {
    console.log('WebSocket закрыт, попытка переподключения...');
    setTimeout(connectWebSocket, 10000); // Увеличен таймаут до 10 секунд
  });

  wss.on('pong', () => {
    console.log('Получен pong от сервера');
  });

  // Пинг каждые 30 секунд для поддержания соединения
  setInterval(() => {
    if (wss.readyState === WebSocket.OPEN) {
      wss.ping();
      console.log('Отправлен ping серверу');
    }
  }, 30000);

  return wss;
}

connectWebSocket();

async function fetchKlines(symbol, timeframe) {
  try {
    const response = await fetch(`https://api.binance.us/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=100`);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Ошибка свечей ${symbol} ${timeframe}:`, error.message);
    return [];
  }
}

function calculateNadarayaWatsonEnvelope(closes) {
  const n = closes.length;
  let upper = new Array(n).fill(0);
  let lower = new Array(n).fill(0);
  let smooth = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    let sumWeights = 0;
    let sumWeightedValues = 0;
    for (let j = 0; j < n; j++) {
      const weight = Math.exp(-Math.pow(i - j, 2) / (2 * 8 * 8));
      sumWeights += weight;
      sumWeightedValues += weight * closes[j];
    }
    smooth[i] = sumWeightedValues / sumWeights;
  }

  const residuals = closes.map((c, i) => Math.abs(c - smooth[i]));
  const mad = calculateMedian(residuals);
  upper = smooth.map(s => s + 3 * mad);
  lower = smooth.map(s => s - 3 * mad);

  return { upper: upper[n - 1], lower: lower[n - 1], smooth: smooth[n - 1] };
}

function calculateEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateOBV(klines) {
  let obv = 0;
  for (let i = 1; i < klines.length; i++) {
    const prevClose = parseFloat(klines[i - 1][4]);
    const currClose = parseFloat(klines[i][4]);
    const volume = parseFloat(klines[i][5]);
    obv += (currClose > prevClose ? volume : currClose < prevClose ? -volume : 0);
  }
  return obv;
}

function calculateFibonacci(klines) {
  const highs = klines.map(k => parseFloat(k[2])).filter(h => !isNaN(h));
  const lows = klines.map(k => parseFloat(k[3])).filter(l => !isNaN(l));
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const diff = max - min;
  return { 0.5: min + diff * 0.5, 0.618: min + diff * 0.618 };
}

function calculateMedian(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
    const obv = klines.length > 1 ? calculateOBV(klines) : 0;
    const ema200 = klines.length > 1 ? calculateEMA(closes, 200) : price;
    const fib = klines.length > 1 ? calculateFibonacci(klines) : { 0.5: price, 0.618: price };
    const lastKline = klines[klines.length - 1] || [0, 0, 0, 0, 0, 0];
    const volume = parseFloat(lastKline[5]) || 0;

    const outsideChannel = price > nw.upper || price < nw.lower;
    const direction = price > nw.upper ? 'Шорт' : price < nw.lower ? 'Лонг' : 'Нет';
    const market = outsideChannel ? (price > nw.upper ? 'Восходящий' : 'Нисходящий') : 'Флет';
    const trend = direction === 'Шорт' ? 'down' : direction === 'Лонг' ? 'up' : 'none';
    const forecast = trend === 'up' ? 'рост' : 'падение';
    let confidence = 0;

    if (direction !== 'Нет') {
      confidence = Math.min(100, Math.round((Math.abs(price - (direction === 'Шорт' ? nw.upper : nw.lower)) / price) * 200));
      if (obv > 0 && direction === 'Лонг') confidence += 20;
      if (obv < 0 && direction === 'Шорт') confidence += 20;
      if (price > ema200 && direction === 'Лонг') confidence += 10;
      if (price < ema200 && direction === 'Шорт') confidence += 10;
      if (Math.abs(price - fib[0.618]) < price * 0.005) confidence += 15;
      if (volume > klines.slice(-5, -1).reduce((a, k) => a + parseFloat(k[5]), 0) / 4) confidence += 10;
      if (btcPrice > lastPrices['BTCUSDT'] * 0.99 && direction === 'Лонг') confidence += 5;
      if (ethPrice > lastPrices['ETHUSDT'] * 0.99 && direction === 'Лонг') confidence += 5;
      confidence = Math.min(100, Math.round(confidence * learningWeights[symbol]));
    }

    const entry = price;
    const stopLoss = direction === 'Лонг' ? entry * 0.995 : direction === 'Шорт' ? entry * 1.005 : entry;
    const takeProfit = direction === 'Лонг' ? entry * 1.01 : direction === 'Шорт' ? entry * 0.99 : entry;
    const reasoning = direction === 'Шорт' ? `Цена (${price}) выше верхней (${nw.upper}), OBV: ${obv}, EMA200: ${ema200}` : 
                      direction === 'Лонг' ? `Цена (${price}) ниже нижней (${nw.lower}), OBV: ${obv}, EMA200: ${ema200}` : 
                      `Цена (${price}) внутри (${nw.lower}–${nw.upper})`;

    recommendations[tf] = { direction, confidence, outsideChannel, entry, stopLoss, takeProfit, market, trend, pivot: nw.smooth, reasoning, forecast };
  }

  lastRecommendations[symbol] = recommendations;
  return recommendations;
}

function checkTradeStatus(symbol, currentPrice) {
  const tradeData = trades[symbol];
  if (tradeData && tradeData.active) {
    const { entry, stopLoss, takeProfit, direction } = tradeData.active;
    if (direction === 'Лонг') {
      if (currentPrice <= stopLoss) {
        const loss = TRADE_AMOUNT * (entry - stopLoss) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalLoss += loss + commission;
        tradeData.stopCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        learningWeights[symbol] *= 0.95;
        tradeData.active = null;
      } else if (currentPrice >= takeProfit) {
        const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        learningWeights[symbol] *= 1.05;
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
        learningWeights[symbol] *= 0.95;
        tradeData.active = null;
      } else if (currentPrice <= takeProfit) {
        const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        learningWeights[symbol] *= 1.05;
        tradeData.active = null;
      }
    }
  }
}

app.get('/data', async (req, res) => {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  let recommendations = {};

  try {
    for (const symbol of symbols) {
      let klinesByTimeframe = {};
      for (const tf of TIMEFRAMES) {
        klinesByTimeframe[tf] = await fetchKlines(symbol, tf);
      }
      recommendations[symbol] = await aiTradeDecision(symbol, klinesByTimeframe);
    }

    let activeTradeSymbol = null;
    for (const s in trades) {
      if (trades[s].active) {
        activeTradeSymbol = s;
        break;
      }
    }

    if (!activeTradeSymbol) {
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
        trades[bestTrade.symbol].active = {
          direction: bestTrade.direction,
          entry: bestTrade.entry,
          stopLoss: bestTrade.stopLoss,
          takeProfit: bestTrade.takeProfit,
          timeframe: bestTrade.timeframe
        };
        trades[bestTrade.symbol].openCount++;
      }
    }
    res.json({ prices: lastPrices, recommendations, trades });
  } catch (error) {
    console.error('Ошибка /data:', error);
    res.status(500).json({ error: 'Ошибка сервера', details: error.message });
  }
});

app.post('/reset-stats', (req, res) => {
  for (const symbol in trades) {
    trades[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
