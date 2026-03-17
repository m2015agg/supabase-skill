import { Command } from "commander";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

function write(msg: string): void {
  process.stdout.write(msg);
}

// All supabase-skill commands that Claude should run without prompting
const SKILL_PERMISSIONS = [
  // Read-only local commands (query SQLite/markdown)
  "Bash(supabase-skill search:*)",
  "Bash(supabase-skill context:*)",
  "Bash(supabase-skill table:*)",
  "Bash(supabase-skill columns:*)",
  "Bash(supabase-skill envs:*)",
  "Bash(supabase-skill docs:*)",
  "Bash(supabase-skill cron --status:*)",
  // Snapshot (fetches from API but writes locally)
  "Bash(supabase-skill snapshot:*)",
  // Supabase CLI read-only commands
  "Bash(supabase projects list:*)",
  "Bash(supabase projects api-keys:*)",
  "Bash(supabase branches list:*)",
  "Bash(supabase functions list:*)",
  "Bash(supabase secrets list:*)",
  "Bash(supabase snippets list:*)",
  "Bash(supabase snippets download:*)",
  "Bash(supabase migration list:*)",
  "Bash(supabase inspect:*)",
  "Bash(supabase backups list:*)",
  "Bash(supabase db dump:*)",
  "Bash(supabase db diff:*)",
  "Bash(supabase db lint:*)",
  "Bash(supabase gen types:*)",
  "Bash(supabase status:*)",
];

function updateSettings(filePath: string, permissions: string[]): { added: number; existing: number } {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      settings = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // Corrupted file, start fresh
    }
  }

  if (!settings.permissions) settings.permissions = {};
  const perms = settings.permissions as Record<string, unknown>;
  if (!Array.isArray(perms.allow)) perms.allow = [];
  const allow = perms.allow as string[];

  let added = 0;
  let existing = 0;
  for (const perm of permissions) {
    if (allow.includes(perm)) {
      existing++;
    } else {
      allow.push(perm);
      added++;
    }
  }

  writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
  return { added, existing };
}

export function approveCommand(): Command {
  return new Command("approve")
    .description("Pre-approve supabase-skill + supabase CLI read commands in Claude Code (no more permission prompts)")
    .option("--global", "Add to global ~/.claude/settings.json (applies to all projects)")
    .option("--remove", "Remove pre-approved permissions")
    .action((opts: { global?: boolean; remove?: boolean }) => {
      const targets: Array<{ path: string; label: string }> = [];

      if (opts.global) {
        targets.push({
          path: join(homedir(), ".claude", "settings.json"),
          label: "~/.claude/settings.json (global)",
        });
      } else {
        const cwd = process.cwd();
        targets.push({
          path: join(cwd, ".claude", "settings.json"),
          label: ".claude/settings.json (project)",
        });
      }

      if (opts.remove) {
        for (const target of targets) {
          if (!existsSync(target.path)) {
            write(`  ${target.label}: not found\n`);
            continue;
          }
          const settings = JSON.parse(readFileSync(target.path, "utf-8"));
          const perms = settings.permissions as Record<string, unknown> | undefined;
          if (perms && Array.isArray(perms.allow)) {
            const before = perms.allow.length;
            perms.allow = (perms.allow as string[]).filter((p) => !SKILL_PERMISSIONS.includes(p));
            const removed = before - (perms.allow as string[]).length;
            writeFileSync(target.path, JSON.stringify(settings, null, 2) + "\n");
            write(`  ${target.label}: removed ${removed} permissions\n`);
          }
        }
        return;
      }

      write("\n  Pre-approving supabase-skill commands for Claude Code:\n\n");

      for (const target of targets) {
        const { added, existing } = updateSettings(target.path, SKILL_PERMISSIONS);
        write(`  ${target.label}:\n`);
        write(`    ${added} permissions added, ${existing} already present\n\n`);
      }

      write("  Approved commands (Claude won't prompt for these):\n");
      write("    supabase-skill: search, context, table, columns, envs, docs, snapshot\n");
      write("    supabase CLI:   projects list, branches list, functions list, inspect,\n");
      write("                    migration list, db dump/diff/lint, backups list, gen types\n");
      write("\n  NOT approved (Claude will still ask — these modify data):\n");
      write("    supabase migration up/down/repair, db push, functions deploy,\n");
      write("    secrets set, REST API mutations (POST/PATCH/DELETE)\n\n");
    });
}
