const sqlite3 = require("sqlite3").verbose();

// Create or open database file
const db = new sqlite3.Database("./pastes.db");

// Create table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS pastes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      max_views INTEGER,
      views INTEGER DEFAULT 0
    )
  `);
});

module.exports = db;
