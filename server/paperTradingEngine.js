const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');

const WALLET_FILE = path.join(__dirname, '..', 'data', 'paper_wallet.json');
const TRADES_FILE = path.join(__dirname, '..', 'data', 'trade_history.json');

function ensureDataDir() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function formatPricePrecision(price) {
  if (price === null || price === undefined || isNaN(price)) return 0;
  const num = parseFloat(price);
  if (num >= 1000) return Number(num.toFixed(2));
  if (num >= 1) return Number(num.toFixed(4));
  return Number(num.toFixed(8));
}

class PaperTradingEngine {
  constructor() {
    this.balance = 1000.0; // 1,000 USDT default
    this.positions = []; // Active futures positions
    this.tradeHistory = []; // Past closed trades
    this.listeners = [];
    this.loadState();
  }

  loadState() {
    ensureDataDir();
    try {
      if (fs.existsSync(WALLET_FILE)) {
        const walletData = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
        this.balance = typeof walletData.balance === 'number' ? walletData.balance : 1000.0;
        this.positions = Array.isArray(walletData.positions) ? walletData.positions : [];
      } else {
        const config = getConfig();
        this.balance = config.paperInitialBalance || 1000.0;
        this.positions = [];
        this.saveWalletState();
      }

      if (fs.existsSync(TRADES_FILE)) {
        const tradesData = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        this.tradeHistory = Array.isArray(tradesData) ? tradesData : [];
      }
    } catch (err) {
      console.error('[PaperEngine] Error loading state, initializing fresh:', err.message);
      this.balance = 1000.0;
      this.positions = [];
      this.tradeHistory = [];
    }
  }

  saveWalletState() {
    ensureDataDir();
    try {
      fs.writeFileSync(
        WALLET_FILE,
        JSON.stringify({ balance: this.balance, positions: this.positions }, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error('[PaperEngine] Failed to save wallet state:', err.message);
    }
  }

  saveTradeHistory() {
    ensureDataDir();
    try {
      fs.writeFileSync(TRADES_FILE, JSON.stringify(this.tradeHistory, null, 2), 'utf8');
    } catch (err) {
      console.error('[PaperEngine] Failed to save trade history:', err.message);
    }
  }

  onEvent(callback) {
    this.listeners.push(callback);
  }

  emitEvent(eventType, payload) {
    this.listeners.forEach(cb => {
      try {
        cb(eventType, payload);
      } catch (e) {
        console.error('[PaperEngine] Event listener error:', e);
      }
    });
  }

  /**
   * Calculate summary statistics and equity
   */
  getAccountSummary() {
    let totalUnrealizedPnL = 0;
    let totalUsedMargin = 0;

    this.positions.forEach(pos => {
      totalUnrealizedPnL += (pos.unrealizedPnL || 0);
      totalUsedMargin += (pos.margin || 0);
    });

    const equity = Number((this.balance + totalUnrealizedPnL).toFixed(2));
    const availableMargin = Number(Math.max(0, this.balance - totalUsedMargin).toFixed(2));

    const totalTrades = this.tradeHistory.length;
    const winningTrades = this.tradeHistory.filter(t => t.realizedPnL > 0).length;
    const losingTrades = this.tradeHistory.filter(t => t.realizedPnL < 0).length;
    const winRate = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;

    const totalProfit = this.tradeHistory.reduce((acc, t) => acc + (t.realizedPnL > 0 ? t.realizedPnL : 0), 0);
    const totalLoss = Math.abs(this.tradeHistory.reduce((acc, t) => acc + (t.realizedPnL < 0 ? t.realizedPnL : 0), 0));
    const profitFactor = totalLoss > 0 ? Number((totalProfit / totalLoss).toFixed(2)) : (totalProfit > 0 ? 999 : 0);

    const initialBalance = 1000.0;
    const totalROI = Number((((equity - initialBalance) / initialBalance) * 100).toFixed(2));

    return {
      balance: Number(this.balance.toFixed(2)),
      equity,
      availableMargin,
      usedMargin: Number(totalUsedMargin.toFixed(2)),
      unrealizedPnL: Number(totalUnrealizedPnL.toFixed(2)),
      positions: this.positions,
      tradeCount: totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      totalROI,
      tradeHistory: this.tradeHistory.slice(0, 50) // Return most recent 50 trades
    };
  }

  /**
   * Calculate Liquidation Price for Binance Futures
   */
  calculateLiquidationPrice(side, entryPrice, leverage) {
    const maintenanceMarginRate = 0.005; // 0.5% default MMR for top pairs
    if (side === 'LONG' || side === 'BUY') {
      const liq = entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
      return formatPricePrecision(Math.max(0, liq));
    } else {
      const liq = entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
      return formatPricePrecision(liq);
    }
  }

  /**
   * Open a new Paper Futures position
   */
  openPosition({
    symbol,
    side, // 'LONG' or 'SHORT'
    leverage = 10,
    marginAmount, // USDT margin to commit
    entryPrice,
    takeProfit,
    stopLoss,
    aiSignalId = null,
    aiReason = ''
  }) {
    const normalizedSide = side.toUpperCase().includes('SHORT') ? 'SHORT' : 'LONG';
    const config = getConfig();

    // 1. Max positions check (safety limit to never risk entire $1k capital)
    const maxPositions = config.maxOpenPositions || 2;
    if (this.positions.length >= maxPositions) {
      throw new Error(`Límite de seguridad alcanzado: Máximo ${maxPositions} operaciones simultáneas para proteger el 90% del capital.`);
    }

    // 2. Check if position already open on this symbol
    const existing = this.positions.find(p => p.symbol === symbol);
    if (existing) {
      throw new Error(`Ya existe una operación activa en ${symbol}. Esperando su cierre.`);
    }

    // 3. Margin sizing: 5% of balance ($50 on $1,000)
    if (!marginAmount || marginAmount <= 0) {
      const riskPct = config.riskPerTradePercent || 5;
      marginAmount = (this.balance * riskPct) / 100;
    }

    if (marginAmount > this.balance) {
      throw new Error(`Balance insuficiente ($${this.balance.toFixed(2)}) para margen ($${marginAmount.toFixed(2)})`);
    }

    // 4. Nominal position size in USDT
    const positionValueUSDT = marginAmount * leverage;
    const quantity = Number((positionValueUSDT / entryPrice).toFixed(6));

    // 5. Take Profit & Stop Loss defaults (Micro-scalps of 0.8% with 0.4% risk)
    const tpPct = (config.takeProfitPercent || 0.8) / 100;
    const slPct = (config.stopLossPercent || 0.4) / 100;

    if (!takeProfit) {
      takeProfit = normalizedSide === 'LONG'
        ? entryPrice * (1 + tpPct)
        : entryPrice * (1 - tpPct);
    }

    if (!stopLoss) {
      stopLoss = normalizedSide === 'LONG'
        ? entryPrice * (1 - slPct)
        : entryPrice * (1 + slPct);
    }

    const liquidationPrice = this.calculateLiquidationPrice(normalizedSide, entryPrice, leverage);

    const newPosition = {
      id: 'POS-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      symbol: symbol.toUpperCase(),
      side: normalizedSide,
      leverage: Number(leverage),
      margin: Number(marginAmount.toFixed(2)),
      entryPrice: formatPricePrecision(entryPrice),
      currentPrice: formatPricePrecision(entryPrice),
      quantity,
      positionValue: Number(positionValueUSDT.toFixed(2)),
      takeProfit: formatPricePrecision(takeProfit),
      stopLoss: formatPricePrecision(stopLoss),
      liquidationPrice,
      unrealizedPnL: 0.0,
      unrealizedRoePercent: 0.0,
      openTime: new Date().toISOString(),
      timestamp: Date.now(),
      aiSignalId,
      aiReason
    };

    this.positions.push(newPosition);
    this.saveWalletState();

    this.emitEvent('POSITION_OPENED', newPosition);
    return newPosition;
  }

  /**
   * Update active positions based on live market tick
   */
  updateMarketPrice(symbol, markPrice) {
    let stateChanged = false;
    const positionsToClose = [];

    this.positions.forEach(pos => {
      if (pos.symbol === symbol) {
        pos.currentPrice = formatPricePrecision(markPrice);

        // Calculate Unrealized PnL
        let pnl = 0;
        if (pos.side === 'LONG') {
          pnl = (markPrice - pos.entryPrice) * pos.quantity;
        } else {
          pnl = (pos.entryPrice - markPrice) * pos.quantity;
        }

        pos.unrealizedPnL = Number(pnl.toFixed(2));
        pos.unrealizedRoePercent = Number(((pnl / pos.margin) * 100).toFixed(2));
        stateChanged = true;

        // Trailing Stop / Break-even protection:
        // If trade is in profit >= +$2.00 USDT, move Stop Loss to Breakeven (+0.1%)
        if (pos.unrealizedPnL >= 2.0) {
          if (pos.side === 'LONG' && pos.stopLoss < pos.entryPrice) {
            pos.stopLoss = formatPricePrecision(pos.entryPrice * 1.001);
          } else if (pos.side === 'SHORT' && pos.stopLoss > pos.entryPrice) {
            pos.stopLoss = formatPricePrecision(pos.entryPrice * 0.999);
          }
        }

        // 1. Check Take Profit Hit
        const hitLongTP = pos.side === 'LONG' && markPrice >= pos.takeProfit;
        const hitShortTP = pos.side === 'SHORT' && markPrice <= pos.takeProfit;

        if (hitLongTP || hitShortTP) {
          positionsToClose.push({ pos, price: markPrice, reason: 'TAKE_PROFIT_ALCANZADO' });
        }

        // 2. Check Stop Loss Hit (or Trailing Stop Hit)
        else if (pos.side === 'LONG' && markPrice <= pos.stopLoss) {
          const reason = pos.stopLoss >= pos.entryPrice ? 'TRAILING_STOP_GANANCIA_PROTEGIDA' : 'STOP_LOSS_PROTECCION';
          positionsToClose.push({ pos, price: markPrice, reason });
        } else if (pos.side === 'SHORT' && markPrice >= pos.stopLoss) {
          const reason = pos.stopLoss <= pos.entryPrice ? 'TRAILING_STOP_GANANCIA_PROTEGIDA' : 'STOP_LOSS_PROTECCION';
          positionsToClose.push({ pos, price: markPrice, reason });
        }

        // 3. Check Liquidation
        else if (pos.side === 'LONG' && markPrice <= pos.liquidationPrice) {
          positionsToClose.push({ pos, price: pos.liquidationPrice, reason: 'LIQUIDATION' });
        } else if (pos.side === 'SHORT' && markPrice >= pos.liquidationPrice) {
          positionsToClose.push({ pos, price: pos.liquidationPrice, reason: 'LIQUIDATION' });
        }
      }
    });

    if (stateChanged) {
      this.saveWalletState();
    }

    // Process any auto-closed positions
    positionsToClose.forEach(({ pos, price, reason }) => {
      this.closePosition(pos.id, price, reason);
    });

    return stateChanged;
  }

  /**
   * Close a position (manually or auto-triggered)
   */
  closePosition(positionId, exitPrice, closeReason = 'MANUAL_CLOSE') {
    const index = this.positions.findIndex(p => p.id === positionId);
    if (index === -1) {
      throw new Error(`Position ${positionId} not found`);
    }

    const pos = this.positions[index];
    const finalPrice = exitPrice || pos.currentPrice;

    let realizedPnL = 0;
    if (closeReason === 'LIQUIDATION') {
      realizedPnL = -pos.margin; // Total margin lost on liquidation
    } else {
      if (pos.side === 'LONG') {
        realizedPnL = (finalPrice - pos.entryPrice) * pos.quantity;
      } else {
        realizedPnL = (pos.entryPrice - finalPrice) * pos.quantity;
      }
    }

    // Fee simulation (0.04% maker/taker Binance Futures standard fee)
    const totalTradingFee = (pos.positionValue * 2) * 0.0004;
    realizedPnL = Number((realizedPnL - totalTradingFee).toFixed(2));
    const roiPercent = Number(((realizedPnL / pos.margin) * 100).toFixed(2));

    // Update wallet balance
    this.balance += realizedPnL;
    this.balance = Number(Math.max(0, this.balance).toFixed(2));

    const closedRecord = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      leverage: pos.leverage,
      margin: pos.margin,
      entryPrice: pos.entryPrice,
      exitPrice: formatPricePrecision(finalPrice),
      quantity: pos.quantity,
      takeProfit: pos.takeProfit,
      stopLoss: pos.stopLoss,
      realizedPnL,
      roiPercent,
      fee: Number(totalTradingFee.toFixed(2)),
      closeReason,
      openTime: pos.openTime,
      closeTime: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - pos.timestamp) / 1000),
      aiReason: pos.aiReason
    };

    // Remove from active positions and save to history
    this.positions.splice(index, 1);
    this.tradeHistory.unshift(closedRecord);

    this.saveWalletState();
    this.saveTradeHistory();

    this.emitEvent('POSITION_CLOSED', closedRecord);
    return closedRecord;
  }

  /**
   * Reset the paper wallet balance and positions
   */
  resetWallet(newBalance = 1000.0) {
    this.balance = Number(newBalance);
    this.positions = [];
    this.tradeHistory = [];
    this.saveWalletState();
    this.saveTradeHistory();
    this.emitEvent('WALLET_RESET', { balance: this.balance });
    return this.getAccountSummary();
  }
}

const paperEngine = new PaperTradingEngine();
module.exports = paperEngine;
