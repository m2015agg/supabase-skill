#!/usr/bin/env node
import { Command } from "commander";
import { installCommand } from "./commands/install.js";
import { initCommand } from "./commands/init.js";
import { docsCommand } from "./commands/docs.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { envsCommand } from "./commands/envs.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { searchCommand } from "./commands/search.js";
import { contextCommand } from "./commands/context.js";
import { columnsCommand } from "./commands/columns.js";
import { tableCommand } from "./commands/table.js";
import { cronCommand } from "./commands/cron.js";
import { approveCommand } from "./commands/approve.js";
import { updateCommand } from "./commands/update.js";
import { doctorCommand } from "./commands/doctor.js";
import { diffCommand } from "./commands/diff.js";
import { graphCommand } from "./commands/graph.js";
import { functionsCommand } from "./commands/functions.js";
import { indexesCommand } from "./commands/indexes.js";
import { enumsCommand } from "./commands/enums.js";
import { policiesCommand } from "./commands/policies.js";
import { triggersCommand } from "./commands/triggers.js";
import { viewsCommand } from "./commands/views.js";

const program = new Command();

program
  .name("supabase-skill")
  .description("Supabase CLI skill for AI agents. Installs comprehensive CLI instructions into CLAUDE.md with multi-environment support.")
  .version("0.8.0");

program.addCommand(installCommand());
program.addCommand(initCommand());
program.addCommand(docsCommand());
program.addCommand(uninstallCommand());
program.addCommand(envsCommand());
program.addCommand(snapshotCommand());
program.addCommand(searchCommand());
program.addCommand(contextCommand());
program.addCommand(columnsCommand());
program.addCommand(tableCommand());
program.addCommand(cronCommand());
program.addCommand(approveCommand());
program.addCommand(updateCommand());
program.addCommand(doctorCommand());
program.addCommand(diffCommand());
program.addCommand(graphCommand());
program.addCommand(functionsCommand());
program.addCommand(indexesCommand());
program.addCommand(enumsCommand());
program.addCommand(policiesCommand());
program.addCommand(triggersCommand());
program.addCommand(viewsCommand());

program.parse();
