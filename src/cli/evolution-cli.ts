import type { Command } from "commander";
import { evolutionCliCommand, type SelfEvolutionConfig } from "../infra/self-evolution.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerEvolutionCli(program: Command) {
  program.enablePositionalOptions();

  const evolve = program
    .command("evolve")
    .description("Run self-evolution workflow (test + quality check + auto-commit)")
    .option("--config <path>", "Path to evolution config file")
    .option("--test-suite <full|critical|smoke>", "Test suite to run", "critical")
    .option("--no-commit", "Skip auto-commit after optimization")
    .option("--no-rollback", "Skip rollback on failure")
    .option("--verbose", "Output detailed results", false)
    .option("--json", "Output result as JSON", false)
    .addHelpText("after", () => {
      const examples = [
        ["openclaw evolve", "Run self-evolution with default settings"],
        ["openclaw evolve --test-suite smoke", "Run quick smoke tests only"],
        ["openclaw evolve --test-suite full", "Run full test suite with coverage"],
        ["openclaw evolve --no-commit", "Run without auto-commit"],
        ["openclaw evolve --verbose --json", "Output detailed JSON results"],
        ["openclaw evolve --config ./evolution.config.json", "Use custom config"],
      ] as const;

      const fmtExamples = examples
        .map(([cmd, desc]) => `  ${theme.command(cmd)} ${theme.muted(`# ${desc}`)}`)
        .join("\n");

      return `
${theme.heading("What this does:")}
  - Runs automated test suite
  - Analyzes code quality (ESLint, complexity)
  - Checks system performance (memory, disk)
  - Auto-commits optimizations if improvements found
  - Rolls back on test failure (if enabled)

${theme.heading("Test suites:")}
  - smoke:   Quick sanity checks (~1 min)
  - critical: Core functionality tests (~5 min) [default]
  - full:    Complete test suite with coverage (~20 min)

${theme.heading("Examples:")}
${fmtExamples}

${theme.muted("Docs:")} ${formatDocsLink("/concepts/self-evolution", "docs.openclaw.ai/concepts/self-evolution")}`;
    })
    .action(async (opts) => {
      try {
        await evolutionCliCommand({
          config: opts.config,
          testSuite: opts.testSuite,
          noCommit: opts.commit === false,
          noRollback: opts.rollback === false,
          verbose: opts.verbose,
        });
      } catch (error: unknown) {
        console.error(theme.error(`Evolution failed: ${resolveErrorMessage(error)}`));
        process.exit(1);
      }
    });

  // Status command
  evolve
    .command("status")
    .description("Check self-evolution status and last run results")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");

        const stateDir = path.join(process.env.HOME || "~", ".openclaw/evolution");
        const stateFile = path.join(stateDir, "last-run.json");

        try {
          const stateContent = await fs.readFile(stateFile, "utf-8");
          const state = JSON.parse(stateContent);

          if (opts.json) {
            console.log(JSON.stringify(state, null, 2));
          } else {
            console.log(theme.heading("Self-Evolution Status"));
            console.log(`Last Run: ${state.timestamp || "Never"}`);
            console.log(`Status: ${theme.success(state.status)}`);
            console.log(`Duration: ${state.durationMs || 0}ms`);
            console.log(
              `Tests: ${state.testResult?.passed || 0}/${state.testResult?.total || 0} passed`,
            );
            console.log(`Quality: ${state.qualityResult?.score || 0}/100`);
            console.log(`Performance: ${state.performanceResult?.score || 0}/100`);

            if (state.changes?.committed) {
              console.log(`Commit: ${state.changes.commitHash?.slice(0, 7)}`);
            }
          }
        } catch {
          if (opts.json) {
            console.log(JSON.stringify({ status: "never_run" }));
          } else {
            console.log(theme.muted("No evolution runs recorded yet."));
            console.log(`Run ${theme.command("openclaw evolve")} to start.`);
          }
        }
      } catch (error: unknown) {
        console.error(theme.error(`Status check failed: ${resolveErrorMessage(error)}`));
        process.exit(1);
      }
    });

  // Configure command
  evolve
    .command("configure")
    .description("Configure self-evolution settings")
    .option("--enable", "Enable self-evolution")
    .option("--disable", "Disable self-evolution")
    .option("--test-suite <full|critical|smoke>", "Default test suite")
    .option("--quality-threshold <number>", "Quality score threshold (0-100)", "85")
    .option("--auto-commit", "Enable auto-commit")
    .option("--no-auto-commit", "Disable auto-commit")
    .option("--auto-rollback", "Enable auto-rollback on failure")
    .option("--no-auto-rollback", "Disable auto-rollback")
    .action(async (opts) => {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");

        const configDir = path.join(process.env.HOME || "~", ".openclaw");
        const configFile = path.join(configDir, "evolution.config.json");

        let config: Partial<SelfEvolutionConfig> = {};

        try {
          const content = await fs.readFile(configFile, "utf-8");
          config = JSON.parse(content);
        } catch {
          // Config doesn't exist yet
        }

        // Apply options
        if (opts.enable) {
          config.enabled = true;
        }
        if (opts.disable) {
          config.enabled = false;
        }
        if (opts.testSuite) {
          config.testSuite = opts.testSuite;
        }
        if (opts.qualityThreshold) {
          config.qualityThreshold = Number.parseInt(opts.qualityThreshold, 10);
        }
        if (opts.autoCommit) {
          config.autoCommit = true;
        }
        if (opts.autoCommit === false) {
          config.autoCommit = false;
        }
        if (opts.autoRollback) {
          config.rollbackOnFailure = true;
        }
        if (opts.autoRollback === false) {
          config.rollbackOnFailure = false;
        }

        // Save config
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(configFile, JSON.stringify(config, null, 2), "utf-8");

        console.log(theme.success("Configuration saved!"));
        console.log(`Config file: ${configFile}`);
        console.log(JSON.stringify(config, null, 2));
      } catch (error: unknown) {
        console.error(theme.error(`Configuration failed: ${resolveErrorMessage(error)}`));
        process.exit(1);
      }
    });

  // History command
  evolve
    .command("history")
    .description("Show evolution history")
    .option("--limit <number>", "Number of entries to show", "10")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");

        const stateDir = path.join(process.env.HOME || "~", ".openclaw/evolution");
        const historyFile = path.join(stateDir, "history.json");

        try {
          const content = await fs.readFile(historyFile, "utf-8");
          const history = JSON.parse(content);
          const limit = Number.parseInt(opts.limit, 10);
          const recent = history.slice(-limit);

          if (opts.json) {
            console.log(JSON.stringify(recent, null, 2));
          } else {
            console.log(theme.heading("Evolution History"));
            for (const entry of recent.toReversed()) {
              const icon = entry.status === "success" ? "✅" : "❌";
              console.log(`${icon} ${entry.timestamp}`);
              console.log(`   Status: ${entry.status} | Duration: ${entry.durationMs}ms`);
              console.log(
                `   Tests: ${entry.testResult?.passed || 0}/${entry.testResult?.total || 0} | Quality: ${entry.qualityResult?.score || 0}/100`,
              );
              if (entry.changes?.committed) {
                console.log(`   Commit: ${entry.changes.commitHash?.slice(0, 7)}`);
              }
              console.log();
            }
          }
        } catch {
          console.log(theme.muted("No evolution history found."));
        }
      } catch (error: unknown) {
        console.error(theme.error(`History check failed: ${resolveErrorMessage(error)}`));
        process.exit(1);
      }
    });
}
