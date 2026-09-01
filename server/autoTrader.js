const cron = require('node-cron');
const { getConfig } = require('./config');
const { analyzeMarketWithDeepSeek, generateTechnicalFallbackSignal } = require('./deepseekService');
const { analyzeCandles } = require('./indicators');
const paperEngine = require('./paperTradingEngine');
const { executeRealBinanceOrder, fetchCurrentPrice, fetchTopTrendingPairs, fetchTradFiStocks, fetchKlines, fetch24hrTicker } = require('./binanceService');
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
    this.aiConsultCache = {}; // Cache to avoid repeating queries within cooldown window
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
    const intervalMin = config.autoPilotIntervalMinutes || 2;

    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    const cronExpr = `*/${intervalMin} * * * *`;
    this.isRunning = true;
    this.log(`🚀 Modo Auto-Piloto IA ACTIVADO (Radar Dinámico Binance + Ahorro de Tokens). Escaneo cada ${intervalMin} min.`, 'success');

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
    const currentWallet = paperEngine.getAccountSummary();
    const openSymbols = currentWallet.positions.map(p => p.symbol);
    const requiredMarginPerTrade = (currentWallet.balance * (config.riskPerTradePercent || 10)) / 100;
    const hasMarginForNewTrades = currentWallet.availableMargin >= Math.min(requiredMarginPerTrade * 0.8, 50);

    let symbolsToScan = [];

    if (specificSymbol) {
      symbolsToScan = [specificSymbol];
    } else if (!hasMarginForNewTrades && openSymbols.length > 0) {
      // CAPITAL OCCUPIED: Focus exclusively on monitoring open positions for profit exits
      symbolsToScan = openSymbols;
      this.log(`💤 [CAPITAL ASIGNADO 100%] ${openSymbols.length} operaciones activas ($${currentWallet.availableMargin.toFixed(2)} libre). Monitoreando salidas en TP/SL para liberar capital...`, 'info');
    } else {
      // CAPITAL AVAILABLE: Dynamic market discovery across Binance Futures & Wall St
      let discoveredTrending = [];
      try {
        const trendingPairs = await fetchTopTrendingPairs(12);
        if (trendingPairs && trendingPairs.length > 0) {
          discoveredTrending = trendingPairs.map(t => t.symbol);
        }
      } catch (err) {
        console.warn('[AutoTrader] Dynamic trending fetch warning:', err.message);
      }

      const stockSymbols = ['TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT', 'SPYUSDT'];
      const coreSymbols = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'];

      // Merge dynamically discovered coins + open positions + core watchlist
      symbolsToScan = Array.from(new Set([
        ...discoveredTrending,
        ...openSymbols,
        ...stockSymbols,
        ...coreSymbols,
        ...config.tradingPairs
      ]));

      this.log(`🔍 [RADAR DINÁMICO] Explorando ${symbolsToScan.length} activos en Binance (${discoveredTrending.slice(0, 5).join(', ')}... y Wall St)`, 'info');
    }

    this.isAnalyzing = true;
    this.lastScanTime = new Date().toISOString();
    this.broadcast('SCAN_STARTED', { symbols: symbolsToScan });

    try {
      for (const symbol of symbolsToScan) {
        try {
          const hasOpenPosition = openSymbols.includes(symbol);

          // 2. ZERO-TOKEN SCREENING: Fetch klines and calculate technical indicators locally (free)
          const klines = await fetchKlines(symbol, config.timeframe, 80);
          const ticker = await fetch24hrTicker(symbol);
          const techAnalysis = analyzeCandles(klines);

          const rsi = techAnalysis.indicators.rsi?.value;
          const vol = techAnalysis.indicators.volume;
          const bb = techAnalysis.indicators.bollingerBands;

          const isExtremeRSI = rsi !== null && (rsi <= 36 || rsi >= 64);
          const isVolumeSurge = vol && vol.ratio >= 1.25;
          const isTrendConfluence = Math.abs(techAnalysis.trendScore) >= 2;
          const isBollingerExtreme = bb && (bb.percentB <= 0.05 || bb.percentB >= 0.95);

          const shouldConsultAI = hasOpenPosition || isExtremeRSI || isVolumeSurge || isTrendConfluence || isBollingerExtreme;

          let analysis;

          if (shouldConsultAI && config.deepseekApiKey && config.deepseekApiKey.trim() !== '') {
            // Check AI Cooldown Cache (5 min window unless price moved > 0.3%)
            const cached = this.aiConsultCache[symbol];
            const now = Date.now();
            const priceChangeSinceCached = cached ? Math.abs((techAnalysis.currentPrice - cached.price) / cached.price) : 1;

            if (cached && (now - cached.timestamp < 5 * 60 * 1000) && priceChangeSinceCached < 0.003) {
              analysis = cached.signal;
            } else {
              // High-probability setup -> Consult DeepSeek with compressed payload
              analysis = await analyzeMarketWithDeepSeek(symbol, config.timeframe, currentWallet.positions);
              this.aiConsultCache[symbol] = {
                timestamp: now,
                price: techAnalysis.currentPrice,
                signal: analysis
              };
              this.log(`🤖 [IA DEEPSEEK] Oportunidad analizada en ${symbol} (RSI: ${rsi || 'N/A'}, Tendencia: ${techAnalysis.overallTrend})`, 'info');
            }
          } else {
            // Market in consolidation/neutral -> Use instant zero-token technical gatekeeper
            const marketDataPayload = {
              symbol: symbol.toUpperCase(),
              timeframe: config.timeframe,
              currentPrice: techAnalysis.currentPrice,
              change24h: ticker ? `${ticker.priceChangePercent}%` : 'N/A',
              indicators: techAnalysis.indicators,
              supportResistance: techAnalysis.supportResistance,
              technicalTrend: techAnalysis.overallTrend
            };
            analysis = generateTechnicalFallbackSignal(marketDataPayload, techAnalysis);
          }

          this.latestSignals[symbol] = analysis;
          this.broadcast('AI_ANALYSIS_RESULT', analysis);

          if (analysis.signal !== 'HOLD' && analysis.confidence >= 60) {
            sendSignalAlert(analysis).catch(e => console.error('[AutoTrader] Telegram error:', e));
          }

          if (config.autoPilot) {
            await this.evaluateAndExecuteTrade(analysis, config);
          }
        } catch (err) {
          // Silent catch for individual pair errors to ensure continuous scan
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
      return;
    }

    const availableMargin = paperEngine.getAccountSummary().availableMargin;
    const requiredMargin = (paperEngine.balance * (config.riskPerTradePercent || 10)) / 100;
    if (availableMargin < Math.min(requiredMargin * 0.8, 50)) {
      // Waiting for open positions to close - no error throw
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
