# @m2015agg/supabase-skill

**Supabase CLI skill for AI agents.** Installs comprehensive Supabase CLI instructions into your `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` with multi-environment support (dev/stage/prod).

No MCP server. No context window bloat. No running processes. Just a CLI skill doc that teaches your AI agent every Supabase command it needs.

## Why This Exists

The Supabase MCP server dumps its entire schema into your agent's context window — 30-40% gone before your agent even starts thinking. It also can't talk to multiple databases in the same session.

The Supabase CLI already does everything the MCP does. Your agent just doesn't know about it unless you document it.

This package:
- **Detects** your Supabase CLI installation and login status
- **Lists** your projects and lets you tag them as `prod`, `stage`, or `dev`
- **Writes** a comprehensive CLI skill doc into your CLAUDE.md with your actual project refs baked in
- **Covers** every Supabase CLI command: SQL, migrations, schema, inspect, storage, edge functions, snippets, secrets
- **Enforces** safety rules (never mutate prod without approval, always specify `--project-ref`)

One install. Zero runtime overhead. Your agent knows every command.

## Install

```bash
npm install -g @m2015agg/supabase-skill
```

## Quick Start

### 1. Global Setup

```bash
supabase-skill install
```

Interactive wizard that:
1. Checks if `supabase` CLI is installed
2. Checks if you're logged in (`supabase login`)
3. Lists your Supabase projects
4. Lets you tag each as `prod` / `stage` / `dev` / `skip`
5. Saves config to `~/.config/supabase-skill/config.json`
6. Upserts the full skill doc into `~/.claude/CLAUDE.md`
7. Adds `SUPABASE_ACCESS_TOKEN` to your shell profile if missing

```
$ supabase-skill install

  Checking supabase CLI... ✓ v2.67.1
  Checking login status... ✓ logged in

  Found 2 project(s):
    1. My App Production (abcdefghijklmnopqrst)
    2. My App Staging (tsrqponmlkjihgfedcba)

  Tag each project (prod/stage/dev/skip):
    My App Production → prod
    My App Staging → stage

  supabase-skill install complete:
    ~/.config/supabase-skill/config.json: created
    ~/.claude/CLAUDE.md: updated

  Next: run `supabase-skill init` in any project directory.
```

### 2. Per-Project Setup

```bash
cd your-project
supabase-skill init
```

This:
1. Upserts the skill doc into `CLAUDE.md` and `.claude/CLAUDE.md` (if the `.claude/` dir exists)
2. Creates/updates `.env` with your project refs (`SUPABASE_PROD_REF=...`, `SUPABASE_STAGE_REF=...`)
3. Ensures `.gitignore` includes `.env`

### 3. Done

Next time Claude Code (or Codex, Cursor, etc.) opens your project, it reads the skill doc and knows every Supabase command, which ref is prod vs stage, and the safety rules.

## Commands

| Command | Description |
|---------|-------------|
| `supabase-skill install` | Global setup wizard (CLI check, env tagging, CLAUDE.md) |
| `supabase-skill init` | Per-project setup (CLAUDE.md + .env + .gitignore) |
| `supabase-skill snapshot` | Snapshot DB schema to `.supabase-schema/` for fast agent lookups |
| `supabase-skill search <query>` | Search tables, columns, functions, and FKs locally |
| `supabase-skill docs` | Output the skill doc to stdout |
| `supabase-skill docs --format <fmt>` | Output as `claude`, `agents`, `cursor`, `skill`, or `raw` |
| `supabase-skill envs` | List configured environments with project refs |
| `supabase-skill uninstall` | Remove skill doc from current project's CLAUDE.md files |
| `supabase-skill uninstall --global` | Remove from `~/.claude/CLAUDE.md` |

## What It Writes to CLAUDE.md

The skill doc is injected between `<!-- supabase-skill:start -->` and `<!-- supabase-skill:end -->` markers. This means:

- **Idempotent**: Run `install` or `init` multiple times — it updates in place, never duplicates
- **Clean removal**: `uninstall` removes exactly the marked section, nothing else
- **Non-destructive**: Your existing CLAUDE.md content is preserved

### The Skill Doc

Here's exactly what gets written (with your project refs filled in):

```markdown
## supabase-cli (Supabase Database & Infrastructure)

Requires: `supabase` CLI installed, logged in via `supabase login`.
All commands support `-o json` for structured output.

### Environments
- **PROD**: `abcdefghijklmnopqrst` (My App Production) — ⚠️ NEVER modify without explicit approval
- **STAGE**: `tsrqponmlkjihgfedcba` (My App Staging)
- **Default**: Use STAGE for testing. PROD requires explicit approval.
```

It covers **every major Supabase CLI capability** organized by task:

| Section | Commands Covered |
|---------|-----------------|
| **SQL Execution** | `db execute` with `--stdin` and `-f` |
| **Migrations** | `migration new`, `list`, `up`, `down`, `repair`, `squash`, `fetch` |
| **Schema Management** | `db diff`, `dump`, `pull`, `push`, `lint` |
| **Database Inspection** | All 12 `inspect db` commands (table-stats, index-stats, long-running-queries, outliers, bloat, locks, blocking, db-stats, vacuum-stats, role-stats, replication-slots) + `inspect report` |
| **Storage** | `storage ls`, `cp`, `rm`, `mv` |
| **Edge Functions** | `functions list`, `deploy`, `delete`, `serve` |
| **Project Management** | `projects list`, `api-keys`, `secrets list/set` |
| **SQL Snippets** | `snippets list`, `download` |
| **Safety Rules** | Never mutate prod without approval, always use `--project-ref`, use `-o json`, test on stage first |

### Safety Rules (built into the skill doc)

The skill doc includes explicit safety rules that the agent follows:

```
- NEVER run mutations on PROD without explicit user approval
- ALWAYS specify --project-ref — never rely on linked project for remote ops
- Use -o json for structured output the agent can parse
- Run supabase migration list BEFORE and AFTER migration operations
- Test migrations on STAGE before applying to PROD
```

## Schema Snapshot (CodeGraph for Your Database)

The killer feature. Instead of your agent running SQL against `information_schema` every time it needs to understand your database (burning context and API calls), `snapshot` creates a local file cache that Claude can grep and read instantly.

### Create a Snapshot

```bash
supabase-skill snapshot
```

One API call fetches the full OpenAPI spec from PostgREST, then splits it into small, searchable markdown files:

```
.supabase-schema/
├── index.md              # All tables, views, functions at a glance
├── tables/
│   ├── episodes.md       # Columns, types, PKs, FKs, defaults, notes
│   ├── subscriptions.md
│   ├── users.md
│   └── ... (one file per table + view)
├── relationships.json    # Every FK mapping: "episodes.subscription_id" → "subscriptions.id"
└── functions.md          # All RPC functions with parameter signatures
```

### What a Table File Looks Like

```markdown
# episodes

15 columns | 1 PK | 2 FK

| Column | Type | Nullable | Default | FK |
|--------|------|----------|---------|-----|
| id **PK** | uuid | NOT NULL | gen_random_uuid() |  |
| subscription_id | uuid | NOT NULL |  | → subscriptions.id |
| status | text | nullable | new |  |
| audio_url | text | nullable |  |  |
| metadata_id | uuid | nullable |  | → episode_metadata.id |
...

## Notes
- **processing_metadata**: Stores additional processing information and AI analysis results
```

### Search the Snapshot

```bash
# Find everything related to "episode"
supabase-skill search episode

# Output:
#   TABLES: episodes, episode_chunks, episode_metadata, ...
#   COLUMNS: ai_sections.episode_id (uuid), segments.episode_id (uuid), ...
#   FUNCTIONS: browse_episodes, episode_semantic_search, ...
#   FKS: episodes.subscription_id → subscriptions.id, ...

# JSON output for programmatic use
supabase-skill search subscription --json
```

### How Agents Use It

Instead of:
```
Agent: "Let me query the database to understand the schema..."
→ runs SQL against information_schema (3-5 seconds, eats context)
→ parses results
→ stores in conversation memory
```

Now:
```
Agent: reads .supabase-schema/tables/episodes.md (instant, 20 lines)
Agent: reads .supabase-schema/relationships.json (instant, FK map)
```

The snapshot is **markdown** (not JSON) so Claude reads it naturally with zero parsing overhead. Add `.supabase-schema/` to your `.gitignore` and refresh with `supabase-skill snapshot` whenever your schema changes.

## Multi-Format Output

Generate the skill doc for different AI agent platforms:

```bash
# Claude Code (CLAUDE.md)
supabase-skill docs --format claude

# OpenAI Codex (AGENTS.md)
supabase-skill docs --format agents

# Cursor (.cursorrules)
supabase-skill docs --format cursor

# OpenClaw / ClawHub (SKILL.md with frontmatter)
supabase-skill docs --format skill

# Raw (no wrapping)
supabase-skill docs
```

## Config File

Stored at `~/.config/supabase-skill/config.json`:

```json
{
  "environments": {
    "prod": { "ref": "abcdefghijklmnopqrst", "name": "My App Production" },
    "stage": { "ref": "tsrqponmlkjihgfedcba", "name": "My App Staging" }
  },
  "defaultEnv": "stage",
  "safetyRules": {
    "prodRequiresApproval": true,
    "alwaysSpecifyRef": true
  }
}
```

## Why CLIs Beat MCP for Agents

| | MCP Server | CLI Skill Doc |
|---|---|---|
| **Context overhead** | 30-40% of context window consumed by schema | Zero — agent reads a concise doc |
| **Multi-environment** | One database per server instance | `--project-ref` switches instantly |
| **Runtime** | Server process running in background | No process — just `exec` calls |
| **Dependencies** | Protocol handshake, WebSocket, auth | `supabase` binary + a text file |
| **Structured output** | Custom serialization | `-o json` flag built into every command |
| **Composability** | None | Pipe output: `supabase ... -o json \| jq '...'` |
| **Testing** | Spin up server, connect, send request | `supabase --help` in terminal |

## Requirements

- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed
- Logged in via `supabase login`
- Node.js 18+

## License

MIT
