// ---------------------------------------------------------------------------
// Settings Manager for Grid DCA Bot
// ---------------------------------------------------------------------------

// Default settings
const defaultSettings: Record<string, string> = {
  trading_mode: 'LIVE',
  capital_type: 'FIXED',
  capital_value: '100',
  grid_step_percent: '3',
  max_grid_levels: '10',
  dynamic_grid_enabled: 'false',
  momentum_window: '10',
  momentum_threshold_pct: '-0.5',
  rebound_threshold_pct: '0.25',
  dynamic_mode_timeout_min: '30'
}

// Current settings state
let currentSettings: Record<string, string> = { ...defaultSettings }
let currentMode = 'LIVE'
let currentWhitelist: string[] = []

/**
 * Update settings locally and handle mode changes
 */
export const updateSettingsLocally = (newSettings: Record<string, string>): void => {
  const oldMode = currentMode
  Object.assign(currentSettings, newSettings)
  currentMode = currentSettings.trading_mode || 'LIVE'

  if (oldMode !== currentMode) {
    console.log(`[BOT] Trading mode switched to: ${currentMode}`)
    // Note: Mode change handling should be done by the caller (bot-core)
  }
}

/**
 * Get current trading mode
 */
export const getCurrentMode = (): string => currentMode

/**
 * Get current whitelist
 */
export const getCurrentWhitelist = (): string[] => currentWhitelist

/**
 * Set current whitelist
 */
export const setCurrentWhitelist = (whitelist: string[]): void => {
  currentWhitelist = whitelist
}

/**
 * Get a specific setting value
 */
export const getSetting = (key: string): string => currentSettings[key] || ''

/**
 * Get all current settings
 */
export const getAllSettings = (): Record<string, string> => ({ ...currentSettings })

// ---------------------------------------------------------------------------
// Setting Getters with Type Safety
// ---------------------------------------------------------------------------

export const getGridStep = (): number => {
  const step = parseFloat(currentSettings.grid_step_percent || '3')
  return isNaN(step) || step <= 0 ? 3 : step
}

export const getTrailingStopLevels = (): number => {
  const v = parseInt(currentSettings.trailing_stop_levels || '3')
  return isNaN(v) || v <= 0 ? 3 : v
}

export const getTrailingStopPct = (): number => {
  const frac = parseFloat(currentSettings.trailing_stop_pct || '0.5')
  return (getGridStep() * (isNaN(frac) || frac <= 0 ? 0.5 : frac)) / 100
}

export const getMaxGridLevels = (): number => {
  const v = parseInt(currentSettings.max_grid_levels || '10')
  return isNaN(v) || v <= 0 ? 10 : v
}

export const getShareAmount = (): number => {
  const val = parseFloat(currentSettings.capital_value || '100')
  return isNaN(val) || val <= 0 ? 100 : val
}

export const getDynamicGridEnabled = (): boolean => {
  const val = currentSettings.dynamic_grid_enabled || 'false'
  return val.toLowerCase() === 'true'
}

export const getMomentumWindow = (): number => {
  const v = parseInt(currentSettings.momentum_window || '10')
  return isNaN(v) || v <= 0 ? 10 : v
}

export const getMomentumThresholdPct = (): number => {
  const v = parseFloat(currentSettings.momentum_threshold_pct || '-0.5')
  return isNaN(v) || v >= 0 ? -0.5 : v // Must be negative
}

export const getReboundThresholdPct = (): number => {
  const v = parseFloat(currentSettings.rebound_threshold_pct || '0.25')
  return isNaN(v) || v <= 0 ? 0.25 : v
}

export const getDynamicModeTimeoutMs = (): number => {
  const minutes = parseInt(currentSettings.dynamic_mode_timeout_min || '30')
  const safeMinutes = isNaN(minutes) || minutes <= 0 ? 30 : minutes
  return safeMinutes * 60 * 1000
}
