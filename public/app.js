/**
 * DeepSeek AI Quantitative Scalper ($5 USD Target) - Frontend Application
 */

const state = {
  activeSymbol: 'BTCUSDT',
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
    totalROI: 0,
    tradeHistory: []
  },
  latestAiSignal: null,
  isAnalyzing: false,
  autoPilot: true,
  config: {},
  logs: [],
  soundEnabled: true
};

let ws = null;
let audioCtx = null;

// Sound alerts
function playSound(type) {
  if (!state.soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'signal') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      osc.frequency.setValueAtTime(783.99, now + 0.2);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  } catch (e) {}
}

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  fetchInitialData();
  bindUIEvents();
});

// ----------------------------------------------------
// WEBSOCKET CLIENT
// ----------------------------------------------------
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnectionBadge(true);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    updateConnectionBadge(false);
    setTimeout(initWebSocket, 2000);
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
      handleAllPricesTick(data);
      break;

    case 'PRICE_TICK':
      handlePriceTick(data);
      break;

    case 'WALLET_UPDATE':
      state.wallet = data;
      renderWalletSummary();
      renderPositions();
      renderHistory();
      break;

    case 'AI_ANALYSIS_RESULT':
      state.latestAiSignal = data;
      state.isAnalyzing = false;
      renderAiSignalCard();
      playSound('signal');
      break;

    case 'SCAN_STARTED':
      state.isAnalyzing = true;
      renderAiSignalCard();
      break;

    case 'SCAN_COMPLETED':
      state.isAnalyzing = false;
      renderAiSignalCard();
      break;

    case 'AUTO_TRADER_LOG':
      state.logs.unshift(data);
      if (state.logs.length > 100) state.logs.pop();
      renderLogs();
      break;

    case 'POSITION_OPENED':
      playSound('signal');
      showToast(`⚡ IA Abrió Operación: ${data.side} #${data.symbol} @ $${formatPrice(data.entryPrice)}`, 'info');
      break;

    case 'POSITION_CLOSED':
      if (data.realizedPnL >= 0) {
        playSound('win');
        showToast(`🎯 ¡META CUMPLIDA! +$${data.realizedPnL} USDT en ${data.symbol}`, 'success');
      } else {
        showToast(`🛑 Cierre de Protección: -$${Math.abs(data.realizedPnL)} USDT en ${data.symbol}`, 'danger');
      }
      break;

    case 'CONFIG_UPDATED':
      state.config = data;
      state.autoPilot = data.autoPilot;
      renderConfigState();
      break;
  }
}

function handleAllPricesTick(priceMap) {
  for (const [symbol, price] of Object.entries(priceMap)) {
    const oldPrice = state.prices[symbol];
    state.prices[symbol] = price;

    const tickerEl = document.getElementById(`watch-price-${symbol}`);
    if (tickerEl) {
      tickerEl.innerText = '$' + formatPrice(price);
      if (oldPrice && price !== oldPrice) {
        tickerEl.style.color = price > oldPrice ? '#00f59b' : '#ff4d6d';
        setTimeout(() => { if (tickerEl) tickerEl.style.color = '#ffffff'; }, 600);
      }
    }
  }

  // Update open positions floating PnL in real-time
  if (state.wallet.positions && state.wallet.positions.length > 0) {
    let hasPosChanges = false;
    state.wallet.positions.forEach(pos => {
      const currentPrice = state.prices[pos.symbol];
      if (currentPrice && currentPrice !== pos.currentPrice) {
        pos.currentPrice = currentPrice;
        let pnl = pos.side === 'LONG'
          ? (currentPrice - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - currentPrice) * pos.quantity;
        pos.unrealizedPnL = Number(pnl.toFixed(2));
        pos.unrealizedRoePercent = Number(((pnl / pos.margin) * 100).toFixed(2));
        hasPosChanges = true;
      }
    });

    if (hasPosChanges) {
      renderWalletSummary();
      renderPositions();
    }
  }
}

function handlePriceTick(data) {
  const { symbol, price } = data;
  state.prices[symbol] = price;
  const tickerEl = document.getElementById(`watch-price-${symbol}`);
  if (tickerEl) {
    tickerEl.innerText = '$' + formatPrice(price);
  }
}

// ----------------------------------------------------
// REST API DATA
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

async function triggerAiScan(symbol = state.activeSymbol, timeframe = '15m', execute = true) {
  state.isAnalyzing = true;
  renderAiSignalCard();
  showToast(`🧠 DeepSeek evaluando oportunidades de $5 en ${symbol}...`, 'info');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe, execute })
    });
    const data = await res.json();
    if (data.success) {
      state.latestAiSignal = data.analysis;
      renderAiSignalCard();
    } else {
      showToast('Error en análisis: ' + data.error, 'danger');
    }
  } catch (err) {
    showToast('Error de conexión: ' + err.message, 'danger');
  } finally {
    state.isAnalyzing = false;
    renderAiSignalCard();
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
      showToast('Posición cerrada manualmente', 'info');
    } else {
      showToast('Error al cerrar: ' + data.error, 'danger');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

async function resetPaperWallet() {
  if (!confirm('¿Deseas reiniciar la cuenta a $1,000 USDT?')) return;

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
      showToast('Cuenta reiniciada a $1,000.00 USDT', 'success');
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
      renderConfigState();
      showToast(newStatus ? '🚀 Auto-Piloto IA ACTIVADO' : '⏸️ Auto-Piloto IA PAUSADO', newStatus ? 'success' : 'warning');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

// ----------------------------------------------------
// UI RENDERING
// ----------------------------------------------------
function renderAll() {
  renderWalletSummary();
  renderWatchlist();
  renderPositions();
  renderAiSignalCard();
  renderLogs();
  renderHistory();
  renderConfigState();
}

function renderWalletSummary() {
  const w = state.wallet;
  document.getElementById('walletBalance').innerText = '$' + w.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('walletEquity').innerText = '$' + w.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Calculate Net Accumulated Profit (Realized + Unrealized)
  const totalRealized = w.tradeHistory.reduce((acc, t) => acc + (t.realizedPnL || 0), 0);
  const netAccumulatedProfit = Number((totalRealized + (w.unrealizedPnL || 0)).toFixed(2));
  const profPrefix = netAccumulatedProfit >= 0 ? '+' : '';

  const profEl = document.getElementById('statTotalProfitHeader');
  if (profEl) {
    profEl.innerText = `${profPrefix}$${netAccumulatedProfit.toFixed(2)} USDT`;
    profEl.className = `font-mono font-extrabold text-sm ${netAccumulatedProfit >= 0 ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}`;
  }

  const winRateEl = document.getElementById('walletWinRate');
  if (winRateEl) {
    winRateEl.innerText = `${w.winRate}% (${w.winningTrades}W / ${w.losingTrades}L)`;
  }

  // Update Global Goal Progress ($10.00 Total Goal)
  const globalGoal = state.config.globalProfitGoalUSDT || 10.0;
  const goalProgressPct = Math.min(100, Math.max(0, (netAccumulatedProfit / globalGoal) * 100));

  const goalAmtEl = document.getElementById('globalGoalAmount');
  const goalBarEl = document.getElementById('globalGoalProgressBar');

  if (goalAmtEl) {
    if (netAccumulatedProfit >= globalGoal) {
      goalAmtEl.innerHTML = `<span class="text-[#00f59b] font-extrabold">🏆 ¡META DE $10 USD LOGRADA! (+${netAccumulatedProfit.toFixed(2)} USDT)</span>`;
    } else {
      goalAmtEl.innerText = `${profPrefix}$${netAccumulatedProfit.toFixed(2)} / $${globalGoal.toFixed(2)} USDT (${goalProgressPct.toFixed(1)}%)`;
    }
  }

  if (goalBarEl) {
    goalBarEl.style.width = `${goalProgressPct}%`;
  }
}

function renderWatchlist() {
  const container = document.getElementById('watchlistBar');
  if (!container) return;

  const pairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', '1000PEPEUSDT'];
  
  container.innerHTML = pairs.map(sym => {
    const isSelected = sym === state.activeSymbol;
    const price = state.prices[sym] ? '$' + formatPrice(state.prices[sym]) : '---';
    let cleanSym = sym.replace('USDT', '');
    if (cleanSym === '1000PEPE') cleanSym = 'PEPE';

    return `
      <button onclick="selectQuickPair('${sym}')" class="px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 border transition-all ${
        isSelected 
          ? 'bg-[#00f2fe]/10 border-[#00f2fe] text-[#00f2fe]' 
          : 'bg-[#111622] border-[#1e2638] text-[#8899a6] hover:text-white'
      }">
        <span>${cleanSym}:</span>
        <span id="watch-price-${sym}" class="font-mono text-white font-bold">${price}</span>
      </button>
    `;
  }).join('');
}

function selectQuickPair(sym) {
  state.activeSymbol = sym;
  renderWatchlist();
  triggerAiScan(sym, '15m', true);
}

function renderPositions() {
  const container = document.getElementById('livePositionsContainer');
  const countBadge = document.getElementById('openPositionsBadge');
  if (!container) return;

  const positions = state.wallet.positions || [];
  if (countBadge) {
    countBadge.innerText = `${positions.length} / 2 Activas`;
    countBadge.className = positions.length > 0 
      ? 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#00f59b]/20 text-[#00f59b] border border-[#00f59b]/40 animate-pulse'
      : 'px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/30';
  }

  if (positions.length === 0) {
    container.innerHTML = `
      <div class="bg-[#080a0f] p-8 rounded-xl border border-dashed border-[#1e2638] text-center">
        <div class="w-12 h-12 mx-auto rounded-full bg-[#00f2fe]/10 flex items-center justify-center mb-3">
          <i data-lucide="radar" class="w-6 h-6 text-[#00f2fe] animate-spin" style="animation-duration: 6s;"></i>
        </div>
        <h4 class="text-sm font-bold text-white mb-1">IA en Modo Centinela Autónomo</h4>
        <p class="text-xs text-[#8899a6] max-w-md mx-auto">
          DeepSeek está analizando los mercados en vivo. Realiza micro-operaciones seguras con <b>$50 de margen (5%)</b> para sumar ganancias poco a poco hasta alcanzar la <b>Meta Total de +$10.00 USD</b>.
        </p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = positions.map(pos => {
    const isLong = pos.side === 'LONG';
    const isProfit = (pos.unrealizedPnL || 0) >= 0;
    const pnlSign = isProfit ? '+' : '';

    let cleanSym = pos.symbol.replace('USDT', '');
    if (cleanSym === '1000PEPE') cleanSym = 'PEPE';

    return `
      <div class="bg-[#080a0f] p-4 rounded-xl border border-[#1e2638] hover:border-[#2a364f] transition-all">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-[11px] font-extrabold ${isLong ? 'bg-[#00f59b]/20 text-[#00f59b]' : 'bg-[#ff4d6d]/20 text-[#ff4d6d]'}">${pos.side} ${pos.leverage}x</span>
            <h4 class="text-sm font-extrabold text-white">${cleanSym} <span class="text-xs text-gray-500 font-mono">(${pos.symbol})</span></h4>
            <span class="text-xs font-mono text-[#8899a6]">Margen: $${pos.margin} USDT</span>
          </div>

          <div class="flex items-center gap-3">
            <div class="text-right">
              <span class="text-[10px] text-[#8899a6] block">PnL Flotante</span>
              <span class="font-mono text-base font-extrabold ${isProfit ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}">
                ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} USDT (${pnlSign}${pos.unrealizedRoePercent}%)
              </span>
            </div>
            <button onclick="closePosition('${pos.id}')" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#ff4d6d]/20 text-[#ff4d6d] hover:bg-[#ff4d6d] hover:text-white transition-all">
              Cerrar
            </button>
          </div>
        </div>

        <!-- Metric Details -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-[#111622] p-2.5 rounded-lg">
          <div>
            <span class="text-[10px] text-[#8899a6] block">Entrada</span>
            <span class="text-white font-bold">$${formatPrice(pos.entryPrice)}</span>
          </div>
          <div>
            <span class="text-[10px] text-[#8899a6] block">Precio Actual</span>
            <span class="text-white font-bold">$${formatPrice(pos.currentPrice)}</span>
          </div>
          <div>
            <span class="text-[10px] text-[#00f59b] block">🎯 Take Profit</span>
            <span class="text-[#00f59b] font-bold">$${formatPrice(pos.takeProfit)}</span>
          </div>
          <div>
            <span class="text-[10px] text-[#ff4d6d] block">🛑 Stop Loss</span>
            <span class="text-[#ff4d6d] font-bold">$${formatPrice(pos.stopLoss)}</span>
          </div>
        </div>

        ${pos.aiReason ? `
          <div class="mt-2.5 text-[11px] text-[#8899a6] italic">
            🧠 <b>Motivo IA:</b> ${pos.aiReason}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function renderAiSignalCard() {
  const card = document.getElementById('aiSignalCard');
  if (!card) return;

  if (state.isAnalyzing) {
    card.innerHTML = `
      <div class="flex flex-col items-center justify-center py-6 text-center">
        <div class="w-8 h-8 border-3 border-[#00f2fe] border-t-transparent rounded-full animate-spin mb-3"></div>
        <h4 class="text-white font-bold text-xs mb-1">DeepSeek IA Analizando Mercados</h4>
        <p class="text-[11px] text-[#8899a6]">Buscando la mejor confluencia para la meta de $5 USD...</p>
      </div>
    `;
    return;
  }

  const s = state.latestAiSignal;
  if (!s) {
    card.innerHTML = `
      <div class="text-center py-5 text-[#8899a6]">
        <p class="text-xs mb-2">IA en espera del próximo ciclo de escaneo.</p>
        <button onclick="triggerAiScan()" class="btn-primary px-4 py-2 text-xs font-bold">
          ⚡ Escanear con DeepSeek Ahora
        </button>
      </div>
    `;
    return;
  }

  const isBuy = s.signal === 'BUY_LONG';
  const isSell = s.signal === 'SELL_SHORT';
  const isHold = s.signal === 'HOLD';

  let badgeColor = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  let badgeText = '⏸️ ESPERAR (HOLD)';
  if (isBuy) {
    badgeColor = 'bg-[#00f59b]/20 text-[#00f59b] border-[#00f59b]/40';
    badgeText = '🟢 COMPRA / LONG';
  } else if (isSell) {
    badgeColor = 'bg-[#ff4d6d]/20 text-[#ff4d6d] border-[#ff4d6d]/40';
    badgeText = '🔴 VENTA / SHORT';
  }

  card.innerHTML = `
    <div>
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded text-xs font-extrabold border ${badgeColor}">
            ${badgeText}
          </span>
          <span class="text-xs font-mono font-bold text-white">${s.symbol}</span>
        </div>
        <span class="text-[11px] font-mono text-[#00f59b] font-bold">Meta: $5.00</span>
      </div>

      <!-- Confidence Gauge -->
      <div class="mb-3">
        <div class="flex justify-between text-xs font-semibold mb-1">
          <span class="text-[#8899a6]">Confianza Cuántica:</span>
          <span class="text-white font-mono font-bold">${s.confidence}%</span>
        </div>
        <div class="w-full h-1.5 bg-[#161d2d] rounded-full overflow-hidden">
          <div class="h-full bg-[#00f2fe]" style="width: ${s.confidence}%"></div>
        </div>
      </div>

      <!-- Reasoning Text -->
      <div class="terminal-box p-3 text-xs text-[#c2d0df] leading-relaxed">
        <span class="text-[#00f2fe] font-bold block mb-1">🧠 Pensamiento de DeepSeek:</span>
        <p>${s.reasoning}</p>
      </div>
    </div>
  `;
}

function renderLogs() {
  const container = document.getElementById('systemLogsContainer');
  if (!container) return;

  if (state.logs.length === 0) {
    container.innerHTML = `<div class="text-[#5c6b7d] text-center py-4 text-xs">Esperando eventos del sistema...</div>`;
    return;
  }

  container.innerHTML = state.logs.map(l => {
    let color = 'text-[#c2d0df]';
    if (l.type === 'success') color = 'text-[#00f59b] font-semibold';
    if (l.type === 'error') color = 'text-[#ff4d6d]';
    if (l.type === 'warning') color = 'text-[#ffd166]';

    return `
      <div class="py-1 border-b border-[#161d2d] flex items-start gap-2 text-xs">
        <span class="text-[#5c6b7d] font-mono text-[10px] shrink-0">[${l.timeFormatted || ''}]</span>
        <span class="${color}">${l.message}</span>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  const container = document.getElementById('tradeHistoryTableBody');
  const countEl = document.getElementById('statTotalTrades');
  if (!container) return;

  const history = state.wallet.tradeHistory || [];
  if (countEl) countEl.innerText = history.length;

  if (history.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-8 text-[#5c6b7d] text-xs">
          Aún no hay operaciones cerradas. La IA está monitoreando para abrir la primera.
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = history.map(t => {
    const isWin = (t.realizedPnL || 0) >= 0;
    const sign = isWin ? '+' : '';

    return `
      <tr class="border-b border-[#1e2638] hover:bg-[#161d2d]/50 font-mono text-xs">
        <td class="py-2.5 px-3 text-white font-bold">${t.symbol}</td>
        <td class="py-2.5 px-3">
          <span class="px-1.5 py-0.5 rounded text-[10px] ${t.side === 'LONG' ? 'bg-[#00f59b]/20 text-[#00f59b]' : 'bg-[#ff4d6d]/20 text-[#ff4d6d]'}">${t.side}</span>
        </td>
        <td class="py-2.5 px-3 text-white">$${formatPrice(t.entryPrice)}</td>
        <td class="py-2.5 px-3 text-white">$${formatPrice(t.exitPrice)}</td>
        <td class="py-2.5 px-3 font-bold ${isWin ? 'text-[#00f59b]' : 'text-[#ff4d6d]'}">
          ${sign}$${t.realizedPnL.toFixed(2)} USDT
        </td>
        <td class="py-2.5 px-3 text-[#8899a6] text-[11px]">${t.closeReason}</td>
        <td class="py-2.5 px-3 text-[#8899a6]">${t.durationSeconds}s</td>
      </tr>
    `;
  }).join('');
}

function renderConfigState() {
  const toggleBtn = document.getElementById('autoPilotToggle');
  const badge = document.getElementById('autoPilotStatusBadge');

  if (toggleBtn) toggleBtn.checked = state.autoPilot;
  if (badge) {
    if (state.autoPilot) {
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-[#00f59b] pulse-dot"></span> <span class="text-[#00f59b] font-bold">AUTO-PILOTO ACTIVO</span>`;
    } else {
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-[#8899a6]"></span> <span class="text-[#8899a6]">AUTO-PILOTO PAUSADO</span>`;
    }
  }
}

function updateConnectionBadge(connected) {
  const badge = document.getElementById('binanceWsStatus');
  if (!badge) return;
  if (connected) {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-[#00f59b] pulse-dot"></span> <span class="text-[#00f59b]">Binance Futures Live</span>`;
  } else {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-[#ff4d6d]"></span> <span class="text-[#ff4d6d]">Reconectando...</span>`;
  }
}

// ----------------------------------------------------
// SETTINGS MODAL
// ----------------------------------------------------
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const cfg = state.config;
  document.getElementById('inputDeepSeekKey').value = cfg.deepseekApiKeyMasked || '';
  document.getElementById('selectDeepSeekModel').value = cfg.deepseekModel || 'deepseek-chat';
  document.getElementById('inputTargetProfit').value = cfg.targetProfitUSDT || 5.0;
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
    deepseekModel: document.getElementById('selectDeepSeekModel').value,
    targetProfitUSDT: parseFloat(document.getElementById('inputTargetProfit').value) || 5.0,
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
      renderConfigState();
      showToast('Ajustes guardados correctamente', 'success');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
}

async function testTelegram() {
  const token = document.getElementById('inputTelegramToken').value.trim();
  const chat = document.getElementById('inputTelegramChatId').value.trim();

  if (!token || !chat) {
    alert('Ingresa el Bot Token y Chat ID');
    return;
  }

  try {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: token, chatId: chat })
    });
    const data = await res.json();
    if (data.success) {
      alert('¡Mensaje de prueba enviado con éxito a tu Telegram!');
    } else {
      alert('Error Telegram: ' + data.error);
    }
  } catch (e) {
    alert('Error: ' + e.message);
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
  let borderColor = 'border-[#00f2fe]';
  let bgColor = 'bg-[#111622]';
  if (type === 'success') borderColor = 'border-[#00f59b]';
  if (type === 'danger') borderColor = 'border-[#ff4d6d]';
  if (type === 'warning') borderColor = 'border-[#ffd166]';

  toast.className = `p-3.5 rounded-xl border ${borderColor} ${bgColor} text-white text-xs font-semibold shadow-2xl flex items-center justify-between gap-3 transform translate-y-2 opacity-0 transition-all duration-300 pointer-events-auto`;
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" class="text-[#8899a6] hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function bindUIEvents() {
  document.getElementById('btnScanNow')?.addEventListener('click', () => triggerAiScan());
  document.getElementById('autoPilotToggle')?.addEventListener('change', toggleAutoPilot);
}
