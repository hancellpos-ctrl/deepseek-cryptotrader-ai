const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const { getConfig, getSafeConfig, updateConfig } = require('./config');
const { fetchKlines, fetch24hrTicker, fetchAllPrices, initAllPricesStream, connectBinanceStream, fetchCurrentPrice, fetchTopTrendingPairs } = require('./binanceService');
const { analyzeCandles } = require('./indicators');
const paperEngine = require('./paperTradingEngine');
const autoTrader = require('./autoTrader');
const { analyzeMarketWithDeepSeek } = require('./deepseekService');
const { testTelegramConnection, sendOrderClosedAlert } = require('./telegramService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Broadcast to all connected WebSockets
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Wire up paper engine events
paperEngine.onEvent((eventType, payload) => {
  broadcast(eventType, payload);
  broadcast('WALLET_UPDATE', paperEngine.getAccountSummary());

  if (eventType === 'POSITION_CLOSED') {
    const config = getConfig();
    sendOrderClosedAlert(payload, config.tradingMode).catch(e => console.error(e));
    autoTrader.log(`Posición cerrada en ${payload.symbol}: PnL $${payload.realizedPnL} (${payload.roiPercent}%) - ${payload.closeReason}`, payload.realizedPnL >= 0 ? 'success' : 'warning');
  }
});

// Wire up auto trader broadcaster
autoTrader.setBroadcaster((eventType, payload) => {
  broadcast(eventType, payload);
});

// WebSocket Connection handling
wss.on('connection', (ws) => {
  console.log('[WS] New UI client connected');

  // Send initial state
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    data: {
      config: getSafeConfig(),
      wallet: paperEngine.getAccountSummary(),
      autoTraderStatus: {
        isRunning: autoTrader.isRunning,
        isAnalyzing: autoTrader.isAnalyzing,
        lastScanTime: autoTrader.lastScanTime,
        latestSignals: autoTrader.latestSignals,
        logs: autoTrader.logs.slice(0, 30)
      }
    }
  }));

  ws.on('message', async (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'SUBSCRIBE_SYMBOL') {
        const { symbol, interval } = parsed.data;
        startBinanceStreamForSymbol(symbol, interval || '15m');
      }
    } catch (e) {
      console.error('[WS] Client message error:', e.message);
    }
  });
});

let currentActiveSymbol = 'BTCUSDT';
let currentActiveInterval = '15m';

function startBinanceStreamForSymbol(symbol, interval = '15m') {
  currentActiveSymbol = symbol;
  currentActiveInterval = interval;
  
  connectBinanceStream(
    symbol,
    interval,
    (priceData) => {
      // 1. Update live price in paper engine and check TP/SL/Liquidation
      const pnlChanged = paperEngine.updateMarketPrice(symbol, priceData.price);

      // 2. Broadcast price tick
      broadcast('PRICE_TICK', priceData);

      if (pnlChanged) {
        broadcast('WALLET_UPDATE', paperEngine.getAccountSummary());
      }
    },
    (candleData) => {
      // Broadcast candle updates for live TradingView chart
      broadcast('CANDLE_UPDATE', candleData);
    }
  );
}

// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

/**
 * Get General System Status
 */
app.get('/api/status', async (req, res) => {
  try {
    const config = getSafeConfig();
    const wallet = paperEngine.getAccountSummary();
    const prices = await fetchAllPrices(config.tradingPairs);
    const ticker = await fetch24hrTicker(currentActiveSymbol);

    res.json({
      success: true,
      config,
      wallet,
      prices,
      activeTicker: ticker,
      autoPilot: {
        isRunning: autoTrader.isRunning,
        isAnalyzing: autoTrader.isAnalyzing,
        lastScanTime: autoTrader.lastScanTime
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get Top Trending / Volatile Cryptos from Binance Futures
 */
app.get('/api/market/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '12', 10);
    const trending = await fetchTopTrendingPairs(limit);
    res.json({ success: true, trending });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get Candles (Klines) for TradingView Chart
 */
app.get('/api/candles', async (req, res) => {
  try {
    const symbol = req.query.symbol || currentActiveSymbol;
    const interval = req.query.interval || currentActiveInterval;
    const limit = parseInt(req.query.limit || '150', 10);

    const klines = await fetchKlines(symbol, interval, limit);
    const formattedCandles = klines.map(k => ({
      time: Math.floor(k[0] / 1000), // UNIX timestamp in seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    res.json({ success: true, symbol, interval, candles: formattedCandles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get Technical Indicators for active symbol
 */
app.get('/api/indicators', async (req, res) => {
  try {
    const symbol = req.query.symbol || currentActiveSymbol;
    const interval = req.query.interval || currentActiveInterval;
    const klines = await fetchKlines(symbol, interval, 80);
    const analysis = analyzeCandles(klines);

    res.json({ success: true, symbol, interval, analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Get Paper Wallet Summary
 */
app.get('/api/wallet', (req, res) => {
  res.json({ success: true, wallet: paperEngine.getAccountSummary() });
});

/**
 * Reset Paper Wallet back to $1,000 USDT
 */
app.post('/api/wallet/reset', (req, res) => {
  const initialBalance = req.body.initialBalance || 1000.0;
  const newSummary = paperEngine.resetWallet(initialBalance);
  autoTrader.log(`Balance emulado reiniciado a $${initialBalance} USDT.`, 'info');
  res.json({ success: true, message: 'Wallet reset successfully', wallet: newSummary });
});

/**
 * Trigger DeepSeek AI Analysis
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const symbol = req.body.symbol || currentActiveSymbol;
    const timeframe = req.body.timeframe || currentActiveInterval;
    const executeIfSignal = req.body.execute === true;

    autoTrader.log(`Iniciando análisis manual con DeepSeek para ${symbol} (${timeframe})...`, 'info');
    const result = await analyzeMarketWithDeepSeek(symbol, timeframe, paperEngine.positions);

    broadcast('AI_ANALYSIS_RESULT', result);

    if (executeIfSignal && result.signal !== 'HOLD') {
      const config = getConfig();
      await autoTrader.evaluateAndExecuteTrade(result, config);
    }

    res.json({ success: true, analysis: result });
  } catch (err) {
    autoTrader.log(`Error en análisis manual: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Open Trade (Simulated / Real)
 */
app.post('/api/trade/open', async (req, res) => {
  try {
    const { symbol, side, leverage, marginAmount, takeProfit, stopLoss } = req.body;
    const currentPrice = await fetchCurrentPrice(symbol || currentActiveSymbol);

    const position = paperEngine.openPosition({
      symbol: (symbol || currentActiveSymbol).toUpperCase(),
      side: side || 'LONG',
      leverage: Number(leverage || 10),
      marginAmount: marginAmount ? Number(marginAmount) : undefined,
      entryPrice: currentPrice,
      takeProfit: takeProfit ? Number(takeProfit) : undefined,
      stopLoss: stopLoss ? Number(stopLoss) : undefined,
      aiReason: 'Orden manual del usuario'
    });

    res.json({ success: true, position });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Close Active Position
 */
app.post('/api/trade/close', async (req, res) => {
  try {
    const { positionId, symbol } = req.body;
    let targetPos = null;

    if (positionId) {
      targetPos = paperEngine.positions.find(p => p.id === positionId);
    } else if (symbol) {
      targetPos = paperEngine.positions.find(p => p.symbol === symbol.toUpperCase());
    }

    if (!targetPos) {
      return res.status(404).json({ success: false, error: 'Posición no encontrada' });
    }

    const currentPrice = await fetchCurrentPrice(targetPos.symbol);
    const closed = paperEngine.closePosition(targetPos.id, currentPrice, 'MANUAL_CLOSE');

    res.json({ success: true, trade: closed });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Get / Update Configuration
 */
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: getSafeConfig() });
});

app.post('/api/config', (req, res) => {
  const result = updateConfig(req.body);
  if (result.success) {
    const fullConfig = getConfig();
    if (fullConfig.autoPilot && !autoTrader.isRunning) {
      autoTrader.start();
    } else if (!fullConfig.autoPilot && autoTrader.isRunning) {
      autoTrader.stop();
    }
    broadcast('CONFIG_UPDATED', result.config);
    res.json({ success: true, config: result.config });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

/**
 * Toggle Auto-Pilot
 */
app.post('/api/autopilot/toggle', (req, res) => {
  const { enabled } = req.body;
  updateConfig({ autoPilot: enabled });
  if (enabled) {
    autoTrader.start();
  } else {
    autoTrader.stop();
  }
  broadcast('CONFIG_UPDATED', getSafeConfig());
  res.json({ success: true, isRunning: autoTrader.isRunning });
});

/**
 * Test Telegram Connection
 */
app.post('/api/telegram/test', async (req, res) => {
  const { botToken, chatId } = req.body;
  const config = getConfig();
  const token = botToken || config.telegramBotToken;
  const chat = chatId || config.telegramChatId;

  if (!token || !chat) {
    return res.status(400).json({ success: false, error: 'Se requiere Telegram Bot Token y Chat ID' });
  }

  const testResult = await testTelegramConnection(token, chat);
  res.json(testResult);
});

/**
 * Get Logs
 */
app.get('/api/logs', (req, res) => {
  res.json({ success: true, logs: autoTrader.logs });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 DeepSeek CryptoTrader AI (Binance Futures & Paper)`);
  console.log(`📡 Servidor activo en: http://localhost:${PORT}`);
  console.log(`=======================================================`);

  // 1. Start global live price stream for all pairs in watchlist
  initAllPricesStream((pricesMap) => {
    let pnlChanged = false;
    for (const [sym, price] of Object.entries(pricesMap)) {
      if (paperEngine.updateMarketPrice(sym, price)) {
        pnlChanged = true;
      }
    }

    broadcast('ALL_PRICES_TICK', pricesMap);

    if (pnlChanged) {
      broadcast('WALLET_UPDATE', paperEngine.getAccountSummary());
    }
  });

  // 2. Start Binance public WebSocket stream for default pair candles
  startBinanceStreamForSymbol(currentActiveSymbol, currentActiveInterval);

  // 3. Fallback high-speed poller (every 1.2s) to guarantee 100% price updates & instant TP/SL trigger
  setInterval(async () => {
    try {
      const config = getConfig();
      const prices = await fetchAllPrices(config.tradingPairs);
      let pnlChanged = false;

      for (const [sym, price] of Object.entries(prices)) {
        if (paperEngine.updateMarketPrice(sym, price)) {
          pnlChanged = true;
        }
      }

      broadcast('ALL_PRICES_TICK', prices);

      if (pnlChanged) {
        broadcast('WALLET_UPDATE', paperEngine.getAccountSummary());
      }
    } catch (e) {}
  }, 1200);

  // 4. Start auto-trader if configured
  const cfg = getConfig();
  if (cfg.autoPilot) {
    autoTrader.start();
  }
});
