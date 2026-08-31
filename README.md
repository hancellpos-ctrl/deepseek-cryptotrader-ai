# 🚀 DeepSeek CryptoTrader AI (Binance Futures & Paper Trading)

Una plataforma completa de trading algorítmico y autónomo para futuros de criptomonedas, impulsada por **DeepSeek AI (V3 / R1)** y streaming en tiempo real de **Binance Futures**.

---

## 🌟 Características Principales

1. **🤖 Modo 100% Autónomo con DeepSeek AI**:
   * Escaneo continuo y ejecución autónoma en pares principales (`BTC`, `ETH`, `SOL`, `BNB`, `DOGE`, `XRP`, `1000PEPE`).
   * La IA analiza confluencia técnica en tiempo real (EMAs 9/21/50, RSI 14, MACD, Bandas de Bollinger, ATR y Volumen) y decide de forma independiente **cuándo abrir, mantener o cerrar posiciones**.

2. **🎯 Estrategia de Meta Global ($10.00 USD Acumulados)**:
   * Diseñado para llevar una cuenta de **$1,000.00 a $1,010.00 USDT** mediante micro-operaciones seguras.
   * Asignación prudente de capital: solo **$50 USDT (5%)** de margen por trade con apalancamiento 10x ($500 valor nocional).
   * **Preservación de Capital:** Máximo 2 operaciones simultáneas, manteniendo **más de $900 USDT (90-95%) 100% seguros en reserva**.

3. **🛡️ Criterios Inteligentes de Cierre y Trailing Stop**:
   * **Take Profit Dinámico:** Captura rápida de ganancias calculadas según el ATR y zonas de soporte/resistencia.
   * **Trailing Stop / Break-Even:** Al ganar ≥ +$2.00 USDT, el Stop Loss se eleva automáticamente al precio de entrada (+0.1%) para blindar la ganancia.
   * **Decisión Autónoma de Cierre:** Si DeepSeek detecta agotamiento de tendencia o divergencias, emite la orden `CLOSE_POSITION` para embolsar la ganancia actual.
   * **Stop Loss Protector:** Riesgo limitado a aprox. -$1.50 a -$2.00 USDT por trade (ratio >1.8:1).

4. **🧪 Simulador de Futuros en Tiempo Real (Paper Trading)**:
   * Billetera virtual de $1,000 USDT con cálculo exacto de PnL no realizado, ROI %, márgenes aislados, precios de liquidación y comisiones.
   * Soporte completo de criptomonedas fraccionarias y meme coins como **PEPE (`1000PEPEUSDT`)** con precisión de hasta 8 decimales.

5. **📱 Alertas en Vivo por Telegram y Modo Real de Binance**:
   * Envío instantáneo de señales, aperturas y cierres al móvil.
   * Alternancia con un clic hacia ejecución real en Binance Futures mediante API Keys firmadas.

---

## 📋 Bitácora del Proyecto

Consulta la [BITACORA.md](BITACORA.md) para conocer el registro cronológico completo, la arquitectura técnica detallada, las pruebas de precisión y las decisiones de diseño del sistema.

---

## 🚀 Inicio Rápido

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar el entorno:**
   * Copia `.env.example` a `.env`:
     ```bash
     cp .env.example .env
     ```
   * Agrega tu API Key de DeepSeek (`sk-...`).

3. **Iniciar el servidor:**
   ```bash
   npm start
   ```

4. **Abrir en tu navegador:**
   ```
   http://localhost:3000
   ```

---

## 📁 Estructura del Proyecto

```
├── BITACORA.md               # Bitácora detallada y registro de arquitectura
├── README.md                 # Guía general de uso
├── package.json              # Configuración y dependencias de Node.js
├── .env.example              # Plantilla de variables de entorno
├── .gitignore                # Exclusión de archivos sensibles
├── server/
│   ├── server.js             # Servidor Express, WebSockets y poller de alta frecuencia
│   ├── config.js             # Parámetros de la estrategia y configuración persistente
│   ├── binanceService.js     # Datos de mercado REST y WebSockets de Binance Futures
│   ├── indicators.js         # Indicadores técnicos (EMA, RSI, MACD, Bollinger, ATR)
│   ├── deepseekService.js    # Inteligencia Artificial y prompts cuantitativos
│   ├── paperTradingEngine.js # Motor de futuros simulados, PnL y Trailing Stop
│   ├── autoTrader.js         # Loop de escaneo y trading autónomo
│   └── telegramService.js    # Notificaciones automáticas a Telegram
└── public/
    ├── index.html            # Dashboard web moderno con barra de meta global
    ├── style.css             # Estilos y efectos del terminal de trading
    └── app.js                # Lógica reactiva de la interfaz (WebSockets & Audio)
```
