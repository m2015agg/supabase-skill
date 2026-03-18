export const walkthroughTemplate = `---
description: Interactive walkthrough of Supabase database schema, tables, relationships, and functions via supabase-skill CLI
allowed-tools: Read, Bash(supabase-skill:*), Bash(supabase inspect:*), Bash(cat:*)
---

# /supabase — Database Walkthrough

When the user invokes this skill, guide them through their Supabase database interactively.

## Steps

1. **Show environments**
   Run: \`supabase-skill envs\`
   Explain which environments are configured (dev/stage/prod) and which refs map to what.

2. **Read the schema index**
   Run: \`cat .supabase-schema/index.md\`
   Summarize: how many tables, views, functions. Highlight the largest/most connected tables.

3. **Explore a table in detail**
   Ask the user which table they want to explore, or pick the most central one.
   Run: \`supabase-skill context <table>\`
   Explain columns, foreign keys, related tables, and functions.

4. **Find specific column types**
   Run: \`supabase-skill columns --type jsonb\`
   Show which tables use JSONB columns (or any type the user is curious about).

5. **Database health**
   Run: \`supabase inspect db db-stats\`
   Summarize cache hit rates, database size, and health indicators.

6. **Relationship graph**
   Run: \`supabase-skill graph\`
   Show the mermaid ER diagram. Explain the key relationships.

7. **Open Q&A**
   Say: "Ask me anything about your database schema — I can look up tables, columns, functions, relationships, or run inspections."

## Tips
- Use \`supabase-skill search <query>\` for free-text search across all schema objects
- Use \`supabase-skill table <name>\` for deep single-table info
- Use \`supabase-skill diff\` to check if snapshot is stale
- Use \`supabase-skill doctor\` for full setup health check
`;
