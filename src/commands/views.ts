import { Command } from "commander";
import { openDb, hasDb, queryViews } from "../util/db.js";

const SCHEMA_DIR = ".supabase-schema";

export function viewsCommand(): Command {
  return new Command("views")
    .description("List database views and their definitions from local schema cache")
    .argument("[name]", "Filter by view name")
    .option("--json", "Output as JSON")
    .option("--full", "Show full view definitions")
    .action((name?: string, opts?: { json?: boolean; full?: boolean }) => {
      if (!hasDb(SCHEMA_DIR)) {
        console.error("No schema snapshot found. Run: supabase-skill snapshot");
        process.exit(1);
      }

      const db = openDb(SCHEMA_DIR);

      try {
        const results = queryViews(db, name);

        if (results.length === 0) {
          console.log("\n  No views found. Run `supabase-skill snapshot` with DATABASE_URL set for pg_catalog data.\n");
          return;
        }

        if (opts?.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        console.log(`\n  ${results.length} view(s) found\n`);

        for (const v of results) {
          console.log(`  ${v.name} (${v.column_count} columns)`);
          if (opts?.full && v.definition) {
            console.log(`    ${v.definition.trim()}`);
            console.log();
          }
        }

        console.log();
      } finally {
        db.close();
      }
    });
}
