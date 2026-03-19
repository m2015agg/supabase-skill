import { Command } from "commander";
import { readConfig, type SkillConfig } from "../util/config.js";

function buildEnvSection(config: SkillConfig | null): string {
  if (!config || Object.keys(config.environments).length === 0) {
    return `### Environments
- Configure with \`supabase-skill install\` to set project refs
- Use \`--project-ref <ref>\` with every remote command`;
  }

  const lines = ["### Environments"];
  for (const [env, { ref, name }] of Object.entries(config.environments)) {
    const warning = env === "prod" ? " — \u26a0\ufe0f NEVER modify without explicit approval" : "";
    const label = env.toUpperCase();
    lines.push(`- **${label}**: \`${ref}\` (${name})${warning}`);
  }

  // Add routing rules
  lines.push("");
  lines.push("**Environment routing** (use these refs when user says...):");
  for (const [env, { ref }] of Object.entries(config.environments)) {
    const aliases = env === "prod"
      ? `"prod", "production", "live"`
      : env === "stage"
        ? `"stage", "staging", "test", "preview"`
        : `"dev", "development", "local"`;
    lines.push(`- ${aliases} → \`--project-ref ${ref}\``);
  }

  if (config.environments["prod"]) {
    lines.push(`- **Default**: Always use STAGE unless user explicitly says "prod". PROD requires approval.`);
  }

  // Add env var instructions for direct API access
  lines.push("");
  lines.push("**Direct API access** (for curl/psql when supabase CLI isn't enough):");
  lines.push("- Read keys from `.env` file — NEVER hardcode keys in commands");
  for (const [env] of Object.entries(config.environments)) {
    const prefix = `SUPABASE_${env.toUpperCase()}`;
    lines.push(`- ${env.toUpperCase()}: \`$${prefix}_URL\`, \`$${prefix}_SERVICE_KEY\`, \`$${prefix}_ANON_KEY\``);
  }
  lines.push("- Load with: `source .env` or `export $(grep -v '^#' .env | xargs)`");

  return lines.join("\n");
}

export function getSkillDoc(config: SkillConfig | null = null): string {
  const envSection = buildEnvSection(config);

  return `## supabase-cli (Supabase Database & Infrastructure)

Requires: \`supabase\` CLI installed, logged in via \`supabase login\`.
All commands support \`-o json\` for structured output.

${envSection}

### IMPORTANT: CLI Flag Reference
- Database commands (db, migration, inspect, storage) use \`--linked\` (requires \`supabase link\` first)
- Management commands (functions, projects, secrets, snippets) use \`--project-ref <ref>\`
- \`supabase db execute\` does NOT exist — use \`supabase-skill sql\` instead
- To switch linked project: \`supabase link --project-ref <ref>\`

### Project Linking (required before db/migration/inspect/storage commands)
- \`supabase link --project-ref <ref>\` — link current directory to a Supabase project
- Must run from a directory with \`supabase/config.toml\` (or run \`supabase init\` first)
- Only one project can be linked at a time per directory

### SQL Execution (via psql)
Run arbitrary SQL against any configured environment. Connection is pre-configured — no linking or env vars needed.

**When to use what:**
- **Schema exploration** (table structure, columns, FKs, functions): use \`supabase-skill context/table/search/columns\` — instant, reads local cache
- **Data queries** (SELECT, INSERT, UPDATE, DELETE, ad-hoc SQL): use \`supabase-skill sql\` — runs live against the database
- **DDL / migrations**: use \`supabase migration\` workflow (not \`sql\`)

**Commands:**
- \`supabase-skill sql -c "SELECT count(*) FROM table_name"\` — run SQL on stage (default)
- \`supabase-skill sql --prod -c "SELECT ..."\` — run SQL on production
- \`supabase-skill sql -f path/to/file.sql\` — execute SQL file
- \`echo "SELECT 1" | supabase-skill sql\` — pipe SQL via stdin
- \`supabase-skill sql -c "..." --raw\` — raw unformatted psql output
- \`supabase-skill sql --setup\` — configure postgres connection URL
- \`supabase-skill sql --prod --setup\` — configure prod connection URL

**Environment targeting:**
- Default is always **stage** — safe for exploration and testing
- Use \`--prod\` only when user explicitly asks for production data
- Use \`--project-ref <ref>\` to target a specific project ref directly

**Notes:**
- Connection strings are stored in config (set during \`supabase-skill install\` or first \`sql\` run)
- If you get a connection error, tell the user to run \`supabase-skill sql --setup\` to configure pgUrl
- Schema is auto-set to the configured schema (e.g., \`<schema>\`) via search_path

### Data Operations (REST API)
Load env vars first: \`source .env\` or \`export $(grep -v '^#' .env | xargs)\`
Header shorthand: \`-H "apikey: $KEY" -H "Authorization: Bearer $KEY"\`
GET uses \`Accept-Profile: <schema>\`, POST/PATCH/DELETE use \`Content-Profile: <schema>\`

**SELECT (GET)**:
- \`curl -s "$URL/rest/v1/<table>?select=col1,col2&limit=10" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Accept-Profile: <schema>"\`

**Filters** (append to URL query string):
- \`?col=eq.value\` — equals | \`?col=neq.value\` — not equals
- \`?col=gt.5\` — greater than | \`?col=gte.5\` — greater or equal | \`?col=lt.5\` | \`?col=lte.5\`
- \`?col=like.*pattern*\` — LIKE | \`?col=ilike.*pattern*\` — case-insensitive LIKE
- \`?col=in.(val1,val2)\` — IN list | \`?col=is.null\` — IS NULL | \`?col=is.true\`
- \`?or=(col1.eq.a,col2.eq.b)\` — OR conditions
- \`?order=col.desc\` — ORDER BY | \`?limit=10&offset=20\` — pagination

**COUNT**: Add \`-H "Prefer: count=exact"\` header, read \`Content-Range\` response header

**INSERT (POST)**:
- \`curl -s "$URL/rest/v1/<table>" -X POST -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Profile: <schema>" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"col": "value"}'\`

**UPDATE (PATCH)** — ALWAYS include a filter or you update ALL rows:
- \`curl -s "$URL/rest/v1/<table>?id=eq.<uuid>" -X PATCH -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Profile: <schema>" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"col": "new_value"}'\`

**UPSERT (POST with merge)**:
- Add header: \`-H "Prefer: resolution=merge-duplicates,return=representation"\`

**DELETE** — ALWAYS include a filter or you delete ALL rows:
- \`curl -s "$URL/rest/v1/<table>?id=eq.<uuid>" -X DELETE -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Profile: <schema>" -H "Prefer: return=representation"\`

**Call RPC function (POST)**:
- \`curl -s "$URL/rest/v1/rpc/<function>" -X POST -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Profile: <schema>" -H "Content-Type: application/json" -d '{"param": "value"}'\`

### Migrations (uses --linked, NOT --project-ref)
- \`supabase migration new <name>\` — create empty migration file (local only)
- \`supabase migration list\` — compare local vs remote (linked project)
- \`supabase migration up\` — apply pending migrations to linked project
- \`supabase migration down -n 1\` — rollback last N migrations
- \`supabase migration repair --status applied <version>\` — mark version as applied
- \`supabase migration repair --status reverted <version>\` — mark version as reverted
- \`supabase migration squash\` — combine into single file
- \`supabase migration fetch\` — pull migration history from remote

### DDL (Schema Changes via Migrations)
All schema changes go through migration files. Create with \`supabase migration new <name>\`, write SQL, apply with \`supabase migration up\`:
- **CREATE TABLE**: \`CREATE TABLE <schema>.<name> (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ...);\`
- **ALTER TABLE**: \`ALTER TABLE <schema>.<table> ADD COLUMN <col> <type>;\`
- **DROP TABLE**: \`DROP TABLE IF EXISTS <schema>.<table>;\`
- **CREATE VIEW**: \`CREATE OR REPLACE VIEW <schema>.<name> AS SELECT ...;\`
- **CREATE INDEX**: \`CREATE INDEX idx_<table>_<col> ON <schema>.<table>(<col>);\`
- **CREATE FUNCTION/RPC**: \`CREATE OR REPLACE FUNCTION <schema>.<name>(...) RETURNS ... AS $$ ... $$ LANGUAGE plpgsql;\`
- **RLS Policies**: \`ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY; CREATE POLICY ...\`
- **Triggers**: \`CREATE TRIGGER ... BEFORE/AFTER INSERT/UPDATE ON <schema>.<table> ...\`
- **Enums**: \`CREATE TYPE <schema>.<name> AS ENUM ('val1', 'val2');\`
- Always use \`<schema>.\` schema prefix for all objects
- Run \`supabase migration list\` BEFORE and AFTER to verify

### Schema Management (uses --linked, NOT --project-ref)
- \`supabase db diff\` — diff local vs remote schema
- \`supabase db dump\` — dump full schema from linked project
- \`supabase db dump --data-only\` — dump data only
- \`supabase db dump -s <schema>\` — dump specific schema
- \`supabase db pull\` — pull remote schema to local migrations
- \`supabase db push\` — push migrations to remote
- \`supabase db lint\` — check for typing errors (local only)

### Database Inspection (uses --linked or --db-url, NOT --project-ref)
- \`supabase inspect db table-stats\` — table sizes + row counts
- \`supabase inspect db index-stats\` — index usage + scan counts
- \`supabase inspect db long-running-queries\` — queries > 5min
- \`supabase inspect db outliers\` — slowest queries by total time
- \`supabase inspect db bloat\` — dead tuple estimation
- \`supabase inspect db locks\` — active locks
- \`supabase inspect db blocking\` — blocking lock chains
- \`supabase inspect db db-stats\` — cache hit rates, WAL, sizes
- \`supabase inspect db vacuum-stats\` — vacuum status per table
- \`supabase inspect db role-stats\` — role information
- \`supabase inspect db replication-slots\` — replication status
- \`supabase inspect report\` — CSV of ALL inspect commands
- Alternative: \`supabase inspect db table-stats --db-url "postgresql://..."\` — inspect without linking

### Storage (uses --linked + --experimental)
- \`supabase storage ls ss:///bucket/path --experimental\` — list objects (note: triple slash ss:///)
- \`supabase storage cp local.file ss:///bucket/path --experimental\` — upload
- \`supabase storage cp ss:///bucket/path local.file --experimental\` — download
- \`supabase storage rm ss:///bucket/path --experimental\` — delete
- \`supabase storage mv ss:///old ss:///new --experimental\` — move/rename

### Edge Functions (uses --project-ref)
- \`supabase functions list --project-ref <ref>\` — list deployed functions
- \`supabase functions deploy <name> --project-ref <ref>\` — deploy function
- \`supabase functions delete <name> --project-ref <ref>\` — delete function
- \`supabase functions new <name>\` — create new function locally
- \`supabase functions download [name]\` — download function source from linked project
- \`supabase functions serve\` — serve all functions locally for testing

### Branches (uses --project-ref)
- \`supabase branches list --project-ref <ref> -o json\` — list all preview branches
- \`supabase branches create <name> --project-ref <ref>\` — create preview branch
- \`supabase branches get <branch-id> --project-ref <ref>\` — get branch details
- \`supabase branches delete <branch-id> --project-ref <ref>\` — delete branch
- \`supabase branches pause <branch-id> --project-ref <ref>\` — pause branch (save costs)
- \`supabase branches unpause <branch-id> --project-ref <ref>\` — resume branch

### Backups (uses --project-ref)
- \`supabase backups list --project-ref <ref>\` — list available physical backups
- \`supabase backups restore --project-ref <ref>\` — restore to specific timestamp (PITR)

### Project Management (uses --project-ref)
- \`supabase projects list -o json\` — list all projects
- \`supabase projects api-keys --project-ref <ref> -o json\` — get API keys
- \`supabase secrets list --project-ref <ref>\` — list env secrets
- \`supabase secrets set KEY=VALUE --project-ref <ref>\` — set secret
- \`supabase postgres-config get --project-ref <ref>\` — get Postgres config overrides
- \`supabase postgres-config update --project-ref <ref>\` — update Postgres config

### Code Generation
- \`supabase gen types --linked\` — generate TypeScript types from linked project schema
- \`supabase gen types --project-id <ref>\` — generate types from specific project

### SQL Snippets (uses --project-ref)
- \`supabase snippets list --project-ref <ref> -o json\` — list saved snippets
- \`supabase snippets download <id> --project-ref <ref>\` — download snippet SQL

### Setup
- \`supabase-skill install\` — global setup (interactive wizard, adds to ~/.claude/CLAUDE.md)
- \`supabase-skill init\` — per-project setup (CLAUDE.md + .env + .gitignore)
- \`supabase-skill docs\` — output LLM instruction snippet
- \`supabase-skill docs --format claude\` — CLAUDE.md format
- \`supabase-skill envs\` — list configured environments

### Schema Snapshot (local DB map — use INSTEAD of querying information_schema)
If \`.supabase-schema/\` exists, ALWAYS use these commands instead of running SQL to explore the schema:
- \`supabase-skill snapshot\` — snapshot schema to .supabase-schema/ (tables, columns, FKs, functions)
- \`supabase-skill snapshot --project-ref <ref>\` — snapshot a specific environment
- \`supabase-skill context <table-or-topic>\` — get full context: columns, FKs, related tables (3 levels deep), name-related tables, functions
- \`supabase-skill context <topic> --depth 5\` — deeper FK traversal
- \`supabase-skill table <name>\` — full single-table detail with relationships, functions, related table summaries
- \`supabase-skill columns --type <type>\` — find all columns of a type (uuid, jsonb, text, timestamp, etc.)
- \`supabase-skill columns --fk\` — find all foreign key columns
- \`supabase-skill columns --table <name>\` — filter columns to specific table
- \`supabase-skill columns <name> --type jsonb\` — combine name + type filters
- \`supabase-skill search <query>\` — search tables, columns, functions, and relationships
- \`supabase-skill search <query> --json\` — structured JSON output
- \`supabase-skill functions [query]\` — list/search RPC functions with parameters
- \`supabase-skill functions --args uuid\` — find functions by argument type
- \`supabase-skill indexes [table]\` — list indexes, filter by table, \`--unique\`, \`--primary\`
- \`supabase-skill enums [name]\` — list custom enum types and their values
- \`supabase-skill policies [table]\` — list RLS policies, filter by \`--command SELECT/INSERT/UPDATE/DELETE\`
- \`supabase-skill triggers [table]\` — list triggers, filter by \`--event INSERT/UPDATE/DELETE\`
- \`supabase-skill views [name]\` — list views, \`--full\` for definitions
- Read \`.supabase-schema/tables/<name>.md\` — full table schema (columns, types, PKs, FKs, defaults)
- Read \`.supabase-schema/index.md\` — overview of all tables, views, functions
- Read \`.supabase-schema/relationships.json\` — all foreign key mappings
- Read \`.supabase-schema/functions.md\` — all RPC functions with parameters

### Schema Snapshot Auto-Refresh
- Snapshot refreshes nightly via cron (if configured with \`supabase-skill cron\`)
- **After applying migrations**: Run \`supabase-skill snapshot\` to update the local schema cache
- **After creating/altering tables**: Run \`supabase-skill snapshot\` before continuing work
- **Rule of thumb**: If you ran any DDL (CREATE, ALTER, DROP) or migration commands, refresh the snapshot immediately
- **Freshness check**: If snapshot is >24h old, suggest refreshing before relying on schema data
- \`supabase-skill doctor\` shows snapshot age and overall setup health

### Safety Rules
- NEVER run mutations on PROD without explicit user approval
- ALWAYS specify \`--project-ref\` — never rely on linked project for remote ops
- Use \`-o json\` for structured output the agent can parse
- Run \`supabase migration list\` BEFORE and AFTER migration operations
- Test migrations on STAGE before applying to PROD

### Exit codes
- 0 = success, 1 = error`.replace(/<schema>/g, config?.schema || "public");
}

const FORMATS: Record<string, { filename: string; wrap: (content: string) => string }> = {
  claude: {
    filename: "CLAUDE.md",
    wrap: (c) => c,
  },
  agents: {
    filename: "AGENTS.md",
    wrap: (c) => c,
  },
  cursor: {
    filename: ".cursorrules",
    wrap: (c) => c,
  },
  skill: {
    filename: "SKILL.md",
    wrap: (c) =>
      `---
name: supabase-skill
description: Manage Supabase databases, migrations, storage, and edge functions via CLI. Multi-environment support (dev/stage/prod).
metadata:
  requires:
    env:
      - SUPABASE_ACCESS_TOKEN
    bins:
      - supabase
    primaryEnv: SUPABASE_ACCESS_TOKEN
---

# supabase-skill

${c}`,
  },
  raw: {
    filename: "",
    wrap: (c) => c,
  },
};

export function docsCommand(): Command {
  return new Command("docs")
    .description("Generate LLM instruction snippet for supabase-skill. Outputs to stdout.")
    .option(
      "--format <type>",
      "Output format: claude, agents, cursor, skill, raw (default: raw)",
      "raw",
    )
    .action((opts: { format: string }) => {
      const fmt = FORMATS[opts.format];
      if (!fmt) {
        process.stderr.write(
          `Unknown format: ${opts.format}. Use: ${Object.keys(FORMATS).join(", ")}\n`,
        );
        process.exit(1);
      }
      const config = readConfig();
      const doc = getSkillDoc(config);
      process.stdout.write(fmt.wrap(doc) + "\n");
    });
}
