# supabase-skill Benchmark Results

**Model:** sonnet
**Runs per eval:** 3
**Date:** 2026-03-18 12:11

## Summary

| Eval | Task | With Skill (avg ms) | Without Skill (avg ms) | Speedup | With Pass | Without Pass |
|------|------|---------------------|----------------------|---------|-----------|--------------|
| schema_lookup | What columns does the episodes table have, includi... | 14000ms | 18175ms | 1.29x | 0/3 | 0/3 |
| relationship_traversal | What tables have foreign keys pointing to the plan... | 13521ms | 33757ms | 2.49x | 0/3 | 0/3 |
| column_search | Find all columns of type jsonb across the bibleai ... | 14685ms | 97618ms | 6.64x | 0/3 | 0/3 |
| function_lookup | What RPC functions are available in the bibleai sc... | 33779ms | 18495ms | 0.54x | 0/3 | 0/3 |
| migration_generation | Write a migration to add a 'priority' integer colu... | 25597ms | 36385ms | 1.42x | 0/3 | 0/3 |
| cross_table_query | How are chat_sessions, chat_messages, and users re... | 17911ms | 14203ms | 0.79x | 0/3 | 0/3 |

## Raw Data

See `benchmark.json` for full results.

Individual responses in `with_skill/` and `without_skill/` directories.

Grading details in `grading/` directory.
