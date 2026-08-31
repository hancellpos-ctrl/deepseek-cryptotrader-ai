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

  const systemPrompt = `Eres un gestor de fondos cuantitativo autónomo y algoritmo de alta frecuencia especializado en Binance Futures.
Tu misión principal es llevar el balance del portafolio de $1,000.00 USDT a $1,010.00 USDT (+10 USD DE GANANCIA NETA TOTAL ACUMULADA) mediante operaciones inteligentes y de bajo riesgo:
1. ESTRATEGIA: NO busques $10 en una sola operación arriesgada. Realiza micro-operaciones seguras (capturando +$1.50, +$2.50, +$3.50 por trade con movimientos del 0.4% - 0.9%) que se acumulan progresivamente hasta llegar a la meta global de $10 USD.
2. PRESERVACIÓN DE CAPITAL: Asigna solo $50 USDT (5% del capital) por trade a 10x de apalancamiento ($500 valor nocional). Máximo 2 operaciones simultáneas, manteniendo más de $900 USDT (90-95%) 100% protegidos en reserva.
3. CONTROL DE RIESGO: Stop Loss protector ajustado (máximo -$1.50 a -$2.00 USDT de riesgo por operación).
4. GESTIÓN AUTÓNOMA: Si ya existe una posición abierta en esta moneda ("activePositionsInPair"), evalúa si mantenerla ("HOLD") o cerrarla con ganancia/protección ("CLOSE_POSITION").
5. APERTURAS: Solo emite "BUY_LONG" o "SELL_SHORT" si la confluencia técnica (RSI, MACD, EMAs, Volumen) es sólida (Confianza >= 68%).
6. Explica tu razonamiento cuantitativo en español.

Debes responder ÚNICAMENTE un objeto JSON válido con la siguiente estructura exacta (sin texto adicional):
{
  "symbol": "${symbol.toUpperCase()}",
  "signal": "BUY_LONG" | "SELL_SHORT" | "HOLD" | "CLOSE_POSITION",
  "confidence": 85,
  "recommended_leverage": 10,
  "entry_price": 95000.0,
  "take_profit": 95760.0,
  "stop_loss": 94620.0,
  "risk_reward_ratio": "1.8:1",
  "expected_trade_gain": "+$3.80 USDT",
  "market_condition": "BULLISH_MOMENTUM" | "BEARISH_BREAKDOWN" | "CONSOLIDATION_RANGE" | "OVERBOUGHT_REVERSAL" | "OVERSOLD_BOUNCE",
  "reasoning": "Explicación clara en español de por qué este trade contribuye de forma segura a sumar hacia la meta global de $10 USD.",
  "risk_warning": "Nivel exacto de protección o invalidación."
}`;

  const userPrompt = `Analiza estos datos de mercado en vivo de ${symbol} (${timeframe}) y determina la mejor operación en Binance Futures:
\`\`\`json
${JSON.stringify(marketDataPayload, null, 2)}
\`\`\`
Responde solo con el JSON requerido.`;

  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: config.deepseekModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2, // Low temperature for consistent quantitative analysis
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.deepseekApiKey.trim()}`
        },
        timeout: 25000
      }
    );

    const content = response.data.choices[0].message.content;
    let parsedResult;
    try {
      parsedResult = JSON.parse(content);
    } catch (parseErr) {
      // Regex extraction fallback
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse JSON from DeepSeek response: ' + content);
      }
    }

    return {
      ...parsedResult,
      isAiGenerated: true,
      aiModel: config.deepseekModel || 'deepseek-chat',
      analyzedAt: new Date().toISOString(),
      rawMarketData: marketDataPayload
    };
  } catch (error) {
    console.error('[DeepSeek API Error]:', error.response?.data || error.message);
    // Fallback if DeepSeek API throws error (e.g. rate limit, invalid key)
    const fallback = generateTechnicalFallbackSignal(marketDataPayload, techAnalysis);
    fallback.reasoning = `[Aviso: Error conectando a DeepSeek API (${error.response?.data?.error?.message || error.message}). Usando análisis técnico algorítmico]: ` + fallback.reasoning;
    return fallback;
  }
}

function formatPricePrecision(price) {
  if (price === null || price === undefined || isNaN(price)) return 0;
  const num = parseFloat(price);
  if (num >= 1000) return Number(num.toFixed(2));
  if (num >= 1) return Number(num.toFixed(4));
  return Number(num.toFixed(8));
}

/**
 * Algorithmic Technical Indicator Fallback (when no API key or during API error)
 */
function generateTechnicalFallbackSignal(marketData, techAnalysis) {
  const { currentPrice, indicators, overallTrend, supportResistance } = techAnalysis;
  const rsi = indicators.rsi?.value || 50;
  const macd = indicators.macd;
  const ema = indicators.ema;
  const atr = indicators.atr || (currentPrice * 0.01);

  let signal = 'HOLD';
  let confidence = 50;
  let condition = 'CONSOLIDATION_RANGE';
  let reasoning = 'El mercado no presenta confluencia suficiente para una entrada de alta probabilidad.';

  const isBullish = overallTrend.includes('BULLISH') && rsi < 65 && macd?.histogram > 0;
  const isBearish = overallTrend.includes('BEARISH') && rsi > 35 && macd?.histogram < 0;

  let takeProfit = currentPrice;
  let stopLoss = currentPrice;
  let leverage = 10;

  if (isBullish) {
    signal = 'BUY_LONG';
    confidence = overallTrend === 'STRONG_BULLISH' ? 82 : 72;
    condition = 'BULLISH_MOMENTUM';
    stopLoss = formatPricePrecision(currentPrice - (atr * 1.5));
    takeProfit = formatPricePrecision(currentPrice + (atr * 3.0));
    reasoning = `Tendencia alcista confirmada (${overallTrend}). RSI en ${rsi} con espacio para subir. MACD con histograma positivo (${macd?.histogram}). EMA 9 por encima de EMA 21.`;
  } else if (isBearish) {
    signal = 'SELL_SHORT';
    confidence = overallTrend === 'STRONG_BEARISH' ? 82 : 72;
    condition = 'BEARISH_BREAKDOWN';
    stopLoss = formatPricePrecision(currentPrice + (atr * 1.5));
    takeProfit = formatPricePrecision(currentPrice - (atr * 3.0));
    reasoning = `Tendencia bajista detectada (${overallTrend}). RSI en ${rsi} perdiendo soporte. MACD con histograma negativo (${macd?.histogram}). Presión vendedora activa.`;
  } else {
    signal = 'HOLD';
    confidence = 50;
    stopLoss = formatPricePrecision(currentPrice * 0.98);
    takeProfit = formatPricePrecision(currentPrice * 1.03);
    reasoning = `Mercado en fase de consolidación o lateralización. RSI neutro (${rsi}). Se recomienda esperar una ruptura de soporte (${supportResistance.supportLevels[0] || 'N/A'}) o resistencia (${supportResistance.resistanceLevels[0] || 'N/A'}).`;
  }

  const risk = Math.abs(currentPrice - stopLoss);
  const reward = Math.abs(takeProfit - currentPrice);
  const rrRatio = risk > 0 ? (reward / risk).toFixed(1) + ':1' : '2.0:1';

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
    aiModel: 'algorithmic_technical_fallback',
    analyzedAt: new Date().toISOString(),
    rawMarketData: marketData
  };
}

module.exports = {
  analyzeMarketWithDeepSeek
};
