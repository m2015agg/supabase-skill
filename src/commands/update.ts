import { Command } from "commander";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function write(msg: string): void {
  process.stdout.write(msg);
}

function getCurrentVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export function updateCommand(): Command {
  return new Command("update")
    .description("Update supabase-skill to the latest version")
    .option("--check", "Check for updates without installing")
    .action((opts: { check?: boolean }) => {
      const current = getCurrentVersion();

      // Check latest on npm
      write(`  Current version: v${current}\n`);
      write("  Checking npm for updates... ");

      let latest: string;
      try {
        latest = execSync("npm view @m2015agg/supabase-skill version 2>/dev/null", {
          encoding: "utf-8",
          timeout: 10000,
        }).trim();
      } catch {
        write("failed (couldn't reach npm registry)\n");
        return;
      }

      if (latest === current) {
        write(`✓ already on latest (v${current})\n\n`);
        return;
      }

      write(`v${latest} available\n`);

      if (opts.check) {
        write(`\n  Run \`supabase-skill update\` to install v${latest}\n\n`);
        return;
      }

      write(`  Updating v${current} → v${latest}...\n`);
      try {
        execSync("npm install -g @m2015agg/supabase-skill@latest 2>&1", {
          encoding: "utf-8",
          timeout: 60000,
          stdio: "inherit",
        });
        write(`\n  ✓ Updated to v${latest}\n\n`);
      } catch {
        write("  ✗ Update failed. Try: npm install -g @m2015agg/supabase-skill@latest\n\n");
      }
    });
}
