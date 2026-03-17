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

  // Add safety reminder
  if (config.environments["prod"]) {
    lines.push(`- **Default**: Use STAGE for testing. PROD requires explicit approval.`);
  }

  return lines.join("\n");
}

export function getSkillDoc(config: SkillConfig | null = null): string {
  const envSection = buildEnvSection(config);

  return `## supabase-cli (Supabase Database & Infrastructure)

Requires: \`supabase\` CLI installed, logged in via \`supabase login\`.
All commands support \`-o json\` for structured output.

${envSection}

### SQL Execution (daily use)
- \`supabase db execute --project-ref <ref> --stdin <<< "SELECT 1"\` — run inline SQL
- \`supabase db execute --project-ref <ref> -f path/to/file.sql\` — run SQL file

### Migrations
- \`supabase migration new <name>\` — create empty migration file
- \`supabase migration list --project-ref <ref>\` — compare local vs remote
- \`supabase migration up --project-ref <ref>\` — apply pending to remote
- \`supabase migration down --project-ref <ref> -n 1\` — rollback last N migrations
- \`supabase migration repair --status applied <version> --project-ref <ref>\` — mark version as applied
- \`supabase migration repair --status reverted <version> --project-ref <ref>\` — mark version as reverted
- \`supabase migration squash --project-ref <ref>\` — combine into single file
- \`supabase migration fetch --project-ref <ref>\` — pull history from remote

### Schema Management
- \`supabase db diff --project-ref <ref>\` — diff local vs remote schema
- \`supabase db dump --project-ref <ref>\` — dump full schema
- \`supabase db dump --project-ref <ref> --data-only\` — dump data only
- \`supabase db dump --project-ref <ref> --schema <name>\` — dump specific schema
- \`supabase db pull --project-ref <ref>\` — pull remote schema to local migrations
- \`supabase db push --project-ref <ref>\` — push migrations to remote
- \`supabase db lint\` — check for typing errors

### Database Inspection (debugging/support)
- \`supabase inspect db table-stats --project-ref <ref>\` — table sizes + row counts
- \`supabase inspect db index-stats --project-ref <ref>\` — index usage + scan counts
- \`supabase inspect db long-running-queries --project-ref <ref>\` — queries > 5min
- \`supabase inspect db outliers --project-ref <ref>\` — slowest queries by total time
- \`supabase inspect db bloat --project-ref <ref>\` — dead tuple estimation
- \`supabase inspect db locks --project-ref <ref>\` — active locks
- \`supabase inspect db blocking --project-ref <ref>\` — blocking lock chains
- \`supabase inspect db db-stats --project-ref <ref>\` — cache hit rates, WAL, sizes
- \`supabase inspect db vacuum-stats --project-ref <ref>\` — vacuum status per table
- \`supabase inspect db role-stats --project-ref <ref>\` — role information
- \`supabase inspect db replication-slots --project-ref <ref>\` — replication status
- \`supabase inspect report --project-ref <ref>\` — CSV of ALL inspect commands

### Storage
- \`supabase storage ls ss://bucket/path --project-ref <ref>\` — list objects
- \`supabase storage cp local.file ss://bucket/path --project-ref <ref>\` — upload
- \`supabase storage cp ss://bucket/path local.file --project-ref <ref>\` — download
- \`supabase storage rm ss://bucket/path --project-ref <ref>\` — delete
- \`supabase storage mv ss://old ss://new --project-ref <ref>\` — move/rename

### Edge Functions
- \`supabase functions list --project-ref <ref>\` — list deployed functions
- \`supabase functions deploy <name> --project-ref <ref>\` — deploy function
- \`supabase functions delete <name> --project-ref <ref>\` — delete function
- \`supabase functions serve\` — serve locally for testing

### Project Management
- \`supabase projects list -o json\` — list all projects
- \`supabase projects api-keys --project-ref <ref> -o json\` — get API keys
- \`supabase secrets list --project-ref <ref>\` — list env secrets
- \`supabase secrets set KEY=VALUE --project-ref <ref>\` — set secret

### SQL Snippets (from dashboard)
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
- \`supabase-skill context <table-or-topic>\` — get full context: columns, FKs, related tables (2 levels deep), related functions
- \`supabase-skill context <topic> --depth 3\` — deeper FK traversal
- \`supabase-skill table <name>\` — full single-table detail with relationships, functions, related table summaries
- \`supabase-skill columns --type <type>\` — find all columns of a type (uuid, jsonb, text, timestamp, etc.)
- \`supabase-skill columns --fk\` — find all foreign key columns
- \`supabase-skill columns --table <name>\` — filter columns to specific table
- \`supabase-skill columns <name> --type jsonb\` — combine name + type filters
- \`supabase-skill search <query>\` — search tables, columns, functions, and relationships
- \`supabase-skill search <query> --json\` — structured JSON output
- Read \`.supabase-schema/tables/<name>.md\` — full table schema (columns, types, PKs, FKs, defaults)
- Read \`.supabase-schema/index.md\` — overview of all tables, views, functions
- Read \`.supabase-schema/relationships.json\` — all foreign key mappings
- Read \`.supabase-schema/functions.md\` — all RPC functions with parameters

### Schema Snapshot Auto-Refresh
- Snapshot refreshes nightly via cron (if configured with \`supabase-skill cron\`)
- **After applying migrations**: Run \`supabase-skill snapshot\` to update the local schema cache
- **After creating/altering tables**: Run \`supabase-skill snapshot\` before continuing work
- **Rule of thumb**: If you ran any DDL (CREATE, ALTER, DROP) or migration commands, refresh the snapshot immediately

### Safety Rules
- NEVER run mutations on PROD without explicit user approval
- ALWAYS specify \`--project-ref\` — never rely on linked project for remote ops
- Use \`-o json\` for structured output the agent can parse
- Run \`supabase migration list\` BEFORE and AFTER migration operations
- Test migrations on STAGE before applying to PROD

### Exit codes
- 0 = success, 1 = error`;
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
