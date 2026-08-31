const cron = require('node-cron');
const { getConfig } = require('./config');
const { analyzeMarketWithDeepSeek } = require('./deepseekService');
const paperEngine = require('./paperTradingEngine');
const { executeRealBinanceOrder, fetchCurrentPrice } = require('./binanceService');
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
    const intervalMin = config.autoPilotIntervalMinutes || 5;

    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    // Cron expression for every X minutes
    const cronExpr = `*/${intervalMin} * * * *`;
    this.isRunning = true;
    this.log(`🚀 Modo Auto-Piloto IA ACTIVADO. Escaneo cada ${intervalMin} minutos.`, 'success');

    // Run first analysis immediately in background
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
      this.log('Escaneo en progreso, omitiendo ciclo duplicado...', 'info');
      return;
    }

    const config = getConfig();
    const symbolsToScan = specificSymbol ? [specificSymbol] : config.tradingPairs;
    const currentWallet = paperEngine.getAccountSummary();

    this.isAnalyzing = true;
    this.lastScanTime = new Date().toISOString();
    this.broadcast('SCAN_STARTED', { symbols: symbolsToScan });

    try {
      for (const symbol of symbolsToScan) {
        this.log(`🔍 Analizando ${symbol} con IA DeepSeek (${config.timeframe})...`, 'info');

        try {
          const analysis = await analyzeMarketWithDeepSeek(symbol, config.timeframe, currentWallet.positions);
          this.latestSignals[symbol] = analysis;

          this.broadcast('AI_ANALYSIS_RESULT', analysis);

          const signalEmoji = analysis.signal === 'BUY_LONG' ? '🟢 LONG' : (analysis.signal === 'SELL_SHORT' ? '🔴 SHORT' : '⏸️ HOLD');
          this.log(`Resultado ${symbol}: ${signalEmoji} | Confianza: ${analysis.confidence}% | R/R: ${analysis.risk_reward_ratio}`, analysis.signal === 'HOLD' ? 'info' : 'success');

          // Send Telegram signal if confidence is high or requested
          if (analysis.signal !== 'HOLD' && analysis.confidence >= 60) {
            sendSignalAlert(analysis).catch(e => console.error('[AutoTrader] Telegram error:', e));
          }

          // Decide whether to execute trade
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

    // 1. If AI decided to CLOSE an active position autonomously:
    if (analysis.signal === 'CLOSE_POSITION') {
      if (existing) {
        const currentPrice = await fetchCurrentPrice(analysis.symbol);
        const closed = paperEngine.closePosition(existing.id, currentPrice, `DECISIÓN_IA: ${analysis.reasoning || 'Cierre autónomo de DeepSeek'}`);
        this.log(`🤖 [IA AUTÓNOMA] Cerró posición en ${analysis.symbol} @ $${currentPrice}. PnL: $${closed.realizedPnL} USDT (${closed.roiPercent}%). Motivo: ${analysis.reasoning}`, closed.realizedPnL >= 0 ? 'success' : 'warning');
      }
      return;
    }

    const minConfidence = config.minConfidenceToTrade || 68;
    if (analysis.confidence < minConfidence) {
      this.log(`Señal ${analysis.signal} en ${analysis.symbol} ignorada: Confianza (${analysis.confidence}%) menor al umbral (${minConfidence}%).`, 'info');
      return;
    }

    // 2. Check if we already have an active position on this pair
    if (existing) {
      this.log(`Ya existe posición activa en ${analysis.symbol} (${existing.side}), la IA continúa monitoreándola en vivo.`, 'info');
      return;
    }

    // 3. Check if maximum simultaneous positions limit reached (safety)
    const maxPositions = config.maxOpenPositions || 2;
    if (openPositions.length >= maxPositions) {
      this.log(`Límite de seguridad (${maxPositions} posiciones activas) alcanzado. Protegiendo capital en reserva hasta que una cierre con ganancia.`, 'info');
      return;
    }

    const side = analysis.signal === 'BUY_LONG' ? 'LONG' : 'SHORT';
    const leverage = analysis.recommended_leverage || config.defaultLeverage || 10;
    const entryPrice = analysis.entry_price || await fetchCurrentPrice(analysis.symbol);

    if (config.tradingMode === 'real') {
      // Real Binance Futures execution
      try {
        this.log(`🔥 [REAL BINANCE] Ejecutando orden real ${side} en ${analysis.symbol} (${leverage}x)...`, 'warning');
        const balance = 1000;
        const margin = (balance * (config.riskPerTradePercent || 10)) / 100;
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

        this.log(`✅ [REAL] Orden ejecutada en Binance! ID: ${realOrder.orderId}`, 'success');
      } catch (err) {
        this.log(`❌ [REAL] Error ejecutando orden Binance: ${err.message}`, 'error');
      }
    } else {
      // Paper Trading Simulated Execution
      try {
        const marginAmount = (paperEngine.balance * (config.riskPerTradePercent || 10)) / 100;
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

        this.log(`🧪 [IA AUTÓNOMA] Abrió ${side} en ${analysis.symbol} @ $${entryPrice} (10x). Margen: $${position.margin} USDT | Meta: +$10.00 USD.`, 'success');
        sendOrderOpenedAlert(position, 'paper').catch(e => console.error(e));
      } catch (err) {
        this.log(`❌ [EMULADO] Error abriendo posición: ${err.message}`, 'error');
      }
    }
  }
}

const autoTrader = new AutoTrader();
module.exports = autoTrader;
