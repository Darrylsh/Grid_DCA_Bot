import * as https from 'https'

export const sendTelegramMessage = (message: string): void => {
  const token = process.env['TELEGRAM_BOT_TOKEN']
  const chatId = process.env['TELEGRAM_CHAT_ID']

  if (!token || !chatId) {
    console.warn(
      '[TELEGRAM] Skipping notification. TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set in .env'
    )
    return
  }

  const data = JSON.stringify({
    chat_id: chatId,
    text: message
  })

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }

  const req = https.request(options, (res) => {
    let body = ''
    res.on('data', (chunk) => (body += chunk))
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.warn(`[TELEGRAM] Failed to send message. HTTP ${res.statusCode}: ${body}`)
      }
    })
  })

  req.on('error', (error) => {
    console.error('[TELEGRAM] Error sending message:', error.message)
  })

  req.write(data)
  req.end()
}
