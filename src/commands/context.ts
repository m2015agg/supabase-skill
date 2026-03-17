import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

function write(msg: string): void {
  process.stdout.write(msg);
}

interface Relationship {
  from: string;
  to: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
  defaultVal: string;
  fk: string;
  isPk: boolean;
}

function parseTableFile(filePath: string): { columns: ColumnInfo[]; notes: string[] } {
  const content = readFileSync(filePath, "utf-8");
  const columns: ColumnInfo[] = [];
  const notes: string[] = [];
  let inNotes = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("## Notes")) {
      inNotes = true;
      continue;
    }
    if (inNotes && line.startsWith("- ")) {
      notes.push(line);
      continue;
    }
    if (line.startsWith("|") && !line.startsWith("| Column") && !line.startsWith("|---")) {
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cols.length >= 5) {
        columns.push({
          name: cols[0].replace(/\s*\*\*PK\*\*/, ""),
          type: cols[1],
          nullable: cols[2],
          defaultVal: cols[3],
          fk: cols[4],
          isPk: cols[0].includes("**PK**"),
        });
      }
    }
  }
  return { columns, notes };
}

function loadRelationships(schemaDir: string): Relationship[] {
  const relsFile = join(schemaDir, "relationships.json");
  if (!existsSync(relsFile)) return [];
  const rels = JSON.parse(readFileSync(relsFile, "utf-8")) as Record<string, string>;
  return Object.entries(rels).map(([from, to]) => ({ from, to }));
}

function loadFunctions(schemaDir: string): Array<{ name: string; params: string[] }> {
  const funcsFile = join(schemaDir, "functions.md");
  if (!existsSync(funcsFile)) return [];
  const content = readFileSync(funcsFile, "utf-8");
  const funcs: Array<{ name: string; params: string[] }> = [];
  let currentFunc = "";
  let currentParams: string[] = [];

  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) {
      if (currentFunc) funcs.push({ name: currentFunc, params: currentParams });
      currentFunc = line.replace("## ", "");
      currentParams = [];
    } else if (line.startsWith("- `") && currentFunc) {
      currentParams.push(line.replace("- `", "").replace(/`.*/, ""));
    }
  }
  if (currentFunc) funcs.push({ name: currentFunc, params: currentParams });
  return funcs;
}

function getRelatedTables(
  tableName: string,
  rels: Relationship[],
  depth: number,
  visited: Set<string>,
): Map<string, { direction: string; via: string; depth: number }> {
  const related = new Map<string, { direction: string; via: string; depth: number }>();
  if (depth <= 0) return related;

  for (const rel of rels) {
    const [fromTable, fromCol] = rel.from.split(".");
    const [toTable, toCol] = rel.to.split(".");

    if (fromTable === tableName && !visited.has(toTable)) {
      related.set(toTable, {
        direction: "references",
        via: `${fromCol} → ${toTable}.${toCol}`,
        depth,
      });
      visited.add(toTable);
      if (depth > 1) {
        const deeper = getRelatedTables(toTable, rels, depth - 1, visited);
        for (const [k, v] of deeper) {
          if (!related.has(k)) related.set(k, v);
        }
      }
    }

    if (toTable === tableName && !visited.has(fromTable)) {
      related.set(fromTable, {
        direction: "referenced by",
        via: `${fromTable}.${fromCol} → ${toCol}`,
        depth,
      });
      visited.add(fromTable);
      if (depth > 1) {
        const deeper = getRelatedTables(fromTable, rels, depth - 1, visited);
        for (const [k, v] of deeper) {
          if (!related.has(k)) related.set(k, v);
        }
      }
    }
  }

  return related;
}

export function contextCommand(): Command {
  return new Command("context")
    .description("Get comprehensive context for a table or topic — related tables, FKs, functions, column details")
    .argument("<query>", "Table name or topic (e.g., 'episodes', 'user subscriptions', 'chat')")
    .option("--dir <dir>", "Schema directory", ".supabase-schema")
    .option("--depth <n>", "FK traversal depth", "2")
    .option("--json", "Output as JSON")
    .action((query: string, opts: { dir: string; depth: string; json?: boolean }) => {
      const schemaDir = join(process.cwd(), opts.dir);
      const depth = parseInt(opts.depth, 10);

      if (!existsSync(schemaDir)) {
        write(`No schema snapshot found at ${opts.dir}/\n`);
        write("Run `supabase-skill snapshot` first.\n");
        process.exit(1);
      }

      const tablesDir = join(schemaDir, "tables");
      const allTables = readdirSync(tablesDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
      const rels = loadRelationships(schemaDir);
      const funcs = loadFunctions(schemaDir);
      const q = query.toLowerCase();

      // Find matching tables (exact match first, then fuzzy)
      let entryTables: string[] = [];
      const exactMatch = allTables.find((t) => t === q);
      if (exactMatch) {
        entryTables = [exactMatch];
      } else {
        entryTables = allTables.filter((t) => t.toLowerCase().includes(q));
      }

      if (entryTables.length === 0) {
        // Try matching by column names
        for (const table of allTables) {
          const { columns } = parseTableFile(join(tablesDir, `${table}.md`));
          if (columns.some((c) => c.name.toLowerCase().includes(q))) {
            entryTables.push(table);
          }
        }
      }

      if (entryTables.length === 0) {
        write(`No tables or columns match "${query}"\n`);
        return;
      }

      // Find related functions
      const matchingFuncs = funcs.filter((f) =>
        f.name.toLowerCase().includes(q) ||
        f.params.some((p) => p.toLowerCase().includes(q)),
      );

      if (opts.json) {
        const result: Record<string, unknown> = { entryTables: [] };
        const tableResults: unknown[] = [];

        for (const table of entryTables.slice(0, 5)) {
          const { columns, notes } = parseTableFile(join(tablesDir, `${table}.md`));
          const visited = new Set([table]);
          const related = getRelatedTables(table, rels, depth, visited);
          tableResults.push({
            name: table,
            columns,
            notes,
            related: Object.fromEntries(
              [...related.entries()].map(([k, v]) => [k, v]),
            ),
          });
        }
        result.entryTables = tableResults;
        result.functions = matchingFuncs;
        write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      // Pretty output
      write(`\n# Context for "${query}"\n\n`);

      for (const table of entryTables.slice(0, 5)) {
        const filePath = join(tablesDir, `${table}.md`);
        const { columns, notes } = parseTableFile(filePath);
        const visited = new Set([table]);
        const related = getRelatedTables(table, rels, depth, visited);

        // Table header
        const pkCount = columns.filter((c) => c.isPk).length;
        const fkCount = columns.filter((c) => c.fk).length;
        write(`## ${table}\n`);
        write(`${columns.length} columns | ${pkCount} PK | ${fkCount} FK\n\n`);

        // Columns
        write("| Column | Type | Nullable | Default | FK |\n");
        write("|--------|------|----------|---------|----|\n");
        for (const col of columns) {
          const pk = col.isPk ? " **PK**" : "";
          write(`| ${col.name}${pk} | ${col.type} | ${col.nullable} | ${col.defaultVal} | ${col.fk} |\n`);
        }
        write("\n");

        // Notes
        if (notes.length > 0) {
          for (const note of notes) {
            write(`${note}\n`);
          }
          write("\n");
        }

        // Related tables
        if (related.size > 0) {
          write("### Related Tables\n\n");

          // Group by direction
          const refs = [...related.entries()].filter(([, v]) => v.direction === "references");
          const refBy = [...related.entries()].filter(([, v]) => v.direction === "referenced by");

          if (refs.length > 0) {
            write("**References (this table points to):**\n");
            for (const [name, info] of refs) {
              write(`  → ${name} via ${info.via}\n`);
            }
            write("\n");
          }

          if (refBy.length > 0) {
            write("**Referenced by (points to this table):**\n");
            for (const [name, info] of refBy) {
              write(`  ← ${name} via ${info.via}\n`);
            }
            write("\n");
          }
        }

        write("---\n\n");
      }

      if (entryTables.length > 5) {
        write(`... and ${entryTables.length - 5} more matching tables\n\n`);
      }

      // Related functions
      if (matchingFuncs.length > 0) {
        write("## Related Functions\n\n");
        for (const func of matchingFuncs) {
          const paramStr = func.params.length > 0 ? `(${func.params.join(", ")})` : "()";
          write(`- \`${func.name}${paramStr}\`\n`);
        }
        write("\n");
      }
    });
}
