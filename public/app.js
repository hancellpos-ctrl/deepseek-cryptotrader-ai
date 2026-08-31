/**
 * CryptoTrader AI - 4 Module Mobile Web App & PWA
 */

const state = {
  prices: {},
  trendingCoins: [],
  stockAssets: [],
  activeMarketFilter: 'crypto', // 'crypto' or 'stocks'
  positionsSort: 'recent', // 'recent', 'pnl_desc', 'pnl_asc', 'crypto', 'stocks'
  historyFilter: 'all', // 'all', 'wins', 'losses', 'highest_pnl'
  wallet: {
    balance: 1000.0,
    equity: 1000.0,
    availableMargin: 1000.0,
    usedMargin: 0.0,
    unrealizedPnL: 0.0,
    positions: [],
    tradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    tradeHistory: []
  },
  latestAiSignal: null,
  logs: [],
  autoPilot: true,
  config: {},
  isScanning: false,
  activeTab: 'view-trades'
};

let ws = null;

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  fetchInitialData();
  fetchMarketData();
  setInterval(fetchMarketData, 25000);
  bindUIEvents();
});

// ----------------------------------------------------
// TAB NAVIGATION (4 MODULES)
// ----------------------------------------------------
function navigateToTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.app-view').forEach(view => {
    view.classList.remove('active');
  });
  const targetView = document.getElementById(tabId);
  if (targetView) targetView.classList.add('active');

  const tabMap = {
    'view-trades': 'nav-btn-trades',
    'view-alerts': 'nav-btn-alerts',
    'view-history': 'nav-btn-history',
    'view-settings': 'nav-btn-settings'
  };

  ['nav-btn-trades', 'nav-btn-alerts', 'nav-btn-history', 'nav-btn-settings'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });

  const activeBtn = document.getElementById(tabMap[tabId]);
  if (activeBtn) activeBtn.classList.add('active');

  if (window.lucide) lucide.createIcons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ----------------------------------------------------
// MARKET FILTER SWITCHER (CRYPTO VS STOCKS)
// ----------------------------------------------------
function setMarketFilter(type) {
  state.activeMarketFilter = type;

  const btnCrypto = document.getElementById('btn-market-crypto');
  const btnStocks = document.getElementById('btn-market-stocks');

  if (type === 'crypto') {
    if (btnCrypto) btnCrypto.className = 'px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/40 transition-all';
    if (btnStocks) btnStocks.className = 'px-2.5 py-1 rounded-lg text-[10px] font-extrabold text-[#8899a6] hover:text-white transition-all';
  } else {
    if (btnStocks) btnStocks.className = 'px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/40 transition-all';
    if (btnCrypto) btnCrypto.className = 'px-2.5 py-1 rounded-lg text-[10px] font-extrabold text-[#8899a6] hover:text-white transition-all';
  }

  fetchMarketData();
}

// ----------------------------------------------------
// SORTING & FILTERING CONTROLS
// ----------------------------------------------------
function setPositionsSort(mode) {
  state.positionsSort = mode;
  ['recent', 'pnl_desc', 'pnl_asc', 'crypto', 'stocks'].forEach(m => {
    const el = document.getElementById(`sort-pos-${m}`);
    if (el) {
      if (m === mode) el.classList.add('active');
      else el.classList.remove('active');
    }
  });
  renderPositions();
}

function setHistoryFilter(filter) {
  state.historyFilter = filter;
  ['all', 'wins', 'losses', 'highest_pnl'].forEach(f => {
    const el = document.getElementById(`filter-hist-${f}`);
    if (el) {
      if (f === filter) el.classList.add('active');
      else el.classList.remove('active');
    }
  });
  renderHistory();
}

// ----------------------------------------------------
// WEBSOCKET REAL-TIME CLIENT
// ----------------------------------------------------
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => updateConnectionStatus(true);
  ws.onclose = () => {
    updateConnectionStatus(false);
    setTimeout(initWebSocket, 2000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };
}

function handleWebSocketMessage(msg) {
  const { type, data } = msg;

  switch (type) {
    case 'INIT_STATE':
      state.config = data.config || {};
      state.wallet = data.wallet || state.wallet;
      state.autoPilot = state.config.autoPilot !== undefined ? state.config.autoPilot : true;
      if (data.autoTraderStatus?.logs) {
        state.logs = data.autoTraderStatus.logs;
      }
      renderAll();
      break;

    case 'ALL_PRICES_TICK':
      handlePricesTick(data);
      break;

    case 'WALLET_UPDATE':
      state.wallet = data;
      renderWallet();
      renderPositions();
      renderHistory();
      break;

    case 'AI_ANALYSIS_RESULT':
      state.latestAiSignal = data;
      renderAiAlertCard();
      break;

    case 'AUTO_TRADER_LOG':
      state.logs.unshift(data);
      if (state.logs.length > 50) state.logs.pop();
      renderLogs();
      break;

    case 'POSITION_OPENED':
      showToast(`⚡ IA Invirtió: $${data.margin} USDT en ${data.symbol} @ $${formatPrice(data.entryPrice)}`, 'info');
      break;

    case 'POSITION_CLOSED':
      if (data.realizedPnL >= 0) {
        showToast(`🎯 ¡Ganancia lograda! +$${data.realizedPnL} USDT en ${data.symbol}`, 'success');
      } else {
        showToast(`🛑 Cierre preventivo: -$${Math.abs(data.realizedPnL)} USDT en ${data.symbol}`, 'danger');
      }
      break;

    case 'CONFIG_UPDATED':
      state.config = data;
      state.autoPilot = data.autoPilot;
      renderConfig();
      break;
  }
}

function handlePricesTick(priceMap) {
  state.prices = { ...state.prices, ...priceMap };

  if (state.wallet.positions && state.wallet.positions.length > 0) {
    let changed = false;
    state.wallet.positions.forEach(pos => {
      const currentPrice = state.prices[pos.symbol];
      if (currentPrice && currentPrice !== pos.currentPrice) {
        pos.currentPrice = currentPrice;
        let pnl = pos.side === 'LONG'
          ? (currentPrice - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - currentPrice) * pos.quantity;
        pos.unrealizedPnL = Number(pnl.toFixed(2));
        pos.unrealizedRoePercent = Number(((pnl / pos.margin) * 100).toFixed(2));
        changed = true;
      }
    });

    if (changed) {
      renderWallet();
      renderPositions();
    }
  }
}

// ----------------------------------------------------
// REST API
// ----------------------------------------------------
async function fetchInitialData() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      state.config = data.config;
      state.wallet = data.wallet;
      state.prices = data.prices || {};
      state.autoPilot = data.config.autoPilot;
      renderAll();
    }
  } catch (err) {
    console.error('Error fetching initial status:', err);
  }
}

async function fetchMarketData() {
  try {
    if (state.activeMarketFilter === 'crypto') {
      const res = await fetch('/api/market/trending?limit=10');
      const data = await res.json();
      if (data.success && data.trending) {
        state.trendingCoins = data.trending;
        renderMarketPills();
      }
    } else {
      const res = await fetch('/api/market/stocks');
      const data = await res.json();
      if (data.success && data.stocks) {
        state.stockAssets = data.stocks;
        renderMarketPills();
      }
    }
  } catch (e) {}
}

async function triggerAiScan(symbol = 'BTCUSDT') {
  if (state.isScanning) return;
  state.isScanning = true;
  showToast(`🧠 DeepSeek analizando ${symbol}...`, 'info');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe: '15m', execute: true })
    });
    const data = await res.json();
    if (data.success) {
      state.latestAiSignal = data.analysis;
      renderAiAlertCard();
      showToast(`Señal ${data.analysis.symbol}: ${data.analysis.signal} (${data.analysis.confidence}%)`, 'success');
      navigateToTab('view-alerts');
    } else {
      showToast('Error en análisis: ' + data.error, 'danger');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  } finally {
    state.isScanning = false;
  }
}

async function closePosition(positionId) {
  try {
    const res = await fetch('/api/trade/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionId })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Posición cerrada con éxito', 'info');
    } else {
      showToast('Error al cerrar: ' + data.error, 'danger');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

async function toggleAutoPilot() {
  const newStatus = !state.autoPilot;
  try {
    const res = await fetch('/api/autopilot/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      state.autoPilot = data.isRunning;
      renderConfig();
      showToast(newStatus ? '🚀 Auto-IA Activada' : '⏸️ Auto-IA Pausada', newStatus ? 'success' : 'warning');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

async function resetPaperWallet() {
  if (!confirm('¿Reiniciar balance a $1,000 USDT (100% Dinero Propio) y limpiar historial?')) return;
  try {
    const res = await fetch('/api/wallet/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialBalance: 1000.0 })
    });
    const data = await res.json();
    if (data.success) {
      state.wallet = data.wallet;
      renderAll();
      showToast('Balance reiniciado a $1,000 USDT', 'success');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

// ----------------------------------------------------
// UI RENDERING
// ----------------------------------------------------
function renderAll() {
  renderWallet();
  renderMarketPills();
  renderPositions();
  renderAiAlertCard();
  renderLogs();
  renderHistory();
  renderConfig();
  if (window.lucide) lucide.createIcons();
}

function renderMarketPills() {
  const container = document.getElementById('trendingPillsContainer');
  if (!container) return;

  const items = state.activeMarketFilter === 'crypto' ? state.trendingCoins : state.stockAssets;

  if (!items || items.length === 0) {
    container.innerHTML = `<span class="text-[10px] text-[#6b7c93]">Cargando mercado de Binance...</span>`;
    return;
  }

  container.innerHTML = items.map(c => {
    const isUp = c.priceChangePercent >= 0;
    const sign = isUp ? '+' : '';
    const cleanSym = c.symbol.replace('USDT', '');

    return `
      <button onclick="triggerAiScan('${c.symbol}')" class="px-2.5 py-1 rounded-xl bg-[#0d121e] hover:bg-[#151d30] border border-[#1a243a] flex items-center gap-1.5 shrink-0 transition-all text-left">
        <div>
          <span class="text-xs font-extrabold text-white block">${cleanSym}</span>
          <span class="text-[9px] text-[#6b7c93] font-mono">$${formatPrice(c.lastPrice)}</span>
        </div>
        <span class="font-mono text-[10px] font-bold ${isUp ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}">
          ${sign}${c.priceChangePercent.toFixed(1)}%
        </span>
      </button>
    `;
  }).join('');
}

function renderWallet() {
  const w = state.wallet;
  
  const totalRealized = w.tradeHistory ? w.tradeHistory.reduce((acc, t) => acc + (t.realizedPnL || 0), 0) : 0;
  const netProfit = Number((totalRealized + (w.unrealizedPnL || 0)).toFixed(2));
  const sign = netProfit >= 0 ? '+' : '';
  const color = netProfit >= 0 ? 'text-[#00f59b]' : 'text-[#ff4d6d]';

  const eqEl = document.getElementById('walletEquity');
  if (eqEl) eqEl.innerText = '$' + w.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const profHeader = document.getElementById('statTotalProfitHeader');
  if (profHeader) {
    profHeader.innerText = `${sign}$${netProfit.toFixed(2)}`;
    profHeader.className = `font-mono font-extrabold text-xs ${color}`;
  }

  const profTag = document.getElementById('walletEquityProfitTag');
  if (profTag) {
    profTag.innerText = `${sign}$${netProfit.toFixed(2)}`;
    profTag.className = `font-mono font-extrabold text-xs ${color}`;
  }

  const balEl = document.getElementById('walletBalance');
  if (balEl) balEl.innerText = '$' + w.balance.toFixed(2);

  const availEl = document.getElementById('walletAvailableMargin');
  if (availEl) availEl.innerText = '$' + w.availableMargin.toFixed(2);

  const winRateEl = document.getElementById('walletWinRate');
  if (winRateEl) winRateEl.innerText = `${w.winRate || 0}%`;

  // Goal Progress
  const goal = state.config.globalProfitGoalUSDT || 10.0;
  const pct = Math.min(100, Math.max(0, (netProfit / goal) * 100));

  const goalAmtEl = document.getElementById('globalGoalAmount');
  if (goalAmtEl) {
    goalAmtEl.innerText = `${sign}$${netProfit.toFixed(2)} / $${goal.toFixed(2)} (${pct.toFixed(0)}%)`;
  }

  const goalBarEl = document.getElementById('globalGoalProgressBar');
  if (goalBarEl) goalBarEl.style.width = `${pct}%`;

  // History Tab Stats
  const histTrades = document.getElementById('statHistoryTotalTrades');
  if (histTrades) histTrades.innerText = w.tradeHistory ? w.tradeHistory.length : 0;

  const histWinRate = document.getElementById('statHistoryWinRate');
  if (histWinRate) histWinRate.innerText = `${w.winRate || 0}%`;

  const histProfit = document.getElementById('statHistoryTotalProfit');
  if (histProfit) {
    histProfit.innerText = `${sign}$${netProfit.toFixed(2)}`;
    histProfit.className = `text-xs font-bold ${color}`;
  }
}

function renderPositions() {
  const container = document.getElementById('livePositionsContainer');
  const countBadge = document.getElementById('openPositionsBadge');
  if (!container) return;

  const stockSymbols = ['TSLAUSDT', 'NVDAUSDT', 'AAPLUSDT', 'SPYUSDT', 'QQQUSDT', 'AMZNUSDT', 'METAUSDT', 'MSFTUSDT', 'COINUSDT', 'MSTRUSDT', 'AMDUSDT'];
  let positions = (state.wallet.positions || []).slice();

  // 1. Filter by category if selected
  if (state.positionsSort === 'crypto') {
    positions = positions.filter(p => !stockSymbols.includes(p.symbol));
  } else if (state.positionsSort === 'stocks') {
    positions = positions.filter(p => stockSymbols.includes(p.symbol));
  }

  // 2. Sort
  if (state.positionsSort === 'pnl_desc') {
    // Más ganadoras alante
    positions.sort((a, b) => (b.unrealizedPnL || 0) - (a.unrealizedPnL || 0));
  } else if (state.positionsSort === 'pnl_asc') {
    // Más perdedoras alante
    positions.sort((a, b) => (a.unrealizedPnL || 0) - (b.unrealizedPnL || 0));
  } else if (state.positionsSort === 'recent') {
    // Más recientes alante
    positions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  if (countBadge) countBadge.innerText = `${positions.length} Activas`;

  if (positions.length === 0) {
    container.innerHTML = `
      <div class="bg-[#0b0f19] p-5 rounded-2xl border border-[#141b2b] text-center">
        <div class="w-8 h-8 mx-auto rounded-full bg-[#00f2fe]/10 flex items-center justify-center mb-2">
          <i data-lucide="radar" class="w-4 h-4 text-[#00f2fe]"></i>
        </div>
        <p class="text-xs font-semibold text-[#8899a6]">Modo Centinela Activo (Sin Apalancar)</p>
        <p class="text-[11px] text-[#55657e]">La IA vigila el mercado para invertir $50 de tu capital de forma segura.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = positions.map(pos => {
    const isLong = pos.side === 'LONG';
    const isWin = (pos.unrealizedPnL || 0) >= 0;
    const sign = isWin ? '+' : '';
    const cleanSym = pos.symbol.replace('USDT', '').replace('1000', '');
    const levText = (pos.leverage && pos.leverage > 1) ? `${pos.leverage}x` : '1x (Dinero Propio)';

    return `
      <div class="bg-[#0b0f19] p-3.5 rounded-2xl border border-[#172033] shadow-md">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-black ${isLong ? 'bg-[#00f59b]/20 text-[#00f59b]' : 'bg-[#ff4d6d]/20 text-[#ff4d6d]'}">
              ${pos.side} • ${levText}
            </span>
            <h3 class="text-xs font-extrabold text-white">${cleanSym} <span class="text-[10px] text-[#55657e]">USDT</span></h3>
          </div>
          <span class="font-mono text-sm font-black ${isWin ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}">
            ${sign}$${pos.unrealizedPnL.toFixed(2)} <span class="text-[10px]">(${sign}${pos.unrealizedRoePercent}%)</span>
          </span>
        </div>

        <div class="grid grid-cols-2 gap-1.5 text-[11px] font-mono bg-[#07090e] p-2 rounded-xl border border-[#141b2b] mb-2.5">
          <div class="flex justify-between">
            <span class="text-[#6b7c93]">Inversión Real:</span>
            <span class="text-white font-bold">$${pos.margin} USDT</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#6b7c93]">Cantidad Cripto:</span>
            <span class="text-white font-bold">${pos.quantity} ${cleanSym}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#6b7c93]">Entrada:</span>
            <span class="text-white font-bold">$${formatPrice(pos.entryPrice)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#6b7c93]">Actual:</span>
            <span class="text-white font-bold">$${formatPrice(pos.currentPrice)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#00f59b]">Take Profit:</span>
            <span class="text-[#00f59b] font-bold">$${formatPrice(pos.takeProfit)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#ff4d6d]">Stop Loss:</span>
            <span class="text-[#ff4d6d] font-bold">$${formatPrice(pos.stopLoss)}</span>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-[10px] text-[#00f2fe] font-mono font-bold">100% Capital Propio</span>
          <button onclick="closePosition('${pos.id}')" class="px-3 py-1 rounded-lg text-xs font-bold bg-[#ff4d6d]/15 text-[#ff4d6d] hover:bg-[#ff4d6d] hover:text-white transition-all">
            Cerrar Posición
          </button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function renderAiAlertCard() {
  const card = document.getElementById('aiSignalCardAlerts');
  if (!card) return;

  const s = state.latestAiSignal;
  if (!s) {
    card.innerHTML = `
      <div class="text-center py-4">
        <p class="text-xs text-[#8899a6] mb-2">Presiona escanear para consultar la IA.</p>
        <button onclick="triggerAiScan('BTCUSDT')" class="btn-primary px-3.5 py-1.5 text-xs font-bold">
          ⚡ Escanear con DeepSeek
        </button>
      </div>
    `;
    return;
  }

  const isBuy = s.signal === 'BUY_LONG';
  const isSell = s.signal === 'SELL_SHORT';

  let badgeColor = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  let badgeText = 'ESPERAR (HOLD)';
  if (isBuy) {
    badgeColor = 'bg-[#00f59b]/20 text-[#00f59b] border-[#00f59b]/40';
    badgeText = 'COMPRA SPOT / LONG';
  } else if (isSell) {
    badgeColor = 'bg-[#ff4d6d]/20 text-[#ff4d6d] border-[#ff4d6d]/40';
    badgeText = 'VENTA / SHORT';
  }

  card.innerHTML = `
    <div>
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded-md text-[10px] font-black border ${badgeColor}">
            ${badgeText}
          </span>
          <span class="text-xs font-mono font-bold text-white">${s.symbol}</span>
        </div>
        <span class="text-[11px] font-mono text-[#00f59b] font-bold">Confianza: ${s.confidence}%</span>
      </div>

      <div class="w-full h-1.5 bg-[#141b2b] rounded-full overflow-hidden mb-2.5">
        <div class="h-full bg-gradient-to-r from-[#00f2fe] to-[#00f59b]" style="width: ${s.confidence}%"></div>
      </div>

      <div class="bg-[#07090e] p-2.5 rounded-xl border border-[#141b2b] text-[11px] text-[#c2d0df] leading-relaxed">
        <span class="text-[#00f2fe] font-bold block mb-1">🧠 Razonamiento Técnico:</span>
        <p>${s.reasoning || 'Evaluando condiciones de mercado...'}</p>
      </div>
    </div>
  `;
}

function renderLogs() {
  const container = document.getElementById('systemLogsContainer');
  if (!container) return;

  if (state.logs.length === 0) {
    container.innerHTML = `<div class="text-[#5c6b7d] text-center py-3 text-xs">Esperando eventos en vivo...</div>`;
    return;
  }

  container.innerHTML = state.logs.map(l => {
    let color = 'text-[#c2d0df]';
    if (l.type === 'success') color = 'text-[#00f59b] font-semibold';
    if (l.type === 'error') color = 'text-[#ff4d6d]';
    if (l.type === 'warning') color = 'text-[#ffd166]';

    return `
      <div class="py-0.5 flex items-start gap-1.5 text-[11px]">
        <span class="text-[#55657e] font-mono text-[9px] shrink-0">[${l.timeFormatted || ''}]</span>
        <span class="${color}">${l.message}</span>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  const container = document.getElementById('tradeHistoryContainer');
  if (!container) return;

  let history = (state.wallet.tradeHistory || []).slice();

  // 1. Filter
  if (state.historyFilter === 'wins') {
    history = history.filter(t => (t.realizedPnL || 0) > 0);
  } else if (state.historyFilter === 'losses') {
    history = history.filter(t => (t.realizedPnL || 0) < 0);
  } else if (state.historyFilter === 'highest_pnl') {
    history.sort((a, b) => (b.realizedPnL || 0) - (a.realizedPnL || 0));
  }

  if (history.length === 0) {
    container.innerHTML = `
      <div class="bg-[#0b0f19] p-4 rounded-2xl border border-[#141b2b] text-center text-xs text-[#55657e]">
        No hay operaciones que coincidan con este filtro.
      </div>
    `;
    return;
  }

  container.innerHTML = history.map(t => {
    const isWin = (t.realizedPnL || 0) >= 0;
    const sign = isWin ? '+' : '';
    const cleanSym = t.symbol.replace('USDT', '').replace('1000', '');
    const levText = (t.leverage && t.leverage > 1) ? `${t.leverage}x` : '1x Dinero Propio';

    return `
      <div class="bg-[#0b0f19] p-3 rounded-xl border border-[#141b2b] flex items-center justify-between">
        <div>
          <div class="flex items-center gap-1.5 mb-1">
            <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${t.side === 'LONG' ? 'bg-[#00f59b]/20 text-[#00f59b]' : 'bg-[#ff4d6d]/20 text-[#ff4d6d]'}">
              ${t.side} • ${levText}
            </span>
            <h4 class="text-xs font-bold text-white">${cleanSym}</h4>
            <span class="text-[10px] text-[#6b7c93]">• ${t.durationSeconds || 0}s</span>
          </div>
          <p class="text-[10px] text-[#6b7c93] font-mono">
            Inv: $${t.margin} USDT | $${formatPrice(t.entryPrice)} ➔ $${formatPrice(t.exitPrice)}
          </p>
        </div>

        <div class="text-right">
          <span class="font-mono text-xs font-black ${isWin ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}">
            ${sign}$${t.realizedPnL.toFixed(2)} USDT
          </span>
          <span class="text-[9px] text-[#6b7c93] block">${t.closeReason || 'Cierre'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderConfig() {
  const toggle = document.getElementById('autoPilotToggle');
  if (toggle) toggle.checked = state.autoPilot;

  const cfg = state.config;
  const inputKey = document.getElementById('inputDeepSeekKey');
  if (inputKey && !inputKey.value) inputKey.value = cfg.deepseekApiKeyMasked || '';

  const selectModel = document.getElementById('selectDeepSeekModel');
  if (selectModel) selectModel.value = cfg.deepseekModel || 'deepseek-chat';

  const selectScan = document.getElementById('selectScanMode');
  if (selectScan) selectScan.value = cfg.scanMode || 'all';

  const selectLev = document.getElementById('selectLeverage');
  if (selectLev) selectLev.value = String(cfg.defaultLeverage || 1);

  const inputTarget = document.getElementById('inputTargetProfit');
  if (inputTarget) inputTarget.value = cfg.globalProfitGoalUSDT || 10.0;

  const inputRisk = document.getElementById('inputRiskPercent');
  if (inputRisk) inputRisk.value = cfg.riskPerTradePercent || 5;

  const inputMaxPos = document.getElementById('inputMaxPositions');
  if (inputMaxPos) inputMaxPos.value = cfg.maxOpenPositions || 6;

  const inputTgToken = document.getElementById('inputTelegramToken');
  if (inputTgToken) inputTgToken.value = cfg.telegramBotToken || '';

  const inputTgChat = document.getElementById('inputTelegramChatId');
  if (inputTgChat) inputTgChat.value = cfg.telegramChatId || '';

  const checkTg = document.getElementById('checkboxTelegramEnabled');
  if (checkTg) checkTg.checked = cfg.telegramEnabled || false;
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('binanceWsStatus');
  if (!statusEl) return;
  statusEl.innerText = connected ? 'Binance Live' : 'Reconectando...';
  statusEl.className = connected ? 'text-[#00f59b]' : 'text-[#ff4d6d]';
}

async function saveSettings() {
  const settings = {
    deepseekModel: document.getElementById('selectDeepSeekModel').value,
    scanMode: document.getElementById('selectScanMode').value,
    defaultLeverage: parseInt(document.getElementById('selectLeverage').value, 10) || 1,
    globalProfitGoalUSDT: parseFloat(document.getElementById('inputTargetProfit').value) || 10.0,
    riskPerTradePercent: parseFloat(document.getElementById('inputRiskPercent').value) || 5,
    maxOpenPositions: parseInt(document.getElementById('inputMaxPositions').value, 10) || 6,
    telegramToken: document.getElementById('inputTelegramToken').value,
    telegramChatId: document.getElementById('inputTelegramChatId').value,
    telegramEnabled: document.getElementById('checkboxTelegramEnabled').checked
  };

  const dsKey = document.getElementById('inputDeepSeekKey').value.trim();
  if (dsKey && !dsKey.includes('...')) {
    settings.deepseekApiKey = dsKey;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    if (data.success) {
      state.config = data.config;
      showToast('Configuración guardada con éxito', 'success');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

async function testTelegram() {
  const token = document.getElementById('inputTelegramToken')?.value.trim();
  const chat = document.getElementById('inputTelegramChatId')?.value.trim();

  try {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: token, chatId: chat })
    });
    const data = await res.json();
    if (data.success) {
      showToast('¡Alerta de prueba enviada a Telegram!', 'success');
    } else {
      showToast('Error Telegram: ' + data.error, 'danger');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'danger');
  }
}

// ----------------------------------------------------
// UTILS
// ----------------------------------------------------
function formatPrice(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  const num = parseFloat(val);
  if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num >= 1) return num.toFixed(2);
  if (num >= 0.01) return num.toFixed(4);
  return num.toFixed(6);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  let borderColor = 'border-[#00f2fe]/40';
  let bgColor = 'bg-[#0f1422]';
  if (type === 'success') borderColor = 'border-[#00f59b]/50';
  if (type === 'danger') borderColor = 'border-[#ff4d6d]/50';

  toast.className = `p-3 rounded-xl border ${borderColor} ${bgColor} text-white text-xs font-semibold shadow-2xl flex items-center justify-between gap-2.5`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="text-[#8899a6] hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function bindUIEvents() {
  document.getElementById('autoPilotToggle')?.addEventListener('change', toggleAutoPilot);
}
