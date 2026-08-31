/**
 * Technical Indicators Engine for Binance Futures & DeepSeek CryptoTrader
 */

function formatDecimals(val, precision = 6) {
  if (val === null || val === undefined || isNaN(val)) return null;
  return Number(val.toFixed(precision));
}

function calculateSMA(data, period) {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return formatDecimals(sum / period, 7);
}

function calculateEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return formatDecimals(ema, 7);
}

function calculateEMASeries(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const emaSeries = [];
  let ema = data.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  emaSeries.push({ index: period - 1, value: formatDecimals(ema, 7) });

  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    emaSeries.push({ index: i, value: formatDecimals(ema, 7) });
  }
  return emaSeries;
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return Number(rsi.toFixed(2));
}

function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const fastK = 2 / (fastPeriod + 1);
  const slowK = 2 / (slowPeriod + 1);

  let fastEMA = closes.slice(0, fastPeriod).reduce((a, b) => a + b, 0) / fastPeriod;
  let slowEMA = closes.slice(0, slowPeriod).reduce((a, b) => a + b, 0) / slowPeriod;

  const macdLine = [];
  
  for (let i = fastPeriod; i < slowPeriod; i++) {
    fastEMA = closes[i] * fastK + fastEMA * (1 - fastK);
  }

  for (let i = slowPeriod; i < closes.length; i++) {
    fastEMA = closes[i] * fastK + fastEMA * (1 - fastK);
    slowEMA = closes[i] * slowK + slowEMA * (1 - slowK);
    macdLine.push(fastEMA - slowEMA);
  }

  if (macdLine.length < signalPeriod) return null;

  const signalK = 2 / (signalPeriod + 1);
  let signalEMA = macdLine.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;

  for (let i = signalPeriod; i < macdLine.length; i++) {
    signalEMA = macdLine[i] * signalK + signalEMA * (1 - signalK);
  }

  const currentMACD = macdLine[macdLine.length - 1];
  const currentSignal = signalEMA;
  const histogram = currentMACD - currentSignal;

  return {
    macd: formatDecimals(currentMACD, 7),
    signal: formatDecimals(currentSignal, 7),
    histogram: formatDecimals(histogram, 7),
    trend: histogram > 0 ? (currentMACD > currentSignal ? 'BULLISH' : 'WEAK_BULLISH') : (currentMACD < currentSignal ? 'BEARISH' : 'WEAK_BEARISH')
  };
}

function calculateBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upper = middle + (stdDevMultiplier * stdDev);
  const lower = middle - (stdDevMultiplier * stdDev);
  const lastPrice = closes[closes.length - 1];
  const percentB = upper !== lower ? (lastPrice - lower) / (upper - lower) : 0.5;

  return {
    upper: formatDecimals(upper, 7),
    middle: formatDecimals(middle, 7),
    lower: formatDecimals(lower, 7),
    percentB: Number(percentB.toFixed(4)),
    bandwidth: Number((((upper - lower) / middle) * 100).toFixed(2))
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length <= period) return null;
  const trueRanges = [];
  
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  if (trueRanges.length < period) return null;
  
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return formatDecimals(atr, 7);
}

function calculateSupportResistance(highs, lows, closes, lookback = 30) {
  if (closes.length < lookback) return { supports: [], resistances: [] };

  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  const currentPrice = closes[closes.length - 1];

  const maxHigh = Math.max(...recentHighs);
  const minLow = Math.min(...recentLows);
  
  const pivot = (maxHigh + minLow + currentPrice) / 3;
  const r1 = (2 * pivot) - minLow;
  const s1 = (2 * pivot) - maxHigh;
  const r2 = pivot + (maxHigh - minLow);
  const s2 = pivot - (maxHigh - minLow);

  return {
    currentPrice,
    pivot: formatDecimals(pivot, 7),
    resistanceLevels: [formatDecimals(r1, 7), formatDecimals(r2, 7), formatDecimals(maxHigh, 7)],
    supportLevels: [formatDecimals(s1, 7), formatDecimals(s2, 7), formatDecimals(minLow, 7)]
  };
}

function calculateVolumeTrend(volumes, period = 20) {
  if (volumes.length < period) return { current: 0, average: 0, ratio: 1, surge: false };
  const current = volumes[volumes.length - 1];
  const slice = volumes.slice(-period);
  const avg = slice.reduce((a, b) => a + b, 0) / period;
  const ratio = avg > 0 ? Number((current / avg).toFixed(2)) : 1;
  return {
    current: Number(current.toFixed(2)),
    average: Number(avg.toFixed(2)),
    ratio,
    surge: ratio >= 1.5
  };
}

function analyzeCandles(klines) {
  if (!klines || klines.length < 30) {
    return { error: 'Insufficient kline data for analysis' };
  }

  const opens = klines.map(k => parseFloat(k[1]));
  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));
  const volumes = klines.map(k => parseFloat(k[5]));

  const currentPrice = closes[closes.length - 1];
  const previousPrice = closes[closes.length - 2];
  const priceChangePercent = Number((((currentPrice - previousPrice) / previousPrice) * 100).toFixed(2));

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);
  const atr14 = calculateATR(highs, lows, closes, 14);
  const supRes = calculateSupportResistance(highs, lows, closes, 40);
  const volTrend = calculateVolumeTrend(volumes, 20);

  let trendScore = 0;
  if (ema9 && ema21 && ema9 > ema21) trendScore += 1;
  if (ema9 && ema21 && ema9 < ema21) trendScore -= 1;
  if (ema50 && currentPrice > ema50) trendScore += 1;
  if (ema50 && currentPrice < ema50) trendScore -= 1;
  if (ema200 && currentPrice > ema200) trendScore += 1;
  if (ema200 && currentPrice < ema200) trendScore -= 1;
  if (macd && macd.histogram > 0) trendScore += 1;
  if (macd && macd.histogram < 0) trendScore -= 1;

  let overallTrend = 'NEUTRAL';
  if (trendScore >= 2) overallTrend = 'STRONG_BULLISH';
  else if (trendScore === 1) overallTrend = 'MODERATE_BULLISH';
  else if (trendScore === -1) overallTrend = 'MODERATE_BEARISH';
  else if (trendScore <= -2) overallTrend = 'STRONG_BEARISH';

  return {
    currentPrice,
    priceChangePercent,
    indicators: {
      ema: { ema9, ema21, ema50, ema200 },
      rsi: {
        value: rsi14,
        status: rsi14 > 70 ? 'OVERBOUGHT' : (rsi14 < 30 ? 'OVERSOLD' : 'NEUTRAL')
      },
      macd,
      bollingerBands: bb,
      atr: atr14,
      volume: volTrend
    },
    supportResistance: supRes,
    trendScore,
    overallTrend,
    lastCandle: {
      open: opens[opens.length - 1],
      high: highs[highs.length - 1],
      low: lows[lows.length - 1],
      close: closes[closes.length - 1],
      volume: volumes[volumes.length - 1]
    }
  };
}

module.exports = {
  calculateSMA,
  calculateEMA,
  calculateEMASeries,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateSupportResistance,
  calculateVolumeTrend,
  analyzeCandles
};
