const axios = require('axios');
const { getConfig } = require('./config');
const { analyzeCandles } = require('./indicators');
const { fetchKlines, fetch24hrTicker } = require('./binanceService');

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * Format prompt and query DeepSeek AI for trading analysis
 */
async function analyzeMarketWithDeepSeek(symbol = 'BTCUSDT', timeframe = '15m', currentPositions = []) {
  const config = getConfig();
  
  // 1. Fetch live market data & technical indicators
  const klines = await fetchKlines(symbol, timeframe, 80);
  const ticker = await fetch24hrTicker(symbol);
  const techAnalysis = analyzeCandles(klines);

  if (techAnalysis.error) {
    throw new Error(techAnalysis.error);
  }

  // 2. Prepare Context for DeepSeek
  const marketDataPayload = {
    symbol: symbol.toUpperCase(),
    timeframe,
    currentPrice: techAnalysis.currentPrice,
    change24h: ticker ? `${ticker.priceChangePercent}%` : 'N/A',
    high24h: ticker ? ticker.highPrice : 'N/A',
    low24h: ticker ? ticker.lowPrice : 'N/A',
    indicators: {
      rsi: techAnalysis.indicators.rsi,
      macd: techAnalysis.indicators.macd,
      ema: techAnalysis.indicators.ema,
      bollingerBands: techAnalysis.indicators.bollingerBands,
      atr: techAnalysis.indicators.atr,
      volumeTrend: techAnalysis.indicators.volume
    },
    supportResistance: techAnalysis.supportResistance,
    technicalTrend: techAnalysis.overallTrend,
    activePositionsInPair: currentPositions.filter(p => p.symbol === symbol.toUpperCase())
  };

  // If no API key is provided, use algorithmic technical fallback with clear notification
  if (!config.deepseekApiKey || config.deepseekApiKey.trim() === '') {
    return generateTechnicalFallbackSignal(marketDataPayload, techAnalysis);
  }

  const systemPrompt = `Eres un gestor cuantitativo de Binance Spot 1x ($100/trade). Meta: +$10 USD acumulados con micro-operaciones seguras.
Evalúa los datos técnicos y responde ÚNICAMENTE este JSON:
{
  "symbol": "${symbol.toUpperCase()}",
  "signal": "BUY_LONG" | "SELL_SHORT" | "HOLD" | "CLOSE_POSITION",
  "confidence": 80,
  "recommended_leverage": 1,
  "entry_price": ${techAnalysis.currentPrice},
  "take_profit": 0.0,
  "stop_loss": 0.0,
  "risk_reward_ratio": "1.5:1",
  "market_condition": "BULLISH_MOMENTUM" | "BEARISH_BREAKDOWN" | "CONSOLIDATION_RANGE" | "OVERBOUGHT_REVERSAL" | "OVERSOLD_BOUNCE",
  "reasoning": "Breve explicación cuantitativa en español.",
  "risk_warning": "Nivel de invalidación."
}`;

  const userPrompt = `Datos técnicos en vivo ${symbol} (${timeframe}):
Precio: ${techAnalysis.currentPrice}, 24h: ${marketDataPayload.change24h}
RSI: ${techAnalysis.indicators.rsi?.value || 'N/A'} (${techAnalysis.indicators.rsi?.status})
MACD: hist=${techAnalysis.indicators.macd?.histogram || 0}
EMAs: 9=${techAnalysis.indicators.ema?.ema9}, 21=${techAnalysis.indicators.ema?.ema21}, 50=${techAnalysis.indicators.ema?.ema50}
Volumen Ratio: ${techAnalysis.indicators.volume?.ratio || 1.0}x
Tendencia: ${techAnalysis.overallTrend}
Posiciones abiertas: ${JSON.stringify(marketDataPayload.activePositionsInPair.map(p => ({ side: p.side, entry: p.entryPrice, pnl: p.unrealizedPnL })))}`;

  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: config.deepseekModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.15,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.deepseekApiKey.trim()}`
        },
        timeout: 20000
      }
    );

    const content = response.data.choices[0].message.content;
    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch (parseErr) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('DeepSeek did not return valid JSON');
      }
    }

    return {
      symbol: symbol.toUpperCase(),
      signal: parsedResult.signal || 'HOLD',
      confidence: parsedResult.confidence || 50,
      recommended_leverage: Number(parsedResult.recommended_leverage || 1),
      entry_price: parsedResult.entry_price ? Number(parsedResult.entry_price) : techAnalysis.currentPrice,
      take_profit: parsedResult.take_profit ? Number(parsedResult.take_profit) : techAnalysis.currentPrice,
      stop_loss: parsedResult.stop_loss ? Number(parsedResult.stop_loss) : techAnalysis.currentPrice,
      risk_reward_ratio: parsedResult.risk_reward_ratio || '1.5:1',
      market_condition: parsedResult.market_condition || techAnalysis.overallTrend,
      reasoning: parsedResult.reasoning || 'Análisis cuantitativo de DeepSeek AI.',
      risk_warning: parsedResult.risk_warning || 'Operar con stop loss activo.',
      isAiGenerated: true,
      aiModel: config.deepseekModel || 'deepseek-chat',
      analyzedAt: new Date().toISOString(),
      rawMarketData: marketDataPayload
    };
  } catch (error) {
    console.error(`[DeepSeek API] Error for ${symbol}:`, error.response?.data?.error?.message || error.message);
    return generateTechnicalFallbackSignal(marketDataPayload, techAnalysis);
  }
}

/**
 * Helper to format price precision
 */
function formatPricePrecision(val) {
  if (val === null || val === undefined || isNaN(val)) return 0;
  if (val < 0.001) return Number(val.toFixed(8));
  if (val < 1) return Number(val.toFixed(4));
  if (val < 10) return Number(val.toFixed(3));
  return Number(val.toFixed(2));
}

/**
 * Algorithmic Technical Indicator Fallback (when no API key or during API error / token-saving)
 */
function generateTechnicalFallbackSignal(marketData, techAnalysis) {
  const { currentPrice, indicators, overallTrend, supportResistance } = techAnalysis;
  const rsi = indicators.rsi?.value || 50;
  const macd = indicators.macd;
  const atr = indicators.atr || (currentPrice * 0.01);

  let signal = 'HOLD';
  let confidence = 50;
  let condition = 'CONSOLIDATION_RANGE';
  let reasoning = 'Mercado en rango o consolidación sin confluencia técnica suficiente.';

  const isBullish = overallTrend.includes('BULLISH') && rsi < 68 && macd?.histogram > 0;
  const isBearish = overallTrend.includes('BEARISH') && rsi > 32 && macd?.histogram < 0;

  let takeProfit = currentPrice;
  let stopLoss = currentPrice;
  const leverage = 1;

  if (isBullish) {
    signal = 'BUY_LONG';
    confidence = overallTrend === 'STRONG_BULLISH' ? 78 : 68;
    condition = 'BULLISH_MOMENTUM';
    stopLoss = formatPricePrecision(currentPrice - (atr * 1.5));
    takeProfit = formatPricePrecision(currentPrice + (atr * 2.5));
    reasoning = `Tendencia alcista (${overallTrend}). RSI en ${rsi}. MACD positivo (${macd?.histogram}). Compra Spot 1x con TP en $${takeProfit}.`;
  } else if (isBearish) {
    signal = 'SELL_SHORT';
    confidence = overallTrend === 'STRONG_BEARISH' ? 78 : 68;
    condition = 'BEARISH_BREAKDOWN';
    stopLoss = formatPricePrecision(currentPrice + (atr * 1.5));
    takeProfit = formatPricePrecision(currentPrice - (atr * 2.5));
    reasoning = `Tendencia bajista (${overallTrend}). RSI en ${rsi}. MACD negativo (${macd?.histogram}). Venta/Short con TP en $${takeProfit}.`;
  } else {
    signal = 'HOLD';
    confidence = 50;
    stopLoss = formatPricePrecision(currentPrice * 0.98);
    takeProfit = formatPricePrecision(currentPrice * 1.02);
    reasoning = `Mercado en fase neutral/lateral (RSI ${rsi}). Sin confluencia clara.`;
  }

  const risk = Math.abs(currentPrice - stopLoss);
  const reward = Math.abs(takeProfit - currentPrice);
  const rrRatio = risk > 0 ? (reward / risk).toFixed(1) + ':1' : '1.5:1';

  return {
    symbol: marketData.symbol,
    signal,
    confidence,
    recommended_leverage: leverage,
    entry_price: currentPrice,
    take_profit: takeProfit,
    stop_loss: stopLoss,
    risk_reward_ratio: rrRatio,
    market_condition: condition,
    reasoning,
    risk_warning: `Invalidación si el precio rompe el Stop Loss en $${stopLoss}.`,
    isAiGenerated: false,
    aiModel: 'algorithmic_technical_gatekeeper',
    analyzedAt: new Date().toISOString(),
    rawMarketData: marketData
  };
}

module.exports = {
  analyzeMarketWithDeepSeek,
  generateTechnicalFallbackSignal
};
