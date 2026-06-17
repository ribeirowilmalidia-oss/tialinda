// DB adapter: usa MySQL (TiDB) em produção via DATABASE_URL, SQLite local caso contrário.
const path = require('path');

if (process.env.DATABASE_URL) {
  const mysql = require('mysql2/promise');
  module.exports = mysql.createPool(process.env.DATABASE_URL);
} else {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(__dirname, 'data.db'));
  db.pragma('journal_mode = WAL');

  function translate(sql) {
    return sql
      .replace(/AUTO_INCREMENT/gi, 'AUTOINCREMENT')
      .replace(/\bINT\s+AUTOINCREMENT\b/gi, 'INTEGER')
      .replace(/\bINT\b/gi, 'INTEGER')
      .replace(/VARCHAR\(\d+\)/gi, 'TEXT')
      .replace(/DECIMAL\(\d+,\s*\d+\)/gi, 'REAL')
      .replace(/TINYINT/gi, 'INTEGER')
      .replace(/BOOLEAN/gi, 'INTEGER')
      .replace(/\bRAND\(\)/gi, 'RANDOM()')
      .replace(/GREATEST\(/gi, 'MAX(');
  }

  function exec(sql, params = []) {
    const t = translate(sql);
    const lower = t.trim().toLowerCase();
    if (lower.startsWith('create') || lower.startsWith('alter') || lower.startsWith('drop')) {
      db.exec(t);
      return [{ affectedRows: 0 }];
    }
    const stmt = db.prepare(t);
    if (lower.startsWith('select')) {
      return [stmt.all(...(params || []))];
    }
    const r = stmt.run(...(params || []));
    return [{ insertId: r.lastInsertRowid, affectedRows: r.changes }];
  }

  module.exports = {
    async execute(sql, params) { return exec(sql, params); },
    async getConnection() {
      let inTx = false;
      return {
        async beginTransaction() { db.exec('BEGIN'); inTx = true; },
        async commit() { db.exec('COMMIT'); inTx = false; },
        async rollback() { if (inTx) { db.exec('ROLLBACK'); inTx = false; } },
        async execute(sql, params) { return exec(sql, params); },
        release() {}
      };
    }
  };
}
