import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

function write(msg: string): void {
  process.stdout.write(msg);
}

export function searchCommand(): Command {
  return new Command("search")
    .description("Search the local schema snapshot for tables, columns, or functions")
    .argument("<query>", "Search term (table name, column name, or function name)")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .option("--json", "Output as JSON")
    .action((query: string, opts: { dir: string; json?: boolean }) => {
      const schemaDir = join(process.cwd(), opts.dir);

      if (!existsSync(schemaDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      const q = query.toLowerCase();
      const results: Array<{ type: string; name: string; match: string; file: string }> = [];

      // Search tables directory
      const tablesDir = join(schemaDir, "tables");
      if (existsSync(tablesDir)) {
        const files = readdirSync(tablesDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const tableName = file.replace(".md", "");
          const content = readFileSync(join(tablesDir, file), "utf-8");

          // Table name match
          if (tableName.toLowerCase().includes(q)) {
            results.push({ type: "table", name: tableName, match: "name", file: `tables/${file}` });
          }

          // Column name match
          const lines = content.split("\n");
          for (const line of lines) {
            if (line.startsWith("|") && !line.startsWith("| Column") && !line.startsWith("|---")) {
              const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
              if (cols.length > 0) {
                const colName = cols[0].replace(/\s*\*\*PK\*\*/, "");
                if (colName.toLowerCase().includes(q)) {
                  const typeStr = cols[1] || "";
                  results.push({
                    type: "column",
                    name: `${tableName}.${colName}`,
                    match: `${typeStr}`,
                    file: `tables/${file}`,
                  });
                }
              }
            }
          }
        }
      }

      // Search functions
      const funcsFile = join(schemaDir, "functions.md");
      if (existsSync(funcsFile)) {
        const content = readFileSync(funcsFile, "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          if (line.startsWith("## ")) {
            const funcName = line.replace("## ", "");
            if (funcName.toLowerCase().includes(q)) {
              results.push({ type: "function", name: funcName, match: "name", file: "functions.md" });
            }
          }
        }
      }

      // Search relationships
      const relsFile = join(schemaDir, "relationships.json");
      if (existsSync(relsFile)) {
        const rels = JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string>;
        for (const [from, to] of Object.entries(rels)) {
          if (from.toLowerCase().includes(q) || to.toLowerCase().includes(q)) {
            results.push({ type: "fk", name: `${from} → ${to}`, match: "relationship", file: "relationships.json" });
          }
        }
      }

      if (opts.json) {
        write(JSON.stringify(results, null, 2) + "\n");
        return;
      }

      if (results.length === 0) {
        write(`No matches for "${query}"\n`);
        return;
      }

      write(`\n${results.length} match(es) for "${query}":\n\n`);

      // Group by type
      const grouped: Record<string, typeof results> = {};
      for (const r of results) {
        if (!grouped[r.type]) grouped[r.type] = [];
        grouped[r.type].push(r);
      }

      for (const [type, items] of Object.entries(grouped)) {
        write(`  ${type.toUpperCase()}S:\n`);
        for (const item of items) {
          const detail = item.match && item.match !== "name" ? ` (${item.match})` : "";
          write(`    ${item.name}${detail}  [${item.file}]\n`);
        }
        write("\n");
      }
    });
}
