const axios = require('axios');
const { getConfig } = require('./config');

async function sendTelegramMessage(messageText) {
  const config = getConfig();
  if (!config.telegramEnabled || !config.telegramBotToken || !config.telegramChatId) {
    return { sent: false, reason: 'Telegram notifications disabled or credentials not set' };
  }

  const url = `https://api.telegram.org/bot${config.telegramBotToken.trim()}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: config.telegramChatId.trim(),
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }, { timeout: 8000 });

    return { sent: true, messageId: response.data?.result?.message_id };
  } catch (error) {
    console.error('[Telegram Error]:', error.response?.data?.description || error.message);
    return { sent: false, error: error.response?.data?.description || error.message };
  }
}

/**
 * Send AI Signal Detected Alert
 */
async function sendSignalAlert(signalData) {
  const emoji = signalData.signal === 'BUY_LONG' ? '🟢 🚀 COMPRA / LONG' : (signalData.signal === 'SELL_SHORT' ? '🔴 🔻 VENTA / SHORT' : '⏸️ ESPERAR / HOLD');
  
  const text = `
🤖 <b>DEEPSEEK AI TRADING SIGNAL</b>
━━━━━━━━━━━━━━━━━━
<b>Par:</b> #${signalData.symbol}
<b>Señal:</b> <b>${emoji}</b>
<b>Confianza IA:</b> <b>${signalData.confidence}%</b>
<b>Apalancamiento:</b> ${signalData.recommended_leverage}x

💰 <b>Precio Entrada:</b> $${signalData.entry_price}
🎯 <b>Take Profit:</b> $${signalData.take_profit}
🛑 <b>Stop Loss:</b> $${signalData.stop_loss}
⚖️ <b>Ratio R/R:</b> ${signalData.risk_reward_ratio}

🧠 <b>Análisis IA:</b>
<i>${signalData.reasoning}</i>

⚠️ <b>Riesgo:</b> ${signalData.risk_warning || 'Mantén estricta gestión de riesgo.'}
━━━━━━━━━━━━━━━━━━
<i>DeepSeek CryptoTrader AI 2026</i>
`;

  return sendTelegramMessage(text);
}

/**
 * Send Order Opened Alert
 */
async function sendOrderOpenedAlert(position, mode = 'paper') {
  const modeText = mode === 'paper' ? '🧪 EMULADO (PAPER TRADING)' : '🔥 REAL BINANCE FUTURES';
  const sideEmoji = position.side === 'LONG' ? '🟢 LONG' : '🔴 SHORT';

  const text = `
⚡ <b>NUEVA OPERACIÓN ABIERTA</b>
━━━━━━━━━━━━━━━━━━
<b>Modo:</b> ${modeText}
<b>Par:</b> #${position.symbol} (${sideEmoji})
<b>Apalancamiento:</b> ${position.leverage}x
<b>Margen Usado:</b> $${position.margin} USDT
<b>Tamaño Total:</b> $${position.positionValue} USDT

📍 <b>Precio de Entrada:</b> $${position.entryPrice}
🎯 <b>Take Profit:</b> $${position.takeProfit}
🛑 <b>Stop Loss:</b> $${position.stopLoss}
💀 <b>Precio Liquidación:</b> $${position.liquidationPrice}

🧠 <b>Motivo IA:</b> <i>${position.aiReason || 'Estrategia cuantitativa'}</i>
━━━━━━━━━━━━━━━━━━
`;

  return sendTelegramMessage(text);
}

/**
 * Send Order Closed Alert
 */
async function sendOrderClosedAlert(trade, mode = 'paper') {
  const isWin = trade.realizedPnL >= 0;
  const emoji = isWin ? '🎯 💰 TAKE PROFIT / GANANCIA' : '🛑 📉 STOP LOSS / PÉRDIDA';
  const modeText = mode === 'paper' ? '🧪 EMULADO' : '🔥 REAL';

  const text = `
${emoji}
━━━━━━━━━━━━━━━━━━
<b>Modo:</b> ${modeText}
<b>Par:</b> #${trade.symbol} (${trade.side})
<b>Motivo Cierre:</b> ${trade.closeReason}

💵 <b>PnL Realizado:</b> <b>${isWin ? '+' : ''}$${trade.realizedPnL} USDT</b>
📈 <b>ROI:</b> <b>${isWin ? '+' : ''}${trade.roiPercent}%</b>

📍 <b>Entrada:</b> $${trade.entryPrice}
🏁 <b>Salida:</b> $${trade.exitPrice}
⏱️ <b>Duración:</b> ${trade.durationSeconds} seg
━━━━━━━━━━━━━━━━━━
`;

  return sendTelegramMessage(text);
}

/**
 * Test Telegram Credentials
 */
async function testTelegramConnection(botToken, chatId) {
  const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
  try {
    const res = await axios.post(url, {
      chat_id: chatId.trim(),
      text: '🤖 <b>DeepSeek CryptoTrader AI</b>: Conexión con Telegram verificada exitosamente! Listo para enviar señales y alertas.',
      parse_mode: 'HTML'
    }, { timeout: 8000 });
    return { success: true, message: 'Mensaje de prueba enviado con éxito a Telegram.' };
  } catch (err) {
    return { success: false, error: err.response?.data?.description || err.message };
  }
}

module.exports = {
  sendTelegramMessage,
  sendSignalAlert,
  sendOrderOpenedAlert,
  sendOrderClosedAlert,
  testTelegramConnection
};
