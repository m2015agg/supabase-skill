import { Command } from "commander";
import { readConfig } from "../util/config.js";

export function envsCommand(): Command {
  return new Command("envs")
    .description("List configured Supabase environments")
    .action(() => {
      const config = readConfig();

      if (!config || Object.keys(config.environments).length === 0) {
        process.stdout.write("No environments configured.\n");
        process.stdout.write("Run `supabase-skill install` to set up environments.\n");
        return;
      }

      process.stdout.write("\nConfigured environments:\n");
      for (const [env, { ref, name }] of Object.entries(config.environments)) {
        const isDefault = env === config.defaultEnv ? " (default)" : "";
        const isProd = env === "prod" ? " \u26a0\ufe0f" : "";
        process.stdout.write(`  ${env.toUpperCase()}: ${ref} — ${name}${isDefault}${isProd}\n`);
      }
      process.stdout.write("\n");
    });
}
