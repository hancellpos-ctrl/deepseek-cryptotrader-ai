const axios = require('axios');
const WebSocket = require('ws');
const crypto = require('crypto');
const { getConfig } = require('./config');

const BINANCE_FUTURES_REST = 'https://fapi.binance.com';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';

let wsKlineClient = null;
let wsMiniTickerClient = null;
let activeWsSymbol = null;
let activeWsInterval = null;
let currentPrices = {};
let pingInterval = null;
let miniTickerPingInterval = null;

function getCachedPrice(symbol) {
  return currentPrices[symbol] || null;
}

/**
 * Fetch historical Kline/Candlestick data
 */
async function fetchKlines(symbol = 'BTCUSDT', interval = '15m', limit = 100) {
  try {
    const url = `${BINANCE_FUTURES_REST}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const response = await axios.get(url, { timeout: 8000 });
    return response.data;
  } catch (error) {
    console.error(`Error fetching klines for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Fetch 24h Ticker statistics for a symbol
 */
async function fetch24hrTicker(symbol = 'BTCUSDT') {
  try {
    const url = `${BINANCE_FUTURES_REST}/fapi/v1/ticker/24hr?symbol=${symbol.toUpperCase()}`;
    const response = await axios.get(url, { timeout: 5000 });
    return {
      symbol: response.data.symbol,
      lastPrice: parseFloat(response.data.lastPrice),
      priceChange: parseFloat(response.data.priceChange),
      priceChangePercent: parseFloat(response.data.priceChangePercent),
      highPrice: parseFloat(response.data.highPrice),
      lowPrice: parseFloat(response.data.lowPrice),
      volume: parseFloat(response.data.volume),
      quoteVolume: parseFloat(response.data.quoteVolume)
    };
  } catch (error) {
    console.error(`Error fetching 24hr ticker for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetch top trending, high volume and breakout pairs on Binance Futures
 */
async function fetchTopTrendingPairs(limit = 12, minQuoteVolume = 20000000) {
  try {
    const url = `${BINANCE_FUTURES_REST}/fapi/v1/ticker/24hr`;
    const response = await axios.get(url, { timeout: 8000 });
    const usdtPairs = response.data
      .filter(item => item.symbol.endsWith('USDT') && parseFloat(item.quoteVolume) >= minQuoteVolume)
      .sort((a, b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent)))
      .slice(0, limit)
      .map(item => ({
        symbol: item.symbol,
        lastPrice: parseFloat(item.lastPrice),
        priceChangePercent: parseFloat(item.priceChangePercent),
        quoteVolume: parseFloat(item.quoteVolume)
      }));
    return usdtPairs;
  } catch (error) {
    console.error('Error fetching trending pairs:', error.message);
    return [];
  }
}

/**
 * Fetch current prices for multiple symbols
 */
async function fetchAllPrices(symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT', '1000PEPEUSDT']) {
  try {
    const url = `${BINANCE_FUTURES_REST}/fapi/v1/ticker/price`;
    const response = await axios.get(url, { timeout: 5000 });
    const priceMap = {};
    response.data.forEach(item => {
      if (symbols.includes(item.symbol)) {
        const p = parseFloat(item.price);
        priceMap[item.symbol] = p;
        currentPrices[item.symbol] = p;
      }
    });
    return priceMap;
  } catch (error) {
    console.error('Error fetching all prices:', error.message);
    return currentPrices;
  }
}

/**
 * Fetch single symbol current price
 */
async function fetchCurrentPrice(symbol = 'BTCUSDT') {
  try {
    if (currentPrices[symbol]) return currentPrices[symbol];
    const url = `${BINANCE_FUTURES_REST}/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`;
    const response = await axios.get(url, { timeout: 5000 });
    const price = parseFloat(response.data.price);
    currentPrices[symbol] = price;
    return price;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
    return currentPrices[symbol] || null;
  }
}

/**
 * Global Mini-Ticker WebSocket: Streams live prices for ALL pairs on Binance Futures
 */
function initAllPricesStream(onAllPricesUpdate) {
  if (wsMiniTickerClient) {
    try {
      wsMiniTickerClient.terminate();
    } catch (e) {}
    wsMiniTickerClient = null;
  }

  if (miniTickerPingInterval) clearInterval(miniTickerPingInterval);

  const wsUrl = `${BINANCE_FUTURES_WS}/!miniTicker@arr`;
  console.log('[Binance WS] Connecting global miniTicker stream for all pairs...');
  wsMiniTickerClient = new WebSocket(wsUrl);

  wsMiniTickerClient.on('open', () => {
    console.log('[Binance WS] Global miniTicker stream connected');
    miniTickerPingInterval = setInterval(() => {
      if (wsMiniTickerClient && wsMiniTickerClient.readyState === WebSocket.OPEN) {
        wsMiniTickerClient.ping();
      }
    }, 30000);
  });

  wsMiniTickerClient.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        const updated = {};
        parsed.forEach(item => {
          const price = parseFloat(item.c);
          currentPrices[item.s] = price;
          updated[item.s] = price;
        });

        if (Object.keys(updated).length > 0 && onAllPricesUpdate) {
          onAllPricesUpdate(updated);
        }
      }
    } catch (e) {
      console.error('[Binance WS] MiniTicker parse error:', e.message);
    }
  });

  wsMiniTickerClient.on('error', (err) => {
    console.error('[Binance WS] MiniTicker Error:', err.message);
  });

  wsMiniTickerClient.on('close', () => {
    console.log('[Binance WS] MiniTicker connection closed. Reconnecting in 3s...');
    if (miniTickerPingInterval) clearInterval(miniTickerPingInterval);
    setTimeout(() => initAllPricesStream(onAllPricesUpdate), 3000);
  });
}

/**
 * Connect to Binance Public WebSocket for active symbol live candle & price stream
 */
function connectBinanceStream(symbol, interval, onPriceUpdate, onCandleUpdate) {
  const formattedSymbol = symbol.toLowerCase();
  activeWsSymbol = symbol;
  activeWsInterval = interval;

  if (wsKlineClient) {
    try {
      wsKlineClient.terminate();
    } catch (e) {}
    wsKlineClient = null;
  }

  if (pingInterval) clearInterval(pingInterval);

  const streamName = `${formattedSymbol}@kline_${interval}`;
  const wsUrl = `${BINANCE_FUTURES_WS}/${streamName}`;

  console.log(`[Binance WS] Connecting active stream: ${streamName}`);
  wsKlineClient = new WebSocket(wsUrl);

  wsKlineClient.on('open', () => {
    console.log(`[Binance WS] Active stream connected to ${streamName}`);
    pingInterval = setInterval(() => {
      if (wsKlineClient && wsKlineClient.readyState === WebSocket.OPEN) {
        wsKlineClient.ping();
      }
    }, 30000);
  });

  wsKlineClient.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.e === 'kline') {
        const k = msg.k;
        const currentPrice = parseFloat(k.c);
        currentPrices[symbol] = currentPrice;

        if (onPriceUpdate) {
          onPriceUpdate({
            symbol: symbol,
            price: currentPrice,
            timestamp: msg.E,
            priceChange: parseFloat(k.c) - parseFloat(k.o),
            priceChangePercent: ((parseFloat(k.c) - parseFloat(k.o)) / parseFloat(k.o)) * 100,
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            volume: parseFloat(k.v)
          });
        }

        if (onCandleUpdate) {
          onCandleUpdate({
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isFinal: k.x
          });
        }
      }
    } catch (err) {
      console.error('[Binance WS] Error parsing kline message:', err.message);
    }
  });

  wsKlineClient.on('error', (err) => {
    console.error(`[Binance WS] Error on stream ${streamName}:`, err.message);
  });

  wsKlineClient.on('close', () => {
    console.log(`[Binance WS] Stream ${streamName} closed.`);
    if (pingInterval) clearInterval(pingInterval);
  });
}

/**
 * Execute a REAL Binance Futures Market Order
 */
async function executeRealBinanceOrder({ symbol, side, quantity, leverage = 1, stopLoss, takeProfit, type = 'MARKET' }) {
  const config = getConfig();
  if (!config.binanceApiKey || !config.binanceApiSecret) {
    throw new Error('Binance API Key and Secret are required for Real Trading mode.');
  }

  const timestamp = Date.now();
  const apiKey = config.binanceApiKey;
  const apiSecret = config.binanceApiSecret;

  try {
    const levQuery = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
    const levSignature = crypto.createHmac('sha256', apiSecret).update(levQuery).digest('hex');
    await axios.post(`${BINANCE_FUTURES_REST}/fapi/v1/leverage?${levQuery}&signature=${levSignature}`, null, {
      headers: { 'X-MBX-APIKEY': apiKey }
    });
  } catch (err) {
    console.warn(`[Binance Real] Note setting leverage:`, err.response?.data?.msg || err.message);
  }

  const orderSide = side.toUpperCase();
  let orderQuery = `symbol=${symbol}&side=${orderSide}&type=${type}&quantity=${quantity}&timestamp=${Date.now()}`;
  let orderSignature = crypto.createHmac('sha256', apiSecret).update(orderQuery).digest('hex');

  const orderRes = await axios.post(`${BINANCE_FUTURES_REST}/fapi/v1/order?${orderQuery}&signature=${orderSignature}`, null, {
    headers: { 'X-MBX-APIKEY': apiKey }
  });

  if (stopLoss) {
    try {
      const slSide = orderSide === 'BUY' ? 'SELL' : 'BUY';
      const slQuery = `symbol=${symbol}&side=${slSide}&type=STOP_MARKET&stopPrice=${stopLoss}&closePosition=true&timestamp=${Date.now()}`;
      const slSignature = crypto.createHmac('sha256', apiSecret).update(slQuery).digest('hex');
      await axios.post(`${BINANCE_FUTURES_REST}/fapi/v1/order?${slQuery}&signature=${slSignature}`, null, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
    } catch (slErr) {
      console.error('[Binance Real] Failed to set Stop Loss order:', slErr.response?.data?.msg || slErr.message);
    }
  }

  if (takeProfit) {
    try {
      const tpSide = orderSide === 'BUY' ? 'SELL' : 'BUY';
      const tpQuery = `symbol=${symbol}&side=${tpSide}&type=TAKE_PROFIT_MARKET&stopPrice=${takeProfit}&closePosition=true&timestamp=${Date.now()}`;
      const tpSignature = crypto.createHmac('sha256', apiSecret).update(tpQuery).digest('hex');
      await axios.post(`${BINANCE_FUTURES_REST}/fapi/v1/order?${tpQuery}&signature=${tpSignature}`, null, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
    } catch (tpErr) {
      console.error('[Binance Real] Failed to set Take Profit order:', tpErr.response?.data?.msg || tpErr.message);
    }
  }

  return orderRes.data;
}

module.exports = {
  fetchKlines,
  fetch24hrTicker,
  fetchTopTrendingPairs,
  fetchAllPrices,
  fetchCurrentPrice,
  getCachedPrice,
  initAllPricesStream,
  connectBinanceStream,
  executeRealBinanceOrder
};
