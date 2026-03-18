import { Command } from "commander";
import { join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { isSupabaseCLIInstalled, isLoggedIn } from "../util/detect.js";
import { readConfig } from "../util/config.js";
import { hasDb } from "../util/db.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

function pass(label: string, detail?: string): void {
  write(`  ✓ ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function fail(label: string, detail?: string): void {
  write(`  ✗ ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function warn(label: string, detail?: string): void {
  write(`  ⚠ ${label}${detail ? ` — ${detail}` : ""}\n`);
}

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Health check — validate entire supabase-skill setup")
    .action(() => {
      const cwd = process.cwd();
      let passing = 0;
      let failing = 0;
      let warnings = 0;

      write("\n  supabase-skill doctor\n");
      write("  ─────────────────────\n\n");

      // 1. Supabase CLI installed + version
      const cli = isSupabaseCLIInstalled();
      if (cli.installed) {
        pass("Supabase CLI", `v${cli.version}`);
        passing++;
      } else {
        fail("Supabase CLI", "not installed — run `npm i -g supabase`");
        failing++;
      }

      // 2. Logged in
      if (cli.installed) {
        write("  … Checking login (may take a moment)... ");
        const loggedIn = isLoggedIn();
        write("\r");
        if (loggedIn) {
          pass("Logged in", "supabase projects list works");
          passing++;
        } else {
          fail("Logged in", "run `supabase login`");
          failing++;
        }
      }

      // 3. Config exists + environments
      const config = readConfig();
      if (config) {
        const envCount = Object.keys(config.environments).length;
        if (envCount > 0) {
          const envNames = Object.keys(config.environments).join(", ");
          pass("Config", `${envCount} environment(s): ${envNames}`);
          passing++;
        } else {
          fail("Config", "no environments configured — run `supabase-skill install`");
          failing++;
        }
      } else {
        fail("Config", "not found — run `supabase-skill install`");
        failing++;
      }

      // 4. API keys present per env
      if (config) {
        for (const [env, envConfig] of Object.entries(config.environments)) {
          if (envConfig.anonKey && envConfig.serviceKey) {
            pass(`API keys [${env}]`, "anon + service_role present");
            passing++;
          } else {
            const missing = [];
            if (!envConfig.anonKey) missing.push("anon");
            if (!envConfig.serviceKey) missing.push("service_role");
            warn(`API keys [${env}]`, `missing: ${missing.join(", ")}`);
            warnings++;
          }
        }
      }

      // 5. Schema configured
      if (config?.schema) {
        pass("Schema", config.schema);
        passing++;
      } else {
        warn("Schema", "not set — defaults to 'public'");
        warnings++;
      }

      // 6. Project linked (check supabase/.temp/project-ref)
      const projectRefPath = join(cwd, "supabase", ".temp", "project-ref");
      if (existsSync(projectRefPath)) {
        const ref = readFileSync(projectRefPath, "utf-8").trim();
        pass("Project linked", ref);
        passing++;
      } else {
        warn("Project linked", "no linked project in cwd — run `supabase link --project-ref <ref>`");
        warnings++;
      }

      // 7. CLAUDE.md has skill doc
      const claudeMd = join(cwd, "CLAUDE.md");
      const dotClaudeMd = join(cwd, ".claude", "CLAUDE.md");
      const hasClaudeMd =
        (existsSync(claudeMd) && readFileSync(claudeMd, "utf-8").includes("<!-- supabase-skill:start -->")) ||
        (existsSync(dotClaudeMd) && readFileSync(dotClaudeMd, "utf-8").includes("<!-- supabase-skill:start -->"));
      if (hasClaudeMd) {
        pass("CLAUDE.md", "skill doc installed");
        passing++;
      } else {
        fail("CLAUDE.md", "no supabase-skill section — run `supabase-skill init`");
        failing++;
      }

      // 8. .env has keys
      const envPath = join(cwd, ".env");
      if (existsSync(envPath)) {
        const envContent = readFileSync(envPath, "utf-8");
        if (envContent.includes("SUPABASE_")) {
          pass(".env", "has Supabase keys");
          passing++;
        } else {
          warn(".env", "exists but no SUPABASE_ keys — run `supabase-skill init`");
          warnings++;
        }
      } else {
        warn(".env", "not found — run `supabase-skill init`");
        warnings++;
      }

      // 9. Snapshot exists + age
      const schemaDir = join(cwd, ".supabase-schema");
      if (hasDb(schemaDir)) {
        const dbPath = join(schemaDir, "schema.db");
        const stats = statSync(dbPath);
        const ageMs = Date.now() - stats.mtimeMs;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        const ageDays = Math.floor(ageHours / 24);
        const ageStr = ageDays > 0 ? `${ageDays}d ${ageHours % 24}h ago` : `${ageHours}h ago`;
        if (ageDays > 7) {
          warn("Snapshot", `exists but stale (${ageStr}) — run \`supabase-skill snapshot\``);
          warnings++;
        } else {
          pass("Snapshot", ageStr);
          passing++;
        }
      } else if (existsSync(schemaDir)) {
        warn("Snapshot", "markdown only (no SQLite) — re-run `supabase-skill snapshot`");
        warnings++;
      } else {
        fail("Snapshot", "not found — run `supabase-skill snapshot`");
        failing++;
      }

      // 10. Permissions approved
      const settingsPath = join(cwd, ".claude", "settings.json");
      if (existsSync(settingsPath)) {
        const settings = readFileSync(settingsPath, "utf-8");
        if (settings.includes("supabase-skill")) {
          pass("Permissions", "supabase-skill approved in .claude/settings.json");
          passing++;
        } else {
          warn("Permissions", "supabase-skill not in .claude/settings.json — run `supabase-skill approve`");
          warnings++;
        }
      } else {
        warn("Permissions", ".claude/settings.json not found — run `supabase-skill approve`");
        warnings++;
      }

      // 11. Cron active
      try {
        const crontab = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
        if (crontab.includes("supabase-skill")) {
          pass("Cron", "supabase-skill found in crontab");
          passing++;
        } else {
          warn("Cron", "no supabase-skill cron entry — run `supabase-skill cron`");
          warnings++;
        }
      } catch {
        warn("Cron", "no crontab — run `supabase-skill cron`");
        warnings++;
      }

      // Summary
      write("\n  ─────────────────────\n");
      write(`  ${passing} passed, ${failing} failed, ${warnings} warnings\n`);
      if (failing === 0) {
        write("  Setup looks good!\n\n");
      } else {
        write("  Fix the failures above and re-run `supabase-skill doctor`\n\n");
      }
    });
}
