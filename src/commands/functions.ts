import { Command } from "commander";
import { openDb, hasDb, getAllFunctions, findMatchingFunctions } from "../util/db.js";

const SCHEMA_DIR = ".supabase-schema";

export function functionsCommand(): Command {
  return new Command("functions")
    .description("List and search RPC functions from local schema cache")
    .argument("[query]", "Filter functions by name")
    .option("--returns <type>", "Filter by return type")
    .option("--args <type>", "Filter by argument type")
    .option("--json", "Output as JSON")
    .action((query?: string, opts?: { returns?: string; args?: string; json?: boolean }) => {
      if (!hasDb(SCHEMA_DIR)) {
        console.error("No schema snapshot found. Run: supabase-skill snapshot");
        process.exit(1);
      }

      const db = openDb(SCHEMA_DIR);

      try {
        let results: Array<{ name: string; params: string; description: string | null }>;

        if (query) {
          results = findMatchingFunctions(db, query);
        } else {
          results = getAllFunctions(db);
        }

        // Filter by return type or arg type if specified
        if (opts?.returns) {
          results = results.filter((f) => {
            const params = JSON.parse(f.params || "[]");
            // Check description for return type info
            return f.description?.toLowerCase().includes(opts.returns!.toLowerCase()) ?? false;
          });
        }

        if (opts?.args) {
          results = results.filter((f) => {
            const params = JSON.parse(f.params || "[]") as Array<{ name: string; type: string }>;
            return params.some((p) => p.type.toLowerCase().includes(opts.args!.toLowerCase()));
          });
        }

        if (opts?.json) {
          const output = results.map((f) => ({
            name: f.name,
            parameters: JSON.parse(f.params || "[]"),
            description: f.description,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        // Human-readable output
        console.log(`\n  ${results.length} function(s) found\n`);

        for (const f of results) {
          const params = JSON.parse(f.params || "[]") as Array<{ name: string; type: string }>;
          const paramStr = params.map((p) => `${p.name}: ${p.type}`).join(", ");
          console.log(`  ${f.name}(${paramStr})`);
          if (f.description) {
            console.log(`    ${f.description.slice(0, 120)}`);
          }
        }

        console.log();
      } finally {
        db.close();
      }
    });
}
