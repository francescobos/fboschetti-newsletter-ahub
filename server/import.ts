import type { Database } from "bun:sqlite";
import {
  creaContatto,
  risolviOCreaAzienda,
  trovaPerEmail,
  unisciTag,
} from "./contatti";
import { parseCsv, type RigaCsv } from "./csv";

/**
 * Import idempotente dei contatti da CSV.
 *
 * La regola che regge tutta la fase: su un contatto che esiste già,
 * `iscritto` non viene MAI scritto. Chi si è disiscritto per telefono non
 * deve poter rientrare col prossimo CSV. La riscrizione è un'azione manuale.
 */

export type RapportoImport = {
  righeLette: number;
  creati: number;
  aggiornati: number;
  disiscrittiIntatti: number;
  aziendeCreate: number;
};

export type EsitoImport =
  | { ok: true; rapporto: RapportoImport }
  | { ok: false; errore: string };

/** Aggiorna i soli campi che il CSV porta valorizzati. Mai `iscritto`. */
function aggiornaDaCsv(
  db: Database,
  contattoId: number,
  riga: RigaCsv,
  aziendaId: number | null,
): void {
  const set: string[] = [];
  const args: (string | number | null)[] = [];

  const campi: [keyof RigaCsv, string][] = [
    ["nome", "nome"],
    ["cognome", "cognome"],
    ["ruolo", "ruolo"],
    ["provenienza", "provenienza"],
    ["indirizzoRaw", "indirizzo_raw"],
  ];
  for (const [chiave, colonna] of campi) {
    const valore = riga[chiave];
    // Un campo vuoto significa "non ho l'informazione", non "cancella".
    if (typeof valore === "string" && valore.length > 0) {
      set.push(`${colonna} = ?`);
      args.push(valore);
    }
  }
  if (aziendaId !== null) {
    set.push("azienda_id = ?");
    args.push(aziendaId);
  }

  if (set.length === 0) return;
  set.push("aggiornato_il = ?");
  args.push(Date.now());
  db.run(`UPDATE contatti SET ${set.join(", ")} WHERE id = ?`, [
    ...args,
    contattoId,
  ]);
}

function eseguiImport(db: Database, righe: RigaCsv[]): RapportoImport {
  const rapporto: RapportoImport = {
    righeLette: righe.length,
    creati: 0,
    aggiornati: 0,
    disiscrittiIntatti: 0,
    aziendeCreate: 0,
  };

  for (const riga of righe) {
    let aziendaId: number | null = null;
    if (riga.azienda) {
      const prima = db.query("SELECT COUNT(*) AS n FROM aziende").get() as {
        n: number;
      };
      aziendaId = risolviOCreaAzienda(db, riga.azienda);
      const dopo = db.query("SELECT COUNT(*) AS n FROM aziende").get() as {
        n: number;
      };
      if (dopo.n > prima.n) rapporto.aziendeCreate++;
    }

    const esistente = trovaPerEmail(db, riga.email);
    if (esistente) {
      if (!esistente.iscritto) rapporto.disiscrittiIntatti++;
      aggiornaDaCsv(db, esistente.id, riga, aziendaId);
      unisciTag(db, esistente.id, riga.tag);
      rapporto.aggiornati++;
    } else {
      const id = creaContatto(db, {
        email: riga.email,
        nome: riga.nome ?? null,
        cognome: riga.cognome ?? null,
        aziendaId,
        ruolo: riga.ruolo ?? null,
        provenienza: riga.provenienza ?? null,
        indirizzoRaw: riga.indirizzoRaw ?? null,
      });
      unisciTag(db, id, riga.tag);
      rapporto.creati++;
    }
  }

  return rapporto;
}

export function importaCsv(
  db: Database,
  testo: string,
  opzioni: { origine?: string; dryRun?: boolean } = {},
): EsitoImport {
  const parsed = parseCsv(testo);
  if (!parsed.ok) return { ok: false, errore: parsed.errore };

  const origine = opzioni.origine ?? "sconosciuta";

  // Il dry-run scrive davvero e poi torna indietro: è il solo modo perché il
  // rapporto dell'anteprima sia identico a quello dell'import reale.
  if (opzioni.dryRun) {
    db.run("BEGIN");
    try {
      const rapporto = eseguiImport(db, parsed.righe);
      db.run("ROLLBACK");
      return { ok: true, rapporto };
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  }

  db.run("BEGIN");
  try {
    const rapporto = eseguiImport(db, parsed.righe);
    db.run(
      `INSERT INTO import_csv
         (eseguito_il, origine, righe_lette, creati, aggiornati, rapporto)
       VALUES (?,?,?,?,?,?)`,
      [
        Date.now(),
        origine,
        rapporto.righeLette,
        rapporto.creati,
        rapporto.aggiornati,
        JSON.stringify(rapporto),
      ],
    );
    db.run("COMMIT");
    return { ok: true, rapporto };
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

export function storicoImport(
  db: Database,
  limite = 20,
): {
  id: number;
  eseguitoIl: number;
  origine: string;
  righeLette: number;
  creati: number;
  aggiornati: number;
  rapporto: string;
}[] {
  const righe = db
    .query(
      `SELECT id, eseguito_il, origine, righe_lette, creati, aggiornati, rapporto
       FROM import_csv ORDER BY eseguito_il DESC LIMIT ?`,
    )
    .all(limite) as {
    id: number;
    eseguito_il: number;
    origine: string;
    righe_lette: number;
    creati: number;
    aggiornati: number;
    rapporto: string;
  }[];

  return righe.map((r) => ({
    id: r.id,
    eseguitoIl: r.eseguito_il,
    origine: r.origine,
    righeLette: r.righe_lette,
    creati: r.creati,
    aggiornati: r.aggiornati,
    rapporto: r.rapporto,
  }));
}
