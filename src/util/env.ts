import { readConfig, writeConfig, type SkillConfig, type Environment } from "./config.js";

export interface ResolvedEnv {
  envName: string;
  ref: string;
  env: Environment;
}

export function resolveEnvironment(
  opts: { prod?: boolean; stage?: boolean; projectRef?: string },
  config: SkillConfig | null,
): ResolvedEnv {
  // Explicit project ref override — find matching env or create ad-hoc
  if (opts.projectRef) {
    if (config) {
      for (const [envName, env] of Object.entries(config.environments)) {
        if (env.ref === opts.projectRef) {
          return { envName, ref: env.ref, env };
        }
      }
    }
    return {
      envName: "custom",
      ref: opts.projectRef,
      env: { ref: opts.projectRef, name: opts.projectRef },
    };
  }

  if (!config || Object.keys(config.environments).length === 0) {
    throw new Error("No config found. Run `supabase-skill install` first.");
  }

  // --prod flag
  if (opts.prod) {
    const env = config.environments["prod"];
    if (!env) throw new Error("No prod environment configured. Run `supabase-skill install`.");
    return { envName: "prod", ref: env.ref, env };
  }

  // --stage flag or default
  const envName = opts.stage ? "stage" : (config.defaultEnv || "stage");
  const env = config.environments[envName] || config.environments[config.defaultEnv];
  if (!env) {
    const first = Object.entries(config.environments)[0];
    if (!first) throw new Error("No environments configured. Run `supabase-skill install`.");
    return { envName: first[0], ref: first[1].ref, env: first[1] };
  }
  return { envName, ref: env.ref, env };
}

export function resolvePgUrl(resolved: ResolvedEnv): string {
  // 1. Config pgUrl
  if (resolved.env.pgUrl) return resolved.env.pgUrl;

  // 2. Environment variables
  const envUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (envUrl) return envUrl;

  // 3. No connection string available
  throw new Error(`No postgres connection URL for ${resolved.envName.toUpperCase()}. Run \`supabase-skill sql --setup\` or set DATABASE_URL.`);
}

export function savePgUrl(envName: string, pgUrl: string): void {
  const config = readConfig();
  if (!config) throw new Error("No config found. Run `supabase-skill install` first.");
  if (!config.environments[envName]) throw new Error(`No ${envName} environment in config.`);
  config.environments[envName].pgUrl = pgUrl;
  writeConfig(config);
}
