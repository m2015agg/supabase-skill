import { Command } from "commander";
import { openDb, hasDb, queryTriggers } from "../util/db.js";

const SCHEMA_DIR = ".supabase-schema";

export function triggersCommand(): Command {
  return new Command("triggers")
    .description("List database triggers from local schema cache")
    .argument("[table]", "Filter by table name")
    .option("--event <event>", "Filter by event: INSERT, UPDATE, DELETE")
    .option("--json", "Output as JSON")
    .action((table?: string, opts?: { event?: string; json?: boolean }) => {
      if (!hasDb(SCHEMA_DIR)) {
        console.error("No schema snapshot found. Run: supabase-skill snapshot");
        process.exit(1);
      }

      const db = openDb(SCHEMA_DIR);

      try {
        let results = queryTriggers(db, table);

        if (opts?.event) {
          results = results.filter((t) => t.event.toUpperCase() === opts.event!.toUpperCase());
        }

        if (results.length === 0) {
          console.log("\n  No triggers found. Run `supabase-skill snapshot` with DATABASE_URL set for pg_catalog data.\n");
          return;
        }

        if (opts?.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        console.log(`\n  ${results.length} trigger(s) found\n`);

        // Group by table
        const grouped = new Map<string, typeof results>();
        for (const t of results) {
          if (!grouped.has(t.table_name)) grouped.set(t.table_name, []);
          grouped.get(t.table_name)!.push(t);
        }

        for (const [tbl, trigs] of grouped) {
          console.log(`  ${tbl}:`);
          for (const t of trigs) {
            console.log(`    ${t.trigger_name} — ${t.timing} ${t.event} → ${t.function_name}`);
          }
        }

        console.log();
      } finally {
        db.close();
      }
    });
}
