import { Command } from "commander";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { readConfig } from "../util/config.js";

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

function fetchOpenAPISpec(projectRef: string): OpenAPISpec {
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
    `curl -s "${baseUrl}/rest/v1/" -H "apikey: ${serviceKey}" -H "Authorization: Bearer ${serviceKey}" -H "Accept-Profile: bibleai"`,
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

function generateTableMarkdown(name: string, def: TableDef): string {
  const lines: string[] = [`# ${name}`, ""];
  const required = new Set(def.required || []);

  // Summary line
  const colCount = Object.keys(def.properties).length;
  const pks = Object.entries(def.properties).filter(([, v]) => isPrimaryKey(v.description));
  const fks = Object.entries(def.properties).filter(([, v]) => parseForeignKeys(v.description));
  lines.push(`${colCount} columns | ${pks.length} PK | ${fks.length} FK`);
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
): string {
  const lines: string[] = [
    "# Database Schema Index",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `**${tables.length} tables** | **${views.length} views** | **${rpcs.length} functions**`,
    "",
    "## Tables",
    "",
    "| Table | Columns | FKs | Description |",
    "|-------|---------|-----|-------------|",
  ];

  for (const name of tables) {
    const def = defs[name];
    if (!def) continue;
    const colCount = Object.keys(def.properties).length;
    const fkCount = Object.values(def.properties).filter((v) => parseForeignKeys(v.description)).length;
    // Try to infer purpose from column names
    lines.push(`| [${name}](tables/${name}.md) | ${colCount} | ${fkCount} | |`);
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

export function snapshotCommand(): Command {
  return new Command("snapshot")
    .description("Snapshot database schema to local .supabase-schema/ directory for fast agent lookups")
    .option("--project-ref <ref>", "Supabase project ref (defaults to stage from config)")
    .option("--schema <name>", "Schema to snapshot", "bibleai")
    .option("--output <dir>", "Output directory", ".supabase-schema")
    .action((opts: { projectRef?: string; schema: string; output: string }) => {
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

      write(`\n  Snapshotting schema from ${ref}...\n`);

      // Fetch OpenAPI spec
      write("  Fetching schema via PostgREST... ");
      let spec: OpenAPISpec;
      try {
        spec = fetchOpenAPISpec(ref);
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
        generateIndexMarkdown(tables, views, rpcs, spec.definitions),
      );
      write("\u2713\n");

      // Generate per-table files
      write(`  Generating ${tables.length} table files... `);
      for (const name of tables) {
        const def = spec.definitions[name];
        if (def) {
          writeFileSync(join(tablesDir, `${name}.md`), generateTableMarkdown(name, def));
        }
      }
      write("\u2713\n");

      // Generate view files in tables dir too (agents will look there)
      if (views.length > 0) {
        write(`  Generating ${views.length} view files... `);
        for (const name of views) {
          const def = spec.definitions[name];
          if (def) {
            writeFileSync(join(tablesDir, `${name}.md`), generateTableMarkdown(name, def));
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

      write(`\n  Schema snapshot saved to ${opts.output}/\n`);
      write(`  ${tables.length} tables, ${views.length} views, ${rpcs.length} functions, ${Object.keys(rels).length} FKs\n`);
      write(`\n  Add to .gitignore: ${opts.output}/\n\n`);
    });
}
