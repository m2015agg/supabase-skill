import { Command } from "commander";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { readConfig } from "../util/config.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

function getSnapshotCommand(projectDir: string, ref: string): string {
  const binPath = resolve(process.argv[1]);
  return `cd "${projectDir}" && "${binPath}" snapshot --project-ref ${ref} --output .supabase-schema 2>&1 >> /tmp/supabase-skill-cron.log`;
}

function getCrontab(): string {
  try {
    return execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  } catch {
    return "";
  }
}

function setCrontab(content: string): void {
  execSync(`echo '${content.replace(/'/g, "'\\''")}' | crontab -`, { encoding: "utf-8" });
}

const MARKER = "# supabase-skill snapshot";

export function cronCommand(): Command {
  return new Command("cron")
    .description("Set up nightly cron job to auto-refresh schema snapshot")
    .option("--time <HH:MM>", "Time to run (24h format)", "03:00")
    .option("--remove", "Remove the cron job")
    .option("--status", "Show current cron status")
    .action((opts: { time: string; remove?: boolean; status?: boolean }) => {
      const config = readConfig();
      const cwd = process.cwd();

      if (opts.status) {
        const crontab = getCrontab();
        const existing = crontab.split("\n").filter((l) => l.includes(MARKER) || (l.trim() && !l.startsWith("#") && l.includes("supabase-skill")));
        if (existing.length > 0) {
          write("Active supabase-skill cron jobs:\n");
          for (const line of existing) {
            if (!line.startsWith("#")) write(`  ${line}\n`);
          }
        } else {
          write("No supabase-skill cron jobs configured.\n");
          write("Run `supabase-skill cron` to set up nightly snapshot refresh.\n");
        }
        return;
      }

      if (opts.remove) {
        const crontab = getCrontab();
        const lines = crontab.split("\n");
        const filtered: string[] = [];
        let skipNext = false;
        for (const line of lines) {
          if (line.includes(MARKER)) {
            skipNext = true;
            continue;
          }
          if (skipNext && line.includes("supabase-skill")) {
            skipNext = false;
            continue;
          }
          skipNext = false;
          filtered.push(line);
        }
        const newCrontab = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        setCrontab(newCrontab);
        write("Removed supabase-skill cron job.\n");
        return;
      }

      // Set up cron
      let ref: string | undefined;
      if (config) {
        const stageEnv = config.environments["stage"] || config.environments[config.defaultEnv];
        if (stageEnv) ref = stageEnv.ref;
      }
      if (!ref) {
        write("No environment configured. Run `supabase-skill install` first.\n");
        process.exit(1);
      }

      const [hour, minute] = opts.time.split(":");
      const cronExpr = `${minute || "0"} ${hour || "3"} * * *`;
      const cmd = getSnapshotCommand(cwd, ref);

      // Remove existing entry if present
      let crontab = getCrontab();
      const lines = crontab.split("\n");
      const filtered: string[] = [];
      let skipNext = false;
      for (const line of lines) {
        if (line.includes(MARKER)) { skipNext = true; continue; }
        if (skipNext && line.includes("supabase-skill")) { skipNext = false; continue; }
        skipNext = false;
        filtered.push(line);
      }
      crontab = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();

      // Add new entry
      const newEntry = `${MARKER} (${cwd})\n${cronExpr} ${cmd}`;
      const newCrontab = crontab ? `${crontab}\n\n${newEntry}` : newEntry;
      setCrontab(newCrontab);

      write(`\n  Cron job configured:\n`);
      write(`    Schedule: ${cronExpr} (${opts.time} daily)\n`);
      write(`    Project: ${cwd}\n`);
      write(`    Ref: ${ref}\n`);
      write(`    Log: /tmp/supabase-skill-cron.log\n\n`);
      write(`  To check status: supabase-skill cron --status\n`);
      write(`  To remove: supabase-skill cron --remove\n\n`);
    });
}
