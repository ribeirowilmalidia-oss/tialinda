// DB adapter — escolhe driver automaticamente baseado em DATABASE_URL.
//   postgres://... ou postgresql://... → PostgreSQL (Render, Neon, Supabase)
//   mysql://...                        → MySQL (TiDB Cloud, PlanetScale)
//   (sem DATABASE_URL)                 → SQLite local (better-sqlite3) — dev
//
// A API exposta é a mesma do mysql2/promise:
//   pool.execute(sql, params) => [rows | {insertId, affectedRows}, fields]
//   pool.getConnection() => { beginTransaction, commit, rollback, execute, release }
const path = require('path');

const URL = process.env.DATABASE_URL || '';

if (URL.startsWith('postgres://') || URL.startsWith('postgresql://')) {
  module.exports = makePgAdapter(URL);
} else if (URL.startsWith('mysql://')) {
  const mysql = require('mysql2/promise');
  module.exports = mysql.createPool(URL);
} else {
  module.exports = makeSqliteAdapter();
}

// ============================================================
// PostgreSQL adapter — traduz SQL MySQL → PG e mantém API mysql2
// ============================================================
function makePgAdapter(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10
  });

  function translate(sql) {
    let t = sql
      // Schema differences
      .replace(/\bINT\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi, 'SERIAL PRIMARY KEY')
      .replace(/\bAUTO_INCREMENT\b/gi, '')
      .replace(/\bTINYINT\b/gi, 'SMALLINT')
      .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
      // Functions
      .replace(/\bRAND\s*\(\s*\)/gi, 'RANDOM()')
      // Conflict on duplicate (raríssimo no projeto; manter no-op)
      ;
    // ? → $1, $2, $3 ...
    let i = 0;
    t = t.replace(/\?/g, () => '$' + (++i));
    return t;
  }

  function isInsert(sql) { return /^\s*insert\s+/i.test(sql); }
  function isSelect(sql) { return /^\s*select\s+/i.test(sql); }
  function isDdl(sql)    { return /^\s*(create|alter|drop)\s+/i.test(sql); }
  function hasReturning(sql) { return /\breturning\b/i.test(sql); }

  // Tabelas que não têm coluna "id" — não devem receber RETURNING id automático
  const NO_ID_TABLES = ['settings'];
  function insertTargetTable(sql) {
    const m = /^\s*insert\s+into\s+([`"a-z0-9_]+)/i.exec(sql);
    if (!m) return null;
    return m[1].replace(/[`"]/g, '').toLowerCase();
  }

  async function run(client, sql, params) {
    let q = translate(sql);
    // Para INSERTs sem RETURNING, anexa "RETURNING id" para emular insertId do mysql2 —
    // mas apenas em tabelas que têm coluna id.
    const tbl = insertTargetTable(q);
    const insertHasId = isInsert(q) && !hasReturning(q) && (!tbl || !NO_ID_TABLES.includes(tbl));
    if (insertHasId) q = q + ' RETURNING id';
    const res = await client.query(q, params || []);
    if (isSelect(q) || hasReturning(q)) {
      const rows = res.rows;
      if (isInsert(sql) && rows.length) {
        return [{ insertId: rows[0].id, affectedRows: res.rowCount }, undefined];
      }
      return [rows, undefined];
    }
    if (isDdl(q)) return [{ affectedRows: 0 }, undefined];
    if (isInsert(q)) return [{ affectedRows: res.rowCount, insertId: 0 }, undefined];
    return [{ affectedRows: res.rowCount, insertId: 0 }, undefined];
  }

  return {
    async execute(sql, params) {
      return run(pool, sql, params);
    },
    async getConnection() {
      const client = await pool.connect();
      let inTx = false;
      return {
        async beginTransaction() { await client.query('BEGIN'); inTx = true; },
        async commit() { await client.query('COMMIT'); inTx = false; },
        async rollback() { if (inTx) { await client.query('ROLLBACK'); inTx = false; } },
        async execute(sql, params) { return run(client, sql, params); },
        release() { client.release(); }
      };
    }
  };
}

// ============================================================
// SQLite adapter (dev local)
// ============================================================
function makeSqliteAdapter() {
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

  return {
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
