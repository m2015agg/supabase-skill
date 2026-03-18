import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { hasDb, openDb } from "../util/db.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

interface RelRow {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

function generateFromDb(schemaDir: string): void {
  const db = openDb(schemaDir);
  const rels = db.prepare(
    "SELECT from_table, from_column, to_table, to_column FROM relationships ORDER BY from_table, to_table",
  ).all() as RelRow[];

  write("erDiagram\n");
  for (const r of rels) {
    write(`  ${r.from_table} }o--|| ${r.to_table} : "${r.from_column} -> ${r.to_column}"\n`);
  }

  db.close();
}

function generateFromJson(schemaDir: string): void {
  const relsFile = join(schemaDir, "relationships.json");
  if (!existsSync(relsFile)) {
    write("Error: No relationships data found.\n");
    process.exit(1);
  }

  const rels = JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string>;

  write("erDiagram\n");
  for (const [from, to] of Object.entries(rels)) {
    const [fromTable, fromCol] = from.split(".");
    const [toTable, toCol] = to.split(".");
    write(`  ${fromTable} }o--|| ${toTable} : "${fromCol} -> ${toCol}"\n`);
  }
}

export function graphCommand(): Command {
  return new Command("graph")
    .description("Output mermaid erDiagram of table relationships from snapshot")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .action((opts: { dir: string }) => {
      const schemaDir = join(process.cwd(), opts.dir);

      if (!existsSync(schemaDir)) {
        write("Error: No schema snapshot found. Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      if (hasDb(schemaDir)) {
        generateFromDb(schemaDir);
      } else {
        generateFromJson(schemaDir);
      }
    });
}
