import { Command } from "commander";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { upsertSection } from "../util/claude-md.js";
import { readConfig } from "../util/config.js";
import { getSkillDoc } from "./docs.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize supabase-skill in the current project (CLAUDE.md + .env with keys + .gitignore)")
    .action(() => {
      const cwd = process.cwd();
      const results: string[] = [];
      const config = readConfig();

      if (!config) {
        write("  No global config found. Run `supabase-skill install` first.\n");
        write("  Proceeding with generic skill doc (no environment refs).\n\n");
      }

      const skillDoc = getSkillDoc(config);

      // 1. Upsert into project CLAUDE.md (NO secrets — only refs + commands)
      const claudeMd = join(cwd, "CLAUDE.md");
      const claudeResult = upsertSection(claudeMd, skillDoc);
      results.push(`CLAUDE.md: ${claudeResult}`);

      // Also update .claude/CLAUDE.md if the directory exists
      const dotClaudeDir = join(cwd, ".claude");
      const dotClaudeMd = join(dotClaudeDir, "CLAUDE.md");
      if (existsSync(dotClaudeDir)) {
        const dotResult = upsertSection(dotClaudeMd, skillDoc);
        results.push(`.claude/CLAUDE.md: ${dotResult}`);
      }

      // 2. .env — write refs + API keys (secrets go here, NOT in CLAUDE.md)
      const envPath = join(cwd, ".env");
      const envLines: string[] = ["", "# supabase-skill environments"];

      if (config && Object.keys(config.environments).length > 0) {
        for (const [env, envConfig] of Object.entries(config.environments)) {
          const prefix = `SUPABASE_${env.toUpperCase()}`;
          envLines.push(`${prefix}_REF=${envConfig.ref}`);
          envLines.push(`${prefix}_URL=${envConfig.dbUrl || `https://${envConfig.ref}.supabase.co`}`);
          if (envConfig.anonKey) {
            envLines.push(`${prefix}_ANON_KEY=${envConfig.anonKey}`);
          }
          if (envConfig.serviceKey) {
            envLines.push(`${prefix}_SERVICE_KEY=${envConfig.serviceKey}`);
          }
          envLines.push("");
        }
      } else {
        envLines.push("SUPABASE_STAGE_REF=");
        envLines.push("SUPABASE_STAGE_URL=");
        envLines.push("SUPABASE_STAGE_ANON_KEY=");
        envLines.push("SUPABASE_STAGE_SERVICE_KEY=");
        envLines.push("");
        envLines.push("SUPABASE_PROD_REF=");
        envLines.push("SUPABASE_PROD_URL=");
        envLines.push("SUPABASE_PROD_ANON_KEY=");
        envLines.push("SUPABASE_PROD_SERVICE_KEY=");
        envLines.push("");
      }

      if (!existsSync(envPath)) {
        writeFileSync(envPath, envLines.join("\n") + "\n", { mode: 0o600 });
        results.push(".env: created with project refs + API keys (mode 600)");
      } else {
        const envContent = readFileSync(envPath, "utf-8");
        // Check if we already have supabase-skill section
        if (envContent.includes("# supabase-skill environments")) {
          results.push(".env: supabase-skill section already present (not overwriting)");
        } else {
          appendFileSync(envPath, envLines.join("\n") + "\n");
          const keyCount = envLines.filter((l) => l.includes("_SERVICE_KEY=") && !l.endsWith("=")).length;
          results.push(`.env: appended refs + ${keyCount} service key(s)`);
        }
      }

      // 3. .gitignore — ensure .env is listed
      const gitignorePath = join(cwd, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, ".env\n.supabase-schema/\n");
        results.push(".gitignore: created with .env + .supabase-schema/");
      } else {
        const giContent = readFileSync(gitignorePath, "utf-8");
        const additions: string[] = [];
        if (!giContent.includes(".env")) additions.push(".env");
        if (!giContent.includes(".supabase-schema")) additions.push(".supabase-schema/");
        if (additions.length > 0) {
          appendFileSync(gitignorePath, additions.join("\n") + "\n");
          results.push(`.gitignore: appended ${additions.join(", ")}`);
        } else {
          results.push(".gitignore: .env + .supabase-schema/ already listed");
        }
      }

      write("\nsupabase-skill init complete:\n");
      for (const r of results) {
        write(`  ${r}\n`);
      }

      write("\nSecurity:\n");
      write("  ✓ API keys in .env only (never in CLAUDE.md)\n");
      write("  ✓ .env is gitignored\n");
      write("  ✓ Claude reads keys from .env when it needs direct API access\n");

      write("\nNext:\n");
      write("  supabase-skill snapshot    # cache your schema locally\n");
      write("  supabase-skill cron        # set up nightly refresh\n\n");
    });
}
