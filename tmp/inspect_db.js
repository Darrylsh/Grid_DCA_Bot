const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Path to the database
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gridbot-desktop', 'gridbot.db');

try {
  const db = new Database(dbPath);
  console.log('Connected to database at:', dbPath);

  console.log('\n--- RECENT TRADES (Raw) ---');
  const trades = db.prepare('SELECT id, symbol, side, timestamp FROM trades ORDER BY timestamp DESC LIMIT 10').all();
  trades.forEach(t => {
    console.log(`ID: ${t.id} | Sym: ${t.symbol} | Side: ${t.side} | TS: "${t.timestamp}"`);
  });

  console.log('\n--- SETTINGS ---');
  const settings = db.prepare('SELECT * FROM settings').all();
  settings.forEach(s => console.log(`${s.key}: ${s.value}`));

} catch (e) {
  console.error('Error:', e.message);
}
