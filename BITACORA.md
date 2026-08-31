# 📋 BITÁCORA DE DESARROLLO Y ARQUITECTURA TÉCNICA
## DeepSeek AI Autonomous CryptoTrader | Binance Futures, TradFi Stocks & SQLite Engine

---

## 📌 1. Resumen Ejecutivo del Proyecto

* **Nombre del Proyecto:** DeepSeek AI Autonomous CryptoTrader & TradFi Hub
* **Propósito:** Plataforma algorítmica y autónoma de trading en **Binance Futures** y **TradFi Perpetuals** (Acciones de Wall Street como Tesla, Nvidia, Apple, S&P 500) impulsada por modelos de inteligencia artificial cuantitativa (**DeepSeek-V3 / DeepSeek-R1**), orientada a la gestión inteligente de un portafolio de **$1,000 USDT** con el objetivo de acumular **+$10.00 USD de ganancia neta** mediante micro-operaciones de alta probabilidad, operando al **100% con capital propio (1x Spot / Sin apalancamiento)** y preservación estricta de capital.
* **Modos de Operación:** 
  1. `paper` (Simulación de alta fidelidad con base de datos relacional SQLite, PnL flotante en tiempo real, Take Profit, Stop Loss y Trailing Stop autónomo).
  2. `real` (Ejecución directa en Binance Futures mediante API REST firmada HMAC-SHA256).
* **Stack Tecnológico:**
  * **Backend:** Node.js (v24+), Express, WebSockets (`ws`), SQLite3 (`cryptotrader.db`), Axios, TechnicalIndicators (RSI, MACD, EMA, Bollinger Bands, ATR), Node-Cron.
  * **IA Cuantitativa:** DeepSeek API (`deepseek-chat`, `deepseek-reasoner`).
  * **Frontend / PWA:** Single Page Application (SPA) móvil y de escritorio con Tailwind CSS, Lucide Icons, Service Worker (`sw.js`), WebSockets reactivos bidireccionales y barra de navegación inferior con 4 módulos.
  * **Infraestructura Cloud / VPS:** Docker, Docker Compose, PM2 (`ecosystem.config.js`), script de despliegue en 1 clic (`deploy-vps.sh`).

---

## 🗓️ 2. Historial Cronológico de Desarrollo y Fases

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     FASE 1-3    │ ──► │     FASE 4-5    │ ──► │     FASE 6-8    │ ──► │    FASE 9-12    │
│ Arquitectura,   │     │ Scalping Meta   │     │ Web App Móvil,  │     │ TradFi Stocks,  │
│ Precisión Sub¢  │     │ $10 & Trailing  │     │ SQLite & 1x Spot│     │ Multi-Asset     │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 🔹 Fase 1: Arquitectura Base y Conexiones en Vivo
* Implementación del servidor HTTP y WebSocket en Node.js.
* Conexión con los endpoints públicos de Binance Futures (`https://fapi.binance.com` y `wss://fstream.binance.com`).
* Creación del motor `paperTradingEngine.js` con balance inicial de $1,000 USDT y margen aislado.
* Integración con la API de DeepSeek para generación de análisis técnicos estructurados en JSON.
* Creación del bot de alertas por Telegram (`telegramService.js`).

### 🔹 Fase 2: Diagnóstico y Resolución de Precisión en Monedas Sub-centavo (`1000PEPEUSDT`)
* Corrección de redondeos que truncaban activos de valor menor a $0.01 a `$0.00`.
* Creación de `formatPricePrecision()` con soporte dinámico de hasta **8 decimales**.

### 🔹 Fase 3: Transformación a Terminal Puro de IA (Sin Gráfica Pesada)
* Enfoque del diseño en decisiones de la IA, gestión de riesgo y rendimiento del portafolio.

### 🔹 Fase 4: Micro-Scalping para la Meta Global de $10 USD
* Ajuste de tamaño de orden a **$50 USDT de capital (5% del balance)** por operación.
* Barra de progreso de ganancia acumulada en el encabezado.

### 🔹 Fase 5: Trailing Stop y Poller de Precios de Alta Frecuencia
* Integración de **Trailing Stop protector**: Al alcanzar ganancias técnicas, el Stop Loss sube a Break-Even (+0.1%) para blindar el beneficio.

---

### 🚀 Nuevas Fases Implementadas:

### 🔹 Fase 6: Transformación a Web App Móvil PWA con 4 Módulos
* **Requerimiento:** Crear una interfaz táctil optimizada 100% para smartphones, limpia, con barra de navegación inferior.
* **Solución Implementada:**
  1. **Módulo 1: Operaciones (`#view-trades`)**: Equity total, meta de ganancia, radar de mercado, operaciones activas con PnL dinámico y switch Auto-IA.
  2. **Módulo 2: Alertas (`#view-alerts`)**: Señales de DeepSeek en vivo, medidor de confianza, razonamiento técnico y registro de eventos.
  3. **Módulo 3: Historial (`#view-history`)**: Lista de trades cerrados con ribbon de rendimiento (Win rate %, Ganancia neta, Total trades).
  4. **Módulo 4: Ajustes (`#view-settings`)**: Configuración completa en la app (API Key DeepSeek, modelo IA, apalancamiento, límite de operaciones y Telegram).
  5. **Soporte PWA:** `manifest.json`, Service Worker (`sw.js`), iconos táctiles y meta-tags para iOS/Android.
  6. **Despliegue VPS:** Creación de `Dockerfile`, `docker-compose.yml`, `ecosystem.config.js` y `deploy-vps.sh` (instalador para Ubuntu/Debian).

### 🔹 Fase 7: Base de Datos Relacional SQLite (`cryptotrader.db`)
* **Solución Implementada:**
  * Reemplazo del almacenamiento JSON temporal por persistencia relacional en SQLite3 (`server/db.js`).
  * Tablas creadas: `wallet`, `positions`, `trade_history`, `system_logs`.
  * Persistencia segura del historial de operaciones, balances y posiciones ante reinicios o cortes de energía.

### 🔹 Fase 8: Transición a Modo 1x (100% Dinero Propio / Sin Apalancamiento)
* **Requerimiento:** Operar sin apalancamiento ni dinero prestado del exchange.
* **Solución Implementada:**
  * Configuración por defecto a **`1x` (Modo Spot Seguro)** en [`server/config.js`](file:///C:/Users/elsic/Desktop/critop/server/config.js).
  * Si el balance es $1,000 USDT y se invierten $50 USDT, se compran **exactamente $50.00 USD de criptoactivo**.
  * **Cero riesgo de liquidación (`liquidationPrice = 0.0`)** y cero comisiones por financiamiento.
  * Tarjetas de operación transparentes que indican: `100% Capital Propio`, inversión exacta y cantidad de monedas compradas.

### 🔹 Fase 9: Radar Autónomo de Nuevas Monedas & Trending en Binance
* **Solución Implementada:**
  * Integración de `fetchTopTrendingPairs()` para consultar el mercado de Binance Futures en tiempo real.
  * Detección de monedas con mayor volumen y volatilidad (altcoins en auge como `SUI`, `NEAR`, `RENDER`, `FET`, `SKR`, `HEMI`, `MAGMA`, `PEPE`, etc.).
  * Barra de píldoras horizontal interactiva para escanear cualquier activo con 1 toque.

### 🔹 Fase 10: Integración de Acciones de Wall Street (TradFi Perpetuals en Binance)
* **Solución Implementada:**
  * Integración de los contratos oficiales de **TradFi Perpetuals** disponibles en Binance:
    * `TSLAUSDT` (Tesla), `NVDAUSDT` (NVIDIA), `AAPLUSDT` (Apple), `SPYUSDT` (S&P 500), `QQQUSDT` (Nasdaq 100), `AMZNUSDT` (Amazon), `METAUSDT` (Meta), `MSFTUSDT` (Microsoft), `AMDUSDT` (AMD), `COINUSDT` (Coinbase), `MSTRUSDT` (MicroStrategy).
  * Selector en la app móvil entre **🔥 Criptos** y **🏛️ Acciones**.
  * DeepSeek IA analiza gráficos de acciones y opera con $50 USDT a 1x con total seguridad.

### 🔹 Fase 11: Capacidad de Operaciones Simultáneas Ampliada & Corrección de Streaming de Precios
* **Problema Detectado:** Las monedas descubiertas por el radar (`MAGMA`, `SKR`, `NVDA`, `AAPL`, `SPY`) se quedaban en `$0.00` de PnL flotante.
* **Causa Raíz:** El poller de alta frecuencia filtraba únicamente las 7 monedas iniciales de la lista fija.
* **Solución Implementada:**
  * Modificación de `fetchAllPrices` y el poller del servidor para rastrear dinámicamente el **100% de las posiciones abiertas y activos vigilados**.
  * Al activarse los precios en vivo, `MAGMAUSDT` alcanzó su Take Profit cerrando automáticamente con **+$14.54 USDT de ganancia**.
  * Se amplió la capacidad de operaciones simultáneas de 2 a **6 por defecto**, configurable de 1 a 30 desde Ajustes.

### 🔹 Fase 12: Filtros y Ordenamiento Interactivo en Tiempo Real
* **En Operaciones Activas:** Píldoras de ordenamiento táctil:
  * `🕒 Recientes` | `🟢 + Ganancia` | `🔴 - Pérdida` | `🪙 Criptos` | `🏛️ Acciones`.
* **En Historial:** Filtros por categoría de resultado:
  * `Todos` | `🟢 Ganadoras` | `🔴 Pérdidas` | `💰 Mayor PnL`.

---

## 🏗️ 3. Arquitectura del Repositorio

```
├── server/
│   ├── server.js              # Servidor Express, WebSockets y sincronización multi-activo
│   ├── db.js                  # Conector y esquema SQLite3 (wallet, positions, trade_history)
│   ├── config.js              # Parámetros de riesgo, escaneo y persistencia JSON
│   ├── binanceService.js      # Conexión REST/WS Binance (Criptos + TradFi Stocks)
│   ├── deepseekService.js     # Cliente API de DeepSeek (V3 y R1) con prompt técnico
│   ├── indicators.js          # Indicadores matemáticos (RSI, MACD, EMAs, Bollinger, ATR)
│   ├── paperTradingEngine.js  # Motor simulado respaldado en SQLite (1x spot, TP/SL, Trailing)
│   ├── autoTrader.js          # Agente autónomo de escaneo multi-mercado programado
│   └── telegramService.js     # Notificaciones en tiempo real a Telegram
├── public/
│   ├── index.html             # App móvil con 4 módulos y filtros interactivos
│   ├── style.css              # Estilos glassmorphism y diseño responsive móvil
│   ├── app.js                 # Lógica de navegación, WebSockets y renderizado reactivo
│   ├── manifest.json          # Manifiesto PWA para instalación como app nativa
│   ├── sw.js                  # Service Worker PWA para caché y soporte offline
│   └── icon.svg               # Icono vectorial de la aplicación
├── data/                      # Base de datos SQLite y config (ignorado en Git)
│   ├── cryptotrader.db        # Base de datos relacional SQLite
│   └── config.json            # Configuración persistente
├── Dockerfile                 # Contenedor Docker para despliegue en la nube
├── docker-compose.yml         # Orquestación Docker Compose
├── ecosystem.config.js        # Configuración de procesos PM2 para VPS
├── deploy-vps.sh              # Script bash de instalación en 1 clic para Ubuntu/Debian
├── .env.example               # Plantilla de variables de entorno
└── package.json               # Dependencias de Node.js
```

---

## 🎯 4. Parámetros de Gestión de Riesgo

| Parámetro | Valor Actual | Descripción |
|---|---|---|
| **Balance Base** | `$1,000.00 USDT` | Capital gestionado |
| **Meta Global de Ganancia** | `+$10.00 USDT` | Objetivo de la sesión |
| **Margen por Operación** | `$50.00 USDT (5%)` | 95% del balance en reserva intocable |
| **Modo de Apalancamiento** | `1x (Dinero Propio / Spot)` | Sin multiplicadores ni riesgo de liquidación |
| **Precio de Liquidación** | `$0.00 (Inexistente)` | Imposible de liquidar al no existir deuda |
| **Operaciones Simultáneas** | `6 (Configurable 1-30)` | Diversificación controlada |
| **Mercados Admitidos** | Criptos + Acciones TradFi | BTC, ETH, SOL, Altcoins + TSLA, NVDA, AAPL, SPY, QQQ |
| **Trailing Stop** | `>= +$1.50 USDT` | Sube Stop Loss a precio de entrada (+0.1%) |
| **Take Profit Base** | `1.5%` | Ganancia real sobre los $50 USD invertidos |
| **Stop Loss Base** | `0.8%` | Salida preventiva de bajo impacto |
| **Umbral de Confianza IA** | `≥ 68%` | Solo entra si hay confluencia técnica estricta |

---

## 🚀 5. Despliegue en VPS (Ubuntu / Debian)

Para desplegar la aplicación en tu servidor VPS con PM2:

```bash
# 1. Clonar el repositorio
git clone https://github.com/hancellpos-ctrl/deepseek-cryptotrader-ai.git
cd deepseek-cryptotrader-ai

# 2. Dar permisos y ejecutar el script de instalación
chmod +x deploy-vps.sh
./deploy-vps.sh
```

---

*Bitácora técnica actualizada al 31 de Agosto de 2026.*
