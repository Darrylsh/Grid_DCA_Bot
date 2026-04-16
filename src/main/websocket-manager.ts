// ---------------------------------------------------------------------------
// WebSocket Manager for Grid DCA Bot
// ---------------------------------------------------------------------------

import { WebsocketStream } from '@binance/connector'
import * as https from 'https'
import WebSocket from 'ws'
import { getApiKey, getApiSecret, getClient } from './exchange-client'
import { getWhitelist } from './db'
import { getGridState, getGridLevels } from './state-manager'
import { GridState, GridLevel } from './types'
import { processTick } from './grid-engine'
import { handleGridSellFill } from './grid-engine'
import { botEvents } from './bot-events'

// Host fallback configuration
const BINANCE_HOSTS = process.env['BINANCE_HOST']
  ? [process.env['BINANCE_HOST']]
  : ['api.binance.com', 'api.binance.us']
let activeHost = BINANCE_HOSTS[0]
console.log(`[WEBSOCKET] BINANCE_HOSTS: ${BINANCE_HOSTS.join(', ')}, activeHost: ${activeHost}`)

// WebSocket state
let wsClient: any = null
let streamGeneration = 0
let lastMessageTime = 0
let watchdogInterval: NodeJS.Timeout | null = null

// ---------------------------------------------------------------------------
// REST Request Helpers
// ---------------------------------------------------------------------------

/**
 * Simple unsigned request (userDataStream only needs API key, no signature)
 */
const binanceRestRequestToHost = (
  hostname: string,
  method: 'POST' | 'PUT' | 'DELETE',
  reqPath: string,
  params: Record<string, string> = {}
): Promise<any> => {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey()
    if (!apiKey) return reject(new Error('No API key'))

    const queryString = Object.keys(params).length ? new URLSearchParams(params).toString() : ''
    const fullPath = queryString ? `${reqPath}?${queryString}` : reqPath

    console.log(`[USER DATA STREAM] Using host ${hostname} for ${method} ${reqPath}`)

    const options = {
      hostname,
      port: 443,
      path: fullPath,
      method,
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': 0
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.msg || body}`))
          } else {
            resolve(parsed)
          }
        } catch {
          reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/**
 * Wrapper with host‑fallback logic for REST calls
 */
export const binanceRestRequest = async (
  method: 'POST' | 'PUT' | 'DELETE',
  reqPath: string,
  params: Record<string, string> = {}
): Promise<any> => {
  try {
    const result = await binanceRestRequestToHost(activeHost, method, reqPath, params)
    return result
  } catch (e: any) {
    // Trigger fallback on any 4xx error or HTML response (geo-block returns raw HTML 410)
    const isGeoBlocked =
      e.message.includes('410') ||
      e.message.includes('403') ||
      e.message.includes('Gone') ||
      e.message.includes('HTTP 4')
    const otherHost = BINANCE_HOSTS.find((h) => h !== activeHost)
    if (otherHost && isGeoBlocked) {
      console.log(
        `[USER DATA STREAM] ${activeHost} blocked (${e.message.substring(0, 60)}), trying ${otherHost}...`
      )
      const result = await binanceRestRequestToHost(otherHost, method, reqPath, params)
      activeHost = otherHost // Remember which one works
      console.log(`[USER DATA STREAM] Switched to ${activeHost}.`)
      return result
    }
    console.log(`[USER DATA STREAM] ${activeHost} failed with error: ${e.message}`)
    throw e
  }
}

// ---------------------------------------------------------------------------
// User Data Stream (order fill detection)
// ---------------------------------------------------------------------------

/**
 * Start user data stream for live order‑fill detection
 */
export const startUserDataStream = async (): Promise<void> => {
  const apiKey = getApiKey()
  const apiSecret = getApiSecret()
  if (!apiKey || !apiSecret) {
    console.log('[USER DATA STREAM] No API credentials — skipping. Fill detection disabled.')
    return
  }
  console.log(`[USER DATA STREAM] API key present (first 5 chars: ${apiKey.substring(0, 5)}...)`)

  let listenKey: string
  let udWs: WebSocket | null = null
  let reconnectTimeout: NodeJS.Timeout | null = null
  const isShuttingDown = false

  const connectWS = (key: string): void => {
    if (udWs) {
      try {
        udWs.terminate()
      } catch {
        /* ignore */
      }
    }
    const wsUrl = `wss://stream.binance.com:9443/ws/${key}`
    console.log(`[USER DATA STREAM] Connecting to ${wsUrl}`)
    udWs = new WebSocket(wsUrl)

    udWs.on('open', () => {
      console.log('[USER DATA STREAM] Connected. Watching for order fills...')
    })

    udWs.on('message', (raw: WebSocket.RawData) => {
      try {
        const event = JSON.parse(raw.toString())
        if (event.e === 'executionReport' && event.X === 'FILLED' && event.S === 'SELL') {
          const symbol: string = event.s
          const orderId: string = event.i?.toString()
          const fillPrice: number = parseFloat(event.L)
          const levels = getGridLevels(symbol) as GridLevel[] // TODO: import getGridLevels from state-manager
          const matchedLevel = levels.find((l) => l.binanceSellOrderId === orderId)
          if (matchedLevel) {
            console.log(`[USER DATA] Grid sell fill detected for ${symbol} — order ${orderId}`)
            handleGridSellFill(symbol, matchedLevel, fillPrice).catch(console.error)
          }
        }
      } catch {
        /* ignore */
      }
    })

    udWs.on('error', (err) => {
      console.error('[USER DATA STREAM] WebSocket error:', err.message)
    })

    udWs.on('close', (code) => {
      console.log(`[USER DATA STREAM] Disconnected (code: ${code})`)
      if (!isShuttingDown) {
        // Auto-reconnect after 5 seconds
        if (reconnectTimeout) clearTimeout(reconnectTimeout)
        reconnectTimeout = setTimeout(() => {
          console.log('[USER DATA STREAM] Reconnecting...')
          connectWS(listenKey)
        }, 5000)
      }
    })
  }

  try {
    const result = await binanceRestRequest('POST', '/api/v3/userDataStream')
    listenKey = result.listenKey
    if (!listenKey) throw new Error(`No listenKey in response: ${JSON.stringify(result)}`)
    console.log('[USER DATA STREAM] Listen key obtained.')

    connectWS(listenKey)

    // Binance requires a PUT every 29 min to keep the listen key alive
    setInterval(
      async () => {
        try {
          await binanceRestRequest('PUT', '/api/v3/userDataStream', { listenKey })
          console.log('[USER DATA STREAM] Listen key renewed.')
        } catch (e: any) {
          console.error('[USER DATA STREAM] Failed to renew listen key:', e.message)
          // Re-obtain a fresh listen key and reconnect
          try {
            const fresh = await binanceRestRequest('POST', '/api/v3/userDataStream')
            listenKey = fresh.listenKey
            connectWS(listenKey)
          } catch {
            /* ignore */
          }
        }
      },
      29 * 60 * 1000
    ) // 29 min — slightly before the 30 min timeout
  } catch (e: any) {
    console.error('[USER DATA STREAM] Failed to start:', e.message)
    console.log('[ORDER POLL] Falling back to polling open orders every 60s to detect fills...')
    startOrderPolling()
  }
}

// ---------------------------------------------------------------------------
// Order Polling Fallback
// ---------------------------------------------------------------------------

/**
 * Polls Binance every ~60s to check if any pending grid sell orders were filled
 */
export const startOrderPolling = (): void => {
  console.log('[ORDER POLL] Starting order poll fallback (60s interval)')

  setInterval(async () => {
    // Collect all symbols that have pending grid levels with order IDs
    const symbolsToCheck = Object.keys(getGridLevels()).filter((sym) =>
      (getGridLevels(sym) as GridLevel[]).some((l) => l.binanceSellOrderId)
    )
    if (symbolsToCheck.length === 0) return

    for (const symbol of symbolsToCheck) {
      try {
        const openOrdersRes = (await getClient().openOrders(symbol)) as any
        const openOrders: any[] = openOrdersRes.data || []
        const openOrderIds = new Set(openOrders.map((o: any) => o.orderId?.toString()))

        const levels = (getGridLevels(symbol) as GridLevel[]) || []
        for (const level of [...levels]) {
          if (!level.binanceSellOrderId) continue
          if (!openOrderIds.has(level.binanceSellOrderId)) {
            // Order no longer open — assume it was filled at the sell price
            console.log(
              `[ORDER POLL] Grid sell likely filled for ${symbol} — order ${level.binanceSellOrderId}`
            )
            handleGridSellFill(symbol, level, level.sellPrice).catch(console.error)
          }
        }
      } catch {
        // Silently skip — network issues shouldn't spam the log
      }
    }
  }, 60_000)
}

// ---------------------------------------------------------------------------
// Market Price Feed WebSocket
// ---------------------------------------------------------------------------

/**
 * Monitor WebSocket health, restart if stale
 */
export const startWatchdog = async (): Promise<void> => {
  if (watchdogInterval) clearInterval(watchdogInterval)
  watchdogInterval = setInterval(async () => {
    // Determine if we have anything to monitor
    const whitelist = await getWhitelist()
    const activeGridSymbols = Object.keys(getGridState() as Record<string, GridState>)
    if (whitelist.length === 0 && activeGridSymbols.length === 0) return

    const staleTime = Date.now() - lastMessageTime
    if (staleTime > 60_000) {
      console.log(
        `[WATCHDOG] WebSocket stale (no message for ${Math.round(staleTime / 1000)}s). Restarting...`
      )
      await connectWebSocket()
    }
  }, 15_000)
}

/**
 * Connect WebSocket for market price feed
 */
export const connectWebSocket = async (): Promise<void> => {
  streamGeneration += 1
  const currentGen = streamGeneration

  const whitelist = await getWhitelist()
  // Monitor all whitelisted symbols + any with active grid states
  const monitoringSet = new Set([
    ...whitelist,
    ...Object.keys(getGridState() as Record<string, GridState>)
  ])
  const monitoringList = Array.from(monitoringSet).filter(Boolean)
  console.log(
    `[GEN ${currentGen}] Connecting WebSocket for ${monitoringList.length} symbols: ${monitoringList.join(', ')}`
  )
  botEvents.emit('monitoring_update', monitoringList)

  if (monitoringList.length === 0) return

  const callbacks = {
    open: () => {
      console.log(`[GEN ${currentGen}] WebSocket connected.`)
      lastMessageTime = Date.now() // Initialize heartbeat
      startWatchdog()
    },
    close: () => console.log(`[GEN ${currentGen}] WebSocket closed.`),
    error: (err: any) => console.error(`[GEN ${currentGen}] WebSocket error:`, err),
    message: (data: string) => {
      if (streamGeneration !== currentGen) return
      lastMessageTime = Date.now() // Update heartbeat
      try {
        const combined = JSON.parse(data)
        const parsed = combined.data ?? combined
        if (parsed.e === 'aggTrade' || parsed.e === 'trade' || parsed.e === '24hrTicker') {
          const symbol = parsed.s
          // 'p' is for trade/aggTrade, 'c' is for 24hrTicker
          const priceStr = parsed.c || parsed.p
          const price = parseFloat(priceStr)
          if (!isNaN(price)) processTick(symbol, price).catch(console.error)
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (wsClient) {
    try {
      wsClient.terminate()
    } catch {
      /* ignore */
    }
  }

  wsClient = new WebsocketStream({ callbacks })
  const streams = monitoringList.map((sym) => `${sym.toLowerCase()}@ticker`)
  streams.forEach((stream) => {
    wsClient.subscribe(stream)
  })
}

/**
 * Get current WebSocket client (for external control)
 */
export const getWsClient = (): any => wsClient

/**
 * Get current stream generation
 */
export const getStreamGeneration = (): number => streamGeneration
