import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hasDb, openDb, searchFTS } from "../util/db.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

interface SearchResult {
  type: string;
  name: string;
  match: string;
  file: string;
}

function searchSqlite(schemaDir: string, query: string): SearchResult[] {
  const db = openDb(schemaDir);
  const ftsResults = searchFTS(db, query);
  db.close();

  return ftsResults.map((r) => ({
    type: r.type,
    name: r.parent ? `${r.parent}.${r.name}` : r.name,
    match: r.detail || "name",
    file: r.type === "column" ? `tables/${r.parent}.md` : r.type === "table" ? `tables/${r.name}.md` : "functions.md",
  }));
}

function searchMarkdown(schemaDir: string, query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  const tablesDir = join(schemaDir, "tables");
  if (existsSync(tablesDir)) {
    const files = readdirSync(tablesDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const tableName = file.replace(".md", "");
      const content = readFileSync(join(tablesDir, file), "utf-8");

      if (tableName.toLowerCase().includes(q)) {
        results.push({ type: "table", name: tableName, match: "name", file: `tables/${file}` });
      }

      for (const line of content.split("\n")) {
        if (line.startsWith("|") && !line.startsWith("| Column") && !line.startsWith("|---")) {
          const cols = line.split("|").slice(1, -1).map((c) => c.trim());
          if (cols.length > 0) {
            const colName = cols[0].replace(/\s*\*\*PK\*\*/, "");
            if (colName.toLowerCase().includes(q)) {
              results.push({ type: "column", name: `${tableName}.${colName}`, match: cols[1] || "", file: `tables/${file}` });
            }
          }
        }
      }
    }
  }

  const funcsFile = join(schemaDir, "functions.md");
  if (existsSync(funcsFile)) {
    for (const line of readFileSync(funcsFile, "utf-8").split("\n")) {
      if (line.startsWith("## ") && line.toLowerCase().includes(q)) {
        results.push({ type: "function", name: line.replace("## ", ""), match: "name", file: "functions.md" });
      }
    }
  }

  const relsFile = join(schemaDir, "relationships.json");
  if (existsSync(relsFile)) {
    const rels = JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string>;
    for (const [from, to] of Object.entries(rels)) {
      if (from.toLowerCase().includes(q) || to.toLowerCase().includes(q)) {
        results.push({ type: "fk", name: `${from} → ${to}`, match: "relationship", file: "relationships.json" });
      }
    }
  }

  return results;
}

export function searchCommand(): Command {
  return new Command("search")
    .description("Search the local schema snapshot for tables, columns, or functions (FTS5 powered)")
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

      const results = hasDb(schemaDir) ? searchSqlite(schemaDir, query) : searchMarkdown(schemaDir, query);

      if (opts.json) {
        write(JSON.stringify(results, null, 2) + "\n");
        return;
      }

      if (results.length === 0) {
        write(`No matches for "${query}"\n`);
        return;
      }

      write(`\n${results.length} match(es) for "${query}":\n\n`);

      const grouped: Record<string, SearchResult[]> = {};
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
