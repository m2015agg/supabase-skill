import { Command } from "commander";
import { openDb, hasDb, queryIndexes } from "../util/db.js";

const SCHEMA_DIR = ".supabase-schema";

export function indexesCommand(): Command {
  return new Command("indexes")
    .description("List database indexes from local schema cache")
    .argument("[table]", "Filter by table name")
    .option("--unique", "Show only unique indexes")
    .option("--primary", "Show only primary key indexes")
    .option("--json", "Output as JSON")
    .action((table?: string, opts?: { unique?: boolean; primary?: boolean; json?: boolean }) => {
      if (!hasDb(SCHEMA_DIR)) {
        console.error("No schema snapshot found. Run: supabase-skill snapshot");
        process.exit(1);
      }

      const db = openDb(SCHEMA_DIR);

      try {
        let results = queryIndexes(db, table);

        if (opts?.unique) {
          results = results.filter((idx) => idx.is_unique);
        }
        if (opts?.primary) {
          results = results.filter((idx) => idx.is_primary);
        }

        if (results.length === 0) {
          console.log("\n  No indexes found. Run `supabase-skill snapshot` with DATABASE_URL set for pg_catalog data.\n");
          return;
        }

        if (opts?.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        console.log(`\n  ${results.length} index(es) found\n`);

        // Group by table
        const grouped = new Map<string, typeof results>();
        for (const idx of results) {
          const key = idx.table_name || "(unknown)";
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(idx);
        }

        for (const [tbl, idxs] of grouped) {
          console.log(`  ${tbl}:`);
          for (const idx of idxs) {
            const flags = [
              idx.is_primary ? "PK" : "",
              idx.is_unique && !idx.is_primary ? "UNIQUE" : "",
              idx.index_type !== "btree" && idx.index_type !== "unknown" ? idx.index_type : "",
            ].filter(Boolean).join(", ");
            const flagStr = flags ? ` (${flags})` : "";
            console.log(`    ${idx.index_name} → ${idx.columns}${flagStr}`);
          }
        }

        console.log();
      } finally {
        db.close();
      }
    });
}
