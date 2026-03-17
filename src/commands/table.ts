import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

function write(msg: string): void {
  process.stdout.write(msg);
}

export function tableCommand(): Command {
  return new Command("table")
    .description("Show full details for a table — columns, relationships, related tables, functions that use it")
    .argument("<name>", "Table name (exact or partial match)")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .action((name: string, opts: { dir: string }) => {
      const schemaDir = join(process.cwd(), opts.dir);
      const tablesDir = join(schemaDir, "tables");

      if (!existsSync(tablesDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      // Find the table
      const allTables = readdirSync(tablesDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
      const exact = allTables.find((t) => t === name.toLowerCase());
      const match = exact || allTables.find((t) => t.includes(name.toLowerCase()));

      if (!match) {
        write(`Table "${name}" not found.\n`);
        const similar = allTables.filter((t) => t.includes(name.toLowerCase().slice(0, 4)));
        if (similar.length > 0) {
          write(`Did you mean: ${similar.join(", ")}?\n`);
        }
        return;
      }

      // Print the table file
      const content = readFileSync(join(tablesDir, `${match}.md`), "utf-8");
      write(content);
      write("\n");

      // Find relationships
      const relsFile = join(schemaDir, "relationships.json");
      if (existsSync(relsFile)) {
        const rels = JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string>;

        const outgoing: string[] = [];
        const incoming: string[] = [];

        for (const [from, to] of Object.entries(rels)) {
          const [fromTable] = from.split(".");
          const [toTable] = to.split(".");
          if (fromTable === match) {
            outgoing.push(`  → ${to} (via ${from.split(".")[1]})`);
          }
          if (toTable === match) {
            incoming.push(`  ← ${from}`);
          }
        }

        if (outgoing.length > 0 || incoming.length > 0) {
          write("\n## Relationships\n\n");
          if (outgoing.length > 0) {
            write("**This table references:**\n");
            outgoing.forEach((r) => write(r + "\n"));
            write("\n");
          }
          if (incoming.length > 0) {
            write("**Referenced by:**\n");
            incoming.forEach((r) => write(r + "\n"));
            write("\n");
          }
        }
      }

      // Find functions that might use this table
      const funcsFile = join(schemaDir, "functions.md");
      if (existsSync(funcsFile)) {
        const funcsContent = readFileSync(funcsFile, "utf-8");
        const matchingFuncs: string[] = [];
        let currentFunc = "";

        for (const line of funcsContent.split("\n")) {
          if (line.startsWith("## ")) {
            currentFunc = line.replace("## ", "");
          }
          if (currentFunc && line.toLowerCase().includes(match.toLowerCase())) {
            if (!matchingFuncs.includes(currentFunc)) {
              matchingFuncs.push(currentFunc);
            }
          }
        }

        // Also check by common naming patterns
        const namePatterns = [
          match,
          match.replace(/_/g, ""),
          match.endsWith("s") ? match.slice(0, -1) : match + "s",
        ];

        for (const func of funcsContent.split("\n")) {
          if (func.startsWith("## ")) {
            const funcName = func.replace("## ", "").toLowerCase();
            for (const pattern of namePatterns) {
              if (funcName.includes(pattern.toLowerCase()) && !matchingFuncs.includes(func.replace("## ", ""))) {
                matchingFuncs.push(func.replace("## ", ""));
              }
            }
          }
        }

        if (matchingFuncs.length > 0) {
          write("## Related Functions\n\n");
          for (const func of matchingFuncs) {
            write(`- \`${func}\`\n`);
          }
          write("\n");
        }
      }

      // Show related table summaries (1 level deep)
      const relsFile2 = join(schemaDir, "relationships.json");
      if (existsSync(relsFile2)) {
        const rels = JSON.parse(readFileSync(relsFile2, "utf-8")) as Record<string, string>;
        const relatedTables = new Set<string>();

        for (const [from, to] of Object.entries(rels)) {
          const [fromTable] = from.split(".");
          const [toTable] = to.split(".");
          if (fromTable === match) relatedTables.add(toTable);
          if (toTable === match) relatedTables.add(fromTable);
        }

        if (relatedTables.size > 0) {
          write("## Related Table Summaries\n\n");
          for (const relTable of relatedTables) {
            const relFile = join(tablesDir, `${relTable}.md`);
            if (existsSync(relFile)) {
              const relContent = readFileSync(relFile, "utf-8");
              // Just the header line (column count)
              const headerLine = relContent.split("\n").find((l) => l.match(/^\d+ columns/));
              if (headerLine) {
                write(`- **${relTable}**: ${headerLine}\n`);
              }
            }
          }
          write("\n");
        }
      }
    });
}
