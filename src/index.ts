#!/usr/bin/env node
import { Command } from "commander";
import { installCommand } from "./commands/install.js";
import { initCommand } from "./commands/init.js";
import { docsCommand } from "./commands/docs.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { envsCommand } from "./commands/envs.js";

const program = new Command();

program
  .name("supabase-skill")
  .description("Supabase CLI skill for AI agents. Installs comprehensive CLI instructions into CLAUDE.md with multi-environment support.")
  .version("0.1.0");

program.addCommand(installCommand());
program.addCommand(initCommand());
program.addCommand(docsCommand());
program.addCommand(uninstallCommand());
program.addCommand(envsCommand());

program.parse();
