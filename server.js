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
