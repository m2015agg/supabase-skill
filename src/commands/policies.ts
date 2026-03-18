import { Command } from "commander";
import { openDb, hasDb, queryPolicies } from "../util/db.js";

const SCHEMA_DIR = ".supabase-schema";

export function policiesCommand(): Command {
  return new Command("policies")
    .description("List RLS policies from local schema cache")
    .argument("[table]", "Filter by table name")
    .option("--command <cmd>", "Filter by command: SELECT, INSERT, UPDATE, DELETE, ALL")
    .option("--json", "Output as JSON")
    .action((table?: string, opts?: { command?: string; json?: boolean }) => {
      if (!hasDb(SCHEMA_DIR)) {
        console.error("No schema snapshot found. Run: supabase-skill snapshot");
        process.exit(1);
      }

      const db = openDb(SCHEMA_DIR);

      try {
        let results = queryPolicies(db, table);

        if (opts?.command) {
          results = results.filter((p) => p.command.toUpperCase() === opts.command!.toUpperCase());
        }

        if (results.length === 0) {
          console.log("\n  No policies found. Run `supabase-skill snapshot` with DATABASE_URL set for pg_catalog data.\n");
          return;
        }

        if (opts?.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        console.log(`\n  ${results.length} policy/policies found\n`);

        // Group by table
        const grouped = new Map<string, typeof results>();
        for (const p of results) {
          if (!grouped.has(p.table_name)) grouped.set(p.table_name, []);
          grouped.get(p.table_name)!.push(p);
        }

        for (const [tbl, pols] of grouped) {
          console.log(`  ${tbl}:`);
          for (const p of pols) {
            console.log(`    ${p.policy_name} (${p.command}) → roles: ${p.roles}`);
            if (p.using_expr) {
              const expr = p.using_expr.length > 100 ? p.using_expr.slice(0, 100) + "..." : p.using_expr;
              console.log(`      USING: ${expr}`);
            }
            if (p.with_check_expr) {
              const expr = p.with_check_expr.length > 100 ? p.with_check_expr.slice(0, 100) + "..." : p.with_check_expr;
              console.log(`      WITH CHECK: ${expr}`);
            }
          }
        }

        console.log();
      } finally {
        db.close();
      }
    });
}
