# Algobot Architecture & Deployment Guide

**Created:** April 2026
**Target Audience:** Future AI coding sessions / Antigravity Agent Context

**Note:** For AI agent development rules and versioning protocols, see [AGENTS.md](./AGENTS.md)

## 1. Top-Level System Topology

The Algobot application was recently decoupled from a monolithic desktop utility into a scalable headless architecture:

- **Electron Frontend (Stateless Dashboard):** Runs on the user's local Windows OS (`algobot-desktop`). It has been completely stripped of its database and exchange logic. It functions strictly as a UI dashboard parsing incoming socket events.
- **Headless Backend Engine (Remote):** Runs autonomously on an Ubuntu Server (`192.168.10.42`). It executes trades, processes Binance WebSocket feeds, and acts as the sole source of truth natively.
- **Database (PostgreSQL):** Running remote alongside the headless engine (`Host: 192.168.10.42:5432`, `DB: Gridbot`). Migrated from local SQLite to support concurrent headless read/writes. Handled via `drizzle-orm`.

---

## 2. Core Codebase Index

- **`src/main/index.ts` (Electron Main Process):**
  - Boots the `.asar` local desktop wrapper.
  - Initiates standard `socket.io-client` connection to `process.env.HEADLESS_SERVER_URL` (Defaults to `http://192.168.10.42:3030`).
  - Manages the bridge translation: Catches IPC requests from the React renderer and wraps them into `socketCall(event, ...args)` payloads to ship over LAN.
- **`src/preload/index.ts` (Electron Preload):**
  - Exposes `window.api` logic to React securely.
  - _Important State Fix:_ Implements `getConnectionStatus` to solve a race condition preventing React from recognizing active hooks when compiled to `.exe`.
- **`src/renderer/src/App.tsx` (React UI):**
  - The primary interface. Listens to `bot:marketUpdate` events.
  - Calculates server uptime using the remote metric `botStartTime` exported from the socket pulse.
- **`src/main/headless-server.ts` (Remote PM2 Entrypoint):**
  - Spins up `socket.io` on `0.0.0.0:3030`.
  - Imports and wires all of the engine's functionality from `bot.ts` and `db.ts`.
  - **CRITICAL PATTERN:** Handlers unpack trailing callbacks emitted from Electron's socket invocation using `const callback = args.pop(); const [arg1, arg2] = args;` to guarantee robust cross-matching.
- **`src/main/bot.ts` & `src/main/db.ts` (Algorithmic Logic):**
  - The core engine physics. They manage API limits, `GridState` iterations, and market processing execution.

---

## 3. Remote Deployment Procedure

Because the backend codebase still lives physically inside the `src/main` directory of the user's local Windows workspace, any backend modifications must be cross-compiled remotely to Ubuntu.

Whenever `bot.ts`, `db.ts`, or `headless-server.ts` are modified, follow exactly this procedure:

1.  **Validate Locally:**
    - Run `npm run typecheck` to ensure no Typescript mismatches.
2.  **SCP Transport:**
    - `scp src/main/bot.ts src/main/db.ts src/main/headless-server.ts darryl@192.168.10.42:/home/darryl/bots/gridbot/src/main/`
    - _WARNING:_ Do NOT push to `~/algobot-headless/`! The correct daemon resides in `~/bots/gridbot/`.
3.  **PM2 Daemon Reset:**
    - `ssh darryl@192.168.10.42 "cd /home/darryl/bots/gridbot && pm2 restart gridbot-headless"`
    - Verify the process reboot via `pm2 logs gridbot-headless --lines 10`.

---

## 4. Pending / Next Phase Objectives

Do not assume these modules are complete. In upcoming iterations, refer to these targets:

- **Remote Backtesting Migration:** `src/main/backtest.ts` is still executed completely natively. It needs to be retrofitted to compile its data on the backend to skip gigantic localized db fetching.
- **Drizzle Cleanups:** Some remaining PostgreSQL syntax residues / linting warnings persist across the schema mapping.
- **Audio Triggers:** `buy.mp3` and `sell.mp3` are currently fired contextually by the `App.tsx` loop.

---

> **Antigravity Rule:** _Do NOT edit the backend process while the PM2 engine is active doing live trades without clearing the event queue. If a patch fails compilation, it will orchestrate an `EADDRINUSE` crash on Port 3030._
