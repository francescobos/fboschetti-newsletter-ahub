import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * DB in memoria con lo schema reale applicato.
 *
 * `foreign_keys` va acceso sulla connessione: SQLite non lo eredita dalla
 * migration, e il core applica le migration dentro una transazione, dove
 * quel pragma viene ignorato.
 */
export function creaDbDiTest(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  const sql = readFileSync(
    join(import.meta.dir, "..", "migrations", "20260912_000000_contatti.sql"),
    "utf8",
  );
  db.run(sql);
  return db;
}
