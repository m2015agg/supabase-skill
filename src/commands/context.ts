import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  hasDb, openDb, getTableColumns, getRelatedTables, findMatchingFunctions,
  getAllTableNames, getTableInfo, type ColumnQueryResult,
} from "../util/db.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

// ─── Markdown Fallback (original implementation) ───

interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
  defaultVal: string;
  fk: string;
  isPk: boolean;
}

function parseTableFile(filePath: string): { columns: ColumnInfo[]; notes: string[] } {
  const content = readFileSync(filePath, "utf-8");
  const columns: ColumnInfo[] = [];
  const notes: string[] = [];
  let inNotes = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("## Notes")) { inNotes = true; continue; }
    if (inNotes && line.startsWith("- ")) { notes.push(line); continue; }
    if (line.startsWith("|") && !line.startsWith("| Column") && !line.startsWith("|---")) {
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cols.length >= 5) {
        columns.push({
          name: cols[0].replace(/\s*\*\*PK\*\*/, ""),
          type: cols[1], nullable: cols[2], defaultVal: cols[3],
          fk: cols[4], isPk: cols[0].includes("**PK**"),
        });
      }
    }
  }
  return { columns, notes };
}

// ─── SQLite Path ───

function renderColumnsFromDb(cols: ColumnQueryResult[], info?: { row_count?: number | null; total_size?: string | null }): void {
  const pkCount = cols.filter((c) => c.is_pk).length;
  const fkCount = cols.filter((c) => c.fk_table).length;
  let summary = `${cols.length} columns | ${pkCount} PK | ${fkCount} FK`;
  if (info?.row_count != null) summary += ` | ~${info.row_count.toLocaleString()} rows`;
  if (info?.total_size) summary += ` | ${info.total_size}`;
  write(`${summary}\n\n`);

  write("| Column | Type | Nullable | Default | FK |\n");
  write("|--------|------|----------|---------|----|");
  for (const col of cols) {
    const pk = col.is_pk ? " **PK**" : "";
    const nullable = col.nullable ? "nullable" : "NOT NULL";
    const fk = col.fk_table ? `→ ${col.fk_table}.${col.fk_column}` : "";
    write(`\n| ${col.name}${pk} | ${col.type || "unknown"} | ${nullable} | ${col.default_value || ""} | ${fk} |`);
  }
  write("\n\n");

  const notes = cols.filter((c) => c.description);
  if (notes.length > 0) {
    for (const col of notes) {
      write(`- **${col.name}**: ${col.description}\n`);
    }
    write("\n");
  }
}

function runSqlite(schemaDir: string, query: string, depth: number, jsonMode: boolean): void {
  const db = openDb(schemaDir);
  const q = query.toLowerCase();

  const allTables = getAllTableNames(db);
  let entryTables = allTables.filter((t) => t === q);
  if (entryTables.length === 0) entryTables = allTables.filter((t) => t.includes(q));
  if (entryTables.length === 0) {
    // Search by column name
    const colMatches = db.prepare("SELECT DISTINCT table_name FROM columns WHERE name LIKE ?").all(`%${q}%`) as Array<{ table_name: string }>;
    entryTables = colMatches.map((r) => r.table_name);
  }

  const matchingFuncs = findMatchingFunctions(db, q);

  if (jsonMode) {
    const result = entryTables.slice(0, 5).map((table) => ({
      name: table,
      columns: getTableColumns(db, table),
      related: getRelatedTables(db, table, depth),
    }));
    db.close();
    write(JSON.stringify({ entryTables: result, functions: matchingFuncs }, null, 2) + "\n");
    return;
  }

  if (entryTables.length === 0 && matchingFuncs.length === 0) {
    db.close();
    write(`No tables or columns match "${query}"\n`);
    return;
  }

  write(`\n# Context for "${query}"\n\n`);

  for (const table of entryTables.slice(0, 5)) {
    const cols = getTableColumns(db, table);
    const related = getRelatedTables(db, table, depth);
    const info = getTableInfo(db, table);

    // Also find tables with matching name prefix that may lack FK constraints
    const nameRelated = allTables
      .filter((t) => t !== table && (t.startsWith(table + "_") || t.startsWith(table.replace(/s$/, "") + "_")))
      .filter((t) => !related.some((r) => r.table_name === t));
    for (const nr of nameRelated) {
      related.push({ table_name: nr, direction: "name-related", from_column: "", to_column: "", depth: 0 });
    }

    write(`## ${table}\n`);
    renderColumnsFromDb(cols, info);

    const refs = related.filter((r) => r.direction === "references");
    const refBy = related.filter((r) => r.direction === "referenced by");
    const nameRel = related.filter((r) => r.direction === "name-related");

    if (refs.length > 0 || refBy.length > 0 || nameRel.length > 0) {
      write("### Related Tables\n\n");
      if (refs.length > 0) {
        write("**References (this table points to):**\n");
        for (const r of refs) write(`  → ${r.table_name} via ${r.from_column} → ${r.table_name}.${r.to_column}\n`);
        write("\n");
      }
      if (refBy.length > 0) {
        write("**Referenced by (points to this table):**\n");
        for (const r of refBy) write(`  ← ${r.table_name} via ${r.table_name}.${r.from_column} → ${r.to_column}\n`);
        write("\n");
      }
      if (nameRel.length > 0) {
        write("**Name-related (no FK constraint declared):**\n");
        for (const r of nameRel) write(`  ~ ${r.table_name}\n`);
        write("\n");
      }
    }
    write("---\n\n");
  }

  if (entryTables.length > 5) write(`... and ${entryTables.length - 5} more matching tables\n\n`);

  if (matchingFuncs.length > 0) {
    write("## Related Functions\n\n");
    for (const func of matchingFuncs) {
      const params = JSON.parse(func.params || "[]") as Array<{ name: string; type: string }>;
      const paramStr = params.length > 0 ? `(${params.map((p) => `${p.name}`).join(", ")})` : "()";
      write(`- \`${func.name}${paramStr}\`\n`);
    }
    write("\n");
  }

  db.close();
}

// ─── Markdown Fallback Path ───

function runMarkdown(schemaDir: string, query: string, depth: number, jsonMode: boolean): void {
  const tablesDir = join(schemaDir, "tables");
  const allTables = readdirSync(tablesDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
  const q = query.toLowerCase();

  let entryTables = allTables.filter((t) => t === q);
  if (entryTables.length === 0) entryTables = allTables.filter((t) => t.includes(q));
  if (entryTables.length === 0) {
    for (const table of allTables) {
      const { columns } = parseTableFile(join(tablesDir, `${table}.md`));
      if (columns.some((c) => c.name.toLowerCase().includes(q))) entryTables.push(table);
    }
  }

  // Load relationships
  const relsFile = join(schemaDir, "relationships.json");
  const rels = existsSync(relsFile) ? JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string> : {};

  // Load functions
  const funcsFile = join(schemaDir, "functions.md");
  const matchingFuncs: string[] = [];
  if (existsSync(funcsFile)) {
    for (const line of readFileSync(funcsFile, "utf-8").split("\n")) {
      if (line.startsWith("## ") && line.toLowerCase().includes(q)) {
        matchingFuncs.push(line.replace("## ", ""));
      }
    }
  }

  if (jsonMode) {
    const result = entryTables.slice(0, 5).map((table) => {
      const { columns, notes } = parseTableFile(join(tablesDir, `${table}.md`));
      return { name: table, columns, notes };
    });
    write(JSON.stringify({ entryTables: result, functions: matchingFuncs }, null, 2) + "\n");
    return;
  }

  if (entryTables.length === 0 && matchingFuncs.length === 0) {
    write(`No tables or columns match "${query}"\n`);
    return;
  }

  write(`\n# Context for "${query}"\n\n`);

  for (const table of entryTables.slice(0, 5)) {
    const { columns, notes } = parseTableFile(join(tablesDir, `${table}.md`));
    write(`## ${table}\n`);
    write(`${columns.length} columns | ${columns.filter((c) => c.isPk).length} PK | ${columns.filter((c) => c.fk).length} FK\n\n`);

    write("| Column | Type | Nullable | Default | FK |\n");
    write("|--------|------|----------|---------|----|");
    for (const col of columns) {
      const pk = col.isPk ? " **PK**" : "";
      write(`\n| ${col.name}${pk} | ${col.type} | ${col.nullable} | ${col.defaultVal} | ${col.fk} |`);
    }
    write("\n\n");

    if (notes.length > 0) {
      for (const note of notes) write(`${note}\n`);
      write("\n");
    }

    // Find related tables via relationships
    const outgoing: string[] = [];
    const incoming: string[] = [];
    for (const [from, to] of Object.entries(rels)) {
      const [fromTable] = from.split(".");
      const [toTable] = to.split(".");
      if (fromTable === table) outgoing.push(`  → ${toTable} via ${from.split(".")[1]} → ${to}`);
      if (toTable === table) incoming.push(`  ← ${fromTable} via ${from}`);
    }

    if (outgoing.length > 0 || incoming.length > 0) {
      write("### Related Tables\n\n");
      if (outgoing.length > 0) { write("**References (this table points to):**\n"); outgoing.forEach((r) => write(r + "\n")); write("\n"); }
      if (incoming.length > 0) { write("**Referenced by (points to this table):**\n"); incoming.forEach((r) => write(r + "\n")); write("\n"); }
    }
    write("---\n\n");
  }

  if (matchingFuncs.length > 0) {
    write("## Related Functions\n\n");
    for (const func of matchingFuncs) write(`- \`${func}\`\n`);
    write("\n");
  }
}

export function contextCommand(): Command {
  return new Command("context")
    .description("Get comprehensive context for a table or topic — related tables, FKs, functions, column details")
    .argument("<query>", "Table name or topic (e.g., 'episodes', 'user subscriptions', 'chat')")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .option("--depth <n>", "FK traversal depth", "3")
    .option("--json", "Output as JSON")
    .action((query: string, opts: { dir: string; depth: string; json?: boolean }) => {
      const schemaDir = join(process.cwd(), opts.dir);
      const depth = parseInt(opts.depth, 10);

      if (!existsSync(schemaDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      if (hasDb(schemaDir)) {
        runSqlite(schemaDir, query, depth, !!opts.json);
      } else {
        runMarkdown(schemaDir, query, depth, !!opts.json);
      }
    });
}
