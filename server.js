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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=1000`, { signal: controller.signal });
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

async function aiTradeDecision(symbol, newsSentiment, klines) {
  const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
  if (closes.length === 0) return { direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0, rrr: '0/0' };

  const price = lastPrices[symbol] || closes[closes.length - 1];
  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const atr = calculateATR(klines);
  const levels = findLevels(klines);

  const score = (rsi - 50) / 50 + macd.histogram / Math.abs(macd.line) + newsSentiment;
  const confidence = Math.min(95, Math.max(5, Math.abs(score) * 100));
  let direction = score > 0 ? 'Лонг' : score < 0 ? 'Шорт' : 'Нейтрально';

  const tradeData = trades[symbol];
  let entry, stopLoss, takeProfit;

  if (tradeData.active) {
    direction = tradeData.active.direction;
    entry = tradeData.active.entry;
    stopLoss = tradeData.active.stopLoss;
    takeProfit = tradeData.active.takeProfit;
  } else {
    entry = price;
    stopLoss = direction === 'Лонг' ? levels.support - atr * 0.2 : levels.resistance + atr * 0.2;
    const offset = atr * 0.5;
    takeProfit = direction === 'Лонг' ? levels.resistance - offset : levels.support + offset;
    const minProfit = direction === 'Лонг' ? entry + 4 * (entry - stopLoss) : entry - 4 * (stopLoss - entry);
    if (direction === 'Лонг' && takeProfit < minProfit) takeProfit = minProfit;
    if (direction === 'Шорт' && takeProfit > minProfit) takeProfit = minProfit;

    if (direction !== 'Нейтрально' && confidence >= 75) {
      tradeData.active = { direction, entry, stopLoss, takeProfit };
      tradeData.openCount++;
      console.log(`${symbol}: Сделка ${direction} открыта: entry=${entry}, stopLoss=${stopLoss}, takeProfit=${takeProfit}`);
    }
  }

  const profit = direction === 'Лонг' ? takeProfit - entry : entry - takeProfit;
  const risk = direction === 'Лонг' ? entry - stopLoss : stopLoss - entry;
  const rrr = risk > 0 ? Math.round(profit / risk) : 0;

  return { direction, entry, stopLoss, takeProfit, confidence, rrr: rrr > 0 ? `1/${rrr}` : '0/0' };
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
  const topPairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOGEUSDT', 'DOTUSDT', 'TRXUSDT',
                    'MATICUSDT', 'LINKUSDT', 'LTCUSDT', 'BCHUSDT', 'XLMUSDT', 'AVAXUSDT', 'LDOUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  const newsSentiment = await fetchNewsSentiment();
  sentiment = { long: 0, short: 0, total: topPairs.length };

  for (const symbol of topPairs) {
    const klines = await fetchKlines(symbol);
    if (klines.length === 0) continue;
    const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
    if (closes.length === 0) continue;

    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const score = (rsi - 50) / 50 + macd.histogram / Math.abs(macd.line) + newsSentiment;
    if (score > 0) sentiment.long++;
    else if (score < 0) sentiment.short++;
  }

  sentiment.long = (sentiment.long / sentiment.total) * 100;
  sentiment.short = (sentiment.short / sentiment.total) * 100;
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
      recommendations[symbol] = { direction: 'Нейтрально', entry: 0, stopLoss: 0, takeProfit: 0, confidence: 0, rrr: '0/0' };
    }
  }

  console.log('Sending data:', { prices: lastPrices, recommendations, sentiment, trades });
  res.json({ prices: lastPrices, recommendations, sentiment, trades });
});

app.listen(3000, () => {
  console.log('Сервер запущен на порту 3000');
});
