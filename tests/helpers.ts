import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * DB in memoria con lo schema reale applicato.
 *
 * Applica tutte le migration in ordine lessicografico, come fa il core: una
 * lista hardcoded si dimenticherebbe la prossima migration aggiunta.
 *
 * `foreign_keys` va acceso sulla connessione: SQLite non lo eredita dalla
 * migration, e il core applica le migration dentro una transazione, dove
 * quel pragma viene ignorato.
 */
export function creaDbDiTest(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dir, "..", "migrations");
  const file = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const nome of file) {
    db.run(readFileSync(join(dir, nome), "utf8"));
  }
  return db;
}
