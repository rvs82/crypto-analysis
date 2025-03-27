// Обновляем TIMEFRAMES, убираем '1w'
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d'];

// Убираем '1w' из aggregateKlines
function aggregateKlines(baseKlines, targetTimeframe) {
    const timeframeMs = {
        '5m': 5 * 60 * 1000, '15m': 15 * 60 * 1000, '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000, '4h': 4 * 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000
    };
    const targetMs = timeframeMs[targetTimeframe];
    const aggregated = [];
    let currentStart = null;
    let currentKline = null;

    baseKlines.forEach(kline => {
        const timestamp = kline[0];
        const start = Math.floor(timestamp / targetMs) * targetMs;
        if (start !== currentStart) {
            if (currentKline) aggregated.push(currentKline);
            currentStart = start;
            currentKline = [start, kline[1], kline[2], kline[3], kline[4], parseFloat(kline[5])];
        } else {
            currentKline[2] = Math.max(parseFloat(currentKline[2]), parseFloat(kline[2]));
            currentKline[3] = Math.min(parseFloat(currentKline[3]), parseFloat(kline[3]));
            currentKline[4] = kline[4];
            currentKline[5] += parseFloat(kline[5]);
        }
    });
    if (currentKline) aggregated.push(currentKline);
    return aggregated.slice(-MAX_CANDLES);
}

// Убираем '1w' из WebSocket обработки
ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.s && msg.c) {
        const symbol = msg.s.toUpperCase();
        lastPrices[symbol] = parseFloat(msg.c);
    } else if (msg.e === 'kline' && msg.k) {
        const symbol = msg.s.toUpperCase();
        const tf = msg.k.i;
        if (!TIMEFRAMES.includes(tf)) return; // Пропускаем '1w'
        const kline = [msg.k.t, msg.k.o, msg.k.h, msg.k.l, msg.k.c, msg.k.v];
        const klineList = klinesByTimeframe[symbol][tf];
        const existingIndex = klineList.findIndex(k => k[0] === kline[0]);
        if (existingIndex >= 0) klineList[existingIndex] = kline;
        else {
            klineList.push(kline);
            if (klineList.length > MAX_CANDLES) klineList.shift();
        }
        TIMEFRAMES.filter(t => t !== '5m').forEach(tf => {
            klinesByTimeframe[symbol][tf] = aggregateKlines(klinesByTimeframe[symbol]['5m'], tf).slice(-MAX_CANDLES);
        });
    }
});

// aiTradeDecision уже использует TIMEFRAMES, изменений не требуется
