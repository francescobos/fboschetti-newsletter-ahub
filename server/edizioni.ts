import type { Database } from "bun:sqlite";

/**
 * CRUD dell'edizione e macchina a stati.
 *
 * Non importa nulla di mail né di contatti: i test girano su un DB in
 * memoria senza il core installato. Le Fasi 2 e 3 aggiungeranno qui i loro
 * stati, fra `bozza` e `pronta`.
 */

export type Stato = "bozza" | "pronta" | "in_invio" | "inviata";

export type Edizione = {
  id: number;
  ref: string;
  oggetto: string;
  testo: string;
  html: string;
  percorsoOrigine: string | null;
  stato: Stato;
  campagnaId: string | null;
  avvisoMailto: string | null;
  filtroTag: string | null;
  destinatariN: number | null;
  creatoIl: number;
  aggiornatoIl: number;
  accodataIl: number | null;
  avviataIl: number | null;
};

export type DatiEdizione = {
  ref: string;
  oggetto: string;
  testo: string;
  html: string;
  percorsoOrigine?: string | null;
  avvisoMailto?: string | null;
};

/** Dati da registrare sull'edizione insieme al cambio di stato. */
export type DatiAvanzamento = {
  campagnaId?: string;
  filtroTag?: string | null;
  destinatariN?: number;
};

type RigaEdizione = {
  id: number;
  ref: string;
  oggetto: string;
  testo: string;
  html: string;
  percorso_origine: string | null;
  stato: Stato;
  campagna_id: string | null;
  avviso_mailto: string | null;
  filtro_tag: string | null;
  destinatari_n: number | null;
  creato_il: number;
  aggiornato_il: number;
  accodata_il: number | null;
  avviata_il: number | null;
};

const COLONNE = `id, ref, oggetto, testo, html, percorso_origine, stato,
  campagna_id, avviso_mailto, filtro_tag, destinatari_n,
  creato_il, aggiornato_il, accodata_il, avviata_il`;

/**
 * Le transizioni ammesse. Lo stato è un cancello, non un'etichetta: ciò che
 * non è elencato qui non accade.
 */
const TRANSIZIONI: Record<Stato, Stato[]> = {
  bozza: ["pronta"],
  pronta: ["in_invio"],
  in_invio: ["inviata"],
  inviata: [],
};

function componi(r: RigaEdizione): Edizione {
  return {
    id: r.id,
    ref: r.ref,
    oggetto: r.oggetto,
    testo: r.testo,
    html: r.html,
    percorsoOrigine: r.percorso_origine,
    stato: r.stato,
    campagnaId: r.campagna_id,
    avvisoMailto: r.avviso_mailto,
    filtroTag: r.filtro_tag,
    destinatariN: r.destinatari_n,
    creatoIl: r.creato_il,
    aggiornatoIl: r.aggiornato_il,
    accodataIl: r.accodata_il,
    avviataIl: r.avviata_il,
  };
}

/**
 * Riduce un `ref` scritto a mano alla forma `[a-z0-9-]`.
 *
 * Serve perché l'unicità nel DB è un confronto esatto: senza normalizzare,
 * "news settembre" e "news  settembre" sarebbero `ref` diversi e il vincolo
 * che protegge dal doppio invio non scatterebbe. Uno spazio finale incollato
 * per sbaglio è invisibile a chi guarda.
 */
export function normalizzaRef(grezzo: string): string {
  return grezzo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function creaEdizione(db: Database, dati: DatiEdizione): number {
  const ora = Date.now();
  const row = db
    .query(
      `INSERT INTO edizioni
         (ref, oggetto, testo, html, percorso_origine, avviso_mailto,
          creato_il, aggiornato_il)
       VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    )
    .get(
      dati.ref,
      dati.oggetto,
      dati.testo,
      dati.html,
      dati.percorsoOrigine ?? null,
      dati.avvisoMailto ?? null,
      ora,
      ora,
    ) as { id: number };
  return row.id;
}

export function leggiEdizione(db: Database, id: number): Edizione | null {
  const r = db
    .query(`SELECT ${COLONNE} FROM edizioni WHERE id = ?`)
    .get(id) as RigaEdizione | null;
  return r ? componi(r) : null;
}

export function trovaPerRef(db: Database, ref: string): Edizione | null {
  const r = db
    .query(`SELECT ${COLONNE} FROM edizioni WHERE ref = ?`)
    .get(ref) as RigaEdizione | null;
  return r ? componi(r) : null;
}

export function elencaEdizioni(
  db: Database,
  filtri: { stato?: Stato } = {},
): { righe: Edizione[]; totale: number } {
  const clausola = filtri.stato ? "WHERE stato = ?" : "";
  const args = filtri.stato ? [filtri.stato] : [];
  const totale = (
    db.query(`SELECT COUNT(*) AS n FROM edizioni ${clausola}`).get(...args) as {
      n: number;
    }
  ).n;
  const righe = db
    .query(`SELECT ${COLONNE} FROM edizioni ${clausola} ORDER BY creato_il DESC`)
    .all(...args) as RigaEdizione[];
  return { righe: righe.map(componi), totale };
}

/**
 * Sposta l'edizione in `nuovo`, rifiutando le transizioni non previste.
 *
 * `accodata_il` e `avviata_il` si scrivono qui perché sono la traccia del
 * passaggio, non un dato che chi chiama debba ricordarsi di passare.
 */
export function avanzaStato(
  db: Database,
  id: number,
  nuovo: Stato,
  dati: DatiAvanzamento = {},
): void {
  const edizione = leggiEdizione(db, id);
  if (!edizione) throw new Error(`edizione non trovata: ${id}`);
  if (!TRANSIZIONI[edizione.stato].includes(nuovo)) {
    throw new Error(
      `transizione non ammessa: ${edizione.stato} → ${nuovo} (edizione ${id})`,
    );
  }

  const ora = Date.now();
  const set = ["stato = ?", "aggiornato_il = ?"];
  const args: (string | number | null)[] = [nuovo, ora];

  if (dati.campagnaId !== undefined) {
    set.push("campagna_id = ?");
    args.push(dati.campagnaId);
  }
  if (dati.filtroTag !== undefined) {
    set.push("filtro_tag = ?");
    args.push(dati.filtroTag);
  }
  if (dati.destinatariN !== undefined) {
    set.push("destinatari_n = ?");
    args.push(dati.destinatariN);
  }
  if (nuovo === "pronta") {
    set.push("accodata_il = ?");
    args.push(ora);
  }
  if (nuovo === "in_invio") {
    set.push("avviata_il = ?");
    args.push(ora);
  }

  args.push(id);
  db.run(`UPDATE edizioni SET ${set.join(", ")} WHERE id = ?`, args);
}
