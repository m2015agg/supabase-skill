import { execSync } from "node:child_process";

export interface SupabaseProject {
  id: string;
  name: string;
  organization_id: string;
  region: string;
  created_at: string;
  status?: string;
  ref?: string;
}

export interface SupabaseBranch {
  id: string;
  name: string;
  project_ref: string;
  parent_project_ref: string;
  is_default: boolean;
  status: string;
  preview_project_status: string;
}

function parseJsonArray(output: string): unknown[] {
  const jsonMatch = output.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isSupabaseCLIInstalled(): { installed: boolean; version: string } {
  try {
    const output = execSync("supabase --version 2>&1", { encoding: "utf-8" }).trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return { installed: true, version: match ? match[1] : output };
  } catch {
    return { installed: false, version: "" };
  }
}

export function isLoggedIn(): boolean {
  try {
    execSync("supabase projects list -o json 2>&1", { encoding: "utf-8", timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): SupabaseProject[] {
  try {
    const output = execSync("supabase projects list -o json 2>&1", {
      encoding: "utf-8",
      timeout: 15000,
    });
    return parseJsonArray(output) as SupabaseProject[];
  } catch {
    return [];
  }
}

export function listBranches(projectRef: string): SupabaseBranch[] {
  try {
    const output = execSync(
      `supabase branches list --project-ref ${projectRef} -o json 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    return parseJsonArray(output) as SupabaseBranch[];
  } catch {
    return [];
  }
}

export interface ApiKeys {
  anonKey: string;
  serviceKey: string;
}

export function fetchApiKeys(projectRef: string): ApiKeys | null {
  try {
    const output = execSync(
      `supabase projects api-keys --project-ref ${projectRef} -o json 2>&1`,
      { encoding: "utf-8", timeout: 15000 },
    );
    const keys = parseJsonArray(output) as Array<{ name: string; api_key: string }>;
    const anon = keys.find((k) => k.name === "anon")?.api_key || "";
    const service = keys.find((k) => k.name === "service_role")?.api_key || "";
    if (!anon && !service) return null;
    return { anonKey: anon, serviceKey: service };
  } catch {
    return null;
  }
}

export function installSupabaseCLI(): boolean {
  try {
    execSync("npm install -g supabase 2>&1", { encoding: "utf-8", timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

export function loginSupabase(): boolean {
  try {
    execSync("supabase login", { encoding: "utf-8", timeout: 120000, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}
