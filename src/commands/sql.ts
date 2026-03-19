import { Command } from "commander";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { readConfig } from "../util/config.js";
import { resolveEnvironment, resolvePgUrl, savePgUrl } from "../util/env.js";

function write(msg: string): void {
  process.stdout.write(msg);
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function readStdin(): string | null {
  try {
    if (process.stdin.isTTY) return null;
    return readFileSync(0, "utf-8");
  } catch {
    return null;
  }
}

export function sqlCommand(): Command {
  return new Command("sql")
    .description("Run arbitrary SQL via psql against a configured Supabase environment")
    .option("--prod", "Target production environment")
    .option("--stage", "Target staging environment (default)")
    .option("--project-ref <ref>", "Explicit project ref override")
    .option("-c <sql>", "SQL string to execute")
    .option("-f <file>", "SQL file to execute")
    .option("--raw", "Raw psql output (no extra formatting)")
    .option("--schema <name>", "Override search_path schema")
    .option("--setup", "Configure postgres connection URL for an environment")
    .action(async (opts: {
      prod?: boolean;
      stage?: boolean;
      projectRef?: string;
      c?: string;
      f?: string;
      raw?: boolean;
      schema?: string;
      setup?: boolean;
    }) => {
      const config = readConfig();

      // Resolve which environment
      let resolved;
      try {
        resolved = resolveEnvironment(opts, config);
      } catch (e) {
        write(`  Error: ${(e as Error).message}\n`);
        process.exit(1);
      }

      // --setup mode: prompt for pgUrl and save
      if (opts.setup) {
        write(`\n  Configure postgres URL for ${resolved.envName.toUpperCase()} (${resolved.ref})\n`);
        write("  Get it from: Supabase Dashboard → Settings → Database → Connection string → URI\n\n");
        const url = await promptUser("  Paste connection URL (postgresql://...): ");
        if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
          write("  Error: URL must start with postgresql:// or postgres://\n");
          process.exit(1);
        }
        try {
          savePgUrl(resolved.envName, url);
          write(`\n  ✓ Saved pgUrl for ${resolved.envName.toUpperCase()}\n\n`);
        } catch (e) {
          write(`  Error: ${(e as Error).message}\n`);
          process.exit(1);
        }
        return;
      }

      // Resolve postgres connection URL
      let pgUrl: string;
      try {
        pgUrl = resolvePgUrl(resolved);
      } catch {
        // Inline mini-setup: prompt for pgUrl on first use
        write(`\n  No postgres connection URL configured for ${resolved.envName.toUpperCase()}.\n`);
        write("  Get it from: Supabase Dashboard → Settings → Database → Connection string → URI\n\n");
        const url = await promptUser("  Paste connection URL (postgresql://...): ");
        if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
          write("  Error: URL must start with postgresql:// or postgres://\n");
          process.exit(1);
        }
        try {
          savePgUrl(resolved.envName, url);
          write(`  ✓ Saved for future use.\n\n`);
          pgUrl = url;
        } catch (e) {
          write(`  Error saving: ${(e as Error).message}\n`);
          process.exit(1);
        }
      }

      // Determine SQL source
      let sql: string | null = null;
      let useFile = false;

      if (opts.c) {
        sql = opts.c;
      } else if (opts.f) {
        if (!existsSync(opts.f)) {
          write(`  Error: File not found: ${opts.f}\n`);
          process.exit(1);
        }
        useFile = true;
      } else {
        sql = readStdin();
      }

      if (!sql && !useFile) {
        write("  Error: No SQL provided. Use -c \"SQL\", -f file.sql, or pipe via stdin.\n");
        process.exit(1);
      }

      // Build search_path prefix
      const schema = opts.schema || config?.schema || "public";
      const searchPathPrefix = schema !== "public"
        ? `SET search_path TO ${schema}, public;\n`
        : "";

      // Build psql args
      const psqlArgs = ["-v", "ON_ERROR_STOP=1"];
      if (!opts.raw) {
        psqlArgs.push("-t", "-A");
      }

      try {
        let result: string;
        if (useFile) {
          // For file input, prepend search_path via -c then run file
          const searchPathCmd = searchPathPrefix
            ? `psql "${pgUrl}" ${psqlArgs.join(" ")} -c "${searchPathPrefix.trim()}" -f "${opts.f}"`
            : `psql "${pgUrl}" ${psqlArgs.join(" ")} -f "${opts.f}"`;
          result = execSync(searchPathCmd, {
            encoding: "utf-8",
            timeout: 60000,
          });
        } else {
          // Pipe SQL via stdin (safe — no shell interpolation)
          const fullSql = searchPathPrefix + sql;
          result = execSync(`psql "${pgUrl}" ${psqlArgs.join(" ")}`, {
            input: fullSql,
            encoding: "utf-8",
            timeout: 60000,
          });
        }
        // Output result
        if (result.trim()) {
          write(result);
          if (!result.endsWith("\n")) write("\n");
        }
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        if (err.stderr) {
          write(err.stderr);
        } else {
          write(`  Error: ${err.message || "psql execution failed"}\n`);
        }
        process.exit(1);
      }
    });
}
