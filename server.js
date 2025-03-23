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
const TIMEFRAMES = ['15m', '30m', '1h', '4h', '1d', '1w'];

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
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=1000`);
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

function calculateEMA(period, prices) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
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

function calculateLevels(klines) {
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

async function aiTradeDecision(symbol, klinesByTimeframe) {
  const price = lastPrices[symbol] || 0;
  const btcPrice = lastPrices['BTCUSDT'] || 0;
  const ethPrice = lastPrices['ETHUSDT'] || 0;
  let recommendations = {};

  for (const tf of TIMEFRAMES) {
    const klines = klinesByTimeframe[tf];
    const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
    if (closes.length < 200) {
      recommendations[tf] = { direction: 'Нет', entry: price, stopLoss: price, takeProfit: price, confidence: 0, rrr: '0/0', indicators: {}, reasoning: 'Недостаточно данных' };
      continue;
    }

    const nw = calculateNadarayaWatsonEnvelope(closes);
    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const adx = calculateADX(klines);
    const atr = calculateATR(klines);
    const ema50 = calculateEMA(50, closes);
    const ema100 = calculateEMA(100, closes);
    const ema200 = calculateEMA(200, closes);
    const obv = calculateOBV(klines);
    const levels = calculateLevels(klines);
    const indicators = { 
      nw_upper: nw.upper.toFixed(4), 
      nw_lower: nw.lower.toFixed(4), 
      nw_smooth: nw.smooth.toFixed(4), 
      rsi: rsi.toFixed(2), 
      macd: macd.line.toFixed(4), 
      signal: macd.signal.toFixed(4), 
      adx: adx.toFixed(2), 
      atr: atr.toFixed(4), 
      ema50: ema50.toFixed(4), 
      ema100: ema100.toFixed(4), 
      ema200: ema200.toFixed(4), 
      obv: obv.toFixed(0), 
      support: levels.support.toFixed(4), 
      resistance: levels.resistance.toFixed(4)
    };

    let direction = 'Нет';
    let confidence = 0;
    let reasoning = '';
    if (price > nw.upper && macd.line > macd.signal && price > ema50 && obv > 0) {
      direction = 'Лонг';
      confidence = Math.min(100, Math.round(50 + (price - nw.upper) / atr * 10 + (btcPrice > lastPrices['BTCUSDT'] * 0.99 ? 10 : 0) + (ethPrice > lastPrices['ETHUSDT'] * 0.99 ? 10 : 0)));
      reasoning = `Цена (${price}) выше NW (${nw.upper}), MACD (${macd.line} > ${macd.signal}), EMA50 (${ema50}), OBV (${obv}) положительный. BTC (${btcPrice}), ETH (${ethPrice}) поддерживают рост.`;
    } else if (price < nw.lower && macd.line < macd.signal && price < ema50 && obv < 0) {
      direction = 'Шорт';
      confidence = Math.min(100, Math.round(50 + (nw.lower - price) / atr * 10 + (btcPrice < lastPrices['BTCUSDT'] * 1.01 ? 10 : 0) + (ethPrice < lastPrices['ETHUSDT'] * 1.01 ? 10 : 0)));
      reasoning = `Цена (${price}) ниже NW (${nw.lower}), MACD (${macd.line} < ${macd.signal}), EMA50 (${ema50}), OBV (${obv}) отрицательный. BTC (${btcPrice}), ETH (${ethPrice}) поддерживают падение.`;
    } else {
      reasoning = `Цена (${price}) внутри NW (${nw.lower}-${nw.upper}), MACD (${macd.line}/${macd.signal}), EMA50 (${ema50}), OBV (${obv}) не дают сигнала.`;
    }

    const entry = price;
    const stopLoss = direction === 'Лонг' ? entry - atr * 0.5 : direction === 'Шорт' ? entry + atr * 0.5 : entry;
    const takeProfit = direction === 'Лонг' ? entry + atr * 2 : direction === 'Шорт' ? entry - atr * 2 : entry;
    const profit = direction === 'Лонг' ? takeProfit - entry : entry - takeProfit;
    const risk = direction === 'Лонг' ? entry - stopLoss : stopLoss - entry;
    const rrr = risk > 0 ? Math.round(profit / risk) : 0;

    recommendations[tf] = { direction, entry, stopLoss, takeProfit, confidence, rrr: rrr > 0 ? `1/${rrr}` : '0/0', indicators, reasoning };
  }

  return recommendations;
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
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
      } else if (currentPrice >= takeProfit) {
        const profit = TRADE_AMOUNT * (takeProfit - entry);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
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
      } else if (currentPrice <= takeProfit) {
        const profit = TRADE_AMOUNT * (entry - takeProfit);
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
      }
    }
  }
}

app.get('/data', async (req, res) => {
  const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
  let recommendations = {};

  for (const symbol of symbols) {
    let klinesByTimeframe = {};
    for (const tf of TIMEFRAMES) {
      klinesByTimeframe[tf] = await fetchKlines(symbol, tf);
    }
    recommendations[symbol] = await aiTradeDecision(symbol, klinesByTimeframe);

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
          if (rec.direction !== 'Нет' && rec.confidence >= 50) {
            if (!bestTrade || rec.confidence > bestTrade.confidence) {
              bestTrade = { symbol: sym, timeframe: tf, ...rec };
            }
          }
        }
      }
      if (bestTrade) {
        const tradeData = trades[bestTrade.symbol];
        tradeData.active = { direction: bestTrade.direction, entry: bestTrade.entry, stopLoss: bestTrade.stopLoss, takeProfit: bestTrade.takeProfit, timeframe: bestTrade.timeframe };
        tradeData.openCount++;
        console.log(`${bestTrade.symbol} (${bestTrade.timeframe}): Сделка ${bestTrade.direction} открыта: entry=${bestTrade.entry}, stopLoss=${bestTrade.stopLoss}, takeProfit=${bestTrade.takeProfit}, confidence=${bestTrade.confidence}`);
      }
    }
  }

  res.json({ prices: lastPrices, recommendations, trades });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
