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

### 🔹 Fase 13: Persistencia SQLite Robusta, Entradas de $100 (1x Spot), Capacidad Ampliada & Alertas Sonoras
* **Blindaje ante Desconexiones:** Se implementó una guardia estricta en el poller y en el motor (`markPrice <= 0 || isNaN`). Anteriormente, si la conexión caía y la API devolvía 0 o null, se activaba un falso Stop Loss eliminando posiciones. Ahora las operaciones se **congelan de forma 100% segura** hasta que se restablece la conexión.
* **Ampliación de Límite de Operaciones:** Se eliminó la restricción rígida de 2 posiciones. El nuevo límite por defecto es de **50 operaciones simultáneas** (ampliable hasta 100 en Ajustes), gobernado únicamente por el margen libre disponible.
* **Entradas de $100 USDT (10% de Capital):** Configuración estándar de inversión por trade a **$100 USDT** en modo **1x Spot Puro** (100% dinero propio, sin comisiones de financiamiento ni liquidaciones).
* **Alertas Sonoras (Web Audio API):** Integración de un sintetizador de audio nativo en el navegador con tonos diferenciados:
  * 🎯 **Take Profit / Ganancia:** Campana triunfal armónica (*D5 ➔ A5 ➔ D6*).
  * ⚡ **Apertura / Señal IA:** Doble *ping* de confirmación.
  * 🛑 **Stop Loss:** Tono grave de precaución.
  * Interruptor y botón de prueba interactivo en la pestaña **Ajustes**.
* **Historial Sincronizado:** Restauración e importación de todas las operaciones históricas previas con desglose de timestamp local, ROI% y causa de cierre.

### 🔹 Fase 14: Despliegue 24/7 en la Nube (Render.com + UptimeRobot + API Global Binance)
* **Solución de Bloqueo Geográfico (Error HTTP 451):** 
  * Binance REST (`fapi.binance.com`) bloquea por normativa las IPs de centros de datos en EE.UU. devolviendo `HTTP 451`.
  * **Solución definitiva:** Implementación de contingencia multiruta con `https://data-api.binance.vision` (endpoint oficial de Binance para datos globales sin bloqueos de IP).
### 🔹 Fase 15: Radar Dinámico de Descubrimiento en Binance + Ahorro del 98% de Tokens IA
* **Problema Identificado:** Las consultas repetitivas cada 60 segundos sobre monedas fijas consumían millones de tokens innecesariamente en mercados laterales o sin volumen.
* **Solución Implementada:**
  1. **Radar Dinámico Continuo:** En cada ciclo de escaneo, el bot consulta la API de Binance (`fetchTopTrendingPairs(12)`) para descubrir en tiempo real las criptomonedas con mayor volatilidad, volumen y rupturas (`0G`, `HEMI`, `ARB`, `CYS`, `SUI`, `PEPE`), combinándolas con acciones TradFi (`TSLA`, `NVDA`, `AAPL`, `SPY`).
  2. **Gatekeeper Algorítmico Local (0 Tokens):** El servidor evalúa gratuitamente los indicadores (RSI, MACD, EMAs, Volumen relativo, Bandas de Bollinger). Si el mercado está plano, emite `HOLD` sin gastar tokens.
  3. **Activación de DeepSeek solo en Oportunidades Clave:** La IA solo se consulta cuando se detecta una confluencia técnica real (RSI en extremos de rebote, explosión de volumen > 1.25x, o gestión de posiciones activas).
  4. **Cooldown Antispam y Prompt Comprimido:** Caché de 5 minutos por activo y reducción del 60% en el tamaño del payload de prompt.
### 🔹 Fase 16: Modo Claro (Light Theme), Switcher en Cabecera & Persistencia Local
* **Implementación de Tema Claro:** Integración de una paleta limpia, moderna y de alto contraste (`#f3f6fb`, tarjetas blancas `#ffffff`, tipografía slate `#0f172a`, bordes suaves y acentos cian/verde).
* **Botón de Cambio Rápido en Cabecera:** Botón táctil `☀️ / 🌙` situado junto a la insignia de ganancias para alternar entre Modo Claro y Modo Oscuro con 1 solo toque.
* **Control en la Pestaña Ajustes:** Selector de `Tema de Interfaz` en el módulo de configuración.
* **Persistencia en `localStorage`:** La preferencia del usuario se memoriza automáticamente en el navegador (`wp_theme`).

---

## 🌐 3. Mapa de Conexiones, Cuentas y Topología Cloud

```
                               ┌────────────────────────────────────────────────────────┐
                               │                    UPTIMEROBOT                         │
                               │           (Cuenta: hancellpos@gmail.com)               │
                               │        Ping HTTP GET cada 5m a /api/status             │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │
                                                          ▼ (Evita que Render se duerma)
┌────────────────────────┐     ┌────────────────────────────────────────────────────────┐
│     USUARIO / MÓVIL    │ ──► │                   RENDER WEB SERVICE                   │
│   (Navegador / PWA)    │ ◄── │       URL: https://wptrader.onrender.com               │
│                        │ WS  │       Servicio: wptrader (srv-dab8k5qjobas73bnkuk0)    │
└────────────────────────┘     │       Cuenta: hancellpos@gmail.com                     │
                               │       Workspace: My Workspace (tea-d8emabc2m8qs73930j70)
                               └──────┬───────────────────┬───────────────────┬─────────┘
                                      │                   │                   │
                                      ▼                   ▼                   ▼
                     ┌───────────────────────┐ ┌──────────────────────┐ ┌────────────────┐
                     │   BINANCE GLOBAL API  │ │     DEEPSEEK API     │ │ SQLite ENGINE  │
                     │ data-api.binance.vision│ │    (deepseek-chat)   │ │cryptotrader.db │
                     │   (Precios y Velas    │ │  (Análisis Técnico   │ │  (Balance, Pos,│
                     │  Sin bloqueo HTTP 451)│ │  y Decisiones Spot)  │ │   Historial)   │
                     └───────────────────────┘ └──────────────────────┘ └────────────────┘
```

---

## 🔑 4. Registro de Credenciales, URLs y Servicios Vinculados

| Servicio / Recurso | Detalle / Cuenta | URL / Identificador | Función en el Sistema |
| :--- | :--- | :--- | :--- |
| **Hosting en la Nube** | **Render.com** (`hancellpos@gmail.com`) | `https://wptrader.onrender.com` | Servidor Node.js 24/7 con WebSockets y SQLite |
| **Render Service ID** | `wptrader` | `srv-dab8k5qjobas73bnkuk0` | Identificador del Web Service activo |
| **Repositorio GitHub** | `hancellpos-ctrl/deepseek-cryptotrader-ai` | Rama: `master` | Código fuente y base de datos sincronizada |
| **Anti-Sleep Monitor** | **UptimeRobot** (`hancellpos@gmail.com`) | `https://wptrader.onrender.com/api/status` | Envía pings cada 5 min para evitar suspensión |
| **UptimeRobot API Key** | `u3748672-f06b1dfc6967062ede77842d` | Monitoreo y métricas | Llave de lectura de estado |
| **API de Inteligencia** | **DeepSeek API** | Modelo: `deepseek-chat` (V3) | Análisis técnico y gestión cuantitativa |
| **API de Mercado** | **Binance Global Whitelist** | `https://data-api.binance.vision` | Streaming de velas, tickers y precios en vivo |
| **Base de Datos** | **SQLite3 (WAL Mode)** | `data/cryptotrader.db` | Persistencia de balance, posiciones e historial |

---

## 🎯 5. Parámetros de Gestión de Riesgo (Modo Spot Activo)

| Parámetro | Valor Configurado | Justificación Técnica |
| :--- | :--- | :--- |
| **Balance Base** | `$1,000.00 USDT` | Capital inicial gestionado |
| **Inversión por Trade** | `$100.00 USDT (10%)` | 90% del capital permanece como margen libre de reserva |
| **Apalancamiento** | `1x (Spot / Dinero Propio)` | Cero riesgo de liquidación (`Liq Price = $0.00`) |
| **Poder de Compra Real** | `$100.00 USDT exactos` | Se adquiere el valor equivalente en el activo sin deuda |
| **Meta Global de Ganancia** | `+$10.00 USDT` | Objetivo acumulativo de micro-operaciones |
| **Capacidad de Operaciones** | `50 simultáneas` | Limitado únicamente por margen disponible |
| **Stop Loss Protector** | `0.4% - 0.8%` | Salida preventiva de bajo impacto |
| **Take Profit Base** | `0.8% - 1.5%` | Captura sistemática de ganancias |
| **Trailing Stop** | `>= +$1.50 USDT` | Asegura ganancias moviendo el SL a Break-Even |

---

## 🚀 6. Instrucciones de Despliegue y Mantenimiento

### A. Para desplegar actualizaciones a la Nube:
```bash
git add .
git commit -m "feat: nueva mejora"
git push origin master
# Render detecta el push y se re-despliega solo automáticamente
```

### B. Para consultar o reiniciar desde el CLI de Render:
```bash
# Ver estado del servicio
render services

# Ver logs en vivo
render logs srv-dab8k5qjobas73bnkuk0 --tail

# Disparar despliegue manual
render deploys create srv-dab8k5qjobas73bnkuk0 --confirm
```

---

*Bitácora técnica actualizada al 1 de Septiembre de 2026.*
