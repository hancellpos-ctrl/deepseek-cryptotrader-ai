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

let initPromise = null;

function initDb() {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        // WAL mode for high concurrency, durability and speed on Windows
        await dbAsync.run('PRAGMA journal_mode = WAL;');
        await dbAsync.run('PRAGMA synchronous = NORMAL;');
        await dbAsync.run('PRAGMA busy_timeout = 5000;');

        // 1. Wallet state
        await dbAsync.run(`
          CREATE TABLE IF NOT EXISTS wallet (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            balance REAL NOT NULL DEFAULT 1000.0,
            initial_balance REAL NOT NULL DEFAULT 1000.0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await dbAsync.run(`
          INSERT OR IGNORE INTO wallet (id, balance, initial_balance)
          VALUES (1, 1000.0, 1000.0)
        `);

        // 2. Active Positions
        await dbAsync.run(`
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

        await dbAsync.run(`CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status)`);

        // 3. Trade History
        await dbAsync.run(`
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

        await dbAsync.run(`CREATE INDEX IF NOT EXISTS idx_history_closed ON trade_history(closed_at DESC)`);

        // 4. System & AI Logs
        await dbAsync.run(`
          CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT DEFAULT 'info',
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // 5. Persistent App Settings (PIN, Risk, Goals)
        await dbAsync.run(`
          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        resolve();
      } catch (err) {
        console.error('[DB] Error during initDb:', err);
        reject(err);
      }
    });
  });

  return initPromise;
}

async function getSetting(key, defaultValue = null) {
  try {
    await initDb();
    const row = await dbAsync.get('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (row && row.value !== undefined) {
      try {
        return JSON.parse(row.value);
      } catch (e) {
        return row.value;
      }
    }
  } catch (err) {
    console.error(`[DB] Failed to get setting ${key}:`, err.message);
  }
  return defaultValue;
}

async function setSetting(key, value) {
  try {
    await initDb();
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    await dbAsync.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, strVal]
    );
    return true;
  } catch (err) {
    console.error(`[DB] Failed to set setting ${key}:`, err.message);
    return false;
  }
}

async function getAllSettings() {
  try {
    await initDb();
    const rows = await dbAsync.all('SELECT key, value FROM app_settings');
    const result = {};
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch (e) {
        result[r.key] = r.value;
      }
    }
    return result;
  } catch (err) {
    console.error('[DB] Failed to get all settings:', err.message);
    return {};
  }
}

initDb().catch(e => console.error('[DB] SQLite init error:', e));

module.exports = {
  db,
  dbAsync,
  initDb,
  getSetting,
  setSetting,
  getAllSettings
};
