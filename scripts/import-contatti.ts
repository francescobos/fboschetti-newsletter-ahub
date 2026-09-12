#!/usr/bin/env bun
/**
 * Job "import-contatti": importa un CSV nella lista contatti.
 *
 *   bun run scripts/import-contatti.ts data/contatti.csv [--dry-run]
 *
 * Wiring: è l'unico file del plugin che importa `@hub/*`. La logica sta in
 * `server/import.ts`, che non conosce il core ed è testabile senza di esso.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importaCsv } from "../server/import";

const SLUG = "fboschetti-newsletter";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = hasFlag(argv, "dry-run");
  const percorso = argv.find((a) => !a.startsWith("--"));

  if (!percorso) {
    console.error(
      "[import-contatti] manca il percorso del CSV\n" +
        "  uso: bun run scripts/import-contatti.ts data/contatti.csv [--dry-run]",
    );
    process.exit(1);
  }

  // openPluginDb applica WAL, foreign keys e migration: qui serve solo il
  // busy_timeout, perché il server può scrivere sullo stesso file.
  // @ts-expect-error — @hub/* è risolvibile solo dentro il core
  const { openPluginDb } = await import("@hub/plugin-db");
  const projectRoot = resolve(process.cwd(), "..", "..");
  const db = openPluginDb(SLUG, projectRoot);
  db.run("PRAGMA busy_timeout = 5000");

  const testo = readFileSync(percorso, "utf8");
  const esito = importaCsv(db, testo, { origine: percorso, dryRun });

  if (!esito.ok) {
    console.error(`[import-contatti] CSV rifiutato: ${esito.errore}`);
    process.exit(1);
  }

  const r = esito.rapporto;
  console.log(`[import-contatti] ${dryRun ? "PROVA (nulla scritto)" : "importato"} da ${percorso}`);
  console.log(`  righe lette:          ${r.righeLette}`);
  console.log(`  contatti creati:      ${r.creati}`);
  console.log(`  contatti aggiornati:  ${r.aggiornati}`);
  console.log(`  disiscritti intatti:  ${r.disiscrittiIntatti}`);
  console.log(`  aziende create:       ${r.aziendeCreate}`);
}

main().catch((e) => {
  console.error(
    `[import-contatti] ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
});
