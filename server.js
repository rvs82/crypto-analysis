<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Crypto Trading</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f0f0f0; overflow-y: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background-color: white; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: center; font-size: 15px; }
        th { background-color: #4CAF50; color: white; }
        .long { color: green; }
        .short { color: red; }
        .neutral { color: black; }
        #trade, #reasoning, #stats, #indicators, #techSpec { margin-top: 20px; font-size: 15px; }
        details { margin-top: 5px; }
        summary { cursor: pointer; }
        #sound { margin-bottom: 10px; }
    </style>
</head>
<body>
    <div id="sound">Звук: <input type="checkbox" id="soundCheckbox" checked></div>
    <table>
        <thead>
            <tr>
                <th>Пара</th>
                <th>15м</th>
                <th>30м</th>
                <th>1ч</th>
                <th>4ч</th>
                <th>1д</th>
                <th>1н</th>
            </tr>
        </thead>
        <tbody id="data"></tbody>
    </table>
    <div id="trade"><strong>Сделка:</strong> Нет</div>
    <div id="reasoning"></div>
    <div id="stats"></div>
    <div id="indicators">
        <details>
            <summary>Индикаторы и фильтры</summary>
            <div id="indicators-content"></div>
        </details>
    </div>
    <div id="techSpec">
        <strong>Техническое задание:</strong><br>
        <strong>Новый вариант:</strong><br>
        Сайт использует индикатор Nadaraya-Watson Envelope [LuxAlgo] с режимом Repainting Smoothing, bandwidth 8, multiplier 3, данными закрытия на таймфреймах 15м, 30м, 1ч, 4ч, 1д, 1н. Для точности сигналов добавлены RSI, MACD, ADX, EMA 50, 100, 200. Обработка данных — ИИ с учётом динамики рынка, цен BTC и ETH. Данные в горизонтальной таблице с рекомендациями: "Нет" (чёрный), "Лонг" (зелёный), "Шорт" (красный), рядом вероятность успеха в %. Одновременно открыта 1 сделка размером 100 USDT. Поле "Сделка" показывает криптовалюту, таймфрейм, направление (цветное), вероятность успеха (пересчитывается ИИ в реальном времени), цены открытия, стоп-лосс, тейк-профит (не 0 и не ниже, неизменны до закрытия). Сделки открываются при вероятности ≥ 50% с оптимальным RRR (ИИ). Звуковые оповещения при сигнале на открытие (чекбокс, приятный звук). Под сделкой — рассуждения ИИ о причинах открытия. ИИ рассчитывает уровни поддержки/сопротивления для решений. Убраны лишние запросы и настроение рынка. Под статистикой — выпадающее меню с индикаторами и значениями. Добавлена вертикальная прокрутка.
    </div>

    <script>
        const tbody = document.getElementById('data');
        const tradeDiv = document.getElementById('trade');
        const reasoningDiv = document.getElementById('reasoning');
        const statsDiv = document.getElementById('stats');
        const indicatorsContent = document.getElementById('indicators-content');
        const soundCheckbox = document.getElementById('soundCheckbox');
        let lastSignal = null;

        function updateData() {
            fetch('/data')
                .then(response => response.json())
                .then(data => {
                    tbody.innerHTML = '';
                    let indicatorsHtml = '';

                    for (const symbol in data.recommendations) {
                        const row = document.createElement('tr');
                        const rec = data.recommendations[symbol];
                        const trade = data.trades[symbol];
                        row.innerHTML = `
                            <td>${symbol}</td>
                            ${TIMEFRAMES.map(tf => {
                                const r = rec[tf];
                                const cls = r.direction === 'Лонг' ? 'long' : r.direction === 'Шорт' ? 'short' : 'neutral';
                                if (r.direction !== 'Нет' && r.confidence >= 50 && lastSignal !== `${symbol}-${tf}-${r.direction}` && soundCheckbox.checked) {
                                    new Audio('https://www.myinstants.com/media/sounds/ding.mp3').play();
                                    lastSignal = `${symbol}-${tf}-${r.direction}`;
                                }
                                if (tf === '15m') {
                                    indicatorsHtml += `<strong>${symbol} (${tf}):</strong> NW Upper: ${r.indicators.nw_upper}, NW Lower: ${r.indicators.nw_lower}, NW Smooth: ${r.indicators.nw_smooth}, RSI: ${r.indicators.rsi}, MACD: ${r.indicators.macd}/${r.indicators.signal}, ADX: ${r.indicators.adx}, ATR: ${r.indicators.atr}, Support: ${r.indicators.support}, Resistance: ${r.indicators.resistance}, EMA50: ${r.indicators.ema50}, EMA100: ${r.indicators.ema100}, EMA200: ${r.indicators.ema200}<br>`;
                                }
                                return `<td class="${cls}">${r.direction} (${r.confidence}%)</td>`;
                            }).join('')}
                        `;
                        tbody.appendChild(row);

                        if (trade.active) {
                            const cls = trade.active.direction === 'Лонг' ? 'long' : 'short';
                            tradeDiv.innerHTML = `<strong>Сделка:</strong> ${symbol} (${trade.active.timeframe}) <span class="${cls}">${trade.active.direction}</span> (${rec[trade.active.timeframe].confidence}%), Открытие: ${trade.active.entry.toFixed(4)}, Стоп: ${trade.active.stopLoss.toFixed(4)}, Профит: ${trade.active.takeProfit.toFixed(4)}`;
                            reasoningDiv.innerHTML = `<strong>Рассуждения ИИ:</strong> ${rec[trade.active.timeframe].reasoning}`;
                        } else {
                            tradeDiv.innerHTML = '<strong>Сделка:</strong> Нет';
                            reasoningDiv.innerHTML = '';
                        }
                        statsDiv.innerHTML = `<strong>Статистика:</strong> Открыто: ${trade.openCount}, Закрыто: ${trade.closedCount}, Стоп: ${trade.stopCount}, Профит: ${trade.profitCount}, Прибыль: ${trade.totalProfit.toFixed(2)} USDT, Убыток: ${trade.totalLoss.toFixed(2)} USDT`;
                    }

                    indicatorsContent.innerHTML = indicatorsHtml;
                })
                .catch(error => console.error('Ошибка получения данных:', error));
        }

        const TIMEFRAMES = ['15m', '30m', '1h', '4h', '1d', '1w'];
        updateData();
        setInterval(updateData, 5000);
    </script>
</body>
</html>
