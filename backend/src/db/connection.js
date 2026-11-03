import fs from 'fs';
import path from 'path';

let dbInstance = null;

/**
 * Initializes and returns a unified SQLite database connection.
 * Primary: better-sqlite3 (standard for Docker & Linux)
 * Fallback: Node.js native node:sqlite DatabaseSync (for host environments without C++ toolchain)
 * 
 * Both interfaces support:
 * - db.exec(sql)
 * - db.prepare(sql).run(...)
 * - db.prepare(sql).all(...)
 * - db.prepare(sql).get(...)
 * - db.transaction(fn)
 */
export async function getDatabase(dbPath = process.env.DATABASE_PATH || './data/monitor.db') {
  if (dbInstance) {
    return dbInstance;
  }

  // Ensure target directory exists
  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Attempt 1: better-sqlite3
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(resolvedPath);
    
    // Configure high-performance WAL mode & Pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    console.log(`[DB] Connected to SQLite via better-sqlite3 at: ${resolvedPath} (WAL mode enabled)`);
    dbInstance = {
      raw: db,
      type: 'better-sqlite3',
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      transaction: (fn) => db.transaction(fn),
      close: () => db.close()
    };
    return dbInstance;
  } catch (betterSqliteErr) {
    // A working native addon that fails to open/configure the database (for
    // example because the data volume is not writable) is a real error, not a
    // reason to silently switch implementations.
    if (betterSqliteErr?.code === 'ERR_SQLITE_ERROR') {
      throw betterSqliteErr;
    }
    // Attempt 2: Node.js built-in node:sqlite (Standard in Node.js 22/24+)
    console.warn(`[DB] better-sqlite3 unavailable (${betterSqliteErr?.message || betterSqliteErr}). Falling back to native node:sqlite.`);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(resolvedPath);

    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');

    console.log(`[DB] Connected to SQLite via native node:sqlite at: ${resolvedPath} (WAL mode enabled)`);
    dbInstance = {
      raw: db,
      type: 'node:sqlite',
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      transaction: (fn) => {
        return (...args) => {
          db.exec('BEGIN IMMEDIATE');
          try {
            const res = fn(...args);
            db.exec('COMMIT');
            return res;
          } catch (err) {
            db.exec('ROLLBACK');
            throw err;
          }
        };
      },
      close: () => db.close()
    };
    return dbInstance;
  }
}

