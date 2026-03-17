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
    .description("Initialize supabase-skill in the current project (CLAUDE.md + .env + .gitignore)")
    .action(() => {
      const cwd = process.cwd();
      const results: string[] = [];
      const config = readConfig();

      if (!config) {
        write("  No global config found. Run `supabase-skill install` first.\n");
        write("  Proceeding with generic skill doc (no environment refs).\n\n");
      }

      const skillDoc = getSkillDoc(config);

      // 1. Upsert into project CLAUDE.md
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

      // 2. .env — add project ref placeholders
      const envPath = join(cwd, ".env");
      const envVars: string[] = [];

      if (config && Object.keys(config.environments).length > 0) {
        for (const [env, { ref }] of Object.entries(config.environments)) {
          envVars.push(`SUPABASE_${env.toUpperCase()}_REF=${ref}`);
        }
      } else {
        envVars.push("SUPABASE_STAGE_REF=");
        envVars.push("SUPABASE_PROD_REF=");
      }

      if (!existsSync(envPath)) {
        writeFileSync(envPath, envVars.join("\n") + "\n");
        results.push(".env: created with project refs");
      } else {
        const envContent = readFileSync(envPath, "utf-8");
        const missing = envVars.filter((v) => {
          const key = v.split("=")[0];
          return !envContent.includes(key);
        });
        if (missing.length > 0) {
          appendFileSync(envPath, "\n# supabase-skill\n" + missing.join("\n") + "\n");
          results.push(`.env: appended ${missing.length} project ref(s)`);
        } else {
          results.push(".env: project refs already present");
        }
      }

      // 3. .gitignore
      const gitignorePath = join(cwd, ".gitignore");
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, ".env\n");
        results.push(".gitignore: created with .env");
      } else {
        const giContent = readFileSync(gitignorePath, "utf-8");
        if (giContent.includes(".env")) {
          results.push(".gitignore: .env already listed");
        } else {
          appendFileSync(gitignorePath, ".env\n");
          results.push(".gitignore: appended .env");
        }
      }

      write("supabase-skill init complete:\n");
      for (const r of results) {
        write(`  ${r}\n`);
      }
    });
}
