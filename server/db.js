const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'cryptotrader.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB] Error opening SQLite database:', err.message);
  } else {
    console.log('[DB] SQLite database connected at:', DB_PATH);
  }
});

// Initialize Tables
db.serialize(() => {
  // 1. Wallet state
  db.run(`
    CREATE TABLE IF NOT EXISTS wallet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance REAL NOT NULL DEFAULT 1000.0,
      initial_balance REAL NOT NULL DEFAULT 1000.0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert initial wallet row if not exists
  db.run(`
    INSERT OR IGNORE INTO wallet (id, balance, initial_balance)
    VALUES (1, 1000.0, 1000.0)
  `);

  // 2. Active Positions
  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      leverage INTEGER NOT NULL,
      margin REAL NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      take_profit REAL,
      stop_loss REAL,
      trailing_stop_active INTEGER DEFAULT 0,
      highest_price REAL,
      lowest_price REAL,
      ai_reason TEXT,
      opened_at INTEGER NOT NULL,
      status TEXT DEFAULT 'OPEN'
    )
  `);

  // 3. Trade History
  db.run(`
    CREATE TABLE IF NOT EXISTS trade_history (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      leverage INTEGER NOT NULL,
      margin REAL NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      realized_pnl REAL NOT NULL,
      roi_percent REAL NOT NULL,
      close_reason TEXT,
      ai_reason TEXT,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. System & AI Logs
  db.run(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'info',
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper promises
const dbAsync = {
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

module.exports = {
  db,
  dbAsync
};
