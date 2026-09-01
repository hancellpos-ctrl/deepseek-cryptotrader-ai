const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');

const defaultConfig = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  tradingMode: process.env.TRADING_MODE || 'paper',
  binanceApiKey: process.env.BINANCE_API_KEY || '',
  binanceApiSecret: process.env.BINANCE_API_SECRET || '',
  binanceTestnet: process.env.BINANCE_TESTNET === 'true',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  telegramEnabled: false,
  autoPilot: true,
  autoPilotIntervalMinutes: 1,
  globalProfitGoalUSDT: 10.0, // Meta TOTAL acumulada: +$10.00 USD
  maxOpenPositions: 50, // Sin límite restrictivo (configurable en Ajustes hasta 100)
  scanMode: 'all', // 'all' (Criptos + Acciones TradFi) | 'top_trending' | 'popular'
  tradingPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT', '1000PEPEUSDT'],
  activePair: 'BTCUSDT',
  timeframe: '15m',
  minConfidenceToTrade: 68,
  riskPerTradePercent: 10, // 10% de tu capital ($100 USDT de tu dinero propio por trade)
  defaultLeverage: 1, // 1x = 100% Dinero Propio (Sin Apalancamiento / Modo Spot Seguro)
  maxLeverage: 1,
  takeProfitPercent: 1.5, // 1.5% de ganancia real sobre tu dinero
  stopLossPercent: 0.8, // 0.8% de stop loss protector
  paperInitialBalance: 1000.0,
  soundAlerts: true
};

function ensureDataDir() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadConfig() {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const loaded = JSON.parse(data);
      return { ...defaultConfig, ...loaded };
    }
  } catch (err) {
    console.error('Error loading config file, using default:', err.message);
  }
  return { ...defaultConfig };
}

let currentConfig = loadConfig();

function getConfig() {
  return currentConfig;
}

function getSafeConfig() {
  const safe = { ...currentConfig };
  if (safe.deepseekApiKey) {
    safe.deepseekApiKeyMasked = safe.deepseekApiKey.length > 8 
      ? safe.deepseekApiKey.substring(0, 4) + '...' + safe.deepseekApiKey.slice(-4)
      : '****';
  } else {
    safe.deepseekApiKeyMasked = '';
  }
  if (safe.binanceApiKey) {
    safe.binanceApiKeyMasked = safe.binanceApiKey.length > 8
      ? safe.binanceApiKey.substring(0, 4) + '...' + safe.binanceApiKey.slice(-4)
      : '****';
  } else {
    safe.binanceApiKeyMasked = '';
  }
  if (safe.binanceApiSecret) {
    safe.hasBinanceSecret = true;
    delete safe.binanceApiSecret;
  }
  if (safe.telegramBotToken) {
    safe.hasTelegramToken = true;
  }
  return safe;
}

function updateConfig(newSettings) {
  ensureDataDir();
  if (newSettings.deepseekApiKey && newSettings.deepseekApiKey.includes('...')) {
    delete newSettings.deepseekApiKey;
  }
  if (newSettings.binanceApiKey && newSettings.binanceApiKey.includes('...')) {
    delete newSettings.binanceApiKey;
  }
  if (newSettings.binanceApiSecret === undefined || newSettings.binanceApiSecret === '') {
    delete newSettings.binanceApiSecret;
  }

  currentConfig = { ...currentConfig, ...newSettings };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf8');
    return { success: true, config: getSafeConfig() };
  } catch (err) {
    console.error('Failed to save config:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getConfig,
  getSafeConfig,
  updateConfig
};
