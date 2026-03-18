import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  hasDb, openDb, getTableColumns, getTableInfo, getAllTableNames,
  getRelationshipsFor, findMatchingFunctions, type ColumnQueryResult,
} from "../util/db.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

function findTable(name: string, allTables: string[]): string | undefined {
  const exact = allTables.find((t) => t === name.toLowerCase());
  return exact || allTables.find((t) => t.includes(name.toLowerCase()));
}

function renderColumnsSqlite(cols: ColumnQueryResult[]): void {
  write("| Column | Type | Nullable | Default | FK |\n");
  write("|--------|------|----------|---------|-----|\n");
  for (const col of cols) {
    const pk = col.is_pk ? " **PK**" : "";
    const nullable = col.nullable ? "nullable" : "NOT NULL";
    const fk = col.fk_table ? `→ ${col.fk_table}.${col.fk_column}` : "";
    write(`| ${col.name}${pk} | ${col.type || "unknown"} | ${nullable} | ${col.default_value || ""} | ${fk} |\n`);
  }

  const notes = cols.filter((c) => c.description);
  if (notes.length > 0) {
    write("\n## Notes\n");
    for (const col of notes) write(`- **${col.name}**: ${col.description}\n`);
  }
}

function runSqlite(schemaDir: string, name: string): void {
  const db = openDb(schemaDir);
  const allTables = getAllTableNames(db);
  const match = findTable(name, allTables);

  if (!match) {
    const similar = allTables.filter((t) => t.includes(name.toLowerCase().slice(0, 4)));
    db.close();
    write(`Table "${name}" not found.\n`);
    if (similar.length > 0) write(`Did you mean: ${similar.join(", ")}?\n`);
    return;
  }

  const info = getTableInfo(db, match);
  const cols = getTableColumns(db, match);

  write(`# ${match}\n\n`);
  let summary = `${info?.column_count || cols.length} columns | ${info?.pk_count || 0} PK | ${info?.fk_count || 0} FK`;
  if (info?.row_count != null) summary += ` | ~${info.row_count.toLocaleString()} rows`;
  if (info?.total_size) summary += ` | ${info.total_size}`;
  write(`${summary}\n\n`);
  renderColumnsSqlite(cols);

  // Relationships
  const { outgoing, incoming } = getRelationshipsFor(db, match);
  if (outgoing.length > 0 || incoming.length > 0) {
    write("\n## Relationships\n\n");
    if (outgoing.length > 0) {
      write("**This table references:**\n");
      for (const r of outgoing) write(`  → ${r.to_table}.${r.to_column} (via ${r.from_column})\n`);
      write("\n");
    }
    if (incoming.length > 0) {
      write("**Referenced by:**\n");
      for (const r of incoming) write(`  ← ${r.from_table}.${r.from_column}\n`);
      write("\n");
    }
  }

  // Related functions
  const namePatterns = [match, match.endsWith("s") ? match.slice(0, -1) : match + "s"];
  const funcs = new Set<string>();
  for (const pattern of namePatterns) {
    for (const f of findMatchingFunctions(db, pattern)) funcs.add(f.name);
  }
  if (funcs.size > 0) {
    write("## Related Functions\n\n");
    for (const f of funcs) write(`- \`${f}\`\n`);
    write("\n");
  }

  // Related table summaries
  const relatedNames = new Set([...outgoing.map((r) => r.to_table), ...incoming.map((r) => r.from_table)]);
  if (relatedNames.size > 0) {
    write("## Related Table Summaries\n\n");
    for (const relName of relatedNames) {
      const relInfo = getTableInfo(db, relName);
      if (relInfo) {
        let relSummary = `${relInfo.column_count} columns | ${relInfo.pk_count} PK | ${relInfo.fk_count} FK`;
        if (relInfo.row_count != null) relSummary += ` | ~${relInfo.row_count.toLocaleString()} rows`;
        if (relInfo.total_size) relSummary += ` | ${relInfo.total_size}`;
        write(`- **${relName}**: ${relSummary}\n`);
      }
    }
    write("\n");
  }

  db.close();
}

function runMarkdown(schemaDir: string, name: string): void {
  const tablesDir = join(schemaDir, "tables");
  const allTables = readdirSync(tablesDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
  const match = findTable(name, allTables);

  if (!match) {
    const similar = allTables.filter((t) => t.includes(name.toLowerCase().slice(0, 4)));
    write(`Table "${name}" not found.\n`);
    if (similar.length > 0) write(`Did you mean: ${similar.join(", ")}?\n`);
    return;
  }

  write(readFileSync(join(tablesDir, `${match}.md`), "utf-8"));
  write("\n");

  const relsFile = join(schemaDir, "relationships.json");
  if (existsSync(relsFile)) {
    const rels = JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string>;
    const outgoing: string[] = [];
    const incoming: string[] = [];

    for (const [from, to] of Object.entries(rels)) {
      if (from.split(".")[0] === match) outgoing.push(`  → ${to} (via ${from.split(".")[1]})`);
      if (to.split(".")[0] === match) incoming.push(`  ← ${from}`);
    }

    if (outgoing.length > 0 || incoming.length > 0) {
      write("\n## Relationships\n\n");
      if (outgoing.length > 0) { write("**This table references:**\n"); outgoing.forEach((r) => write(r + "\n")); write("\n"); }
      if (incoming.length > 0) { write("**Referenced by:**\n"); incoming.forEach((r) => write(r + "\n")); write("\n"); }
    }
  }

  const funcsFile = join(schemaDir, "functions.md");
  if (existsSync(funcsFile)) {
    const content = readFileSync(funcsFile, "utf-8");
    const namePatterns = [match, match.endsWith("s") ? match.slice(0, -1) : match + "s"];
    const funcs = new Set<string>();
    for (const line of content.split("\n")) {
      if (line.startsWith("## ")) {
        const funcName = line.replace("## ", "");
        for (const pattern of namePatterns) {
          if (funcName.toLowerCase().includes(pattern.toLowerCase())) funcs.add(funcName);
        }
      }
    }
    if (funcs.size > 0) {
      write("## Related Functions\n\n");
      for (const f of funcs) write(`- \`${f}\`\n`);
      write("\n");
    }
  }
}

export function tableCommand(): Command {
  return new Command("table")
    .description("Show full details for a table — columns, relationships, related tables, functions that use it")
    .argument("<name>", "Table name (exact or partial match)")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .action((name: string, opts: { dir: string }) => {
      const schemaDir = join(process.cwd(), opts.dir);

      if (!existsSync(schemaDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      if (hasDb(schemaDir)) {
        runSqlite(schemaDir, name);
      } else {
        runMarkdown(schemaDir, name);
      }
    });
}
