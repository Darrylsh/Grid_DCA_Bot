# Algobot Deployment Guide for AI Agents

This file contains deployment configuration and procedures for AI agents working on the Algobot project. Refer to this document for all deployment-related operations.

## Deployment Architecture

The Algobot uses a **two-component architecture**:

1. **Frontend (Electron App)**: Desktop application with React UI, runs on user's local machine
2. **Backend (Headless Server)**: Node.js server running on remote Ubuntu server, handles trading logic and database operations

## Configuration Extraction

Deployment details are stored in the `.env` file (DO NOT commit this file). To extract deployment information:

```bash
# Extract server URL (format: http://IP:PORT)
HEADLESS_SERVER_URL=$(grep HEADLESS_SERVER_URL .env | cut -d= -f2)

# Extract database host
DB_HOST=$(grep DB_HOST .env | cut -d= -f2)

# SSH username (inferred from HEADLESS_SERVER_URL or defaults to 'darryl')
SSH_USERNAME="darryl"

# Remote backend path (default location)
REMOTE_PATH="/home/darryl/bots/gridbot/"
```

## Backend Deployment Procedure

When modifying backend files (`bot.ts`, `db.ts`, `headless-server.ts`), follow this procedure:

### 1. Validate Locally

```bash
npm run typecheck
```

### 2. Deploy to Remote Server

```bash
# Extract server IP from HEADLESS_SERVER_URL
SERVER_IP=$(echo $HEADLESS_SERVER_URL | sed 's|http://||' | sed 's|:3030||')

# Copy modified backend files
scp src/main/bot.ts src/main/db.ts src/main/headless-server.ts \
    $SSH_USERNAME@$SERVER_IP:$REMOTE_PATH/src/main/
```

### 3. Restart Headless Server

```bash
ssh $SSH_USERNAME@$SERVER_IP "cd $REMOTE_PATH && pm2 restart gridbot-headless"
```

### 4. Verify Deployment

```bash
ssh $SSH_USERNAME@$SERVER_IP "cd $REMOTE_PATH && pm2 logs gridbot-headless --lines 10"
```

## Frontend Deployment (Electron)

When modifying frontend files or `src/main/index.ts` (which contains `SERVER_URL`), rebuild the Electron app:

### 1. Version Bumping (if required)

```bash
# For feature changes affecting both frontend/backend
npm run version:ui:minor
npm run version:srv:minor

# Update expectedBackendVersion in package.json to match headless-server.ts
```

### 2. Rebuild Frontend

```bash
# Build for Windows
npm run build:win

# Or for development
npm run dev
```

### 3. Publish Release (optional)

```bash
# Requires GH_TOKEN in .env
npm run publish:win
```

## Critical Files & Paths

### Local Project Structure

- `.env` - Environment variables (contains `HEADLESS_SERVER_URL`, `DB_HOST`, API keys)
- `src/main/` - Backend source files
- `src/renderer/` - Frontend React components
- `src/main/index.ts` - Electron main process (contains `SERVER_URL` configuration)

### Remote Server Structure

- `/home/darryl/bots/gridbot/` - Backend installation
- `pm2 list` - Shows running processes including `gridbot-headless`

## Environment Variables Reference

Required `.env` variables for deployment:

```env
# Backend Server Configuration (required for deployment)
HEADLESS_SERVER_URL=http://YOUR_SERVER_IP:3030

# Database Configuration
DB_HOST=YOUR_DATABASE_HOST
DB_USER=trading_bot
DB_PASS=your_database_password
DB_NAME=Gridbot
DB_PORT=5432

# Binance API (required for LIVE trading)
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret

# CORS Configuration (optional)
CORS_ORIGIN=*
```

## `.env` File Location for Packaged Apps

The Electron app loads `.env` from different locations depending on the environment:

- **Development**: `[project-root]/.env` (same folder as package.json)
- **Production (Packaged)**: Searches in this order:
  1. **User Data Directory**: `[user-data-directory]/.env` (Electron's userData folder)
  2. **Executable Directory**: Same folder as the `.exe` file
  3. **Current Working Directory**: Where the app was launched from

### Finding the User Data Directory:

- **Windows**: `%APPDATA%\algobot-desktop\.env` (typically `C:\Users\[username]\AppData\Roaming\algobot-desktop\.env`)
- **macOS**: `~/Library/Application Support/algobot-desktop/.env`
- **Linux**: `~/.config/algobot-desktop/.env`

### For End Users:

1. After installing the app, create a `.env` file in **any** of the above locations
2. Copy the configuration from `.env.example` and fill in your values
3. Restart the application

The app will log the search process on startup with lines starting with `[ENV]`. The final loaded path will be shown.

## Security Considerations for Public Distribution

1. **No Hardcoded IPs**: All IP addresses must be in `.env` file only
2. **Default to localhost**: `src/main/index.ts` uses `localhost:3030` as fallback
3. **CORS Configuration**: Backend accepts configurable origins via `CORS_ORIGIN`
4. **Documentation Sanitization**: All docs use placeholders (`YOUR_SERVER_IP`, `YOUR_USERNAME`)

## Common Deployment Scenarios

### Scenario 1: Backend-Only Changes

- Modify `bot.ts`, `db.ts`, or `headless-server.ts`
- Run SCP deployment procedure
- Restart PM2 process

### Scenario 2: Frontend-Only Changes

- Modify React components or `src/main/index.ts`
- Rebuild Electron app with `npm run build:win`
- No backend restart needed

### Scenario 3: Full Stack Feature

- Bump versions with `npm run version:ui:minor` and `npm run version:srv:minor`
- Deploy backend changes
- Rebuild frontend
- Update `expectedBackendVersion` in package.json

## Troubleshooting

### PM2 Process Not Found

```bash
ssh $SSH_USERNAME@$SERVER_IP "cd $REMOTE_PATH && pm2 start src/main/headless-server.ts --name gridbot-headless"
```

### Connection Errors

- Verify `.env` contains correct `HEADLESS_SERVER_URL`
- Check SSH key authentication
- Ensure firewall allows port 3030

### Version Mismatch

- Frontend version in `package.json` must match `expectedBackendVersion`
- Backend version in `headless-server.ts` must match `expectedBackendVersion`

---

**Last Updated**: April 2026  
**AI Agent Reference**: Use this file for all deployment operations without asking user for configuration details.
