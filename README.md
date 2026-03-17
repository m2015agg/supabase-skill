# @m2015agg/supabase-skill

**The Supabase MCP replacement.** One npm package that teaches AI agents (Claude Code, Codex, Cursor) how to use the Supabase CLI, caches your entire database schema locally, and pre-approves read-only commands so your agent stops asking permission for every lookup.

No MCP server. No context window bloat. No running processes. No permission prompts for reads.

## The Problem

If you're using Claude Code (or any AI agent) with Supabase, you're burning tokens three ways:

**1. The MCP tax** — The Supabase MCP server dumps its entire tool schema into your context window. 30-40% gone before your agent starts thinking.

**2. The schema discovery loop** — Every conversation, your agent runs `SELECT * FROM information_schema.columns` or similar SQL to understand your tables. We measured this across 14 real conversations: **265 schema queries consumed ~330,000 tokens ($4.96 at Opus rates)**. The heaviest single query dumped 22,282 tokens.

**3. The permission prompt hell** — Claude asks "Allow this command?" for every `supabase migration list`, every `supabase inspect db table-stats`, every schema lookup. You click "Allow" 30 times per session.

## The Solution

**Replace the MCP with CLI instructions.** The Supabase CLI already does everything the MCP does. Your agent just doesn't know about it.

**Cache the schema locally.** One API call snapshots your entire database into a local SQLite + markdown cache. Your agent reads local files (~80 tokens) instead of running SQL queries (~1,247 tokens average).

**Pre-approve read commands.** 23 read-only commands (schema lookups, migration list, inspect, etc.) are auto-approved in Claude Code. Write commands (migration up, deploy, delete) still require your approval.

**Result: ~95% token reduction on schema exploration, zero permission prompts for reads, multi-environment support (dev/stage/prod) in one session.**

This package:
- **Guided install wizard** — checks/installs Supabase CLI, logs you in, discovers projects + branches, fetches API keys, configures environments
- **Schema snapshot** — caches your entire database schema locally (SQLite + FTS5 + markdown) so your agent never runs SQL to explore tables again
- **Full DB admin skill doc** — teaches your agent every Supabase command: CRUD via REST API, migrations, DDL, inspect, storage, edge functions, branches, backups
- **Security model** — API keys in `.env` only (never in CLAUDE.md), gitignored, mode 600
- **Pre-approved permissions** — 23 read-only commands auto-approved in Claude Code, write commands still require approval
- **Nightly auto-refresh** — cron job keeps schema snapshot current

Two commands. Zero prompts after install.

## Install

```bash
npm install -g @m2015agg/supabase-skill
```

## Quick Start

### 1. Global Setup (one time)

```bash
supabase-skill install
```

Interactive wizard (8 steps):
1. Check/install Supabase CLI (minimum v2.67.0)
2. Check/trigger login (opens browser if needed)
3. Discover projects + branches (auto-detects preview branches)
4. Tag each as `prod` / `stage` / `dev` / `skip`
5. Ask for database schema name (default: `public`)
6. Fetch API keys automatically (anon + service_role per environment)
7. Write config to `~/.config/supabase-skill/config.json` (mode 600)
8. Write skill doc to `~/.claude/CLAUDE.md`

```
$ supabase-skill install

  ╔══════════════════════════════════════╗
  ║   supabase-skill setup wizard        ║
  ╚══════════════════════════════════════╝

  Step 1/5: Supabase CLI
    ✓ Found v2.78.1 (minimum: v2.67.0)

  Step 2/5: Authentication
    ✓ Logged in

  Step 3/5: Discovering projects & branches
    1. My App Production (abcdefghijklmnopqrst) ✓
       Checking branches... 1 found
       └─ staging (tsrqponmlkjihgfedcba) ✓

    Tag each environment (prod/stage/dev/skip):
    My App Production → prod
      My App Production [staging] → stage
    Database schema name (default: public) → my_schema

  Step 4/5: Fetching API keys
    PROD (abcdefghijklmnopqrst)... ✓ anon + service_role keys saved
    STAGE (tsrqponmlkjihgfedcba)... ✓ anon + service_role keys saved

  Step 5/5: Writing configuration
    ✓ Config, CLAUDE.md, shell profile

  Next: cd into your project and run `supabase-skill init`
```

### 2. Per-Project Setup (per project directory)

```bash
cd your-project
supabase-skill init
```

Runs 5 steps automatically — no prompts:
1. **CLAUDE.md** — skill doc with environment routing (no secrets)
2. **.env** — API keys per environment (gitignored, mode 600)
3. **Schema snapshot** — SQLite + markdown cache of all tables, columns, FKs, functions
4. **Claude permissions** — 23 read-only commands pre-approved (no more prompts)
5. **Nightly cron** — auto-refresh schema at 3am

Or do both in one shot from your project directory:

```bash
supabase-skill install --init
```

### 3. Done

Claude now knows every Supabase command, which ref is prod vs stage, reads your schema from local files instead of running SQL, and doesn't prompt for read-only operations.

## Commands

### User Commands (you run these)

| Command | When |
|---------|------|
| `supabase-skill install` | One time — global wizard (CLI, login, envs, keys) |
| `supabase-skill install --init` | One time from project dir — global + project setup |
| `supabase-skill init` | Per project — full auto-setup (CLAUDE.md + .env + snapshot + approve + cron) |
| `supabase-skill envs` | Check configured environments |
| `supabase-skill cron --status` | Check nightly refresh status |
| `supabase-skill uninstall` | Remove from current project |
| `supabase-skill uninstall --global` | Remove from global CLAUDE.md |

### Agent Commands (Claude uses these — pre-approved, no prompts)

| Command | What it does |
|---------|-------------|
| `supabase-skill context <query>` | Full context: columns, FKs, related tables (2 levels), functions |
| `supabase-skill table <name>` | Single table deep dive with relationships + related summaries |
| `supabase-skill columns [name]` | Search columns by name, `--type`, `--fk`, `--pk`, `--table` |
| `supabase-skill search <query>` | FTS5-powered search across tables, columns, functions, FKs |
| `supabase-skill snapshot` | Refresh schema cache (auto-runs after DDL changes) |
| `supabase inspect db *` | 12 database inspection commands (table-stats, locks, etc.) |
| `supabase migration list` | Compare local vs remote migrations |

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

It covers **20 sections** — every Supabase CLI capability plus REST API operations:

| Section | What it teaches the agent |
|---------|-------------------------|
| **CLI Flag Reference** | Which commands use `--linked` vs `--project-ref` (agents get this wrong constantly) |
| **Environment Routing** | "stage" → correct ref, "prod" → correct ref + approval required |
| **Data Operations (REST API)** | Full CRUD: SELECT with 12 filter operators, INSERT, UPDATE, UPSERT, DELETE, COUNT |
| **Migrations** | `new`, `list`, `up`, `down`, `repair`, `squash`, `fetch` |
| **DDL via Migrations** | CREATE/ALTER/DROP TABLE, VIEW, INDEX, FUNCTION, RLS policies, triggers, enums |
| **Schema Management** | `db diff`, `dump`, `pull`, `push`, `lint` |
| **Database Inspection** | All 12 `inspect db` commands + `inspect report` |
| **Storage** | `ls`, `cp`, `rm`, `mv` (with `--experimental` flag) |
| **Edge Functions** | `list`, `deploy`, `delete`, `new`, `download`, `serve` |
| **Branches** | `list`, `create`, `delete`, `get`, `pause`, `unpause` |
| **Backups** | `list`, `restore` (PITR) |
| **Project Management** | `projects list/api-keys`, `secrets list/set`, `postgres-config` |
| **Code Generation** | `gen types` (TypeScript from schema) |
| **Schema Snapshot** | All `supabase-skill` query commands for local schema exploration |
| **Safety Rules** | Never mutate prod without approval, always specify ref, test on stage first |

### Security Model

| What | Where | Visible to agent? |
|------|-------|-------------------|
| Project refs (not secrets) | CLAUDE.md | Yes — agent needs these for `--project-ref` |
| Environment routing | CLAUDE.md | Yes — agent needs to know "stage" → which ref |
| API keys (anon + service_role) | `.env` only | Only when agent runs `source .env` |
| Config with keys | `~/.config/supabase-skill/config.json` | No — mode 600, only used by `init` |
| Schema snapshot | `.supabase-schema/` | Yes — that's the whole point |

**Rule**: Secrets never go in CLAUDE.md. Agent reads `.env` when it needs direct API access.

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

### Context — The Smart Query (Like CodeGraph's `codegraph_context`)

```bash
# "What's the full picture for episodes?"
supabase-skill context episodes
```

Returns everything in one shot:
- Full column listing with types, PKs, FKs, defaults
- All related tables (2 levels deep via FK chains)
- Which direction: "references" vs "referenced by"
- Related RPC functions
- Column notes/descriptions

```bash
# Deeper FK traversal
supabase-skill context episodes --depth 3

# Topic-based (matches any table/column containing the term)
supabase-skill context subscription
supabase-skill context chat
```

### Table — Single Table Deep Dive

```bash
supabase-skill table subscriptions
```

Returns the full table file plus:
- Outgoing FKs ("this table references")
- Incoming FKs ("referenced by")
- Related RPC functions (name-matched)
- Related table summaries (column counts for each FK target)

### Columns — Cross-Database Column Search

Stop running `SELECT column_name FROM information_schema.columns WHERE...` every time.

```bash
# Find all jsonb columns across the entire database
supabase-skill columns --type jsonb

# All foreign key columns in episode-related tables
supabase-skill columns --fk --table episode

# All primary keys
supabase-skill columns --pk

# All NOT NULL columns with defaults
supabase-skill columns --not-null --has-default

# Find all "status" columns and their types
supabase-skill columns status

# Combine: all uuid columns that are foreign keys
supabase-skill columns --type uuid --fk
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

## Real-World Token Savings — Hard Numbers

We analyzed 14 Claude Code conversations on a production Supabase project (80 tables, 48 RPCs, 86 foreign keys) to measure how many tokens schema exploration actually consumes.

### Before supabase-skill (SQL queries every time)

| Metric | Value |
|--------|-------|
| Conversations doing schema exploration | **14** |
| Total schema query + result dumps | **265 calls** |
| Total tokens consumed by schema results | **~330,000** |
| Cost at Opus rates ($15/M input) | **$4.96** |
| Average tokens per schema call | **~1,247** |
| Heaviest single query result | **~22,282 tokens** |

#### Heaviest Conversations

| Session | Calls | Tokens | Task |
|---------|-------|--------|------|
| Support AI Console planning | 56 | ~81,000 | Exploring tables for agent access |
| Study Mode migration design | 41 | ~74,000 | Designing new tables + FKs |
| Schema exploration | 43 | ~53,000 | General schema discovery |
| Building supabase-skill | 24 | ~33,000 | This tool, ironically |

### After supabase-skill (local snapshot)

| Operation | Before (SQL query) | After (local file) | Savings |
|-----------|-------------------|---------------------|---------|
| "What columns does episodes have?" | ~1,200 tokens | ~80 tokens | **93%** |
| "Find all jsonb columns" | ~3,000 tokens | ~200 tokens | **93%** |
| "What references episodes?" | ~2,000 tokens | ~150 tokens | **92%** |
| "Show me the full schema" | ~22,000 tokens | ~500 tokens | **98%** |

**Conservative estimate**: Those 330,000 tokens across 14 conversations drop to roughly **15,000-20,000 tokens** with the local snapshot. That's a **~95% reduction** — or about **$4.70 saved** at Opus rates just from the conversations we measured.

And that's just one project. The savings compound across every conversation, every day, for every developer on the team.

## Why CLIs Beat MCP for Agents

| | MCP Server | CLI Skill Doc |
|---|---|---|
| **Context overhead** | 30-40% of context window consumed by schema | Zero — agent reads a concise doc |
| **Schema exploration** | ~1,247 tokens per query (measured) | ~80-200 tokens per file read |
| **Multi-environment** | One database per server instance | `--project-ref` switches instantly |
| **Runtime** | Server process running in background | No process — just `exec` calls |
| **Dependencies** | Protocol handshake, WebSocket, auth | `supabase` binary + a text file |
| **Structured output** | Custom serialization | `-o json` flag built into every command |
| **Composability** | None | Pipe output: `supabase ... -o json \| jq '...'` |
| **Testing** | Spin up server, connect, send request | `supabase --help` in terminal |

## Requirements

- Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) v2.67.0+ (wizard installs it if missing)
- Supabase account with at least one project

## Uninstall

```bash
supabase-skill uninstall --global   # remove from ~/.claude/CLAUDE.md
supabase-skill uninstall            # remove from current project
supabase-skill approve --remove     # remove Claude permissions
supabase-skill cron --remove        # remove nightly cron
npm uninstall -g @m2015agg/supabase-skill
```

## License

MIT
