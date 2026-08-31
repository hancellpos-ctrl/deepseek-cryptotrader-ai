/**
 * CryptoTrader AI - Minimalist Mobile Web App
 */

const state = {
  prices: {},
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
  autoPilot: true,
  config: {},
  isScanning: false
};

let ws = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  fetchInitialData();
  bindUIEvents();
});

// ----------------------------------------------------
// WEBSOCKET
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

    case 'POSITION_OPENED':
      showToast(`⚡ IA Abrió: ${data.side} ${data.symbol} @ $${formatPrice(data.entryPrice)}`, 'info');
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

  // Update open positions floating PnL live
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
    console.error('Error fetching status:', err);
  }
}

async function triggerAiScan() {
  if (state.isScanning) return;
  state.isScanning = true;
  showToast('🧠 DeepSeek escaneando confluencias técnicas...', 'info');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT', timeframe: '15m', execute: true })
    });
    const data = await res.json();
    if (data.success) {
      const sig = data.analysis;
      showToast(`Análisis completado: ${sig.signal} (${sig.confidence}%)`, 'success');
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
      showToast('Posición cerrada', 'info');
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
  if (!confirm('¿Reiniciar balance a $1,000 USDT?')) return;
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
// RENDERING
// ----------------------------------------------------
function renderAll() {
  renderWallet();
  renderPositions();
  renderHistory();
  renderConfig();
  if (window.lucide) lucide.createIcons();
}

function renderWallet() {
  const w = state.wallet;
  
  // Total Net Profit
  const totalRealized = w.tradeHistory ? w.tradeHistory.reduce((acc, t) => acc + (t.realizedPnL || 0), 0) : 0;
  const netProfit = Number((totalRealized + (w.unrealizedPnL || 0)).toFixed(2));
  const sign = netProfit >= 0 ? '+' : '';
  const color = netProfit >= 0 ? 'text-[#00f59b]' : 'text-[#ff4d6d]';

  const eqEl = document.getElementById('walletEquity');
  if (eqEl) eqEl.innerText = '$' + w.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const profEl = document.getElementById('statTotalProfitHeader');
  if (profEl) {
    profEl.innerText = `${sign}$${netProfit.toFixed(2)}`;
    profEl.className = `font-mono font-extrabold text-sm ${color}`;
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
}

function renderPositions() {
  const container = document.getElementById('livePositionsContainer');
  const countBadge = document.getElementById('openPositionsBadge');
  if (!container) return;

  const positions = state.wallet.positions || [];
  if (countBadge) countBadge.innerText = `${positions.length} Activas`;

  if (positions.length === 0) {
    container.innerHTML = `
      <div class="bg-[#0b0f19] p-5 rounded-2xl border border-[#141b2b] text-center">
        <div class="w-8 h-8 mx-auto rounded-full bg-[#00f2fe]/10 flex items-center justify-center mb-2">
          <i data-lucide="radar" class="w-4 h-4 text-[#00f2fe]"></i>
        </div>
        <p class="text-xs font-semibold text-[#8899a6]">Modo Centinela Activo</p>
        <p class="text-[11px] text-[#55657e]">La IA está vigilando el mercado para ejecutar operaciones seguras.</p>
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

    return `
      <div class="bg-[#0b0f19] p-3.5 rounded-2xl border border-[#172033] shadow-md">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-black ${isLong ? 'bg-[#00f59b]/20 text-[#00f59b]' : 'bg-[#ff4d6d]/20 text-[#ff4d6d]'}">
              ${pos.side} ${pos.leverage}x
            </span>
            <h3 class="text-xs font-extrabold text-white">${cleanSym} <span class="text-[10px] text-[#55657e]">USDT</span></h3>
          </div>
          <span class="font-mono text-sm font-black ${isWin ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}">
            ${sign}$${pos.unrealizedPnL.toFixed(2)} <span class="text-[10px]">(${sign}${pos.unrealizedRoePercent}%)</span>
          </span>
        </div>

        <div class="grid grid-cols-2 gap-1.5 text-[11px] font-mono bg-[#07090e] p-2 rounded-xl border border-[#141b2b] mb-2.5">
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
          <span class="text-[10px] text-[#6b7c93] font-mono">Margen: $${pos.margin} USDT</span>
          <button onclick="closePosition('${pos.id}')" class="px-3 py-1 rounded-lg text-xs font-bold bg-[#ff4d6d]/15 text-[#ff4d6d] hover:bg-[#ff4d6d] hover:text-white transition-all">
            Cerrar
          </button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

function renderHistory() {
  const container = document.getElementById('tradeHistoryContainer');
  const countEl = document.getElementById('statTotalTrades');
  if (!container) return;

  const history = state.wallet.tradeHistory || [];
  if (countEl) countEl.innerText = history.length;

  if (history.length === 0) {
    container.innerHTML = `
      <div class="bg-[#0b0f19] p-4 rounded-2xl border border-[#141b2b] text-center text-xs text-[#55657e]">
        Aún no hay operaciones cerradas.
      </div>
    `;
    return;
  }

  container.innerHTML = history.map(t => {
    const isWin = (t.realizedPnL || 0) >= 0;
    const sign = isWin ? '+' : '';
    const cleanSym = t.symbol.replace('USDT', '').replace('1000', '');

    return `
      <div class="bg-[#0b0f19] p-3 rounded-xl border border-[#141b2b] flex items-center justify-between">
        <div>
          <div class="flex items-center gap-1.5 mb-1">
            <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${t.side === 'LONG' ? 'bg-[#00f59b]/20 text-[#00f59b]' : 'bg-[#ff4d6d]/20 text-[#ff4d6d]'}">
              ${t.side}
            </span>
            <h4 class="text-xs font-bold text-white">${cleanSym}</h4>
            <span class="text-[10px] text-[#6b7c93]">• ${t.durationSeconds || 0}s</span>
          </div>
          <p class="text-[10px] text-[#6b7c93] font-mono">
            $${formatPrice(t.entryPrice)} ➔ $${formatPrice(t.exitPrice)}
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
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('binanceWsStatus');
  if (!statusEl) return;
  statusEl.innerText = connected ? 'Binance Futures' : 'Reconectando...';
  statusEl.className = connected ? 'text-[#00f59b]' : 'text-[#ff4d6d]';
}

// ----------------------------------------------------
// SETTINGS MODAL
// ----------------------------------------------------
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  const cfg = state.config;
  document.getElementById('inputDeepSeekKey').value = cfg.deepseekApiKeyMasked || '';
  document.getElementById('inputTargetProfit').value = cfg.globalProfitGoalUSDT || 10.0;
  document.getElementById('inputRiskPercent').value = cfg.riskPerTradePercent || 5;
  document.getElementById('inputTelegramToken').value = cfg.telegramBotToken || '';
  document.getElementById('inputTelegramChatId').value = cfg.telegramChatId || '';
  document.getElementById('checkboxTelegramEnabled').checked = cfg.telegramEnabled || false;
  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.classList.add('hidden');
}

async function saveSettings() {
  const settings = {
    globalProfitGoalUSDT: parseFloat(document.getElementById('inputTargetProfit').value) || 10.0,
    riskPerTradePercent: parseFloat(document.getElementById('inputRiskPercent').value) || 5,
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
      closeSettingsModal();
      showToast('Configuración guardada en DB', 'success');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

// ----------------------------------------------------
// UTILS
// ----------------------------------------------------
function formatPrice(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  const num = parseFloat(val);
  if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num >= 1) return num.toFixed(3);
  if (num >= 0.01) return num.toFixed(5);
  return num.toFixed(7);
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
  document.getElementById('btnScanNow')?.addEventListener('click', triggerAiScan);
  document.getElementById('autoPilotToggle')?.addEventListener('change', toggleAutoPilot);
}
