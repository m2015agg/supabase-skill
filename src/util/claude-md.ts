import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MARKER_START = "<!-- supabase-skill:start -->";
const MARKER_END = "<!-- supabase-skill:end -->";

export function getMarkedSnippet(content: string): string {
  return `${MARKER_START}\n${content}\n${MARKER_END}`;
}

export function upsertSection(filePath: string, content: string): "created" | "updated" | "unchanged" {
  const snippet = getMarkedSnippet(content);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (!existsSync(filePath)) {
    writeFileSync(filePath, snippet + "\n");
    return "created";
  }

  const existing = readFileSync(filePath, "utf-8");
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    const currentSection = existing.slice(startIdx, endIdx + MARKER_END.length);
    if (currentSection === snippet) return "unchanged";
    const updated = existing.slice(0, startIdx) + snippet + existing.slice(endIdx + MARKER_END.length);
    writeFileSync(filePath, updated);
    return "updated";
  }

  // No markers found — append
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(filePath, existing + separator + snippet + "\n");
  return "updated";
}

export function removeSection(filePath: string): "removed" | "not_found" {
  if (!existsSync(filePath)) return "not_found";

  const content = readFileSync(filePath, "utf-8");
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1) return "not_found";

  let updated = content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length);
  updated = updated.replace(/\n{3,}/g, "\n\n").trim();
  if (updated) updated += "\n";
  writeFileSync(filePath, updated);
  return "removed";
}
