import { Command } from "commander";
import { openDb, hasDb, queryEnums } from "../util/db.js";

const SCHEMA_DIR = ".supabase-schema";

export function enumsCommand(): Command {
  return new Command("enums")
    .description("List custom enum types and their values from local schema cache")
    .argument("[name]", "Filter by enum name")
    .option("--json", "Output as JSON")
    .action((name?: string, opts?: { json?: boolean }) => {
      if (!hasDb(SCHEMA_DIR)) {
        console.error("No schema snapshot found. Run: supabase-skill snapshot");
        process.exit(1);
      }

      const db = openDb(SCHEMA_DIR);

      try {
        const results = queryEnums(db, name);

        if (results.length === 0) {
          console.log("\n  No enums found. Run `supabase-skill snapshot` with DATABASE_URL set for pg_catalog data.\n");
          return;
        }

        if (opts?.json) {
          const output = results.map((e) => ({
            name: e.name,
            values: JSON.parse(e.enum_values || "[]"),
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        console.log(`\n  ${results.length} enum(s) found\n`);

        for (const e of results) {
          const values = JSON.parse(e.enum_values || "[]") as string[];
          console.log(`  ${e.name}: ${values.join(" | ")}`);
        }

        console.log();
      } finally {
        db.close();
      }
    });
}
