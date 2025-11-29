import Database from "better-sqlite3";

export const db = new Database("diary.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    content TEXT,
    sentiment_score REAL,
    sentiment_label TEXT,
    emotions TEXT,
    created_at TEXT
  )
`).run();
