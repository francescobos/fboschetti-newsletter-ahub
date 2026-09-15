import type { Database } from "bun:sqlite";

/**
 * Risoluzione dei destinatari dalla lista contatti.
 *
 * Funzione pura sul DB: non sa nulla di campagne né di edizioni. La Fase 4
 * la riuserà così com'è.
 */

export type FiltriDestinatari = { tag?: string };

/**
 * Le email a cui si può spedire.
 *
 * Due condizioni, non una: `iscritto` è la volontà della persona, lo stato
 * tecnico è la salute dell'indirizzo. Un indirizzo può essere iscritto e
 * rotto, oppure sano e disiscritto; spedire richiede entrambe.
 *
 * I `rimbalzati` si escludono perché un indirizzo definitivamente rifiutato
 * diventerebbe un errore che sporca `errorCount` della campagna.
 */
export function risolviDestinatari(
  db: Database,
  filtri: FiltriDestinatari = {},
): string[] {
  const dove = ["c.iscritto = 1", "c.stato_tecnico != 'rimbalzato'"];
  const args: string[] = [];

  if (filtri.tag) {
    dove.push(`c.id IN (
      SELECT ct.contatto_id FROM contatti_tag ct
      JOIN tag t ON t.id = ct.tag_id WHERE t.nome = ?
    )`);
    args.push(filtri.tag);
  }

  const righe = db
    .query(
      `SELECT c.email FROM contatti c
       WHERE ${dove.join(" AND ")}
       ORDER BY c.email`,
    )
    .all(...args) as { email: string }[];

  return righe.map((r) => r.email);
}
