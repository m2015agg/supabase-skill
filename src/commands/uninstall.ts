import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { removeSection } from "../util/claude-md.js";

export function uninstallCommand(): Command {
  return new Command("uninstall")
    .description("Remove supabase-skill entries from CLAUDE.md files")
    .option("--global", "Remove from global ~/.claude/CLAUDE.md only")
    .action((opts: { global?: boolean }) => {
      const results: string[] = [];

      if (opts.global) {
        const globalPath = join(homedir(), ".claude", "CLAUDE.md");
        const result = removeSection(globalPath);
        results.push(`~/.claude/CLAUDE.md: ${result}`);
      } else {
        // Remove from current project
        const cwd = process.cwd();
        const claudeMd = join(cwd, "CLAUDE.md");
        const dotClaudeMd = join(cwd, ".claude", "CLAUDE.md");

        results.push(`CLAUDE.md: ${removeSection(claudeMd)}`);
        results.push(`.claude/CLAUDE.md: ${removeSection(dotClaudeMd)}`);
      }

      process.stdout.write("supabase-skill uninstall:\n");
      for (const r of results) {
        process.stdout.write(`  ${r}\n`);
      }
    });
}
