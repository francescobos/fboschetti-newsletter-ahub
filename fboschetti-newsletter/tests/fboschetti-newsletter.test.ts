import { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { contaRighe, inserisciRiga } from "../server/service";

// Il servizio non importa nulla di `@hub/*`, quindi questi test girano senza
// installare il plugin nel core.
let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.run(`CREATE TABLE righe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    messaggio TEXT NOT NULL
  )`);
});

test("un database nuovo non ha righe", () => {
  expect(contaRighe(db)).toBe(0);
});

test("inserisci restituisce l'id e incrementa il conteggio", () => {
  const id = inserisciRiga(db, "ciao");
  expect(id).toBeGreaterThan(0);
  expect(contaRighe(db)).toBe(1);
});
