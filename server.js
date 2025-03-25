const fetch = require('node-fetch');

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const symbols = ['LDOUSDT', 'AVAXUSDT', 'XLMUSDT', 'HBARUSDT', 'BATUSDT', 'AAVEUSDT'];
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
        let recommendations = {};

        try {
            for (const symbol of symbols) {
                let klinesByTimeframe = {};
                for (const tf of TIMEFRAMES) {
                    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=100`);
                    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
                    klinesByTimeframe[tf] = await response.json();
                }

                const priceResponse = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
                if (!priceResponse.ok) throw new Error(`HTTP error: ${priceResponse.status}`);
                const priceData = await priceResponse.json();
                lastPrices[symbol] = parseFloat(priceData.price) || 0;

                recommendations[symbol] = await aiTradeDecision(symbol, klinesByTimeframe, lastPrices[symbol]);
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
            res.status(500).json({ error: 'Ошибка сервера', details: error.message });
        }
    } else if (req.method === 'POST' && req.url === '/reset-stats') {
        for (const symbol in trades) {
            trades[symbol] = { active: null, openCount: 0, closedCount: 0, stopCount: 0, profitCount: 0, totalProfit: 0, totalLoss: 0 };
        }
        res.sendStatus(200);
    }
};

async function aiTradeDecision(symbol, klinesByTimeframe, price) {
    let recommendations = {};
    const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d', '1w'];

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
            pivot: nw.smooth, 
            reasoning, 
            forecast, 
            marketState: `Рынок: ${market}, outsideChannel=${outsideChannel}`,
            blinkDirection: outsideChannel ? (price > nw.upper ? 'green' : 'red') : ''
        };
    }
    return recommendations;
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
