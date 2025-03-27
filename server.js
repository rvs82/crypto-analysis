function connectWebSocket() {
    const ws = new WebSocket('wss://fstream.binance.com/ws');
    ws.on('open', () => {
        console.log('WebSocket сервер запущен (Binance Futures)');
        const symbols = ['ldousdt', 'avaxusdt', 'aaveusdt', 'btcusdt', 'ethusdt'];
        const streams = [];
        symbols.forEach(symbol => {
            streams.push(`${symbol}@ticker`);
            streams.push(`${symbol}@kline_5m`);
        });
        streams.forEach(stream => {
            ws.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [stream],
                id: 1
            }));
            console.log(`Подписка на ${stream} отправлена`);
        });
    });
    ws.on('message', async (data) => { // Здесь добавлено async
        try {
            const msg = JSON.parse(data);
            if (msg.s && msg.c) { // @ticker
                const symbol = msg.s.toUpperCase();
                const newPrice = parseFloat(msg.c);
                if (newPrice !== lastPrices[symbol]) {
                    lastPrices[symbol] = newPrice;
                    console.log(`Обновлена цена через WebSocket для ${symbol}: ${lastPrices[symbol]} (@ticker)`);
                    await saveData();
                    await checkTradeStatus(symbol, lastPrices[symbol], tradesMain);
                    await checkTradeStatus(symbol, lastPrices[symbol], tradesTest);
                }
            } else if (msg.e === 'kline' && msg.k) { // @kline_5m
                const symbol = msg.s.toUpperCase();
                const tf = msg.k.i;
                if (!klinesByTimeframe[symbol][tf]) klinesByTimeframe[symbol][tf] = [];
                const kline = [
                    msg.k.t,
                    msg.k.o,
                    msg.k.h,
                    msg.k.l,
                    msg.k.c,
                    msg.k.v
                ];
                const klineList = klinesByTimeframe[symbol][tf];
                const existingIndex = klineList.findIndex(k => k[0] === kline[0]);
                if (existingIndex >= 0) {
                    klineList[existingIndex] = kline;
                } else {
                    klineList.push(kline);
                    if (klineList.length > 1000) klineList.shift();
                }
                console.log(`Обновлена свеча через WebSocket для ${symbol} ${tf}`);
                TIMEFRAMES.filter(t => t !== '5m').forEach(tf => {
                    klinesByTimeframe[symbol][tf] = aggregateKlines(klinesByTimeframe[symbol]['5m'], tf);
                });
                await saveData();
            } else if (msg.ping) {
                ws.send(JSON.stringify({ pong: msg.ping }));
                console.log('Отправлен pong в ответ на ping');
            }
        } catch (error) {
            console.error('Ошибка обработки WebSocket-сообщения:', error.message);
        }
    });
    ws.on('error', (error) => console.error('WebSocket ошибка:', error.message));
    ws.on('close', () => {
        console.log('WebSocket закрыт, переподключение через 500 мс...');
        setTimeout(connectWebSocket, 500);
    });
}
