# Algobot Desktop (Electron)

Expert-level algorithmic trading bot for Binance by **Algobot**. This project is a high-performance desktop migration of the original Algobot web application, optimized for low-latency WebSocket processing and local data persistence via PostgreSQL.

## 🚀 Architecture Overview

Algobot Desktop follows a split-process architecture typical of Electron applications, with specialized logic layers for trading, data persistence, and UI.

### 1. Process Model

- **Main Process (`src/main/`)**: The "Engine room". Runs in a Node.js environment with full system access.
  - **Bot Logic (`bot.ts`)**: Manages the trading lifecycle, WebSocket streams, and real-time evaluation loops.
  - **Database (`db.ts`)**: Handles all PostgreSQL interactions using a connection pool.
  - **Algorithmic Strategies (`algos.ts`, `strategies/`)**: Contains modular strategy definitions (SNIPER, HUNT, BOX, etc.) and regime filtering logic.
  - **Backtesting (`backtest.ts`)**: A high-speed simulation engine that runs strategies against locally stored historical tick data.
- **Renderer Process (`src/renderer/`)**: The "Dashboard". Built with **React 19** and **Vite**.
  - Provides real-time visualization of market regimes, RSI, and trade logs.
  - Allows dynamic configuration of whitelists, strategies, and trading modes.
- **Preload Bridge (`src/preload/`)**: A secure IPC (Inter-Process Communication) layer that exposes a safe API to the renderer while keeping the main process isolated.

### 2. Core Features

- **Hybrid Trading Modes**: Switch seamlessly between **SIMULATION** (Paper Trading) and **LIVE** (Real Capital) via the UI.
- **Tick Recording Engine**: Buffers high-volume aggTrade data in memory and flushes in batches to PostgreSQL, enabling high-resolution backtesting without impacting trade execution performance.
- **Market Guard**: Implements a "Macro Regime" filter based on BTCUSDT to protect capital during broader market downturns.
- **Dynamic Capital Allocation**: Supports both fixed USDT amounts per trade and percentage-based equity sizing.
- **Profit Protection**: Sophisticated trailing stop-loss logic utilizing ATR multipliers and volatility-based thresholds.
- **Cost Averaging (DCA)**: Integrated logic to average down positions during specific dip-buy regimes.

### 3. Tech Stack

- **Runtime**: [Electron](https://www.electronjs.org/) (Node.js + Chromium)
- **Frontend**: React 19, Tailwind CSS, Lucide Icons
- **Build Tooling**: [electron-vite](https://electron-vite.org/), [electron-builder](https://www.electron.build/)
- **Exchange SDK**: [@binance/connector](https://github.com/binance/binance-connector-node)
- **Database**: PostgreSQL (v12+)

---

## 🛠️ Environment & Setup

### Prerequisites

- **Node.js**: v20 or newer
- **PostgreSQL**: A running instance (local or remote)
- **Binance API Keys**: Required for Live trading and high-resolution market info.

### 1. Configuration (`.env`)

Create a `.env` file in the root directory with the following variables:

```env
# Binance API (Required for LIVE mode)
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here

# PostgreSQL Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=algobot
```

### 2. Installation

```bash
npm install
```

### 3. Development

Starts the Electron app with HMR (Hot Module Replacement) for the renderer.

```bash
npm run dev
```

### 4. Production Build

Generates a standalone executable for your target platform.

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## 🛡️ Best Practices

- **API Security**: Never commit your `.env` file or hardcode keys. The project is pre-configured with `.gitignore`.
- **DB Performance**: For high-volume tick recording, ensure PostgreSQL is running on an SSD and look for BRIN index optimizations in `db.ts`.
- **Maintenance**: Use `npm run format` and `npm run lint` before submitting PRs to ensure code quality.
