import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

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

function getAllColumns(tablesDir: string): ColumnMatch[] {
  const results: ColumnMatch[] = [];
  const files = readdirSync(tablesDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const table = file.replace(".md", "");
    const content = readFileSync(join(tablesDir, file), "utf-8");

    for (const line of content.split("\n")) {
      if (line.startsWith("|") && !line.startsWith("| Column") && !line.startsWith("|---")) {
        const cols = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cols.length >= 5) {
          results.push({
            table,
            column: cols[0].replace(/\s*\*\*PK\*\*/, ""),
            type: cols[1],
            nullable: cols[2],
            defaultVal: cols[3],
            fk: cols[4],
            isPk: cols[0].includes("**PK**"),
          });
        }
      }
    }
  }
  return results;
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
      dir: string;
      type?: string;
      fk?: boolean;
      pk?: boolean;
      nullable?: boolean;
      notNull?: boolean;
      hasDefault?: boolean;
      table?: string;
      json?: boolean;
    }) => {
      const schemaDir = join(process.cwd(), opts.dir);
      const tablesDir = join(schemaDir, "tables");

      if (!existsSync(tablesDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      let columns = getAllColumns(tablesDir);

      // Apply filters
      if (query) {
        const q = query.toLowerCase();
        columns = columns.filter((c) => c.column.toLowerCase().includes(q));
      }

      if (opts.type) {
        const t = opts.type.toLowerCase();
        columns = columns.filter((c) => c.type.toLowerCase().includes(t));
      }

      if (opts.fk) {
        columns = columns.filter((c) => c.fk.length > 0);
      }

      if (opts.pk) {
        columns = columns.filter((c) => c.isPk);
      }

      if (opts.nullable) {
        columns = columns.filter((c) => c.nullable === "nullable");
      }

      if (opts.notNull) {
        columns = columns.filter((c) => c.nullable === "NOT NULL");
      }

      if (opts.hasDefault) {
        columns = columns.filter((c) => c.defaultVal.length > 0);
      }

      if (opts.table) {
        const tbl = opts.table.toLowerCase();
        columns = columns.filter((c) => c.table.toLowerCase().includes(tbl));
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

      // Summary stats
      const tables = new Set(columns.map((c) => c.table));
      const types = new Map<string, number>();
      for (const col of columns) {
        types.set(col.type, (types.get(col.type) || 0) + 1);
      }

      write(`Across ${tables.size} table(s). `);
      write(`Types: ${[...types.entries()].map(([t, n]) => `${t}(${n})`).join(", ")}\n\n`);
    });
}
