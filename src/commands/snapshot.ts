import { Command } from "commander";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { readConfig } from "../util/config.js";
import {
  openDb, initSchema, clearData, insertAll, setMetadata,
  type TableRow, type ColumnRow, type RelRow, type FuncRow,
} from "../util/db.js";

interface ColumnDef {
  description?: string;
  format?: string;
  type?: string;
  default?: string;
  maxLength?: number;
  enum?: string[];
  items?: { type?: string; format?: string };
}

interface TableDef {
  required?: string[];
  properties: Record<string, ColumnDef>;
  type: string;
}

interface RpcParam {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string; format?: string; properties?: Record<string, unknown> };
  type?: string;
  format?: string;
}

interface RpcEndpoint {
  post?: {
    parameters?: RpcParam[];
    description?: string;
  };
}

interface OpenAPISpec {
  definitions: Record<string, TableDef>;
  paths: Record<string, RpcEndpoint>;
}

function write(msg: string): void {
  process.stdout.write(msg);
}

export function fetchOpenAPISpec(projectRef: string, schema: string): OpenAPISpec {
  // Get API keys
  const keysJson = execSync(
    `supabase projects api-keys --project-ref ${projectRef} -o json 2>&1`,
    { encoding: "utf-8", timeout: 15000 },
  );

  // Parse out the first JSON array (ignore CLI warnings after it)
  const jsonMatch = keysJson.match(/\[[\s\S]*?\n\]/);
  if (!jsonMatch) throw new Error("Failed to parse API keys");
  const keys = JSON.parse(jsonMatch[0]) as Array<{ name: string; api_key: string }>;
  const serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
  if (!serviceKey) throw new Error("No service_role key found");

  const baseUrl = `https://${projectRef}.supabase.co`;
  const spec = execSync(
    `curl -s "${baseUrl}/rest/v1/" -H "apikey: ${serviceKey}" -H "Authorization: Bearer ${serviceKey}" -H "Accept-Profile: ${schema}"`,
    { encoding: "utf-8", timeout: 30000 },
  );

  return JSON.parse(spec) as OpenAPISpec;
}

function parseForeignKeys(desc: string | undefined): { table: string; column: string } | null {
  if (!desc) return null;
  const match = desc.match(/<fk table='([^']+)' column='([^']+)'\/>/);
  if (!match) return null;
  return { table: match[1], column: match[2] };
}

function isPrimaryKey(desc: string | undefined): boolean {
  return desc?.includes("<pk/>") ?? false;
}

function generateTableMarkdown(name: string, def: TableDef, stats?: TableStats): string {
  const lines: string[] = [`# ${name}`, ""];
  const required = new Set(def.required || []);

  // Summary line
  const colCount = Object.keys(def.properties).length;
  const pks = Object.entries(def.properties).filter(([, v]) => isPrimaryKey(v.description));
  const fks = Object.entries(def.properties).filter(([, v]) => parseForeignKeys(v.description));
  let summary = `${colCount} columns | ${pks.length} PK | ${fks.length} FK`;
  if (stats) {
    summary += ` | ~${stats.rowCount.toLocaleString()} rows | ${stats.totalSize}`;
  }
  lines.push(summary);
  lines.push("");

  // Columns table
  lines.push("| Column | Type | Nullable | Default | FK |");
  lines.push("|--------|------|----------|---------|-----|");

  for (const [colName, col] of Object.entries(def.properties)) {
    const typeStr = col.format || col.type || "unknown";
    const nullable = required.has(colName) ? "NOT NULL" : "nullable";
    const defaultStr = col.default || "";
    const fk = parseForeignKeys(col.description);
    const fkStr = fk ? `→ ${fk.table}.${fk.column}` : "";
    const pkMarker = isPrimaryKey(col.description) ? " **PK**" : "";
    lines.push(`| ${colName}${pkMarker} | ${typeStr} | ${nullable} | ${defaultStr} | ${fkStr} |`);
  }

  // Description section for columns that have non-FK descriptions
  const descriptions = Object.entries(def.properties)
    .filter(([, v]) => v.description && !v.description.match(/^Note:\n/))
    .map(([k, v]) => {
      // Strip FK/PK annotations from description
      const clean = (v.description || "")
        .replace(/\n\nNote:\n.*$/s, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      return clean ? `- **${k}**: ${clean}` : null;
    })
    .filter(Boolean);

  if (descriptions.length > 0) {
    lines.push("");
    lines.push("## Notes");
    lines.push(...(descriptions as string[]));
  }

  return lines.join("\n");
}

function generateIndexMarkdown(
  tables: string[],
  views: string[],
  rpcs: string[],
  defs: Record<string, TableDef>,
  statsMap?: Map<string, TableStats>,
): string {
  const hasStats = statsMap && statsMap.size > 0;
  const lines: string[] = [
    "# Database Schema Index",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `**${tables.length} tables** | **${views.length} views** | **${rpcs.length} functions**`,
    "",
    "## Tables",
    "",
    hasStats
      ? "| Table | Columns | FKs | Rows | Size |"
      : "| Table | Columns | FKs | Description |",
    hasStats
      ? "|-------|---------|-----|------|------|"
      : "|-------|---------|-----|-------------|",
  ];

  for (const name of tables) {
    const def = defs[name];
    if (!def) continue;
    const colCount = Object.keys(def.properties).length;
    const fkCount = Object.values(def.properties).filter((v) => parseForeignKeys(v.description)).length;
    const s = statsMap?.get(name);
    if (hasStats && s) {
      lines.push(`| [${name}](tables/${name}.md) | ${colCount} | ${fkCount} | ~${s.rowCount.toLocaleString()} | ${s.totalSize} |`);
    } else if (hasStats) {
      lines.push(`| [${name}](tables/${name}.md) | ${colCount} | ${fkCount} | — | — |`);
    } else {
      lines.push(`| [${name}](tables/${name}.md) | ${colCount} | ${fkCount} | |`);
    }
  }

  if (views.length > 0) {
    lines.push("", "## Views", "");
    for (const name of views) {
      const def = defs[name];
      const colCount = def ? Object.keys(def.properties).length : 0;
      lines.push(`- **${name}** (${colCount} columns)`);
    }
  }

  if (rpcs.length > 0) {
    lines.push("", "## Functions", "");
    for (const name of rpcs) {
      lines.push(`- \`${name}\``);
    }
  }

  return lines.join("\n");
}

function generateRelationshipsJson(defs: Record<string, TableDef>): Record<string, string> {
  const rels: Record<string, string> = {};
  for (const [tableName, def] of Object.entries(defs)) {
    for (const [colName, col] of Object.entries(def.properties)) {
      const fk = parseForeignKeys(col.description);
      if (fk) {
        rels[`${tableName}.${colName}`] = `${fk.table}.${fk.column}`;
      }
    }
  }
  return rels;
}

function generateFunctionsMarkdown(paths: Record<string, RpcEndpoint>): string {
  const rpcs = Object.entries(paths)
    .filter(([p]) => p.startsWith("/rpc/"))
    .sort(([a], [b]) => a.localeCompare(b));

  const lines: string[] = ["# Database Functions (RPCs)", "", `${rpcs.length} functions`, ""];

  for (const [path, endpoint] of rpcs) {
    const name = path.replace("/rpc/", "");
    const post = endpoint.post;
    lines.push(`## ${name}`);

    if (post?.description) {
      lines.push(post.description);
    }

    const params = post?.parameters?.filter((p) => p.in === "body") || [];
    if (params.length > 0 && params[0].schema?.properties) {
      const props = params[0].schema.properties as Record<string, { type?: string; format?: string }>;
      lines.push("");
      lines.push("**Parameters:**");
      for (const [pName, pDef] of Object.entries(props)) {
        lines.push(`- \`${pName}\`: ${pDef.format || pDef.type || "unknown"}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

interface TableStats {
  name: string;
  tableSize: string;
  indexSize: string;
  totalSize: string;
  rowCount: number;
}

function fetchTableStats(): Map<string, TableStats> {
  const stats = new Map<string, TableStats>();
  try {
    const output = execSync("supabase inspect db table-stats 2>&1", {
      encoding: "utf-8",
      timeout: 30000,
    });
    // Parse ASCII table: | schema.name | Table size | Index size | Total size | Estimated row count | Seq scans |
    for (const line of output.split("\n")) {
      if (!line.includes("|")) continue;
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length < 5) continue;
      // Skip header/separator lines
      if (cols[0] === "Name" || cols[0].startsWith("-") || cols[0] === "schema") continue;
      if (cols[1]?.startsWith("-")) continue;

      const rawName = cols[0];
      // Strip schema prefix (e.g. "bibleai.episodes" → "episodes")
      const name = rawName.includes(".") ? rawName.split(".").pop()! : rawName;
      const tableSize = cols[1];
      const indexSize = cols[2];
      const totalSize = cols[3];
      const rowCount = parseInt(cols[4]?.replace(/,/g, ""), 10);

      if (name && !isNaN(rowCount)) {
        stats.set(name, { name, tableSize, indexSize, totalSize, rowCount });
      }
    }
  } catch {
    // table-stats requires a linked project; silently skip if unavailable
  }
  return stats;
}

export function snapshotCommand(): Command {
  return new Command("snapshot")
    .description("Snapshot database schema to local .supabase-schema/ directory for fast agent lookups")
    .option("--project-ref <ref>", "Supabase project ref (defaults to stage from config)")
    .option("--schema <name>", "Schema to snapshot (default: from config or 'public')")
    .option("--output <dir>", "Output directory", ".supabase-schema")
    .action((opts: { projectRef?: string; schema?: string; output: string }) => {
      const config = readConfig();

      // Resolve project ref
      let ref = opts.projectRef;
      if (!ref && config) {
        const stageEnv = config.environments["stage"] || config.environments[config.defaultEnv];
        if (stageEnv) ref = stageEnv.ref;
      }
      if (!ref) {
        write("Error: No project ref. Use --project-ref or run `supabase-skill install`.\n");
        process.exit(1);
      }

      // Resolve schema
      const schema = opts.schema || config?.schema || "public";

      write(`\n  Snapshotting schema "${schema}" from ${ref}...\n`);

      // Fetch OpenAPI spec
      write("  Fetching schema via PostgREST... ");
      let spec: OpenAPISpec;
      try {
        spec = fetchOpenAPISpec(ref, schema);
      } catch (e) {
        write(`FAILED\n  ${(e as Error).message}\n`);
        process.exit(1);
      }
      write(`\u2713 ${Object.keys(spec.definitions).length} definitions\n`);

      // Classify tables vs views (views typically start with v_)
      const allNames = Object.keys(spec.definitions).sort();
      const views = allNames.filter((n) => n.startsWith("v_"));
      const tables = allNames.filter((n) => !n.startsWith("v_"));

      // Extract RPCs
      const rpcs = Object.keys(spec.paths)
        .filter((p) => p.startsWith("/rpc/"))
        .map((p) => p.replace("/rpc/", ""))
        .sort();

      // Fetch table stats (sizes + row counts)
      write("  Fetching table stats... ");
      const tableStats = fetchTableStats();
      if (tableStats.size > 0) {
        write(`\u2713 ${tableStats.size} tables\n`);
      } else {
        write("skipped (link project for stats)\n");
      }

      // Create output directory
      const outDir = join(process.cwd(), opts.output);
      const tablesDir = join(outDir, "tables");

      if (existsSync(outDir)) {
        rmSync(outDir, { recursive: true });
      }
      mkdirSync(tablesDir, { recursive: true });

      // Generate index
      write("  Generating index... ");
      writeFileSync(
        join(outDir, "index.md"),
        generateIndexMarkdown(tables, views, rpcs, spec.definitions, tableStats),
      );
      write("\u2713\n");

      // Generate per-table files
      write(`  Generating ${tables.length} table files... `);
      for (const name of tables) {
        const def = spec.definitions[name];
        if (def) {
          writeFileSync(join(tablesDir, `${name}.md`), generateTableMarkdown(name, def, tableStats.get(name)));
        }
      }
      write("\u2713\n");

      // Generate view files in tables dir too (agents will look there)
      if (views.length > 0) {
        write(`  Generating ${views.length} view files... `);
        for (const name of views) {
          const def = spec.definitions[name];
          if (def) {
            writeFileSync(join(tablesDir, `${name}.md`), generateTableMarkdown(name, def, tableStats.get(name)));
          }
        }
        write("\u2713\n");
      }

      // Generate relationships
      write("  Generating relationships... ");
      const rels = generateRelationshipsJson(spec.definitions);
      writeFileSync(join(outDir, "relationships.json"), JSON.stringify(rels, null, 2));
      write(`\u2713 ${Object.keys(rels).length} foreign keys\n`);

      // Generate functions
      write("  Generating functions... ");
      writeFileSync(join(outDir, "functions.md"), generateFunctionsMarkdown(spec.paths));
      write(`\u2713 ${rpcs.length} RPCs\n`);

      // ─── SQLite Database ───
      write("  Writing SQLite database... ");
      try {
        const db = openDb(outDir);
        initSchema(db);
        clearData(db);

        // Build structured data from OpenAPI spec
        const dbTables: TableRow[] = [];
        const dbColumns: ColumnRow[] = [];
        const dbRels: RelRow[] = [];

        for (const name of allNames) {
          const def = spec.definitions[name];
          if (!def) continue;
          const required = new Set(def.required || []);
          const isView = name.startsWith("v_");

          let pkCount = 0;
          let fkCount = 0;
          const colCount = Object.keys(def.properties).length;

          for (const [colName, col] of Object.entries(def.properties)) {
            const pk = isPrimaryKey(col.description);
            const fk = parseForeignKeys(col.description);
            if (pk) pkCount++;
            if (fk) fkCount++;

            // Clean description
            let desc: string | null = null;
            if (col.description && !col.description.match(/^Note:\n/)) {
              desc = col.description
                .replace(/\n\nNote:\n.*$/s, "")
                .replace(/<[^>]+>/g, "")
                .trim() || null;
            }

            dbColumns.push({
              table_name: name,
              name: colName,
              type: col.format || col.type || null,
              nullable: !required.has(colName),
              default_value: col.default || null,
              is_pk: pk,
              fk_table: fk?.table || null,
              fk_column: fk?.column || null,
              description: desc,
            });

            if (fk) {
              dbRels.push({
                from_table: name,
                from_column: colName,
                to_table: fk.table,
                to_column: fk.column,
              });
            }
          }

          const s = tableStats.get(name);
          dbTables.push({
            name, column_count: colCount, pk_count: pkCount, fk_count: fkCount, is_view: isView,
            row_count: s?.rowCount ?? null, table_size: s?.tableSize ?? null,
            index_size: s?.indexSize ?? null, total_size: s?.totalSize ?? null,
          });
        }

        // Build function data
        const dbFuncs: FuncRow[] = [];
        const rpcPaths = Object.entries(spec.paths).filter(([p]) => p.startsWith("/rpc/"));
        for (const [path, endpoint] of rpcPaths) {
          const funcName = path.replace("/rpc/", "");
          const post = endpoint.post;
          const params = post?.parameters?.filter((p) => p.in === "body") || [];
          let paramsJson = "[]";
          if (params.length > 0 && params[0].schema?.properties) {
            const props = params[0].schema.properties as Record<string, { type?: string; format?: string }>;
            paramsJson = JSON.stringify(
              Object.entries(props).map(([n, d]) => ({ name: n, type: d.format || d.type || "unknown" })),
            );
          }
          dbFuncs.push({ name: funcName, params: paramsJson, description: post?.description || null });
        }

        insertAll(db, dbTables, dbColumns, dbRels, dbFuncs);

        // Write metadata
        setMetadata(db, "snapshot_at", new Date().toISOString());
        setMetadata(db, "schema", schema);
        setMetadata(db, "project_ref", ref);

        db.close();
        write("\u2713\n");
      } catch (e) {
        const err = e as Error;
        write(`FAILED (${err.message}) — markdown files still available\n`);
        if (err.stack) write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
      }

      write(`\n  Schema snapshot saved to ${opts.output}/\n`);
      write(`  ${tables.length} tables, ${views.length} views, ${rpcs.length} functions, ${Object.keys(rels).length} FKs\n`);
      write(`\n  Add to .gitignore: ${opts.output}/\n\n`);
    });
}
