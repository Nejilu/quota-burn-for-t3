import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,level TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY AUTOINCREMENT,account TEXT NOT NULL,at TEXT NOT NULL,session REAL,weekly REAL,epoch TEXT);
      CREATE INDEX IF NOT EXISTS samples_account_at ON samples(account,at);`);
  }
  get(kind, id) { const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id); return row ? JSON.parse(row.data) : null; }
  list(kind) { return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map((r)=>JSON.parse(r.data)); }
  put(kind, data) { this.db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,data.id,JSON.stringify(data)); return data; }
  remove(kind,id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r=fn();this.db.exec('COMMIT');return r; } catch(e){this.db.exec('ROLLBACK');throw e;} }
  log(kind,message,data={},level='info') { this.db.prepare('INSERT INTO events(at,level,kind,message,data) VALUES(?,?,?,?,?)').run(new Date().toISOString(),level,kind,message,JSON.stringify(data)); this.db.prepare('DELETE FROM events WHERE id < (SELECT COALESCE(MAX(id),0)-3000 FROM events)').run(); }
  events(limit=100) { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit).map(r=>({...r,data:JSON.parse(r.data)})); }
  sample(account) { this.db.prepare('INSERT INTO samples(account,at,session,weekly,epoch) VALUES(?,?,?,?,?)').run(account.id,account.checkedAt,account.session?.usedPercent??null,account.weekly?.usedPercent??null,account.weekly?.resetsAt??null); this.db.prepare("DELETE FROM samples WHERE at < datetime('now','-30 days')").run(); }
  history(id) { return this.db.prepare('SELECT at,session,weekly FROM samples WHERE account=? ORDER BY id DESC LIMIT 168').all(id).reverse(); }
  settings() { return this.get('settings','global') || {id:'global',mode:'observe',pollSeconds:60,updatedAt:new Date().toISOString()}; }
  close(){this.db.close();}
}
export const makeId = () => randomUUID();
