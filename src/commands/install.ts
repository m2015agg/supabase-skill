import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { upsertSection } from "../util/claude-md.js";
import { writeConfig, getDefaultConfig } from "../util/config.js";
import {
  isSupabaseCLIInstalled, isLoggedIn, listProjects, listBranches,
  fetchApiKeys, installSupabaseCLI,
} from "../util/detect.js";
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
    .description("Guided setup: install CLI, login, configure environments, fetch API keys, update CLAUDE.md")
    .option("--skip-shell", "Skip shell profile modification")
    .option("--ci", "Non-interactive mode for CI/automation (skips prompts)")
    .option("--init", "After global setup, auto-run init in current project directory")
    .action(async (opts: { skipShell?: boolean; ci?: boolean; init?: boolean }) => {
      const home = homedir();
      const results: string[] = [];
      const isInteractive = !opts.ci;

      write("\n  ╔══════════════════════════════════════╗\n");
      write("  ║   supabase-skill setup wizard        ║\n");
      write("  ╚══════════════════════════════════════╝\n\n");

      // ─── Step 1: Supabase CLI ───
      const MIN_VERSION = "2.67.0";
      write("  Step 1/5: Supabase CLI\n");
      let { installed, version } = isSupabaseCLIInstalled();
      if (installed) {
        const [curMaj, curMin, curPatch] = version.split(".").map(Number);
        const [minMaj, minMin, minPatch] = MIN_VERSION.split(".").map(Number);
        const isUpToDate = curMaj > minMaj || (curMaj === minMaj && (curMin > minMin || (curMin === minMin && curPatch >= minPatch)));
        if (isUpToDate) {
          write(`    ✓ Found v${version} (minimum: v${MIN_VERSION})\n\n`);
        } else {
          write(`    ⚠ Found v${version} — minimum required is v${MIN_VERSION}\n`);
          const answer = isInteractive ? await prompt("    Update now via npm? (y/n) → ") : "n";
          if (answer.toLowerCase() === "y") {
            write("    Updating supabase CLI...\n");
            const ok = installSupabaseCLI();
            if (ok) {
              const check = isSupabaseCLIInstalled();
              write(`    ✓ Updated to v${check.version}\n\n`);
              version = check.version;
            } else {
              write("    ✗ Update failed. Try: npm install -g supabase\n\n");
              process.exit(1);
            }
          } else {
            write("    Update manually: npm install -g supabase\n\n");
            process.exit(1);
          }
        }
      } else {
        write("    ✗ Not installed\n");
        const answer = isInteractive ? await prompt("    Install now via npm? (y/n) → ") : "n";
        if (answer.toLowerCase() === "y") {
          write("    Installing supabase CLI...\n");
          const ok = installSupabaseCLI();
          if (ok) {
            const check = isSupabaseCLIInstalled();
            write(`    ✓ Installed v${check.version}\n\n`);
            installed = true;
            version = check.version;
          } else {
            write("    ✗ Install failed. Try manually:\n");
            write("      brew install supabase/tap/supabase\n");
            write("      # or: npm install -g supabase\n\n");
            process.exit(1);
          }
        } else {
          write("    Install it manually, then re-run: supabase-skill install\n\n");
          process.exit(1);
        }
      }

      // ─── Step 2: Login ───
      write("  Step 2/5: Authentication\n");
      let loggedIn = isLoggedIn();
      if (loggedIn) {
        write("    ✓ Logged in\n\n");
      } else {
        write("    ✗ Not logged in\n");
        const answer = isInteractive ? await prompt("    Open browser to login now? (y/n) → ") : "n";
        if (answer.toLowerCase() === "y") {
          write("    Opening browser for Supabase login...\n\n");
          try {
            execSync("supabase login", { stdio: "inherit", timeout: 120000 });
            loggedIn = isLoggedIn();
            if (loggedIn) {
              write("\n    ✓ Logged in\n\n");
            } else {
              write("\n    ✗ Login may have failed. Re-run: supabase-skill install\n\n");
              process.exit(1);
            }
          } catch {
            write("    ✗ Login failed. Run `supabase login` manually, then re-run install.\n\n");
            process.exit(1);
          }
        } else {
          write("    Run `supabase login` first, then re-run: supabase-skill install\n\n");
          process.exit(1);
        }
      }

      // ─── Step 3: Discover Projects + Branches ───
      write("  Step 3/5: Discovering projects & branches\n");
      const config = getDefaultConfig();

      const projects = listProjects();
      if (projects.length === 0) {
        write("    No projects found. Create a project at supabase.com first.\n\n");
      } else {
        const items: Array<{ ref: string; name: string; type: string; parentRef?: string }> = [];

        for (const p of projects) {
          const ref = p.ref || p.id;
          const status = p.status || "";
          const statusTag = status === "ACTIVE_HEALTHY" ? " ✓" : status === "INACTIVE" ? " (inactive)" : "";
          write(`    ${items.length + 1}. ${p.name} (${ref})${statusTag}\n`);
          items.push({ ref, name: p.name, type: "project" });

          // Fetch branches for active projects
          if (status === "ACTIVE_HEALTHY") {
            write(`       Checking branches... `);
            const branches = listBranches(ref);
            const nonDefault = branches.filter((b) => !b.is_default && b.project_ref !== ref);
            if (nonDefault.length > 0) {
              write(`${nonDefault.length} found\n`);
              for (const b of nonDefault) {
                const bStatus = b.preview_project_status === "ACTIVE_HEALTHY" ? " ✓" : "";
                write(`       └─ ${b.name} (${b.project_ref})${bStatus}\n`);
                items.push({ ref: b.project_ref, name: `${p.name} [${b.name}]`, type: "branch", parentRef: ref });
              }
            } else {
              write("none\n");
            }
          }
        }

        if (isInteractive) {
          write("\n    Tag each environment (prod/stage/dev/skip):\n");
          for (const item of items) {
            const indent = item.type === "branch" ? "      " : "    ";
            const answer = await prompt(`${indent}${item.name} (${item.ref}) → `);
            const env = answer.toLowerCase();
            if (env === "prod" || env === "stage" || env === "dev") {
              config.environments[env] = { ref: item.ref, name: item.name };
            }
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
      }
      // Ask for schema name
      if (isInteractive && Object.keys(config.environments).length > 0) {
        const schemaAnswer = await prompt("    Database schema name (default: public) → ");
        config.schema = schemaAnswer.trim() || "public";
      }
      write("\n");

      // ─── Step 4: Fetch API Keys ───
      write("  Step 4/5: Fetching API keys\n");
      for (const env of Object.keys(config.environments)) {
        const envConfig = config.environments[env];
        write(`    ${env.toUpperCase()} (${envConfig.ref})... `);
        const keys = fetchApiKeys(envConfig.ref);
        if (keys) {
          config.environments[env] = {
            ...envConfig,
            anonKey: keys.anonKey,
            serviceKey: keys.serviceKey,
            dbUrl: `https://${envConfig.ref}.supabase.co`,
          };
          write(`✓ anon + service_role keys saved\n`);
        } else {
          write("✗ could not fetch (will need manual setup)\n");
        }
      }
      write("\n");

      // ─── Step 4b: Postgres connection URLs ───
      if (isInteractive && Object.keys(config.environments).length > 0) {
        write("  Step 4b/5: Postgres connection URLs (for `supabase-skill sql`)\n");
        write("    Find in: Supabase Dashboard → Settings → Database → Connection string → URI\n\n");
        for (const env of Object.keys(config.environments)) {
          const answer = await prompt(`    Postgres URL for ${env.toUpperCase()} (or press Enter to skip): `);
          if (answer && (answer.startsWith("postgresql://") || answer.startsWith("postgres://"))) {
            config.environments[env].pgUrl = answer;
            write(`    ✓ pgUrl saved for ${env.toUpperCase()}\n`);
          } else if (answer) {
            write(`    ✗ Skipped (must start with postgresql:// or postgres://)\n`);
          } else {
            write(`    Skipped — configure later with \`supabase-skill sql --setup\`\n`);
          }
        }
        write("\n");
      }

      // ─── Step 5: Write Everything ───
      write("  Step 5/5: Writing configuration\n");

      // Config file (contains secrets — restrictive permissions)
      writeConfig(config);
      results.push("~/.config/supabase-skill/config.json: created (mode 600)");

      // CLAUDE.md (NO secrets — only refs, names, CLI commands)
      const claudeMd = join(home, ".claude", "CLAUDE.md");
      const skillDoc = getSkillDoc(config);
      const claudeResult = upsertSection(claudeMd, skillDoc);
      results.push(`~/.claude/CLAUDE.md: ${claudeResult}`);

      // Shell profile
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

      // Output summary
      write("\n  ── Setup Complete ──\n\n");
      for (const r of results) {
        write(`    ${r}\n`);
      }

      if (Object.keys(config.environments).length > 0) {
        write("\n  Environments:\n");
        for (const [env, { ref, name, serviceKey }] of Object.entries(config.environments)) {
          const keyStatus = serviceKey ? "✓ keys" : "✗ no keys";
          const warning = env === "prod" ? " ⚠️" : "";
          write(`    ${env.toUpperCase()}: ${ref} (${name}) [${keyStatus}]${warning}\n`);
        }

        write("\n  Security:\n");
        write("    ✓ API keys in ~/.config/supabase-skill/config.json (mode 600)\n");
        write("    ✓ CLAUDE.md contains only project refs (no secrets)\n");
        write("    ✓ .env gets service keys on init (gitignored)\n");
      }

      if (opts.init && Object.keys(config.environments).length > 0) {
        write("\n  Running init in current project...\n\n");
        try {
          execSync("supabase-skill init", { stdio: "inherit", cwd: process.cwd() });
        } catch {
          write("    ✗ Init failed — run `supabase-skill init` manually\n");
        }
      } else {
        write("\n  Next: cd into your project and run `supabase-skill init`\n");
        write("  (init auto-runs: .env + CLAUDE.md + snapshot + approve + cron)\n\n");
      }
    });
}
