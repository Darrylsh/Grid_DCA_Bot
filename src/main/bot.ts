// bot.ts — Grid DCA Bot Engine (Re-export hub for backward compatibility)
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config({ path: path.join(__dirname, '../../.env') })

// ---------------------------------------------------------------------------
// Import Bot Core Orchestration Functions
// ---------------------------------------------------------------------------
import {
  reloadWhitelist,
  updateSettingsLocally,
  getUnrealizedPnl,
  getFullGridState,
  deleteBaseShareLocally,
  wipeAllDataLocally,
  executeManualTrade,
  getCurrentMode,
  reloadDecoupledList,
  toggleBotManualMode,
  startBot
} from './bot-core'

// ---------------------------------------------------------------------------
// Import other module exports needed for IPC compatibility
// ---------------------------------------------------------------------------
import {
  executeGridBuy,
  handleGridSellFill,
  processTick,
  clearGridLevels,
  sellLowestGridLevel,
  togglePause
} from './grid-engine'

import { registerBaseShare, sellBaseShare } from './trade-executor'

import {
  binanceRestRequest,
  startUserDataStream,
  startOrderPolling,
  startWatchdog,
  connectWebSocket
} from './websocket-manager'

import { botEvents } from './bot-events'

// ---------------------------------------------------------------------------
// Re-export all public functions for backward compatibility
// ---------------------------------------------------------------------------
export {
  // From bot-core
  reloadWhitelist,
  updateSettingsLocally,
  getUnrealizedPnl,
  getFullGridState,
  deleteBaseShareLocally,
  wipeAllDataLocally,
  executeManualTrade,
  getCurrentMode,
  reloadDecoupledList,
  toggleBotManualMode,
  startBot,
  // From grid-engine
  executeGridBuy,
  handleGridSellFill,
  processTick,
  clearGridLevels,
  sellLowestGridLevel,
  togglePause,
  // From trade-executor
  registerBaseShare,
  sellBaseShare,
  // From websocket-manager
  binanceRestRequest,
  startUserDataStream,
  startOrderPolling,
  startWatchdog,
  connectWebSocket,
  // From bot-events
  botEvents
}
