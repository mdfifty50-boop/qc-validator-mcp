/**
 * SQLite database layer for qc-validator-mcp.
 * DB location: ~/.qc-validator-mcp/qc.db (overridable via QC_DATA_DIR env var)
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let _db = null;

export function getDb() {
  if (_db) return _db;

  const DATA_DIR = process.env.QC_DATA_DIR || join(homedir(), '.qc-validator-mcp');
  const DB_PATH = join(DATA_DIR, 'qc.db');

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS validations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT    NOT NULL,
      output_hash TEXT    NOT NULL,
      score       REAL    NOT NULL,
      pass        INTEGER NOT NULL,
      issues_count INTEGER NOT NULL,
      issues_json TEXT    NOT NULL DEFAULT '[]',
      created_at  TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_validations_agent ON validations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_validations_created ON validations(created_at);
  `);

  return _db;
}

/**
 * Reset DB — used in tests only.
 */
export function _resetDb() {
  const db = getDb();
  db.exec('DELETE FROM validations');
}

/**
 * Close the DB connection — useful when swapping DATA_DIR in tests.
 */
export function _closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
