const cron = require('node-cron');
const { getConfig } = require('./config');
const { analyzeMarketWithDeepSeek } = require('./deepseekService');
const paperEngine = require('./paperTradingEngine');
const { executeRealBinanceOrder, fetchCurrentPrice, fetchTopTrendingPairs } = require('./binanceService');
const { sendSignalAlert, sendOrderOpenedAlert } = require('./telegramService');

class AutoTrader {
  constructor() {
    this.cronTask = null;
    this.isRunning = false;
    this.isAnalyzing = false;
    this.lastScanTime = null;
    this.latestSignals = {};
    this.logs = [];
    this.broadcastCallback = null;
  }

  setBroadcaster(callback) {
    this.broadcastCallback = callback;
  }

  log(message, type = 'info') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString(),
      type,
      message
    };
    this.logs.unshift(logEntry);
    if (this.logs.length > 100) this.logs.pop();

    if (this.broadcastCallback) {
      this.broadcastCallback('AUTO_TRADER_LOG', logEntry);
    }
  }

  broadcast(eventType, data) {
    if (this.broadcastCallback) {
      this.broadcastCallback(eventType, data);
    }
  }

  start() {
    const config = getConfig();
    const intervalMin = config.autoPilotIntervalMinutes || 1;

    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    const cronExpr = `*/${intervalMin} * * * *`;
    this.isRunning = true;
    this.log(`🚀 Modo Auto-Piloto IA ACTIVADO (1x Dinero Propio). Escaneo cada ${intervalMin} min.`, 'success');

    setTimeout(() => this.runAnalysisCycle(), 2000);

    this.cronTask = cron.schedule(cronExpr, () => {
      this.runAnalysisCycle();
    });
  }

  stop() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    this.isRunning = false;
    this.log('⏸️ Modo Auto-Piloto IA DETENIDO.', 'warning');
  }

  async runAnalysisCycle(specificSymbol = null) {
    if (this.isAnalyzing) {
      return;
    }

    const config = getConfig();
    let symbolsToScan = specificSymbol ? [specificSymbol] : config.tradingPairs;

    // Dynamic Discovery based on scanMode
    if (!specificSymbol) {
      if (config.scanMode === 'stocks') {
        symbolsToScan = ['TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT', 'AMZNUSDT', 'METAUSDT', 'MSFTUSDT', 'SPYUSDT', 'QQQUSDT'];
        this.log(`🏛️ [BOLSA IA] Escaneando acciones TradFi en Binance: TSLA, NVDA, AAPL, SPY, QQQ...`, 'info');
      } else if (config.scanMode === 'all') {
        try {
          const trendingPairs = await fetchTopTrendingPairs(4);
          const trendingSymbols = trendingPairs ? trendingPairs.map(t => t.symbol) : [];
          symbolsToScan = Array.from(new Set([...trendingSymbols, 'BTCUSDT', 'SOLUSDT', 'TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT', 'SPYUSDT']));
          this.log(`🌐 [RADAR GLOBAL] Escaneando Criptos (${trendingSymbols.join(', ') || 'BTC, SOL'}) y Acciones (TSLA, NVDA, AAPL, SPY)...`, 'info');
        } catch (err) {
          symbolsToScan = ['BTCUSDT', 'SOLUSDT', 'TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT'];
        }
      } else if (config.scanMode === 'top_trending') {
        try {
          const trendingPairs = await fetchTopTrendingPairs(8);
          if (trendingPairs && trendingPairs.length > 0) {
            const trendingSymbols = trendingPairs.map(t => t.symbol);
            symbolsToScan = Array.from(new Set([...trendingSymbols, 'BTCUSDT', 'SOLUSDT']));
            this.log(`🔥 [RADAR IA] Detectadas ${trendingSymbols.length} criptos en tendencia: ${trendingSymbols.join(', ')}`, 'info');
          }
        } catch (err) {
          console.warn('Error fetching dynamic trending pairs, fallback to defaults:', err.message);
        }
      }
    }

    const currentWallet = paperEngine.getAccountSummary();

    this.isAnalyzing = true;
    this.lastScanTime = new Date().toISOString();
    this.broadcast('SCAN_STARTED', { symbols: symbolsToScan });

    try {
      for (const symbol of symbolsToScan) {
        try {
          const analysis = await analyzeMarketWithDeepSeek(symbol, config.timeframe, currentWallet.positions);
          this.latestSignals[symbol] = analysis;

          this.broadcast('AI_ANALYSIS_RESULT', analysis);

          if (analysis.signal !== 'HOLD' && analysis.confidence >= 60) {
            sendSignalAlert(analysis).catch(e => console.error('[AutoTrader] Telegram error:', e));
          }

          if (config.autoPilot) {
            await this.evaluateAndExecuteTrade(analysis, config);
          }
        } catch (err) {
          this.log(`Error analizando ${symbol}: ${err.message}`, 'error');
        }
      }
    } finally {
      this.isAnalyzing = false;
      this.broadcast('SCAN_COMPLETED', { lastScanTime: this.lastScanTime });
    }
  }

  async evaluateAndExecuteTrade(analysis, config) {
    if (analysis.signal === 'HOLD') return;

    const openPositions = paperEngine.positions;
    const existing = openPositions.find(p => p.symbol === analysis.symbol);

    // AI Close decision
    if (analysis.signal === 'CLOSE_POSITION') {
      if (existing) {
        const currentPrice = await fetchCurrentPrice(analysis.symbol);
        const closed = paperEngine.closePosition(existing.id, currentPrice, `DECISIÓN_IA: ${analysis.reasoning || 'Cierre autónomo de DeepSeek'}`);
        this.log(`🤖 [IA AUTÓNOMA] Cerró ${analysis.symbol} @ $${currentPrice}. PnL: $${closed.realizedPnL} USDT (${closed.roiPercent}%).`, closed.realizedPnL >= 0 ? 'success' : 'warning');
      }
      return;
    }

    const minConfidence = config.minConfidenceToTrade || 68;
    if (analysis.confidence < minConfidence) {
      return;
    }

    if (existing) {
      return;
    }

    const maxPositions = (config.maxOpenPositions !== undefined && config.maxOpenPositions > 0) ? config.maxOpenPositions : 50;
    if (maxPositions > 0 && openPositions.length >= maxPositions) {
      this.log(`⚠️ Límite de ${maxPositions} operaciones simultáneas alcanzado.`, 'warning');
      return;
    }

    const availableMargin = paperEngine.getAccountSummary().availableMargin;
    if (availableMargin <= 10) {
      this.log(`⚠️ Margen libre agotado ($${availableMargin} USDT). Esperando cierres de operaciones para nuevas compras.`, 'warning');
      return;
    }

    const side = analysis.signal === 'BUY_LONG' ? 'LONG' : 'SHORT';
    const leverage = Number(config.defaultLeverage || 1); // 1x Dinero propio (sin apalancar)
    const entryPrice = analysis.entry_price || await fetchCurrentPrice(analysis.symbol);

    if (config.tradingMode === 'real') {
      try {
        const balance = 1000;
        const margin = (balance * (config.riskPerTradePercent || 5)) / 100;
        const totalUSDT = margin * leverage;
        const quantity = (totalUSDT / entryPrice).toFixed(4);

        const realOrder = await executeRealBinanceOrder({
          symbol: analysis.symbol,
          side: side === 'LONG' ? 'BUY' : 'SELL',
          quantity,
          leverage,
          stopLoss: analysis.stop_loss,
          takeProfit: analysis.take_profit
        });

        this.log(`✅ [REAL SPOT/1x] Orden ejecutada en Binance: $${margin} USDT en ${analysis.symbol}!`, 'success');
      } catch (err) {
        this.log(`❌ [REAL] Error ejecutando orden: ${err.message}`, 'error');
      }
    } else {
      try {
        const marginAmount = (paperEngine.balance * (config.riskPerTradePercent || 5)) / 100;
        const position = paperEngine.openPosition({
          symbol: analysis.symbol,
          side,
          leverage,
          marginAmount,
          entryPrice,
          takeProfit: analysis.take_profit,
          stopLoss: analysis.stop_loss,
          aiSignalId: 'SIG-' + Date.now(),
          aiReason: analysis.reasoning
        });

        this.log(`🧪 [IA SPOT/1x] Invertidos $${position.margin} USDT (100% Dinero Propio) en ${analysis.symbol} @ $${entryPrice}.`, 'success');
        sendOrderOpenedAlert(position, 'paper').catch(e => console.error(e));
      } catch (err) {
        this.log(`❌ Error abriendo posición: ${err.message}`, 'error');
      }
    }
  }
}

const autoTrader = new AutoTrader();
module.exports = autoTrader;
