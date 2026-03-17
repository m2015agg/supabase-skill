import { execSync } from "node:child_process";

export interface SupabaseProject {
  id: string;
  name: string;
  organization_id: string;
  region: string;
  created_at: string;
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
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
