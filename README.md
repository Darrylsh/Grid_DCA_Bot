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

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Then edit `.env` with your actual values:

```env
# Binance API (Permissions: Spot Trading, Read)
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret

# PostgreSQL Database Configuration
DB_USER=trading_bot
DB_PASS=your_database_password_here
DB_NAME=Gridbot
DB_HOST=your_database_host_here
DB_PORT=5432

# Backend Server Configuration
PORT=3030
HEADLESS_SERVER_URL=http://your_server_ip_here:3030
CORS_ORIGIN=*

# GitHub Token for Auto-Updater Publishing
# Required only for publishing new releases, not for regular use
# Permissions needed: "repo" scope
GH_TOKEN=your_github_token_here
```

**Note for Packaged Apps**: When using the packaged application (`.exe`), the `.env` file should be placed in the Electron user data directory:

- **Windows**: `%APPDATA%\algobot-desktop\.env`
- **macOS**: `~/Library/Application Support/algobot-desktop/.env`
- **Linux**: `~/.config/algobot-desktop/.env`

The application logs the exact path on startup. During development, `.env` should be in the project root.

## 🚀 Auto-Updater Setup

The application includes automatic update functionality using `electron-updater`. To enable this:

### For Users:

- Updates are automatically checked when you click "Check for Updates" in Settings
- The application connects to GitHub Releases for update detection
- No GitHub token is required for users to receive updates

### For Developers (Publishing New Releases):

**Helper Scripts:**

- `setup-token.bat` - Simple batch file for CMD users
- `scripts/setup-github-token.ps1` - Advanced PowerShell script with API testing

1. **Generate GitHub Token:**
   - Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Create token with "repo" scope (full control of private repositories)
   - Copy the token value

2. **Set Environment Variable:**

   ```bash
   # Using batch file (simple):
   .\setup-token.bat

   # Using PowerShell script (advanced with testing):
   .\scripts\setup-github-token.ps1 -Token "ghp_your_token_here"

   # Or manually (current session only):
   # CMD:
   set GH_TOKEN=your_token_here

   # PowerShell:
   $env:GH_TOKEN='your_token_here'

   # For permanent setup (requires admin):
   [System.Environment]::SetEnvironmentVariable('GH_TOKEN', 'your_token_here', [System.EnvironmentVariableTarget]::User)
   ```

3. **Publish Release:**

   ```bash
   # Bump version first
   npm run version:ui:minor

   # Build and publish
   npm run publish:win
   ```

4. **Publish Release:**

   ```bash
   # Bump version first
   npm run version:ui:minor

   # Build and publish
   npm run publish:win
   ```

## 🔒 Security Considerations

- **Environment Variables**: Never commit `.env` file. Ensure `.env` is in `.gitignore`. Use `.env.example` as template. For packaged apps, place `.env` in the Electron user data directory (see Configuration section).
- **Network Security**: The headless server runs on a private network by default. Exposing it to the internet without authentication could allow unauthorized control. Use firewall rules and consider implementing socket.io authentication if deploying in untrusted networks.
- **CORS Configuration**: Configure `CORS_ORIGIN` environment variable to restrict which origins can connect to the socket.io server. Default is `*` (allow all). For production, set to the exact origin of your frontend.
- **Database Credentials**: Use strong passwords and limit database access to trusted IPs.
- **Binance API Keys**: Use keys with minimal permissions (Spot Trading, Read). Never share your API secret.
- **Regular Updates**: Keep dependencies updated to address security vulnerabilities.

## 📜 Commands

- `npm install`: Install dependencies.
- `npm run dev`: Start the bot in development mode.
- `npm run build:win`: Generate a standalone Windows `.exe`.
- `npm run publish:win`: Build and publish Windows release to GitHub (requires GH_TOKEN).
- `npm run version:ui:minor`: Bump frontend version minor.
