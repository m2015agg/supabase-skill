import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { upsertSection } from "../util/claude-md.js";
import { writeConfig, getDefaultConfig, type SkillConfig, type Environment } from "../util/config.js";
import { isSupabaseCLIInstalled, isLoggedIn, listProjects, type SupabaseProject } from "../util/detect.js";
import { getSkillDoc } from "./docs.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function write(msg: string): void {
  process.stdout.write(msg);
}

export function installCommand(): Command {
  return new Command("install")
    .description("Set up supabase-skill globally (checks CLI, configures environments, updates ~/.claude/CLAUDE.md)")
    .option("--skip-shell", "Skip shell profile modification")
    .option("--non-interactive", "Skip interactive prompts (use existing config or defaults)")
    .action(async (opts: { skipShell?: boolean; nonInteractive?: boolean }) => {
      const home = homedir();
      const results: string[] = [];

      // 1. Check supabase CLI
      write("\n  Checking supabase CLI... ");
      const { installed, version } = isSupabaseCLIInstalled();
      if (!installed) {
        write("NOT FOUND\n\n");
        write("  Supabase CLI is required. Install it:\n");
        write("    brew install supabase/tap/supabase\n");
        write("    # or: npm install -g supabase\n");
        write("    # or: https://supabase.com/docs/guides/cli/getting-started\n\n");
        process.exit(1);
      }
      write(`\u2713 v${version}\n`);

      // 2. Check login
      write("  Checking login status... ");
      const loggedIn = isLoggedIn();
      if (!loggedIn) {
        write("NOT LOGGED IN\n\n");
        write("  Run: supabase login\n");
        write("  Then re-run: supabase-skill install\n\n");
        process.exit(1);
      }
      write("\u2713 logged in\n");

      // 3. List projects and tag environments
      const config = getDefaultConfig();

      if (!opts.nonInteractive && process.stdin.isTTY) {
        const projects = listProjects();
        if (projects.length > 0) {
          write(`\n  Found ${projects.length} project(s):\n`);
          projects.forEach((p, i) => {
            write(`    ${i + 1}. ${p.name} (${p.id})\n`);
          });

          write("\n  Tag each project (prod/stage/dev/skip):\n");
          for (const project of projects) {
            const answer = await prompt(`    ${project.name} (${project.id}) \u2192 `);
            const env = answer.toLowerCase();
            if (env === "prod" || env === "stage" || env === "dev") {
              config.environments[env] = { ref: project.id, name: project.name };
            }
          }

          // Set default env
          if (config.environments["stage"]) {
            config.defaultEnv = "stage";
          } else if (config.environments["dev"]) {
            config.defaultEnv = "dev";
          } else {
            const envKeys = Object.keys(config.environments);
            if (envKeys.length > 0) config.defaultEnv = envKeys[0];
          }
        } else {
          write("\n  No projects found. You can configure environments later with:\n");
          write("    supabase-skill install\n");
        }
      }

      // 4. Write config
      writeConfig(config);
      results.push("~/.config/supabase-skill/config.json: created");

      // 5. Upsert into global CLAUDE.md
      const claudeMd = join(home, ".claude", "CLAUDE.md");
      const skillDoc = getSkillDoc(config);
      const claudeResult = upsertSection(claudeMd, skillDoc);
      results.push(`~/.claude/CLAUDE.md: ${claudeResult}`);

      // 6. Shell profile — ensure SUPABASE_ACCESS_TOKEN
      if (!opts.skipShell) {
        const shell = process.env.SHELL || "/bin/bash";
        const profileName = shell.includes("zsh") ? ".zshrc" : ".bashrc";
        const profilePath = join(home, profileName);

        if (existsSync(profilePath)) {
          const content = readFileSync(profilePath, "utf-8");
          if (content.includes("SUPABASE_ACCESS_TOKEN")) {
            results.push(`~/${profileName}: SUPABASE_ACCESS_TOKEN already present`);
          } else {
            appendFileSync(profilePath, "\n# supabase-skill\nexport SUPABASE_ACCESS_TOKEN=\"\"\n");
            results.push(`~/${profileName}: added SUPABASE_ACCESS_TOKEN placeholder`);
          }
        } else {
          writeFileSync(profilePath, "# supabase-skill\nexport SUPABASE_ACCESS_TOKEN=\"\"\n");
          results.push(`~/${profileName}: created with SUPABASE_ACCESS_TOKEN placeholder`);
        }
      }

      // Output results
      write("\n  supabase-skill install complete:\n");
      for (const r of results) {
        write(`    ${r}\n`);
      }

      if (Object.keys(config.environments).length > 0) {
        write("\n  Configured environments:\n");
        for (const [env, { ref, name }] of Object.entries(config.environments)) {
          write(`    ${env.toUpperCase()}: ${ref} (${name})\n`);
        }
      }

      write("\n  Next: run `supabase-skill init` in any project directory.\n\n");
    });
}
