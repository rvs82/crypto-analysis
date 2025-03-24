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
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=500`);
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

function calculateMedian(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function aiTradeDecision(symbol, klinesByTimeframe) {
  const price = lastPrices[symbol] || 0;
  let recommendations = {};

  console.log(`Начало aiTradeDecision для ${symbol}, текущая цена: ${price}`);

  for (const tf of TIMEFRAMES) {
    const klines = klinesByTimeframe[tf] || [];
    const closes = klines.length > 0 ? klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c)) : [price];
    const nw = closes.length > 1 ? calculateNadarayaWatsonEnvelope(closes) : { upper: price * 1.05, lower: price * 0.95, smooth: price };

    const outsideChannel = price > nw.upper || price < nw.lower;
    const direction = price > nw.upper ? 'Шорт' : price < nw.lower ? 'Лонг' : 'Нет';
    const confidence = direction !== 'Нет' ? (outsideChannel ? 100 : 0) : 0;
    const reasoning = direction === 'Шорт' ? `Цена (${price}) выше верхней границы (${nw.upper})` : 
                      direction === 'Лонг' ? `Цена (${price}) ниже нижней границы (${nw.lower})` : 
                      `Цена (${price}) внутри канала (${nw.lower}–${nw.upper})`;
    const entry = price;
    const stopLoss = direction === 'Лонг' ? entry * 0.995 : direction === 'Шорт' ? entry * 1.005 : entry;
    const takeProfit = direction === 'Лонг' ? entry * 1.01 : direction === 'Шорт' ? entry * 0.99 : entry;
    const market = outsideChannel ? (price > nw.upper ? 'Восходящий' : 'Нисходящий') : 'Флет';
    const trend = direction === 'Шорт' ? 'down' : direction === 'Лонг' ? 'up' : 'none';
    const pivot = nw.smooth; // Добавляем pivot для совместимости с клиентом
    const forecast = trend === 'up' ? 'рост' : 'падение';

    recommendations[tf] = { 
      direction, 
      confidence, 
      outsideChannel, 
      entry, 
      stopLoss, 
      takeProfit, 
      market, 
      trend, 
      pivot, 
      reasoning, 
      forecast, 
      marketState: `Рынок: ${market}, outsideChannel=${outsideChannel}`,
      blinkDirection: outsideChannel ? (price > nw.upper ? 'green' : 'red') : ''
    };
    console.log(`Рекомендация для ${symbol} ${tf}: direction=${direction}, confidence=${confidence}, outsideChannel=${outsideChannel}`);
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
        const loss = TRADE_AMOUNT * (entry - stopLoss) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalLoss += loss + commission;
        tradeData.stopCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
      } else if (currentPrice >= takeProfit) {
        const profit = TRADE_AMOUNT * (takeProfit - entry) / entry;
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
        const loss = TRADE_AMOUNT * (stopLoss - entry) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalLoss += loss + commission;
        tradeData.stopCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по стоп-лоссу. Убыток: ${loss.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
      } else if (currentPrice <= takeProfit) {
        const profit = TRADE_AMOUNT * (entry - takeProfit) / entry;
        const commission = TRADE_AMOUNT * BINANCE_FEE * 2;
        tradeData.totalProfit += profit - commission;
        tradeData.profitCount++;
        tradeData.closedCount++;
        tradeData.openCount--;
        tradeData.active = null;
        console.log(`${symbol}: Закрыто по профиту. Прибыль: ${profit.toFixed(2)} USDT, Комиссия: ${commission.toFixed(2)} USDT`);
      }
    }
  } else {
    console.log(`Нет активной сделки для ${symbol}`);
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
      console.log(`Рекомендации для ${symbol} сформированы`);
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
        for (const tf of TIMEFRAMES) {
          const rec = recommendations[sym][tf];
          console.log(`Проверка ${sym} ${tf}: direction=${rec.direction}, confidence=${rec.confidence}, outsideChannel=${rec.outsideChannel}`);
          if (rec.direction !== 'Нет' && rec.confidence >= 50 && rec.outsideChannel) {
            if (!bestTrade || rec.confidence > bestTrade.confidence) {
              bestTrade = { symbol: sym, timeframe: tf, ...rec };
              console.log(`Обновлена лучшая сделка: ${sym} ${tf}, confidence=${rec.confidence}`);
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
        console.log(`${bestTrade.symbol} (${bestTrade.timeframe}): Сделка ${bestTrade.direction} открыта: entry=${bestTrade.entry}, stopLoss=${bestTrade.stopLoss}, takeProfit=${bestTrade.takeProfit}, confidence=${bestTrade.confidence}`);
      } else {
        console.log('Нет подходящей сделки для открытия');
      }
    } else {
      console.log(`Активная сделка уже существует для ${activeTradeSymbol}`);
    }
    console.log('Отправка ответа клиенту');
    res.json({ prices: lastPrices, recommendations, trades });
  } catch (error) {
    console.error('Ошибка в app.get("/data"):', error);
    res.status(500).json({ error: 'Ошибка сервера', details: error.message });
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
