import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Environment {
  ref: string;
  name: string;
  anonKey?: string;
  serviceKey?: string;
  dbUrl?: string;
}

export interface SkillConfig {
  schema?: string;
  environments: Record<string, Environment>;
  defaultEnv: string;
  safetyRules: {
    prodRequiresApproval: boolean;
    alwaysSpecifyRef: boolean;
  };
}

function getConfigDir(): string {
  return join(homedir(), ".config", "supabase-skill");
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function readConfig(): SkillConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SkillConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: SkillConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function getDefaultConfig(): SkillConfig {
  return {
    environments: {},
    defaultEnv: "stage",
    safetyRules: {
      prodRequiresApproval: true,
      alwaysSpecifyRef: true,
    },
  };
}
