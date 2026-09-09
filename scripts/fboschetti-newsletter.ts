#!/usr/bin/env bun
/**
 * Job "fboschetti-newsletter" del plugin fboschetti-newsletter.
 *
 * CLI-first: deve funzionare da terminale anche a server spento.
 *
 *   bun run scripts/fboschetti-newsletter.ts [--dry-run]
 *
 * Lo scheduler appende i propri `args` in coda al comando, quindi ogni
 * argomento extra va letto da process.argv e propagato — un job solo con un
 * dispatcher, mai un job per variante di flag.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) {
    return argv[i + 1];
  }
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = hasFlag(argv, "dry-run");

  // La cwd del job è la root del plugin: per i comandi del core serve la root
  // iniettata nell'env, non un path relativo.
  const projectRoot = process.env.AGENTIC_HUB_PROJECT_ROOT ?? process.cwd();
  const outputDir = process.env.RUN_OUTPUT_DIR ?? "data/output/manual";
  const runId = process.env.RUN_ID ?? "manuale";

  console.log(`[fboschetti-newsletter] run ${runId}`);
  if (dryRun) {
    console.log("[fboschetti-newsletter] dry-run: non scrivo nulla");
    return;
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, "risultato.txt"),
    `run ${runId}\nprojectRoot ${projectRoot}\n`,
  );
  console.log(`[fboschetti-newsletter] scritto in ${outputDir}/risultato.txt`);
}

// L'exit code decide success/error della run: un throw non gestito la
// marcherebbe comunque error, ma senza un messaggio leggibile nei log.
main().catch((e) => {
  console.error(`[fboschetti-newsletter] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
