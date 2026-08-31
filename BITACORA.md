# 📋 BITÁCORA DE DESARROLLO Y ARQUITECTURA TÉCNICA
## DeepSeek AI Autonomous CryptoTrader | Binance Futures & Paper Trading Engine

---

## 📌 1. Resumen Ejecutivo del Proyecto

* **Nombre del Proyecto:** DeepSeek AI Autonomous CryptoTrader
* **Propósito:** Plataforma algorítmica y autónoma de trading en Binance Futures impulsada por modelos de inteligencia artificial cuantitativa (DeepSeek-V3 / DeepSeek-R1), orientada a la gestión inteligente de un portafolio de **$1,000 USDT** con el objetivo de acumular **+$10.00 USD de ganancia neta** mediante micro-operaciones de alta probabilidad y estricta preservación de capital (90-95% en reserva intocable).
* **Modos de Operación:** 
  1. `paper` (Simulación de Futuros de alta fidelidad con liquidaciones, apalancamiento, PnL flotante y comisiones).
  2. `real` (Ejecución directa en Binance Futures mediante API REST firmada HMAC-SHA256).
* **Stack Tecnológico:**
  * **Backend:** Node.js (v24+), Express, WebSockets (`ws`), Axios, TechnicalIndicators (RSI, MACD, EMA, Bollinger Bands, ATR), Node-Cron.
  * **IA Cuantitativa:** DeepSeek API (`deepseek-chat`, `deepseek-reasoner`).
  * **Frontend:** SPA con HTML5, Tailwind CSS, Lucide Icons, WebSockets bidireccionales y sintetizador de audio en Web Audio API.

---

## 🗓️ 2. Historial Cronológico de Desarrollo y Fases

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     FASE 1      │ ──► │     FASE 2      │ ──► │     FASE 3      │ ──► │     FASE 4 & 5  │
│ Arquitectura y  │     │ Corrección PEPE │     │ Rediseño Visual │     │ Meta Global $10 │
│ Motor Simulado  │     │  y Sub-centavos │     │ Terminal Puro IA│     │ Criterios Salida│
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 🔹 Fase 1: Arquitectura Base y Conexiones en Vivo
* Implementación del servidor HTTP y WebSocket en Node.js.
* Conexión con los endpoints públicos de Binance Futures (`https://fapi.binance.com` y `wss://fstream.binance.com`).
* Creación del motor `paperTradingEngine.js` con balance inicial de $1,000 USDT, soporte de apalancamiento (1x a 20x), cálculo de precios de liquidación y margen aislado.
* Integración con la API de DeepSeek (`https://api.deepseek.com/chat/completions`) para generación de análisis técnicos estructurados en JSON.
* Creación del bot de alertas por Telegram (`telegramService.js`).

### 🔹 Fase 2: Diagnóstico y Resolución de Problemas de Precisión en PEPE (`1000PEPEUSDT`)
* **Problema Detectado:** El usuario reportó que PEPE no operaba correctamente.
* **Causa Raíz:**
  1. `paperTradingEngine.js` utilizaba `.toFixed(2)` para los precios. Dado que PEPE cotiza a `$0.00348`, los precios de entrada, TP, SL y liquidación se convertían a `$0.00`, generando cierres erróneos inmediatos.
  2. Indicadores técnicos (EMA, ATR, Pivotes) redondeaban a 2 decimales.
* **Solución Implementada:**
  * Creación de `formatPricePrecision()` con soporte dinámico de hasta **8 decimales** para activos sub-centavo y meme coins.
  * Actualización de `indicators.js` para cálculos con precisión extendida.

### 🔹 Fase 3: Transformación a Terminal de Operaciones Autónomo (Sin Gráfica)
* **Requerimiento:** El usuario solicitó remover la gráfica TradingView para enfocarse exclusivamente en las operaciones activas, las decisiones de la IA y el rendimiento del capital.
* **Solución Implementada:**
  * Rediseño completo de `public/index.html` y `public/app.js`.
  * Creación de tarjetas interactivas de operaciones con PnL en tiempo real, barra de progreso hacia el objetivo y terminal de pensamiento de DeepSeek en vivo.

### 🔹 Fase 4: Estrategia de Micro-Scalping para la Meta Global de $10 USD
* **Requerimiento:** Aclaración del usuario: La meta no era ganar $10 por operación individual, sino acumular **+$10.00 USD en total** en la cuenta (llevar el portafolio de $1,000.00 a $1,010.00 USDT).
* **Solución Implementada:**
  * Reajuste del tamaño de posición a **$50 USDT de margen (5% del capital)** a 10x de apalancamiento ($500 nocional).
  * Límite de seguridad de máximo **2 operaciones simultáneas** para mantener **≥ $900 USDT (90%) 100% seguros en reserva**.
  * Barra de progreso global de ganancia acumulada en el encabezado.

### 🔹 Fase 5: Optimización de Criterios de Cierre y Poller de Ultra-Baja Latencia
* **Problema Detectado:** El usuario consultó por qué el mercado subió a favor pero la operación no se cerró de inmediato.
* **Causa Raíz:** El poller secundario de precios no sincronizaba el motor de simulación en cada ciclo de segundo.
* **Solución Implementada:**
  * Integración de un **poller de alta frecuencia a 1.2 segundos** en `server/server.js` que evalúa instantáneamente los precios de todas las monedas vigiladas.
  * Incorporación de **Trailing Stop / Break-Even**: En cuanto una posición alcanza ≥ +$2.00 USDT a favor, el Stop Loss se sube al precio de entrada (+0.1%) asegurando ganancias.
  * **Verificación en Vivo:** La posición de PEPE se cerró automáticamente con **+$4.77 USDT (+9.54% ROI)**, elevando el balance a **$1,004.77 USDT** (47.7% de la meta global).

---

## 🏗️ 3. Estructura y Módulos del Sistema

```
├── server/
│   ├── server.js              # Servidor Express, WebSockets y bucles de sincronización
│   ├── config.js              # Almacén de configuración y parámetros de riesgo
│   ├── binanceService.js      # Conexión REST y WebSocket con Binance Futures
│   ├── deepseekService.js     # Prompt cuantitativo y cliente API de DeepSeek
│   ├── indicators.js          # Cálculo de RSI, MACD, EMAs, Bollinger, ATR y Pivotes
│   ├── paperTradingEngine.js  # Motor de futuros simulados, PnL, TP/SL y Trailing Stop
│   ├── autoTrader.js          # Agente autónomo de escaneo y ejecución programada
│   └── telegramService.js     # Servicio de alertas y notificaciones a Telegram
├── public/
│   ├── index.html             # Interfaz de usuario del dashboard autónomo
│   ├── style.css              # Estilos personalizados, gradientes y animaciones
│   └── app.js                 # Cliente WebSocket, renderizado reactivo y sonidos
├── data/                      # Persistencia local (ignorado en git)
├── .env.example               # Plantilla de variables de entorno seguras
├── .gitignore                 # Exclusión de credenciales y node_modules
├── BITACORA.md                # Este documento de registro histórico
└── package.json               # Dependencias del proyecto
```

---

## 🎯 4. Criterios de Decisión y Gestión de Riesgo de la IA

| Criterio | Parámetro | Descripción |
|---|---|---|
| **Capital Inicial** | `$1,000.00 USDT` | Saldo inicial para operaciones |
| **Meta Global** | `+$10.00 USDT` | Objetivo de la sesión (Llevar saldo a $1,010.00 USDT) |
| **Margen por Trade** | `$50.00 USDT (5%)` | Asignación conservadora por operación |
| **Apalancamiento** | `10x Aislado` | Tamaño nocional de $500 USDT por trade |
| **Límite de Operaciones** | `Máximo 2` | Máximo $100 USDT comprometidos (90% en reserva segura) |
| **Take Profit** | Dinámico / ~0.8% | Captura rápida de ganancias técnicas |
| **Trailing Stop** | `>= +$2.00 USDT` | Sube Stop Loss a Break-Even (+0.1%) para proteger ganancia |
| **Stop Loss Máximo** | `-$1.50 a -$2.00 USDT` | Ratio Riesgo/Beneficio mínimo de 1.8:1 a favor |
| **Umbral de Confianza** | `≥ 68%` | Solo entra si hay confluencia en RSI, MACD, EMAs y Volumen |

---

## 🚀 5. Instrucciones de Despliegue y Uso

1. **Clonar el repositorio:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd "Nueva carpeta (2)"
   ```
2. **Instalar dependencias:**
   ```bash
   npm install
   ```
3. **Configurar variables de entorno:**
   * Copiar `.env.example` a `.env`:
     ```bash
     cp .env.example .env
     ```
   * Añadir tu `DEEPSEEK_API_KEY`.
4. **Iniciar el servidor:**
   ```bash
   node server/server.js
   ```
5. **Acceder a la aplicación:**
   * Abrir en el navegador: `http://localhost:3000`

---

*Bitácora generada y actualizada automáticamente para el registro del proyecto.*
