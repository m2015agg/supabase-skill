import { Command } from "commander";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { upsertSection } from "../util/claude-md.js";
import { readConfig } from "../util/config.js";
import { getSkillDoc } from "./docs.js";
import { walkthroughTemplate } from "../templates/walkthrough.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize project: CLAUDE.md + .env + snapshot + approve permissions + cron (all automatic)")
    .option("--skip-snapshot", "Skip schema snapshot")
    .option("--skip-approve", "Skip Claude permission approval")
    .option("--skip-cron", "Skip nightly cron setup")
    .action((opts: { skipSnapshot?: boolean; skipApprove?: boolean; skipCron?: boolean }) => {
      const cwd = process.cwd();
      const config = readConfig();

      if (!config || Object.keys(config.environments).length === 0) {
        write("\n  No global config found. Run `supabase-skill install` first.\n\n");
        process.exit(1);
      }

      write("\n  ╔══════════════════════════════════════╗\n");
      write("  ║   supabase-skill project init        ║\n");
      write("  ╚══════════════════════════════════════╝\n\n");

      const skillDoc = getSkillDoc(config);

      // ─── 1. CLAUDE.md (no secrets) ───
      write("  1/5 Writing CLAUDE.md...\n");
      const claudeMd = join(cwd, "CLAUDE.md");
      const claudeResult = upsertSection(claudeMd, skillDoc);
      write(`    CLAUDE.md: ${claudeResult}\n`);

      const dotClaudeDir = join(cwd, ".claude");
      if (!existsSync(dotClaudeDir)) mkdirSync(dotClaudeDir, { recursive: true });
      const dotClaudeMd = join(dotClaudeDir, "CLAUDE.md");
      const dotResult = upsertSection(dotClaudeMd, skillDoc);
      write(`    .claude/CLAUDE.md: ${dotResult}\n`);

      // Write /supabase slash command
      const commandsDir = join(dotClaudeDir, "commands");
      if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });
      const commandPath = join(commandsDir, "supabase.md");
      writeFileSync(commandPath, walkthroughTemplate);
      write(`    .claude/commands/supabase.md: written\n`);

      // ─── 2. .env (secrets) ───
      write("\n  2/5 Writing .env with API keys...\n");
      const envPath = join(cwd, ".env");
      const envLines: string[] = ["", "# supabase-skill environments"];

      for (const [env, envConfig] of Object.entries(config.environments)) {
        const prefix = `SUPABASE_${env.toUpperCase()}`;
        envLines.push(`${prefix}_REF=${envConfig.ref}`);
        envLines.push(`${prefix}_URL=${envConfig.dbUrl || `https://${envConfig.ref}.supabase.co`}`);
        if (envConfig.anonKey) envLines.push(`${prefix}_ANON_KEY=${envConfig.anonKey}`);
        if (envConfig.serviceKey) envLines.push(`${prefix}_SERVICE_KEY=${envConfig.serviceKey}`);
        envLines.push("");
      }

      if (!existsSync(envPath)) {
        writeFileSync(envPath, envLines.join("\n") + "\n", { mode: 0o600 });
        write("    .env: created\n");
      } else {
        const envContent = readFileSync(envPath, "utf-8");
        if (envContent.includes("# supabase-skill environments")) {
          write("    .env: already configured (not overwriting)\n");
        } else {
          appendFileSync(envPath, envLines.join("\n") + "\n");
          write("    .env: appended\n");
        }
      }

      // .gitignore
      const gitignorePath = join(cwd, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, ".env\n.supabase-schema/\n");
        write("    .gitignore: created\n");
      } else {
        const gi = readFileSync(gitignorePath, "utf-8");
        const additions: string[] = [];
        if (!gi.includes(".env")) additions.push(".env");
        if (!gi.includes(".supabase-schema")) additions.push(".supabase-schema/");
        if (additions.length > 0) {
          appendFileSync(gitignorePath, additions.join("\n") + "\n");
          write(`    .gitignore: appended ${additions.join(", ")}\n`);
        }
      }

      // ─── 3. Snapshot ───
      if (!opts.skipSnapshot) {
        write("\n  3/5 Snapshotting schema...\n");
        const ref = config.environments[config.defaultEnv]?.ref ||
          Object.values(config.environments)[0]?.ref;
        if (ref) {
          try {
            execSync(`supabase-skill snapshot --project-ref ${ref}`, { stdio: "inherit", cwd });
          } catch {
            write("    ✗ Snapshot failed — run `supabase-skill snapshot` manually\n");
          }
        }
      } else {
        write("\n  3/5 Snapshot: skipped\n");
      }

      // ─── 4. Approve ───
      if (!opts.skipApprove) {
        write("\n  4/5 Approving Claude permissions...\n");
        try {
          execSync("supabase-skill approve", { stdio: "inherit", cwd });
        } catch {
          write("    ✗ Approve failed — run `supabase-skill approve` manually\n");
        }
      } else {
        write("\n  4/5 Approve: skipped\n");
      }

      // ─── 5. Cron ───
      if (!opts.skipCron) {
        write("\n  5/5 Setting up nightly cron...\n");
        try {
          execSync("supabase-skill cron", { stdio: "inherit", cwd });
        } catch {
          write("    ✗ Cron failed — run `supabase-skill cron` manually\n");
        }
      } else {
        write("\n  5/5 Cron: skipped\n");
      }

      write("\n  ── Project ready! ──\n\n");
      write("  Security:\n");
      write("    ✓ API keys in .env only (never in CLAUDE.md)\n");
      write("    ✓ .env + .supabase-schema/ gitignored\n");
      write("    ✓ Claude read commands pre-approved (no prompts)\n");
      write("    ✓ SQL commands pre-approved (supabase-skill sql)\n");
      write("    ✓ Write commands still require approval\n\n");
    });
}
