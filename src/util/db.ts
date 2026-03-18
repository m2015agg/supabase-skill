import Database from "better-sqlite3";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DB_FILENAME = "schema.db";

// ─── Schema Creation ───

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tables (
  name TEXT PRIMARY KEY,
  column_count INTEGER,
  pk_count INTEGER,
  fk_count INTEGER,
  is_view BOOLEAN DEFAULT FALSE,
  row_count INTEGER,
  table_size TEXT,
  index_size TEXT,
  total_size TEXT
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  nullable BOOLEAN,
  default_value TEXT,
  is_pk BOOLEAN DEFAULT FALSE,
  fk_table TEXT,
  fk_column TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_table TEXT NOT NULL,
  from_column TEXT NOT NULL,
  to_table TEXT NOT NULL,
  to_column TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS functions (
  name TEXT PRIMARY KEY,
  params TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  index_name TEXT NOT NULL,
  columns TEXT,
  is_unique BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT FALSE,
  index_type TEXT
);

CREATE TABLE IF NOT EXISTS enums (
  name TEXT PRIMARY KEY,
  enum_values TEXT
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  command TEXT,
  roles TEXT,
  using_expr TEXT,
  with_check_expr TEXT
);

CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  trigger_name TEXT NOT NULL,
  event TEXT,
  timing TEXT,
  function_name TEXT,
  definition TEXT
);

CREATE TABLE IF NOT EXISTS views (
  name TEXT PRIMARY KEY,
  definition TEXT,
  column_count INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS schema_fts USING fts5(
  name,
  type,
  parent,
  detail,
  description,
  tokenize='porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_columns_table ON columns(table_name);
CREATE INDEX IF NOT EXISTS idx_columns_type ON columns(type);
CREATE INDEX IF NOT EXISTS idx_columns_fk ON columns(fk_table) WHERE fk_table IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_columns_pk ON columns(is_pk) WHERE is_pk = TRUE;
CREATE INDEX IF NOT EXISTS idx_rels_from ON relationships(from_table);
CREATE INDEX IF NOT EXISTS idx_rels_to ON relationships(to_table);
CREATE INDEX IF NOT EXISTS idx_indexes_table ON indexes(table_name);
CREATE INDEX IF NOT EXISTS idx_policies_table ON policies(table_name);
CREATE INDEX IF NOT EXISTS idx_triggers_table ON triggers(table_name);
`;

// ─── Open / Init ───

export function openDb(schemaDir: string): Database.Database {
  const dbPath = join(schemaDir, DB_FILENAME);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  // Ensure all tables exist (handles upgrades from older snapshots)
  initSchema(db);
  return db;
}

export function hasDb(schemaDir: string): boolean {
  return existsSync(join(schemaDir, DB_FILENAME));
}

export function initSchema(db: Database.Database): void {
  // Migrate: rename old 'enums' table that used reserved word 'values'
  try {
    const info = db.prepare("PRAGMA table_info(enums)").all() as Array<{ name: string }>;
    if (info.some((col) => col.name === "values")) {
      db.exec("DROP TABLE enums");
    }
  } catch { /* table doesn't exist yet, fine */ }

  db.exec(SCHEMA_SQL);
}

export function clearData(db: Database.Database): void {
  db.exec("DELETE FROM schema_fts");
  db.exec("DELETE FROM columns");
  db.exec("DELETE FROM relationships");
  db.exec("DELETE FROM functions");
  db.exec("DELETE FROM tables");
  db.exec("DELETE FROM metadata");
  db.exec("DELETE FROM indexes");
  db.exec("DELETE FROM enums");
  db.exec("DELETE FROM policies");
  db.exec("DELETE FROM triggers");
  db.exec("DELETE FROM views");
}

export function setMetadata(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(key, value);
}

export function getMetadata(db: Database.Database, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

// ─── Insert Helpers ───

export interface TableRow {
  name: string;
  column_count: number;
  pk_count: number;
  fk_count: number;
  is_view: boolean;
  row_count?: number | null;
  table_size?: string | null;
  index_size?: string | null;
  total_size?: string | null;
}

export interface ColumnRow {
  table_name: string;
  name: string;
  type: string | null;
  nullable: boolean;
  default_value: string | null;
  is_pk: boolean;
  fk_table: string | null;
  fk_column: string | null;
  description: string | null;
}

export interface RelRow {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

export interface FuncRow {
  name: string;
  params: string; // JSON
  description: string | null;
}

export function insertAll(
  db: Database.Database,
  tables: TableRow[],
  columns: ColumnRow[],
  rels: RelRow[],
  funcs: FuncRow[],
): void {
  const insertTable = db.prepare(
    "INSERT OR REPLACE INTO tables (name, column_count, pk_count, fk_count, is_view, row_count, table_size, index_size, total_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertColumn = db.prepare(
    "INSERT INTO columns (table_name, name, type, nullable, default_value, is_pk, fk_table, fk_column, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRel = db.prepare(
    "INSERT INTO relationships (from_table, from_column, to_table, to_column) VALUES (?, ?, ?, ?)",
  );
  const insertFunc = db.prepare(
    "INSERT OR REPLACE INTO functions (name, params, description) VALUES (?, ?, ?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO schema_fts (name, type, parent, detail, description) VALUES (?, ?, ?, ?, ?)",
  );

  // Coerce any value to SQLite-safe (no booleans, no undefined)
  function safe(v: unknown): string | number | null {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    return String(v);
  }

  const tx = db.transaction(() => {
    for (const t of tables) {
      insertTable.run(safe(t.name), safe(t.column_count), safe(t.pk_count), safe(t.fk_count), safe(t.is_view), safe(t.row_count), safe(t.table_size), safe(t.index_size), safe(t.total_size));
      const sizeDetail = t.total_size ? ` | ${t.total_size}` : "";
      const rowDetail = t.row_count != null ? ` | ~${t.row_count} rows` : "";
      insertFts.run(safe(t.name), "table", "", `${t.column_count} columns ${t.pk_count} PK ${t.fk_count} FK${rowDetail}${sizeDetail}`, "");
    }

    for (const c of columns) {
      insertColumn.run(
        safe(c.table_name), safe(c.name), safe(c.type), safe(c.nullable),
        safe(c.default_value), safe(c.is_pk), safe(c.fk_table), safe(c.fk_column), safe(c.description),
      );
      const detail = [c.type, c.fk_table ? `FK → ${c.fk_table}.${c.fk_column}` : ""].filter(Boolean).join(" ");
      insertFts.run(safe(c.name), "column", safe(c.table_name), detail, safe(c.description) ?? "");
    }

    for (const r of rels) {
      insertRel.run(safe(r.from_table), safe(r.from_column), safe(r.to_table), safe(r.to_column));
    }

    for (const f of funcs) {
      insertFunc.run(safe(f.name), safe(f.params), safe(f.description));
      insertFts.run(safe(f.name), "function", "", safe(f.params) ?? "", safe(f.description) ?? "");
    }
  });

  tx();
}

// ─── Query Helpers ───

export interface FtsResult {
  name: string;
  type: string;
  parent: string;
  detail: string;
  description: string;
  rank: number;
}

export function searchFTS(db: Database.Database, query: string): FtsResult[] {
  // Escape special FTS5 characters and add prefix matching
  const safeQuery = query.replace(/['"():^*{}[\]]/g, "").replace(/[+\-~<>]/g, " ").trim();
  if (!safeQuery) return [];

  try {
    // Try prefix match first (more intuitive for partial names)
    const results = db.prepare(`
      SELECT name, type, parent, detail, description, rank
      FROM schema_fts
      WHERE schema_fts MATCH ?
      ORDER BY rank
      LIMIT 100
    `).all(`"${safeQuery}"*`) as FtsResult[];

    return results;
  } catch {
    // Fallback to simple LIKE if FTS5 match fails
    return db.prepare(`
      SELECT name, type, parent, detail, description, 0 as rank
      FROM schema_fts
      WHERE name LIKE ? OR parent LIKE ? OR detail LIKE ? OR description LIKE ?
      ORDER BY type, name
      LIMIT 100
    `).all(`%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`, `%${safeQuery}%`) as FtsResult[];
  }
}

export interface ColumnQueryResult {
  table_name: string;
  name: string;
  type: string;
  nullable: number;
  default_value: string | null;
  is_pk: number;
  fk_table: string | null;
  fk_column: string | null;
  description: string | null;
}

export function queryColumns(
  db: Database.Database,
  opts: {
    name?: string;
    type?: string;
    fk?: boolean;
    pk?: boolean;
    nullable?: boolean;
    notNull?: boolean;
    hasDefault?: boolean;
    table?: string;
  },
): ColumnQueryResult[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.name) {
    conditions.push("c.name LIKE ?");
    params.push(`%${opts.name}%`);
  }
  if (opts.type) {
    conditions.push("c.type LIKE ?");
    params.push(`%${opts.type}%`);
  }
  if (opts.fk) {
    conditions.push("c.fk_table IS NOT NULL");
  }
  if (opts.pk) {
    conditions.push("c.is_pk = 1");
  }
  if (opts.nullable) {
    conditions.push("c.nullable = 1");
  }
  if (opts.notNull) {
    conditions.push("c.nullable = 0");
  }
  if (opts.hasDefault) {
    conditions.push("c.default_value IS NOT NULL AND c.default_value != ''");
  }
  if (opts.table) {
    conditions.push("c.table_name LIKE ?");
    params.push(`%${opts.table}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db.prepare(`
    SELECT c.table_name, c.name, c.type, c.nullable, c.default_value,
           c.is_pk, c.fk_table, c.fk_column, c.description
    FROM columns c
    ${where}
    ORDER BY c.table_name, c.name
  `).all(...params) as ColumnQueryResult[];
}

export interface RelatedTable {
  table_name: string;
  direction: string;
  from_column: string;
  to_column: string;
  depth: number;
}

export function getRelatedTables(
  db: Database.Database,
  tableName: string,
  maxDepth: number,
): RelatedTable[] {
  // Outgoing (this table references) — deduplicate by table_name, keep shallowest
  const outgoing = db.prepare(`
    WITH RECURSIVE refs(tbl, from_col, to_col, depth) AS (
      SELECT to_table, from_column, to_column, 1
      FROM relationships WHERE from_table = ?
      UNION ALL
      SELECT r.to_table, r.from_column, r.to_column, refs.depth + 1
      FROM relationships r
      JOIN refs ON r.from_table = refs.tbl
      WHERE refs.depth < ?
    )
    SELECT tbl as table_name, 'references' as direction, from_col as from_column, to_col as to_column, MIN(depth) as depth
    FROM refs
    GROUP BY tbl
  `).all(tableName, maxDepth) as RelatedTable[];

  // Incoming (referenced by) — deduplicate by table_name, keep shallowest
  const incoming = db.prepare(`
    WITH RECURSIVE refs(tbl, from_col, to_col, depth) AS (
      SELECT from_table, from_column, to_column, 1
      FROM relationships WHERE to_table = ?
      UNION ALL
      SELECT r.from_table, r.from_column, r.to_column, refs.depth + 1
      FROM relationships r
      JOIN refs ON r.to_table = refs.tbl
      WHERE refs.depth < ?
    )
    SELECT tbl as table_name, 'referenced by' as direction, from_col as from_column, to_col as to_column, MIN(depth) as depth
    FROM refs
    GROUP BY tbl
  `).all(tableName, maxDepth) as RelatedTable[];

  return [...outgoing, ...incoming];
}

export function getTableColumns(db: Database.Database, tableName: string): ColumnQueryResult[] {
  return db.prepare(`
    SELECT table_name, name, type, nullable, default_value, is_pk, fk_table, fk_column, description
    FROM columns WHERE table_name = ?
    ORDER BY id
  `).all(tableName) as ColumnQueryResult[];
}

export function getTableInfo(db: Database.Database, tableName: string): TableRow | undefined {
  return db.prepare("SELECT * FROM tables WHERE name = ?").get(tableName) as TableRow | undefined;
}

export function getAllTableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM tables ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
}

export function findMatchingFunctions(db: Database.Database, query: string): Array<{ name: string; params: string; description: string | null }> {
  return db.prepare(`
    SELECT name, params, description FROM functions
    WHERE name LIKE ?
    ORDER BY name
  `).all(`%${query}%`) as Array<{ name: string; params: string; description: string | null }>;
}

export function getRelationshipsFor(db: Database.Database, tableName: string): { outgoing: RelRow[]; incoming: RelRow[] } {
  const outgoing = db.prepare(
    "SELECT from_table, from_column, to_table, to_column FROM relationships WHERE from_table = ?",
  ).all(tableName) as RelRow[];
  const incoming = db.prepare(
    "SELECT from_table, from_column, to_table, to_column FROM relationships WHERE to_table = ?",
  ).all(tableName) as RelRow[];
  return { outgoing, incoming };
}

// ─── New pg_catalog Types & Helpers ───

export interface IndexRow {
  table_name: string;
  index_name: string;
  columns: string;
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
}

export interface EnumRow {
  name: string;
  enum_values: string; // JSON array
}

export interface PolicyRow {
  table_name: string;
  policy_name: string;
  command: string;
  roles: string;
  using_expr: string | null;
  with_check_expr: string | null;
}

export interface TriggerRow {
  table_name: string;
  trigger_name: string;
  event: string;
  timing: string;
  function_name: string;
  definition: string | null;
}

export interface ViewRow {
  name: string;
  definition: string | null;
  column_count: number;
}

export function insertPgCatalogData(
  db: Database.Database,
  indexes: IndexRow[],
  enums: EnumRow[],
  policies: PolicyRow[],
  triggers: TriggerRow[],
  viewDefs: ViewRow[],
): void {
  const insertIndex = db.prepare(
    "INSERT INTO indexes (table_name, index_name, columns, is_unique, is_primary, index_type) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertEnum = db.prepare(
    "INSERT OR REPLACE INTO enums (name, enum_values) VALUES (?, ?)",
  );
  const insertPolicy = db.prepare(
    "INSERT INTO policies (table_name, policy_name, command, roles, using_expr, with_check_expr) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertTrigger = db.prepare(
    "INSERT INTO triggers (table_name, trigger_name, event, timing, function_name, definition) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertView = db.prepare(
    "INSERT OR REPLACE INTO views (name, definition, column_count) VALUES (?, ?, ?)",
  );
  const insertFts = db.prepare(
    "INSERT INTO schema_fts (name, type, parent, detail, description) VALUES (?, ?, ?, ?, ?)",
  );

  function safe(v: unknown): string | number | null {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return v;
    return String(v);
  }

  const tx = db.transaction(() => {
    for (const idx of indexes) {
      insertIndex.run(safe(idx.table_name), safe(idx.index_name), safe(idx.columns), safe(idx.is_unique), safe(idx.is_primary), safe(idx.index_type));
      insertFts.run(safe(idx.index_name), "index", safe(idx.table_name), `${idx.columns} ${idx.is_unique ? "UNIQUE" : ""}`, "");
    }
    for (const e of enums) {
      insertEnum.run(safe(e.name), safe(e.enum_values));
      insertFts.run(safe(e.name), "enum", "", safe(e.enum_values), "");
    }
    for (const p of policies) {
      insertPolicy.run(safe(p.table_name), safe(p.policy_name), safe(p.command), safe(p.roles), safe(p.using_expr), safe(p.with_check_expr));
      insertFts.run(safe(p.policy_name), "policy", safe(p.table_name), `${p.command} ${p.roles}`, safe(p.using_expr));
    }
    for (const t of triggers) {
      insertTrigger.run(safe(t.table_name), safe(t.trigger_name), safe(t.event), safe(t.timing), safe(t.function_name), safe(t.definition));
      insertFts.run(safe(t.trigger_name), "trigger", safe(t.table_name), `${t.timing} ${t.event}`, safe(t.function_name));
    }
    for (const v of viewDefs) {
      insertView.run(safe(v.name), safe(v.definition), safe(v.column_count));
      insertFts.run(safe(v.name), "view", "", `${v.column_count} columns`, safe(v.definition));
    }
  });
  tx();
}

// Query helpers for new tables

export function queryIndexes(db: Database.Database, tableName?: string): IndexRow[] {
  if (tableName) {
    return db.prepare("SELECT * FROM indexes WHERE table_name LIKE ? ORDER BY table_name, index_name").all(`%${tableName}%`) as IndexRow[];
  }
  return db.prepare("SELECT * FROM indexes ORDER BY table_name, index_name").all() as IndexRow[];
}

export function queryEnums(db: Database.Database, name?: string): EnumRow[] {
  if (name) {
    return db.prepare("SELECT name, enum_values FROM enums WHERE name LIKE ? ORDER BY name").all(`%${name}%`) as EnumRow[];
  }
  return db.prepare("SELECT name, enum_values FROM enums ORDER BY name").all() as EnumRow[];
}

export function queryPolicies(db: Database.Database, tableName?: string): PolicyRow[] {
  if (tableName) {
    return db.prepare("SELECT * FROM policies WHERE table_name LIKE ? ORDER BY table_name, policy_name").all(`%${tableName}%`) as PolicyRow[];
  }
  return db.prepare("SELECT * FROM policies ORDER BY table_name, policy_name").all() as PolicyRow[];
}

export function queryTriggers(db: Database.Database, tableName?: string): TriggerRow[] {
  if (tableName) {
    return db.prepare("SELECT * FROM triggers WHERE table_name LIKE ? ORDER BY table_name, trigger_name").all(`%${tableName}%`) as TriggerRow[];
  }
  return db.prepare("SELECT * FROM triggers ORDER BY table_name, trigger_name").all() as TriggerRow[];
}

export function queryViews(db: Database.Database, name?: string): ViewRow[] {
  if (name) {
    return db.prepare("SELECT * FROM views WHERE name LIKE ? ORDER BY name").all(`%${name}%`) as ViewRow[];
  }
  return db.prepare("SELECT * FROM views ORDER BY name").all() as ViewRow[];
}

export function getAllFunctions(db: Database.Database): Array<{ name: string; params: string; description: string | null }> {
  return db.prepare("SELECT name, params, description FROM functions ORDER BY name").all() as Array<{ name: string; params: string; description: string | null }>;
}
