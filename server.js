<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Crypto Trading</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f0f0f0; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background-color: white; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: left; font-size: 15px; }
        th { background-color: #4CAF50; color: white; }
        .sentiment { margin-bottom: 20px; font-size: 18px; display: flex; justify-content: space-between; }
        .long-block { background-color: #d4edda; color: #155724; padding: 10px; width: 48%; text-align: center; }
        .short-block { background-color: #f8d7da; color: #721c24; padding: 10px; width: 48%; text-align: center; }
        .sound { margin-top: 10px; }
        .long { color: green; }
        .short { color: red; }
        .neutral { color: #e6b800; }
        #indicators, #principles, #activeTrades, #techSpec { margin-top: 20px; font-size: 15px; }
        details { margin-top: 5px; }
        summary { cursor: pointer; }
        .trade-details { margin-top: 5px; font-size: 14px; }
    </style>
</head>
<body>
    <div class="sentiment">
        <div class="long-block">Лонги: <span id="long">0%</span></div>
        <div class="short-block">Шорты: <span id="short">0%</span></div>
    </div>
    <div class="sound">Звук: <input type="checkbox" id="sound" checked></div>
    <table>
        <thead>
            <tr>
                <th>Пара</th>
                <th>Рекомендация</th>
                <th>Сделка</th>
                <th>Закрыто</th>
                <th>С</th>
                <th>П</th>
                <th>Прибыль</th>
                <th>Убыток</th>
            </tr>
        </thead>
        <tbody id="data"></tbody>
    </table>
    <div id="indicators"></div>
    <div id="principles"></div>
    <div id="activeTrades"></div>
    <div id="techSpec">
        <strong>Техническое задание на создание сайта для криптовалютного трейдинга:</strong><br>
        1. Общее описание: Сайт должен предоставлять рекомендации по торговле криптовалютами (LDO/USDT, AVAX/USDT, XLM/USDT, HBAR/USDT, BAT/USDT, AAVE/USDT) с использованием максимального количества технических индикаторов и искусственного интеллекта для анализа данных и принятия решений.<br>
        2. Функционал: Отображение текущих рыночных настроений в двух горизонтальных блоках: "Лонги" (зелёный) и "Шорты" (красный) с целыми процентами (0-100%), рассчитанными ИИ по открытым позициям 20 самых популярных криптовалют. Таблица с данными по каждой паре: название пары, рекомендация (направление, вход, стоп-лосс, тейк-профит, уверенность, соотношение риск/прибыль), текущая сделка, количество закрытых сделок, стопов, профитов, общая прибыль и убыток в USDT. Открытие сделок только при уверенности не ниже 50% с высокой стабильностью тренда (до 25) после обработки всех индикаторов искусственным интеллектом. Дополнительно: если уверенность >= 45% и ADX > 30, сделка открывается при подтверждении ИИ. Звуковое уведомление при открытии новой сделки (включено по умолчанию, с чекбоксом). Под таблицей: список всех используемых индикаторов и фильтров, принципы принятия решений об открытии сделок, параметры активных сделок (неизменные до закрытия). Для каждой валюты: поля с ценой открытия, стоп-лосса и тейк-профита (неизменные до закрытия), раскрывающиеся меню с индикаторами и фильтрами.<br>
        3. Дизайн: Шрифт в таблице на 1 пиксель меньше стандартного (15px). Слово "Лонг" — зелёный, "Шорт" — красный, "Нейтрально" — жёлтый (#e6b800). "Лонги" и "Шорты" в шапке сайта в виде двух горизонтальных блоков: зелёный для "Лонги", красный для "Шорты".<br>
        4. Технические требования: Использовать все возможные технические индикаторы для анализа (25 и более), включая трендовые, импульсные, волатильные, объёмные и уровневые. Применять искусственный интеллект (например, линейную регрессию) для прогнозирования цены с весом +15/-15 и повышения точности. Учитывать ложные сигналы: фильтровать перекупленность/перепроданность, слабые тренды, высокую волатильность. Обновление данных каждые 5 секунд через WebSocket с Binance. Таймфрейм анализа — 15 минут. Стабильность: сделки открываются только при подтверждённом сильном тренде с колебаниями до 25 и после обработки всех индикаторов ИИ.<br>
        5. Тестирование сделок: Перед запуском протестировать код локально с использованием mock-данных для проверки корректности открытия сделок при уверенности 50% и выше (или 45% с ADX > 30 и подтверждением ИИ). Убедиться, что сделки открываются только после полного анализа всех индикаторов с применением ИИ. Проверить закрытие сделок по стоп-лоссу и тейк-профиту, а также точность расчёта прибыли и убытков. Логи должны отображать обновление цен, открытие и закрытие сделок без ошибок. После деплоя проверить работоспособность на реальных данных Binance, убедиться в отсутствии багов и корректности прогнозов.<br>
        6. Дополнительно: Сайт должен быть надёжным, без багов, с точными прогнозами, минимизирующими убытки. Все данные (индикаторы, принципы, сделки, техзадание) должны быть доступны пользователю на главной странице.<br>
        <strong>Внесённые изменения:</strong><br>
        - Расширен диапазон RSI с 30-70 до 20-80 для увеличения числа сделок без потери качества.<br>
        - Ослаблен фильтр ADX с 25 до 20 для допуска ранних трендов.<br>
        - Убран фильтр MACD (macd.line < macd.signal), так как он избыточен при расчёте уверенности.<br>
        - Стабильность тренда поднята до 25 (вместо 20) для большей гибкости при сохранении надёжности.<br>
        - Увеличен вес ИИ-прогноза до +15/-15 (вместо +10/-10) для усиления влияния на уверенность.<br>
        - Изменён таймфрейм с 5-минутного на 15-минутный для более быстрого анализа.<br>
        - Добавлены поля для каждой валюты с ценой открытия, стоп-лосса и тейк-профита, неизменные до закрытия сделки.<br>
        - Добавлены раскрывающиеся меню с индикаторами и фильтрами для каждой валюты.<br>
        - Анализ настроений рынка проводится по открытым позициям "Лонг" и "Шорт" для 20 самых популярных криптовалют с максимальной капитализацией, обработка ИИ, вывод в процентах 0-100.<br>
        - Звук включён по умолчанию.<br>
        - Цвет "Нейтрально" изменён на жёлтый (#e6b800), подобранный под фон.<br>
        - При открытии сделки "Лонг" или "Шорт" отображается в соответствующем цвете (зелёный/красный).<br>
        - Убраны отрицательные проценты уверенности, минимальное значение 0%.<br>
        - Confidence для открытия сделок снижен до 40% с проверкой стабильности на двух свечах.<br>
        - Запросы настроения рынка сокращены до 1 раза в 15 минут, сигналы обновляются каждые 5 секунд.
    </div>

    <script>
        const tbody = document.getElementById('data');
        const soundCheckbox = document.getElementById('sound');
        let previousTrades = {};

        function updateData() {
            fetch('/data')
                .then(response => response.json())
                .then(data => {
                    document.getElementById('long').textContent = `${data.sentiment.long}%`;
                    document.getElementById('short').textContent = `${data.sentiment.short}%`;
                    tbody.innerHTML = '';

                    for (const symbol in data.recommendations) {
                        const rec = data.recommendations[symbol];
                        const trade = data.trades[symbol];
                        const row = document.createElement('tr');

                        const directionClass = rec.direction === 'Лонг' ? 'long' : rec.direction === 'Шорт' ? 'short' : 'neutral';
                        const cells = [
                            symbol,
                            `<span class="${directionClass}">${rec.direction}</span>: ${rec.entry.toFixed(4)}, С: ${rec.stopLoss.toFixed(4)}, П: ${rec.takeProfit.toFixed(4)} | ${rec.confidence}% | ${rec.rrr}`,
                            trade.active ? `<span class="${trade.active.direction === 'Лонг' ? 'long' : 'short'}">${trade.active.direction}</span>` : '<span class="neutral">Нет</span>',
                            trade.closedCount,
                            trade.stopCount,
                            trade.profitCount,
                            `${trade.totalProfit.toFixed(2)} USDT`,
                            `${trade.totalLoss.toFixed(2)} USDT`
                        ];

                        cells.forEach(text => {
                            const td = document.createElement('td');
                            td.innerHTML = text;
                            row.appendChild(td);
                        });

                        if (trade.active) {
                            const tradeDetails = document.createElement('div');
                            tradeDetails.className = 'trade-details';
                            tradeDetails.innerHTML = `
                                Открытие: ${trade.active.entry.toFixed(4)}<br>
                                Стоп-лосс: ${trade.active.stopLoss.toFixed(4)}<br>
                                Тейк-профит: ${trade.active.takeProfit.toFixed(4)}
                            `;
                            row.cells[2].appendChild(tradeDetails);
                        }

                        const indicatorsDetails = document.createElement('details');
                        indicatorsDetails.innerHTML = `
                            <summary>Индикаторы</summary>
                            RSI: ${rec.indicators.rsi}<br>
                            MACD Line: ${rec.indicators.macd_line}, Signal: ${rec.indicators.macd_signal}, Histogram: ${rec.indicators.macd_histogram}<br>
                            ATR: ${rec.indicators.atr}<br>
                            ADX: ${rec.indicators.adx}<br>
                            Bollinger Upper: ${rec.indicators.bollinger_upper}, Middle: ${rec.indicators.bollinger_middle}, Lower: ${rec.indicators.bollinger_lower}<br>
                            Stochastic %K: ${rec.indicators.stochastic_k}, %D: ${rec.indicators.stochastic_d}<br>
                            CCI: ${rec.indicators.cci}<br>
                            Williams %R: ${rec.indicators.williamsR}<br>
                            ROC: ${rec.indicators.roc}<br>
                            Momentum: ${rec.indicators.momentum}<br>
                            OBV: ${rec.indicators.obv}<br>
                            SAR: ${rec.indicators.sar}<br>
                            Ichimoku Tenkan: ${rec.indicators.ichimoku_tenkan}, Kijun: ${rec.indicators.ichimoku_kijun}, Senkou A: ${rec.indicators.ichimoku_senkouA}, Senkou B: ${rec.indicators.ichimoku_senkouB}, Chikou: ${rec.indicators.ichimoku_chikou}<br>
                            VWAP: ${rec.indicators.vwap}<br>
                            CMO: ${rec.indicators.cmo}<br>
                            MFI: ${rec.indicators.mfi}<br>
                            TRIX: ${rec.indicators.trix}<br>
                            Keltner Upper: ${rec.indicators.keltner_upper}, Middle: ${rec.indicators.keltner_middle}, Lower: ${rec.indicators.keltner_lower}<br>
                            Donchian Upper: ${rec.indicators.donchian_upper}, Middle: ${rec.indicators.donchian_middle}, Lower: ${rec.indicators.donchian_lower}<br>
                            Aroon Up: ${rec.indicators.aroon_up}, Down: ${rec.indicators.aroon_down}<br>
                            Chaikin: ${rec.indicators.chaikin}<br>
                            Ultimate: ${rec.indicators.ultimate}<br>
                            Linear Regression Slope: ${rec.indicators.linRegSlope}<br>
                            Support: ${rec.indicators.support}, Resistance: ${rec.indicators.resistance}
                        `;
                        row.appendChild(indicatorsDetails);

                        tbody.appendChild(row);

                        if (soundCheckbox.checked && previousTrades[symbol] !== trade.active?.direction && trade.active) {
                            new Audio('https://www.myinstants.com/media/sounds/tada.mp3').play();
                        }
                        previousTrades[symbol] = trade.active?.direction;
                    }

                    document.getElementById('indicators').innerHTML = `
                        <strong>Индикаторы и фильтры:</strong><br>
                        RSI, MACD, ADX, ATR, EMA, SMA, Bollinger Bands, Stochastic, CCI, Williams %R, ROC, Momentum, OBV, Parabolic SAR, Ichimoku Cloud, VWAP, CMO, MFI, TRIX, Keltner Channels, Donchian Channels, Aroon, Chaikin Oscillator, Ultimate Oscillator, Linear Regression Slope<br>
                        Фильтры: RSI 20-80, ADX > 25, ATR/цена < 5%, Stochastic 20-80, CCI -100..100, Williams %R -80..-20, цена в Bollinger Bands и Keltner Channels, MFI 20-80
                    `;

                    document.getElementById('principles').innerHTML = `
                        <strong>Принципы открытия сделок:</strong><br>
                        1. Уверенность ≥ 40% (все индикаторы, ИИ-прогноз с весом +15, новости).<br>
                        2. Стабильность тренда ≤ 25 (за 10 свечей).<br>
                        3. RSI 40-60, ADX > 25, ATR/цена < 5%.<br>
                        4. MACD пересечение подтверждается на двух свечах.<br>
                        5. Прогноз ИИ подтверждается на двух свечах.<br>
                        6. Stochastic 20-80, CCI -100..100, Williams %R -80..-20.<br>
                        7. Цена в Bollinger Bands и Keltner Channels, MFI 20-80.<br>
                        8. Сделки открываются только после обработки всех индикаторов ИИ.
                    `;

                    let activeTradesHtml = '<strong>Активные сделки:</strong><br>';
                    for (const symbol in data.trades) {
                        const trade = data.trades[symbol];
                        if (trade.active) {
                            activeTradesHtml += `${symbol}: ${trade.active.direction}, Вход: ${trade.active.entry.toFixed(4)}, С: ${trade.active.stopLoss.toFixed(4)}, П: ${trade.active.takeProfit.toFixed(4)}<br>`;
                        }
                    }
                    document.getElementById('activeTrades').innerHTML = activeTradesHtml || '<strong>Активные сделки:</strong> Нет';
                })
                .catch(error => console.error('Ошибка получения данных:', error));
        }

        updateData();
        setInterval(updateData, 5000); // 5 секунд для сигналов
    </script>
</body>
</html>
