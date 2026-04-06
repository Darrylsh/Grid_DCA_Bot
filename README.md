# Grid DCA Bot (Electron)

A premium, high-performance desktop trading bot for Binance by **Antigravity**. This project is a specialized **Grid Accumulation** engine designed for manual base share registration and automated grid-level trading.

## 🚀 Strategy Overview: Grid DCA

Unlike traditional signal-based bots, the **Grid DCA Bot** focuses on price accumulation and recovery:

1. **Base Share**: You manually buy and register an initial "Base Share" for any coin. This serves as your long-term reference.
2. **Upside**: When the price rises by your configured **Grid Step %** (default 3%), the reference price moves up to follow the trend. No trade is executed.
3. **Downside**: When the price drops by your **Grid Step %**, the bot automatically buys a new "Grid Level" share and immediately places a **GTC Limit Sell** at +3% above that level's buy price.
4. **Recovery**: As the price oscillates, individual grid levels sell for profit, while your base share remains as your core position.

## 🛠️ Tech Stack & Architecture

- **Electron Main Process**: High-priority Node.js engine for WebSocket streams and Binance REST API interaction.
- **React 19 Renderer**: Stunning, dark-mode dashboard with real-time PnL tracking and trade logs.
- **PostgreSQL Persistence**: Remote database for grid state, trade history, and candle caching.
- **Enhanced Connectivity**: 
  - Robust Binance US/Global auto-fallback logic.
  - Fail-safe **Order Polling** (60s interval) for fill detection if User Data Streams are restricted.
- **Integrated Backtester**: 1-minute OHLCV candle-based simulation engine with PostgreSQL caching for ultra-fast multi-month testing.

## ⚙️ Configuration (`.env`)

Create a `.env` file in the root directory:

```env
# Binance API (Permissions: Spot Trading, Read)
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
```

## 📜 Commands

- `npm install`: Install dependencies.
- `npm run dev`: Start the bot in development mode.
- `npm run build:win`: Generate a standalone Windows `.exe`.
