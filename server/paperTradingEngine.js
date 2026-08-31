const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { dbAsync } = require('./db');

function formatPricePrecision(price) {
  if (price === null || price === undefined || isNaN(price)) return 0;
  const num = parseFloat(price);
  if (num >= 1000) return Number(num.toFixed(2));
  if (num >= 1) return Number(num.toFixed(4));
  return Number(num.toFixed(8));
}

class PaperTradingEngine {
  constructor() {
    this.balance = 1000.0;
    this.positions = [];
    this.tradeHistory = [];
    this.listeners = [];
    this.initialized = false;
    this.initDatabase();
  }

  async initDatabase() {
    try {
      const walletRow = await dbAsync.get('SELECT balance FROM wallet WHERE id = 1');
      if (walletRow && typeof walletRow.balance === 'number') {
        this.balance = walletRow.balance;
      } else {
        const config = getConfig();
        this.balance = config.paperInitialBalance || 1000.0;
        await dbAsync.run('INSERT OR REPLACE INTO wallet (id, balance, initial_balance) VALUES (1, ?, ?)', [this.balance, this.balance]);
      }

      const posRows = await dbAsync.all("SELECT * FROM positions WHERE status = 'OPEN'");
      this.positions = posRows.map(r => ({
        id: r.id,
        symbol: r.symbol,
        side: r.side,
        leverage: r.leverage || 1,
        margin: r.margin,
        quantity: r.quantity,
        entryPrice: r.entry_price,
        currentPrice: r.current_price,
        positionValue: Number((r.margin * (r.leverage || 1)).toFixed(2)),
        takeProfit: r.take_profit,
        stopLoss: r.stop_loss,
        liquidationPrice: this.calculateLiquidationPrice(r.side, r.entry_price, r.leverage || 1),
        unrealizedPnL: 0.0,
        unrealizedRoePercent: 0.0,
        openTime: new Date(r.opened_at).toISOString(),
        timestamp: r.opened_at,
        aiReason: r.ai_reason
      }));

      const historyRows = await dbAsync.all('SELECT * FROM trade_history ORDER BY closed_at DESC LIMIT 100');
      this.tradeHistory = historyRows.map(r => ({
        id: r.id,
        symbol: r.symbol,
        side: r.side,
        leverage: r.leverage || 1,
        margin: r.margin,
        quantity: r.quantity,
        entryPrice: r.entry_price,
        exitPrice: r.exit_price,
        realizedPnL: r.realized_pnl,
        roiPercent: r.roi_percent,
        closeReason: r.close_reason,
        aiReason: r.ai_reason,
        openTime: new Date(r.opened_at).toISOString(),
        closeTime: new Date(r.closed_at).toISOString(),
        durationSeconds: r.duration_seconds
      }));

      this.initialized = true;
      console.log(`[PaperEngine] Base de Datos SQLite cargada: Balance $${this.balance} | ${this.positions.length} pos activas | ${this.tradeHistory.length} trades`);
    } catch (e) {
      console.error('[PaperEngine] Error initializing SQLite state:', e.message);
      this.initialized = true;
    }
  }

  async saveWalletBalance() {
    try {
      await dbAsync.run('UPDATE wallet SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [this.balance]);
    } catch (e) {
      console.error('[DB] Error saving wallet balance:', e.message);
    }
  }

  async savePositionToDb(pos) {
    try {
      await dbAsync.run(`
        INSERT OR REPLACE INTO positions (
          id, symbol, side, leverage, margin, quantity,
          entry_price, current_price, take_profit, stop_loss,
          ai_reason, opened_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `, [
        pos.id, pos.symbol, pos.side, pos.leverage, pos.margin, pos.quantity,
        pos.entryPrice, pos.currentPrice, pos.takeProfit, pos.stopLoss,
        pos.aiReason, pos.timestamp
      ]);
    } catch (e) {
      console.error('[DB] Error inserting position:', e.message);
    }
  }

  async deletePositionFromDb(positionId) {
    try {
      await dbAsync.run("DELETE FROM positions WHERE id = ?", [positionId]);
    } catch (e) {
      console.error('[DB] Error deleting position:', e.message);
    }
  }

  async saveClosedTradeToDb(trade) {
    try {
      await dbAsync.run(`
        INSERT OR REPLACE INTO trade_history (
          id, symbol, side, leverage, margin, quantity,
          entry_price, exit_price, realized_pnl, roi_percent,
          close_reason, ai_reason, opened_at, closed_at, duration_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        trade.id, trade.symbol, trade.side, trade.leverage, trade.margin, trade.quantity,
        trade.entryPrice, trade.exitPrice, trade.realizedPnL, trade.roiPercent,
        trade.closeReason, trade.aiReason, trade.opened_at || Date.now(), Date.now(), trade.durationSeconds
      ]);
    } catch (e) {
      console.error('[DB] Error saving closed trade:', e.message);
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
      tradeHistory: this.tradeHistory.slice(0, 50)
    };
  }

  calculateLiquidationPrice(side, entryPrice, leverage) {
    if (leverage <= 1) {
      return 0.0; // En 1x (dinero propio / spot) no existe precio de liquidación
    }
    const maintenanceMarginRate = 0.005;
    if (side === 'LONG' || side === 'BUY') {
      const liq = entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
      return formatPricePrecision(Math.max(0, liq));
    } else {
      const liq = entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
      return formatPricePrecision(liq);
    }
  }

  openPosition({
    symbol,
    side,
    leverage = 1, // 1x por defecto (100% Dinero Propio)
    marginAmount,
    entryPrice,
    takeProfit,
    stopLoss,
    aiSignalId = null,
    aiReason = ''
  }) {
    const normalizedSide = side.toUpperCase().includes('SHORT') ? 'SHORT' : 'LONG';
    const config = getConfig();
    const effectiveLeverage = Number(leverage || config.defaultLeverage || 1);

    const maxPositions = config.maxOpenPositions || 2;
    if (this.positions.length >= maxPositions) {
      throw new Error(`Límite de seguridad alcanzado: Máximo ${maxPositions} operaciones simultáneas.`);
    }

    const existing = this.positions.find(p => p.symbol === symbol);
    if (existing) {
      throw new Error(`Ya existe una operación activa en ${symbol}.`);
    }

    if (!marginAmount || marginAmount <= 0) {
      const riskPct = config.riskPerTradePercent || 5;
      marginAmount = (this.balance * riskPct) / 100;
    }

    if (marginAmount > this.balance) {
      throw new Error(`Balance insuficiente ($${this.balance.toFixed(2)}) para inversión ($${marginAmount.toFixed(2)})`);
    }

    // Valor de la posición: con 1x es exactamente el dinero propio invertido
    const positionValueUSDT = marginAmount * effectiveLeverage;
    const quantity = Number((positionValueUSDT / entryPrice).toFixed(6));

    const tpPct = (config.takeProfitPercent || 1.5) / 100;
    const slPct = (config.stopLossPercent || 0.8) / 100;

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

    const liquidationPrice = this.calculateLiquidationPrice(normalizedSide, entryPrice, effectiveLeverage);

    const newPosition = {
      id: 'POS-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      symbol: symbol.toUpperCase(),
      side: normalizedSide,
      leverage: effectiveLeverage,
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
    this.savePositionToDb(newPosition);

    this.emitEvent('POSITION_OPENED', newPosition);
    return newPosition;
  }

  updateMarketPrice(symbol, markPrice) {
    let stateChanged = false;
    const positionsToClose = [];

    this.positions.forEach(pos => {
      if (pos.symbol === symbol) {
        pos.currentPrice = formatPricePrecision(markPrice);

        let pnl = 0;
        if (pos.side === 'LONG') {
          pnl = (markPrice - pos.entryPrice) * pos.quantity;
        } else {
          pnl = (pos.entryPrice - markPrice) * pos.quantity;
        }

        pos.unrealizedPnL = Number(pnl.toFixed(2));
        pos.unrealizedRoePercent = Number(((pnl / pos.margin) * 100).toFixed(2));
        stateChanged = true;

        // Trailing Stop (al ganar >= $1.50 con dinero propio, proteger con Stop Loss al precio de entrada)
        if (pos.unrealizedPnL >= 1.5) {
          if (pos.side === 'LONG' && pos.stopLoss < pos.entryPrice) {
            pos.stopLoss = formatPricePrecision(pos.entryPrice * 1.001);
          } else if (pos.side === 'SHORT' && pos.stopLoss > pos.entryPrice) {
            pos.stopLoss = formatPricePrecision(pos.entryPrice * 0.999);
          }
        }

        // Take Profit
        const hitLongTP = pos.side === 'LONG' && markPrice >= pos.takeProfit;
        const hitShortTP = pos.side === 'SHORT' && markPrice <= pos.takeProfit;

        if (hitLongTP || hitShortTP) {
          positionsToClose.push({ pos, price: markPrice, reason: 'TAKE_PROFIT_ALCANZADO' });
        }
        // Stop Loss
        else if (pos.side === 'LONG' && markPrice <= pos.stopLoss) {
          const reason = pos.stopLoss >= pos.entryPrice ? 'TRAILING_STOP_GANANCIA' : 'STOP_LOSS_PROTECCION';
          positionsToClose.push({ pos, price: markPrice, reason });
        } else if (pos.side === 'SHORT' && markPrice >= pos.stopLoss) {
          const reason = pos.stopLoss <= pos.entryPrice ? 'TRAILING_STOP_GANANCIA' : 'STOP_LOSS_PROTECCION';
          positionsToClose.push({ pos, price: markPrice, reason });
        }
        // Liquidation (solo si hay apalancamiento > 1)
        else if (pos.leverage > 1 && pos.side === 'LONG' && markPrice <= pos.liquidationPrice) {
          positionsToClose.push({ pos, price: pos.liquidationPrice, reason: 'LIQUIDATION' });
        } else if (pos.leverage > 1 && pos.side === 'SHORT' && markPrice >= pos.liquidationPrice) {
          positionsToClose.push({ pos, price: pos.liquidationPrice, reason: 'LIQUIDATION' });
        }
      }
    });

    positionsToClose.forEach(({ pos, price, reason }) => {
      this.closePosition(pos.id, price, reason);
    });

    return stateChanged;
  }

  closePosition(positionId, exitPrice, closeReason = 'MANUAL_CLOSE') {
    const index = this.positions.findIndex(p => p.id === positionId);
    if (index === -1) {
      throw new Error(`Position ${positionId} not found`);
    }

    const pos = this.positions[index];
    const finalPrice = exitPrice || pos.currentPrice;

    let realizedPnL = 0;
    if (closeReason === 'LIQUIDATION') {
      realizedPnL = -pos.margin;
    } else {
      if (pos.side === 'LONG') {
        realizedPnL = (finalPrice - pos.entryPrice) * pos.quantity;
      } else {
        realizedPnL = (pos.entryPrice - finalPrice) * pos.quantity;
      }
    }

    // Spot standard 0.05% trading fee
    const totalTradingFee = (pos.positionValue * 2) * 0.0005;
    realizedPnL = Number((realizedPnL - totalTradingFee).toFixed(2));
    const roiPercent = Number(((realizedPnL / pos.margin) * 100).toFixed(2));

    this.balance += realizedPnL;
    this.balance = Number(Math.max(0, this.balance).toFixed(2));

    const closedRecord = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      leverage: pos.leverage || 1,
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
      opened_at: pos.timestamp,
      aiReason: pos.aiReason
    };

    this.positions.splice(index, 1);
    this.tradeHistory.unshift(closedRecord);

    this.deletePositionFromDb(pos.id);
    this.saveClosedTradeToDb(closedRecord);
    this.saveWalletBalance();

    this.emitEvent('POSITION_CLOSED', closedRecord);
    return closedRecord;
  }

  async resetWallet(newBalance = 1000.0) {
    this.balance = Number(newBalance);
    this.positions = [];
    this.tradeHistory = [];

    await dbAsync.run('UPDATE wallet SET balance = ?, initial_balance = ? WHERE id = 1', [this.balance, this.balance]);
    await dbAsync.run('DELETE FROM positions');
    await dbAsync.run('DELETE FROM trade_history');

    this.emitEvent('WALLET_RESET', { balance: this.balance });
    return this.getAccountSummary();
  }
}

const paperEngine = new PaperTradingEngine();
module.exports = paperEngine;
