import type { Database } from "bun:sqlite";

/**
 * Logica del plugin, separata dalle route di proposito: qui dentro non si
 * importa nulla di `@hub/*`, quindi i test girano senza installare il core.
 */

export function contaRighe(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM righe").get() as { n: number };
  return row.n;
}

export function inserisciRiga(db: Database, messaggio: string): number {
  const row = db
    .query("INSERT INTO righe (created_at, messaggio) VALUES (?, ?) RETURNING id")
    .get(Date.now(), messaggio) as { id: number };
  return row.id;
}
