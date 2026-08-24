import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = createClient({
  url: `file:${path.join(DATA_DIR, 'meal-control.db')}`,
});

export async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      store_code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration TEXT NOT NULL,
      store_code TEXT NOT NULL,
      served_at DATETIME DEFAULT (datetime('now','localtime')),
      operator TEXT
    );
  `);
}

export default db;
