const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const { getConfig, getSafeConfig, updateConfig } = require('./config');
const { fetchKlines, fetch24hrTicker, fetchAllPrices, initAllPricesStream, connectBinanceStream, fetchCurrentPrice, fetchTopTrendingPairs, fetchTradFiStocks } = require('./binanceService');
const { analyzeCandles } = require('./indicators');
const paperEngine = require('./paperTradingEngine');
const autoTrader = require('./autoTrader');
const { analyzeMarketWithDeepSeek } = require('./deepseekService');
const { testTelegramConnection, sendOrderClosedAlert } = require('./telegramService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Middleware de verificación de PIN de Administrador (Doble Rol: Admin vs Visual)
function verifyAdminPin(req) {
  const config = getConfig();
  if (config.pinEnabled === false || !config.securityPin) {
    return true; // Protección por PIN desactivada
  }
  const providedPin = req.headers['x-admin-pin'] || req.body?.pin || req.query?.pin;
  return String(providedPin) === String(config.securityPin);
}

function requireAdminPin(req, res, next) {
  if (verifyAdminPin(req)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: '🔒 Acción protegida: Estás en Modo Visual (Solo Lectura). Se requiere PIN de Administrador.',
    readOnly: true
  });
}

app.get('/health', (req, res) => res.status(200).send('OK'));

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
    const openSymbols = paperEngine.positions.map(p => p.symbol);
    const allTracked = Array.from(new Set([
      ...config.tradingPairs,
      ...openSymbols,
      'MAGMAUSDT', 'SKRUSDT', 'HEMIUSDT',
      'TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT', 'SPYUSDT', 'QQQUSDT', 'AMZNUSDT', 'METAUSDT', 'MSFTUSDT', 'COINUSDT', 'MSTRUSDT'
    ]));
    const prices = await fetchAllPrices(allTracked);

    // Update positions with fresh prices
    for (const [sym, price] of Object.entries(prices)) {
      paperEngine.updateMarketPrice(sym, price);
    }

    const wallet = paperEngine.getAccountSummary();
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
 * Get TradFi Stocks (TSLA, NVDA, AAPL, SPY, QQQ, etc.) from Binance
 */
app.get('/api/market/stocks', async (req, res) => {
  try {
    const stocks = await fetchTradFiStocks();
    res.json({ success: true, stocks });
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
 * ----------------------------------------------------
 * PIN AUTHENTICATION & SECURITY ENDPOINTS
 * ----------------------------------------------------
 */

/**
 * Verify Admin Security PIN
 */
app.post('/api/auth/verify-pin', (req, res) => {
  const { pin } = req.body;
  const config = getConfig();

  if (config.pinEnabled === false) {
    return res.json({ success: true, isAdmin: true, pinEnabled: false, message: 'Protección por PIN desactivada' });
  }

  if (String(pin) === String(config.securityPin)) {
    return res.json({ success: true, isAdmin: true, pinEnabled: true, message: 'PIN verificado con éxito' });
  }

  return res.status(401).json({ success: false, isAdmin: false, error: 'PIN de seguridad incorrecto' });
});

/**
 * Change or Update Security PIN (Requires current valid PIN)
 */
app.post('/api/auth/change-pin', requireAdminPin, (req, res) => {
  try {
    const { currentPin, newPin, pinEnabled } = req.body;
    const config = getConfig();

    if (config.pinEnabled !== false && String(currentPin) !== String(config.securityPin)) {
      return res.status(400).json({ success: false, error: 'El PIN actual proporcionado es incorrecto' });
    }

    const updates = {};
    if (newPin !== undefined && newPin !== null && newPin !== '') {
      const cleanPin = String(newPin).trim();
      if (cleanPin.length < 4 || cleanPin.length > 8 || !/^\d+$/.test(cleanPin)) {
        return res.status(400).json({ success: false, error: 'El nuevo PIN debe contener entre 4 y 8 números' });
      }
      updates.securityPin = cleanPin;
    }

    if (typeof pinEnabled === 'boolean') {
      updates.pinEnabled = pinEnabled;
    }

    const result = updateConfig(updates);
    if (result.success) {
      autoTrader.log('Ajustes de PIN y seguridad actualizados por el Administrador.', 'info');
      broadcast('CONFIG_UPDATED', result.config);
      return res.json({ success: true, message: 'Seguridad y PIN actualizados correctamente', config: result.config });
    } else {
      return res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Reset Paper Wallet back to $1,000 USDT (Admin Protected)
 */
app.post('/api/wallet/reset', requireAdminPin, (req, res) => {
  const initialBalance = req.body.initialBalance || 1000.0;
  const newSummary = paperEngine.resetWallet(initialBalance);
  autoTrader.log(`Balance emulado reiniciado a $${initialBalance} USDT por el administrador.`, 'info');
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

    autoTrader.log(`Iniciando análisis con DeepSeek para ${symbol} (${timeframe})...`, 'info');
    const result = await analyzeMarketWithDeepSeek(symbol, timeframe, paperEngine.positions);

    broadcast('AI_ANALYSIS_RESULT', result);

    if (executeIfSignal && result.signal !== 'HOLD') {
      if (verifyAdminPin(req)) {
        const config = getConfig();
        await autoTrader.evaluateAndExecuteTrade(result, config);
      } else {
        autoTrader.log(`Modo visual activo: Señal ${result.signal} en ${symbol} detectada pero no ejecutada (Se requiere PIN de Admin).`, 'info');
      }
    }

    res.json({ success: true, analysis: result });
  } catch (err) {
    autoTrader.log(`Error en análisis: ${err.message}`, 'error');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Open Trade (Admin Protected)
 */
app.post('/api/trade/open', requireAdminPin, async (req, res) => {
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
 * Close Active Position (Admin Protected)
 */
app.post('/api/trade/close', requireAdminPin, async (req, res) => {
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
 * Get / Update Configuration (Update Admin Protected)
 */
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: getSafeConfig() });
});

app.post('/api/config', requireAdminPin, (req, res) => {
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
 * Toggle Auto-Pilot (Admin Protected)
 */
app.post('/api/autopilot/toggle', requireAdminPin, (req, res) => {
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
 * Test Telegram Connection (Admin Protected)
 */
app.post('/api/telegram/test', requireAdminPin, async (req, res) => {
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
async function startServer() {
  try {
    await Promise.race([
      paperEngine.ready(),
      new Promise(r => setTimeout(r, 3000))
    ]);
  } catch (e) {
    console.warn('[Server] paperEngine ready warning:', e.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 WP Trader AI (Binance Spot & Futures)`);
    console.log(`📡 Servidor activo en: http://0.0.0.0:${PORT}`);
    console.log(`=======================================================`);

    // 1. Start global live price stream for all pairs in watchlist
    initAllPricesStream((pricesMap) => {
      let pnlChanged = false;
      for (const [sym, price] of Object.entries(pricesMap)) {
        if (typeof price === 'number' && !isNaN(price) && price > 0) {
          if (paperEngine.updateMarketPrice(sym, price)) {
            pnlChanged = true;
          }
        }
      }

      broadcast('ALL_PRICES_TICK', pricesMap);

      if (pnlChanged) {
        broadcast('WALLET_UPDATE', paperEngine.getAccountSummary());
      }
    });

    // 2. Start Binance public WebSocket stream for default pair candles
    startBinanceStreamForSymbol(currentActiveSymbol, currentActiveInterval);

    // 3. Fallback high-speed poller (every 1s) to guarantee 100% price updates & instant TP/SL trigger
    setInterval(async () => {
      try {
        const config = getConfig();
        const openSymbols = paperEngine.positions.map(p => p.symbol);
        const allTracked = Array.from(new Set([
          ...config.tradingPairs,
          ...openSymbols,
          'MAGMAUSDT', 'SKRUSDT', 'HEMIUSDT',
          'TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT', 'SPYUSDT', 'QQQUSDT', 'AMZNUSDT', 'METAUSDT', 'MSFTUSDT', 'COINUSDT', 'MSTRUSDT'
        ]));

        const prices = await fetchAllPrices(allTracked);
        let pnlChanged = false;

        if (prices && typeof prices === 'object') {
          for (const [sym, price] of Object.entries(prices)) {
            if (typeof price === 'number' && !isNaN(price) && price > 0) {
              if (paperEngine.updateMarketPrice(sym, price)) {
                pnlChanged = true;
              }
            }
          }

          broadcast('ALL_PRICES_TICK', prices);

          if (pnlChanged) {
            broadcast('WALLET_UPDATE', paperEngine.getAccountSummary());
          }
        }
      } catch (e) {
        // Silently wait for network recovery if offline
      }
    }, 1000);

    // 4. Start auto-trader if configured
    const cfg = getConfig();
    if (cfg.autoPilot) {
      autoTrader.start();
    }
  });
}

startServer().catch(err => {
  console.error('[Server] Fatal startup error:', err);
});
