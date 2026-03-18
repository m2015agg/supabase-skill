import { Command } from "commander";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readConfig } from "../util/config.js";
import { hasDb, openDb, getAllTableNames, getTableColumns } from "../util/db.js";
import { fetchOpenAPISpec } from "./snapshot.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

interface ColumnDef {
  description?: string;
  format?: string;
  type?: string;
}

interface TableDef {
  properties: Record<string, ColumnDef>;
  type: string;
}

interface OpenAPISpec {
  definitions: Record<string, TableDef>;
  paths: Record<string, unknown>;
}

export function diffCommand(): Command {
  return new Command("diff")
    .description("Compare live database schema against local snapshot — find added/removed tables and columns")
    .option("--project-ref <ref>", "Supabase project ref")
    .option("--schema <name>", "Schema name")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .action((opts: { projectRef?: string; schema?: string; dir: string }) => {
      const cwd = process.cwd();
      const schemaDir = join(cwd, opts.dir);
      const config = readConfig();

      // Resolve project ref
      let ref = opts.projectRef;
      if (!ref && config) {
        const stageEnv = config.environments["stage"] || config.environments[config.defaultEnv];
        if (stageEnv) ref = stageEnv.ref;
      }
      if (!ref) {
        write("Error: No project ref. Use --project-ref or run `supabase-skill install`.\n");
        process.exit(1);
      }

      const schema = opts.schema || config?.schema || "public";

      if (!existsSync(schemaDir) || !hasDb(schemaDir)) {
        write("Error: No snapshot found. Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      write(`\n  Diffing live "${schema}" (${ref}) vs local snapshot...\n\n`);

      // Fetch fresh spec
      write("  Fetching live schema... ");
      let spec: OpenAPISpec;
      try {
        spec = fetchOpenAPISpec(ref, schema) as unknown as OpenAPISpec;
      } catch (e) {
        write(`FAILED\n  ${(e as Error).message}\n`);
        process.exit(1);
      }
      write("\u2713\n\n");

      // Load local snapshot
      const db = openDb(schemaDir);
      const localTables = new Set(getAllTableNames(db));
      const remoteTables = new Set(Object.keys(spec.definitions));

      let changes = 0;

      // Tables added remotely
      const added = [...remoteTables].filter((t) => !localTables.has(t)).sort();
      if (added.length > 0) {
        write(`  + ${added.length} table(s) added:\n`);
        for (const t of added) {
          const colCount = Object.keys(spec.definitions[t].properties).length;
          write(`    + ${t} (${colCount} columns)\n`);
        }
        write("\n");
        changes += added.length;
      }

      // Tables removed remotely
      const removed = [...localTables].filter((t) => !remoteTables.has(t)).sort();
      if (removed.length > 0) {
        write(`  - ${removed.length} table(s) removed:\n`);
        for (const t of removed) write(`    - ${t}\n`);
        write("\n");
        changes += removed.length;
      }

      // Column-level diffs for tables that exist in both
      const common = [...localTables].filter((t) => remoteTables.has(t)).sort();
      for (const table of common) {
        const localCols = new Set(getTableColumns(db, table).map((c) => c.name));
        const remoteCols = new Set(Object.keys(spec.definitions[table].properties));

        const addedCols = [...remoteCols].filter((c) => !localCols.has(c));
        const removedCols = [...localCols].filter((c) => !remoteCols.has(c));

        if (addedCols.length > 0 || removedCols.length > 0) {
          write(`  ~ ${table}:\n`);
          for (const c of addedCols) {
            const def = spec.definitions[table].properties[c];
            write(`    + ${c} (${def.format || def.type || "unknown"})\n`);
          }
          for (const c of removedCols) {
            write(`    - ${c}\n`);
          }
          write("\n");
          changes += addedCols.length + removedCols.length;
        }
      }

      // Functions diff
      const localFuncs = new Set(
        (db.prepare("SELECT name FROM functions ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name),
      );
      const remoteFuncs = new Set(
        Object.keys(spec.paths as Record<string, unknown>)
          .filter((p) => p.startsWith("/rpc/"))
          .map((p) => p.replace("/rpc/", "")),
      );

      const addedFuncs = [...remoteFuncs].filter((f) => !localFuncs.has(f)).sort();
      const removedFuncs = [...localFuncs].filter((f) => !remoteFuncs.has(f)).sort();

      if (addedFuncs.length > 0) {
        write(`  + ${addedFuncs.length} function(s) added:\n`);
        for (const f of addedFuncs) write(`    + ${f}\n`);
        write("\n");
        changes += addedFuncs.length;
      }

      if (removedFuncs.length > 0) {
        write(`  - ${removedFuncs.length} function(s) removed:\n`);
        for (const f of removedFuncs) write(`    - ${f}\n`);
        write("\n");
        changes += removedFuncs.length;
      }

      db.close();

      if (changes === 0) {
        write("  No changes detected. Snapshot is up to date.\n\n");
      } else {
        write(`  ${changes} change(s) detected. Run \`supabase-skill snapshot\` to update.\n\n`);
      }
    });
}
