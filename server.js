// ... (весь код до aiTradeDecision остаётся прежним)

// Исправление в aiTradeDecision для ограничения confidence до 100
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

    confidence = Math.min(confidence, 100); // Ограничение до 100%

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

// Исправление в app.get('/data') для корректного выбора сделки
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
        if (!recommendations[sym]) continue;
        for (const tf of TIMEFRAMES) {
          const rec = recommendations[sym][tf];
          if (rec && rec.direction !== 'Нет' && rec.confidence >= 50 && rec.outsideChannel) { // Добавлено условие outsideChannel
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
    res.json({ prices: lastPrices, recommendations, trades });
  } catch (error) {
    console.error('Ошибка в app.get("/data"):', error);
    res.status(500).json({ error: 'Ошибка сервера при обработке данных', details: error.message });
  }
});

// ... (остальной код остаётся прежним)
