/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { Pool } = require('pg')
const dotenv = require('dotenv')
const path = require('path')
dotenv.config({ path: path.join(__dirname, '../../.env') })

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
})

async function check() {
  try {
    const res = await pool.query(
      'SELECT symbol, MIN(recorded_at), MAX(recorded_at), COUNT(*) FROM tick_history GROUP BY symbol'
    )
    console.log(JSON.stringify(res.rows, null, 2))
  } catch (e) {
    console.error(e)
  } finally {
    await pool.end()
  }
}
check()
