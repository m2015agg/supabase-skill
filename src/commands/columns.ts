import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hasDb, openDb, queryColumns, type ColumnQueryResult } from "../util/db.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

interface ColumnMatch {
  table: string;
  column: string;
  type: string;
  nullable: string;
  defaultVal: string;
  fk: string;
  isPk: boolean;
}

function queryMarkdown(tablesDir: string, opts: {
  name?: string; type?: string; fk?: boolean; pk?: boolean;
  nullable?: boolean; notNull?: boolean; hasDefault?: boolean; table?: string;
}): ColumnMatch[] {
  const results: ColumnMatch[] = [];
  const files = readdirSync(tablesDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const table = file.replace(".md", "");
    if (opts.table && !table.toLowerCase().includes(opts.table.toLowerCase())) continue;

    for (const line of readFileSync(join(tablesDir, file), "utf-8").split("\n")) {
      if (line.startsWith("|") && !line.startsWith("| Column") && !line.startsWith("|---")) {
        const cols = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cols.length >= 5) {
          const match: ColumnMatch = {
            table,
            column: cols[0].replace(/\s*\*\*PK\*\*/, ""),
            type: cols[1],
            nullable: cols[2],
            defaultVal: cols[3],
            fk: cols[4],
            isPk: cols[0].includes("**PK**"),
          };

          if (opts.name && !match.column.toLowerCase().includes(opts.name.toLowerCase())) continue;
          if (opts.type && !match.type.toLowerCase().includes(opts.type.toLowerCase())) continue;
          if (opts.fk && !match.fk) continue;
          if (opts.pk && !match.isPk) continue;
          if (opts.nullable && match.nullable !== "nullable") continue;
          if (opts.notNull && match.nullable !== "NOT NULL") continue;
          if (opts.hasDefault && !match.defaultVal) continue;

          results.push(match);
        }
      }
    }
  }
  return results;
}

function sqliteToMatch(r: ColumnQueryResult): ColumnMatch {
  return {
    table: r.table_name,
    column: r.name,
    type: r.type || "unknown",
    nullable: r.nullable ? "nullable" : "NOT NULL",
    defaultVal: r.default_value || "",
    fk: r.fk_table ? `→ ${r.fk_table}.${r.fk_column}` : "",
    isPk: !!r.is_pk,
  };
}

export function columnsCommand(): Command {
  return new Command("columns")
    .description("Search columns across all tables by name, type, or attributes")
    .argument("[query]", "Column name to search for")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .option("--type <type>", "Filter by data type (uuid, text, jsonb, integer, timestamp, boolean, etc.)")
    .option("--fk", "Show only foreign key columns")
    .option("--pk", "Show only primary key columns")
    .option("--nullable", "Show only nullable columns")
    .option("--not-null", "Show only NOT NULL columns")
    .option("--has-default", "Show only columns with defaults")
    .option("--table <name>", "Filter to specific table")
    .option("--json", "Output as JSON")
    .action((query: string | undefined, opts: {
      dir: string; type?: string; fk?: boolean; pk?: boolean;
      nullable?: boolean; notNull?: boolean; hasDefault?: boolean;
      table?: string; json?: boolean;
    }) => {
      const schemaDir = join(process.cwd(), opts.dir);
      const tablesDir = join(schemaDir, "tables");

      if (!existsSync(schemaDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      let columns: ColumnMatch[];

      if (hasDb(schemaDir)) {
        const db = openDb(schemaDir);
        const results = queryColumns(db, {
          name: query, type: opts.type, fk: opts.fk, pk: opts.pk,
          nullable: opts.nullable, notNull: opts.notNull, hasDefault: opts.hasDefault, table: opts.table,
        });
        db.close();
        columns = results.map(sqliteToMatch);
      } else {
        columns = queryMarkdown(tablesDir, {
          name: query, type: opts.type, fk: opts.fk, pk: opts.pk,
          nullable: opts.nullable, notNull: opts.notNull, hasDefault: opts.hasDefault, table: opts.table,
        });
      }

      if (opts.json) {
        write(JSON.stringify(columns, null, 2) + "\n");
        return;
      }

      if (columns.length === 0) {
        write("No matching columns found.\n");
        return;
      }

      write(`\n${columns.length} matching column(s):\n\n`);
      write("| Table | Column | Type | Nullable | Default | FK |\n");
      write("|-------|--------|------|----------|---------|----|\n");

      for (const col of columns) {
        const pk = col.isPk ? " **PK**" : "";
        write(`| ${col.table} | ${col.column}${pk} | ${col.type} | ${col.nullable} | ${col.defaultVal} | ${col.fk} |\n`);
      }
      write("\n");

      const tables = new Set(columns.map((c) => c.table));
      const types = new Map<string, number>();
      for (const col of columns) {
        types.set(col.type, (types.get(col.type) || 0) + 1);
      }
      write(`Across ${tables.size} table(s). Types: ${[...types.entries()].map(([t, n]) => `${t}(${n})`).join(", ")}\n\n`);
    });
}
