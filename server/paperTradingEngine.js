const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { dbAsync, initDb } = require('./db');

const WALLET_BACKUP_FILE = path.join(__dirname, '..', 'data', 'paper_wallet.json');
const HISTORY_BACKUP_FILE = path.join(__dirname, '..', 'data', 'trade_history.json');

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
    this.initPromise = this.initDatabase();
  }

  async ready() {
    return this.initPromise;
  }

  saveBackupFiles() {
    try {
      const walletData = {
        balance: Number(this.balance.toFixed(2)),
        positions: this.positions
      };
      fs.writeFileSync(WALLET_BACKUP_FILE, JSON.stringify(walletData, null, 2), 'utf8');
      fs.writeFileSync(HISTORY_BACKUP_FILE, JSON.stringify(this.tradeHistory, null, 2), 'utf8');
    } catch (err) {
      console.warn('[PaperEngine] Note saving backup JSON files:', err.message);
    }
  }

  async initDatabase() {
    try {
      await initDb();

      // Check if existing JSON backup has data to migrate into SQLite if SQLite is empty
      let jsonWallet = null;
      let jsonHistory = null;
      try {
        if (fs.existsSync(WALLET_BACKUP_FILE)) {
          const raw = fs.readFileSync(WALLET_BACKUP_FILE, 'utf8');
          jsonWallet = JSON.parse(raw);
        }
        if (fs.existsSync(HISTORY_BACKUP_FILE)) {
          const rawH = fs.readFileSync(HISTORY_BACKUP_FILE, 'utf8');
          jsonHistory = JSON.parse(rawH);
        }
      } catch (e) {
        console.warn('[PaperEngine] Note reading backup JSON:', e.message);
      }

      // 1. Initialize Wallet
      const walletRow = await dbAsync.get('SELECT balance FROM wallet WHERE id = 1');
      if (walletRow && typeof walletRow.balance === 'number') {
        // If DB has balance but JSON backup had higher/different migrated balance and DB was just default 1000
        if (walletRow.balance === 1000.0 && jsonWallet && jsonWallet.balance && jsonWallet.balance !== 1000.0) {
          this.balance = jsonWallet.balance;
          await dbAsync.run('UPDATE wallet SET balance = ? WHERE id = 1', [this.balance]);
        } else {
          this.balance = walletRow.balance;
        }
      } else if (jsonWallet && jsonWallet.balance) {
        this.balance = jsonWallet.balance;
        await dbAsync.run('INSERT OR REPLACE INTO wallet (id, balance, initial_balance) VALUES (1, ?, ?)', [this.balance, 1000.0]);
      } else {
        const config = getConfig();
        this.balance = config.paperInitialBalance || 1000.0;
        await dbAsync.run('INSERT OR REPLACE INTO wallet (id, balance, initial_balance) VALUES (1, ?, ?)', [this.balance, this.balance]);
      }

      // 2. Load / Migrate Positions
      let posRows = await dbAsync.all("SELECT * FROM positions WHERE status = 'OPEN'");
      
      // If DB has 0 positions but JSON backup had active positions, migrate them!
      if ((!posRows || posRows.length === 0) && jsonWallet && Array.isArray(jsonWallet.positions) && jsonWallet.positions.length > 0) {
        console.log(`[PaperEngine] 🔄 Migrando ${jsonWallet.positions.length} posiciones abiertas desde backup JSON a SQLite...`);
        for (const p of jsonWallet.positions) {
          await dbAsync.run(`
            INSERT OR REPLACE INTO positions (
              id, symbol, side, leverage, margin, quantity,
              entry_price, current_price, take_profit, stop_loss,
              ai_reason, opened_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
          `, [
            p.id, p.symbol, p.side, p.leverage || 1, p.margin, p.quantity,
            p.entryPrice, p.currentPrice, p.takeProfit, p.stopLoss,
            p.aiReason || '', p.timestamp || Date.now()
          ]);
        }
        posRows = await dbAsync.all("SELECT * FROM positions WHERE status = 'OPEN'");
      }

      this.positions = (posRows || []).map(r => ({
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

      // 3. Load / Migrate Trade History (Merge any legacy JSON history with SQLite)
      if (Array.isArray(jsonHistory) && jsonHistory.length > 0) {
        for (const h of jsonHistory) {
          await dbAsync.run(`
            INSERT OR IGNORE INTO trade_history (
              id, symbol, side, leverage, margin, quantity,
              entry_price, exit_price, realized_pnl, roi_percent,
              close_reason, ai_reason, opened_at, closed_at, duration_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            h.id, h.symbol, h.side, h.leverage || 1, h.margin, h.quantity,
            h.entryPrice, h.exitPrice, h.realizedPnL, h.roiPercent,
            h.closeReason, h.aiReason || '',
            h.opened_at || (h.openTime ? new Date(h.openTime).getTime() : Date.now()),
            h.closed_at || (h.closeTime ? new Date(h.closeTime).getTime() : Date.now()),
            h.durationSeconds || 0
          ]);
        }
      }

      const historyRows = await dbAsync.all('SELECT * FROM trade_history ORDER BY closed_at DESC LIMIT 100');

      this.tradeHistory = (historyRows || []).map(r => ({
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
        opened_at: r.opened_at,
        closed_at: r.closed_at,
        durationSeconds: r.duration_seconds
      }));

      this.initialized = true;
      this.saveBackupFiles();

      console.log(`[PaperEngine] ✅ Base de Datos SQLite & Backup sincronizados: Balance $${this.balance} | ${this.positions.length} pos activas (${this.positions.map(p=>p.symbol).join(', ') || 'Ninguna'}) | ${this.tradeHistory.length} trades cerrados`);
    } catch (e) {
      console.error('[PaperEngine] Error initializing SQLite state:', e.message);
      this.initialized = true;
    }
  }

  async saveWalletBalance() {
    try {
      await dbAsync.run('UPDATE wallet SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [this.balance]);
      this.saveBackupFiles();
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
      this.saveBackupFiles();
    } catch (e) {
      console.error('[DB] Error inserting position:', e.message);
    }
  }

  async updatePositionInDb(pos) {
    try {
      await dbAsync.run(`
        UPDATE positions
        SET current_price = ?, take_profit = ?, stop_loss = ?
        WHERE id = ?
      `, [
        pos.currentPrice, pos.takeProfit, pos.stopLoss, pos.id
      ]);
      this.saveBackupFiles();
    } catch (e) {
      console.error('[DB] Error updating position:', e.message);
    }
  }

  async deletePositionFromDb(positionId) {
    try {
      await dbAsync.run("DELETE FROM positions WHERE id = ?", [positionId]);
      this.saveBackupFiles();
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
      this.saveBackupFiles();
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
    const netProfit = Number((equity - initialBalance).toFixed(2));
    const totalROI = Number((((equity - initialBalance) / initialBalance) * 100).toFixed(2));

    return {
      balance: Number(this.balance.toFixed(2)),
      initialBalance,
      equity,
      netProfit,
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

    const maxPositions = (config.maxOpenPositions !== undefined && config.maxOpenPositions > 0) ? config.maxOpenPositions : 50;
    if (maxPositions > 0 && this.positions.length >= maxPositions) {
      throw new Error(`Límite de operaciones alcanzado: Máximo ${maxPositions} operaciones simultáneas.`);
    }

    const existing = this.positions.find(p => p.symbol === symbol);
    if (existing) {
      throw new Error(`Ya existe una operación activa en ${symbol}.`);
    }

    if (!marginAmount || marginAmount <= 0) {
      const riskPct = config.riskPerTradePercent || 5;
      marginAmount = (this.balance * riskPct) / 100;
    }

    const currentSummary = this.getAccountSummary();
    if (marginAmount > currentSummary.availableMargin) {
      throw new Error(`Margen libre insuficiente ($${currentSummary.availableMargin.toFixed(2)}) para inversión ($${marginAmount.toFixed(2)})`);
    }

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
    // CRITICAL: Protect against null, undefined, 0, or NaN prices during internet disconnections!
    if (!markPrice || typeof markPrice !== 'number' || isNaN(markPrice) || markPrice <= 0) {
      return false;
    }

    let stateChanged = false;
    const positionsToClose = [];

    this.positions.forEach(pos => {
      if (pos.symbol === symbol) {
        pos.currentPrice = formatPricePrecision(markPrice);

        let grossPnl = 0;
        if (pos.side === 'LONG') {
          grossPnl = (markPrice - pos.entryPrice) * pos.quantity;
        } else {
          grossPnl = (pos.entryPrice - markPrice) * pos.quantity;
        }

        // Exact Binance trading fee (0.075% on entry + 0.075% on mark price)
        const entryFee = pos.entryPrice * pos.quantity * 0.00075;
        const exitFee = markPrice * pos.quantity * 0.00075;
        const totalEstimatedFee = entryFee + exitFee;
        const netPnl = grossPnl - totalEstimatedFee;

        pos.unrealizedPnL = Number(netPnl.toFixed(2));
        pos.unrealizedRoePercent = Number(((netPnl / pos.margin) * 100).toFixed(2));
        stateChanged = true;

        // Trailing Stop (al ganar >= $1.50 con dinero propio, proteger con Stop Loss al precio de entrada)
        let trailingUpdated = false;
        if (pos.unrealizedPnL >= 1.5) {
          if (pos.side === 'LONG' && pos.stopLoss < pos.entryPrice) {
            pos.stopLoss = formatPricePrecision(pos.entryPrice * 1.001);
            trailingUpdated = true;
          } else if (pos.side === 'SHORT' && pos.stopLoss > pos.entryPrice) {
            pos.stopLoss = formatPricePrecision(pos.entryPrice * 0.999);
            trailingUpdated = true;
          }
        }

        if (trailingUpdated) {
          this.updatePositionInDb(pos);
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
    const finalPrice = (exitPrice && exitPrice > 0) ? exitPrice : pos.currentPrice;

    let grossRealizedPnL = 0;
    if (closeReason === 'LIQUIDATION') {
      grossRealizedPnL = -pos.margin;
    } else {
      if (pos.side === 'LONG') {
        grossRealizedPnL = (finalPrice - pos.entryPrice) * pos.quantity;
      } else {
        grossRealizedPnL = (pos.entryPrice - finalPrice) * pos.quantity;
      }
    }

    // Exact Binance trading fee (0.075% on entry + 0.075% on exit)
    const entryFee = Number((pos.entryPrice * pos.quantity * 0.00075).toFixed(4));
    const exitFee = Number((finalPrice * pos.quantity * 0.00075).toFixed(4));
    const totalTradingFee = Number((entryFee + exitFee).toFixed(4));

    const realizedPnL = Number((grossRealizedPnL - totalTradingFee).toFixed(2));
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
      grossPnL: Number(grossRealizedPnL.toFixed(2)),
      fee: totalTradingFee,
      roiPercent,
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
    this.saveBackupFiles();

    this.emitEvent('WALLET_RESET', { balance: this.balance });
    return this.getAccountSummary();
  }
}

const paperEngine = new PaperTradingEngine();
module.exports = paperEngine;

