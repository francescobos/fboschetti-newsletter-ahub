import type { Database } from "bun:sqlite";
import { normalizzaEmail } from "./csv";

/**
 * CRUD di contatti, aziende e tag.
 *
 * Riceve il `Database` come parametro e non importa nulla di `@hub/*`:
 * i test girano su un DB in memoria senza il core installato.
 */

export type StatoTecnico =
  | "mai_verificato"
  | "valido"
  | "rimbalzato"
  | "sospeso";
export type DisiscrittoVia = "telefono" | "email" | "manuale" | "ponte";

export type Contatto = {
  id: number;
  email: string;
  nome: string | null;
  cognome: string | null;
  aziendaId: number | null;
  aziendaNome: string | null;
  ruolo: string | null;
  indirizzoRaw: string | null;
  via: string | null;
  comune: string | null;
  provincia: string | null;
  regione: string | null;
  cap: string | null;
  iscritto: boolean;
  statoTecnico: StatoTecnico;
  provenienza: string | null;
  creatoIl: number;
  aggiornatoIl: number;
  disiscrittoIl: number | null;
  disiscrittoVia: DisiscrittoVia | null;
  tag: string[];
};

export type DatiContatto = {
  email: string;
  nome?: string | null;
  cognome?: string | null;
  aziendaId?: number | null;
  ruolo?: string | null;
  indirizzoRaw?: string | null;
  via?: string | null;
  comune?: string | null;
  provincia?: string | null;
  regione?: string | null;
  cap?: string | null;
  statoTecnico?: StatoTecnico;
  provenienza?: string | null;
  tag?: string[];
};

export type FiltriContatti = {
  testo?: string;
  tag?: string;
  iscritto?: boolean;
  statoTecnico?: StatoTecnico;
  provincia?: string;
  limite?: number;
  offset?: number;
};

type RigaContatto = {
  id: number;
  email: string;
  nome: string | null;
  cognome: string | null;
  azienda_id: number | null;
  azienda_nome: string | null;
  ruolo: string | null;
  indirizzo_raw: string | null;
  via: string | null;
  comune: string | null;
  provincia: string | null;
  regione: string | null;
  cap: string | null;
  iscritto: number;
  stato_tecnico: StatoTecnico;
  provenienza: string | null;
  creato_il: number;
  aggiornato_il: number;
  disiscritto_il: number | null;
  disiscritto_via: DisiscrittoVia | null;
};

const SELECT_BASE = `
  SELECT c.id, c.email, c.nome, c.cognome, c.azienda_id,
         a.nome AS azienda_nome, c.ruolo, c.indirizzo_raw, c.via, c.comune,
         c.provincia, c.regione, c.cap, c.iscritto, c.stato_tecnico,
         c.provenienza, c.creato_il, c.aggiornato_il, c.disiscritto_il,
         c.disiscritto_via
  FROM contatti c
  LEFT JOIN aziende a ON a.id = c.azienda_id
`;

function tagDi(db: Database, contattoId: number): string[] {
  return (
    db
      .query(
        `SELECT t.nome FROM tag t
         JOIN contatti_tag ct ON ct.tag_id = t.id
         WHERE ct.contatto_id = ? ORDER BY t.nome`,
      )
      .all(contattoId) as { nome: string }[]
  ).map((r) => r.nome);
}

function componi(db: Database, r: RigaContatto): Contatto {
  return {
    id: r.id,
    email: r.email,
    nome: r.nome,
    cognome: r.cognome,
    aziendaId: r.azienda_id,
    aziendaNome: r.azienda_nome,
    ruolo: r.ruolo,
    indirizzoRaw: r.indirizzo_raw,
    via: r.via,
    comune: r.comune,
    provincia: r.provincia,
    regione: r.regione,
    cap: r.cap,
    iscritto: r.iscritto === 1,
    statoTecnico: r.stato_tecnico,
    provenienza: r.provenienza,
    creatoIl: r.creato_il,
    aggiornatoIl: r.aggiornato_il,
    disiscrittoIl: r.disiscritto_il,
    disiscrittoVia: r.disiscritto_via,
    tag: tagDi(db, r.id),
  };
}

export function creaContatto(db: Database, dati: DatiContatto): number {
  const ora = Date.now();
  const row = db
    .query(
      `INSERT INTO contatti
         (email, nome, cognome, azienda_id, ruolo, indirizzo_raw, via, comune,
          provincia, regione, cap, stato_tecnico, provenienza,
          creato_il, aggiornato_il)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    )
    .get(
      normalizzaEmail(dati.email),
      dati.nome ?? null,
      dati.cognome ?? null,
      dati.aziendaId ?? null,
      dati.ruolo ?? null,
      dati.indirizzoRaw ?? null,
      dati.via ?? null,
      dati.comune ?? null,
      dati.provincia ?? null,
      dati.regione ?? null,
      dati.cap ?? null,
      dati.statoTecnico ?? "mai_verificato",
      dati.provenienza ?? null,
      ora,
      ora,
    ) as { id: number };

  if (dati.tag?.length) impostaTag(db, row.id, dati.tag);
  return row.id;
}

export function leggiContatto(db: Database, id: number): Contatto | null {
  const r = db.query(`${SELECT_BASE} WHERE c.id = ?`).get(id) as
    | RigaContatto
    | null;
  return r ? componi(db, r) : null;
}

export function trovaPerEmail(db: Database, email: string): Contatto | null {
  const r = db
    .query(`${SELECT_BASE} WHERE c.email = ?`)
    .get(normalizzaEmail(email)) as RigaContatto | null;
  return r ? componi(db, r) : null;
}

export function elencaContatti(
  db: Database,
  filtri: FiltriContatti = {},
): { righe: Contatto[]; totale: number } {
  const dove: string[] = [];
  const args: (string | number)[] = [];

  if (filtri.testo) {
    dove.push(
      `(c.email LIKE ? OR c.nome LIKE ? OR c.cognome LIKE ? OR a.nome LIKE ?)`,
    );
    const t = `%${filtri.testo}%`;
    args.push(t, t, t, t);
  }
  if (filtri.iscritto !== undefined) {
    dove.push("c.iscritto = ?");
    args.push(filtri.iscritto ? 1 : 0);
  }
  if (filtri.statoTecnico) {
    dove.push("c.stato_tecnico = ?");
    args.push(filtri.statoTecnico);
  }
  if (filtri.provincia) {
    dove.push("c.provincia = ?");
    args.push(filtri.provincia);
  }
  if (filtri.tag) {
    dove.push(`c.id IN (
      SELECT ct.contatto_id FROM contatti_tag ct
      JOIN tag t ON t.id = ct.tag_id WHERE t.nome = ?
    )`);
    args.push(filtri.tag);
  }

  const clausola = dove.length ? `WHERE ${dove.join(" AND ")}` : "";
  const totale = (
    db
      .query(
        `SELECT COUNT(*) AS n FROM contatti c
         LEFT JOIN aziende a ON a.id = c.azienda_id ${clausola}`,
      )
      .get(...args) as { n: number }
  ).n;

  const limite = filtri.limite ?? 50;
  const offset = filtri.offset ?? 0;
  const righe = db
    .query(
      `${SELECT_BASE} ${clausola} ORDER BY c.creato_il DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limite, offset) as RigaContatto[];

  return { righe: righe.map((r) => componi(db, r)), totale };
}

/**
 * Aggiorna solo i campi presenti in `dati`.
 *
 * Non espone `iscritto`: la volontà della persona si cambia solo con
 * `disiscrivi` e `riscrivi`, mai come effetto collaterale di una modifica.
 */
export function aggiornaContatto(
  db: Database,
  id: number,
  dati: Partial<DatiContatto>,
): void {
  const colonne: Record<string, string> = {
    email: "email",
    nome: "nome",
    cognome: "cognome",
    aziendaId: "azienda_id",
    ruolo: "ruolo",
    indirizzoRaw: "indirizzo_raw",
    via: "via",
    comune: "comune",
    provincia: "provincia",
    regione: "regione",
    cap: "cap",
    statoTecnico: "stato_tecnico",
    provenienza: "provenienza",
  };

  const set: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [chiave, colonna] of Object.entries(colonne)) {
    if (!(chiave in dati)) continue;
    const valore = (dati as Record<string, unknown>)[chiave];
    set.push(`${colonna} = ?`);
    args.push(
      chiave === "email" && typeof valore === "string"
        ? normalizzaEmail(valore)
        : (valore as string | number | null),
    );
  }

  if (set.length > 0) {
    set.push("aggiornato_il = ?");
    args.push(Date.now());
    db.run(`UPDATE contatti SET ${set.join(", ")} WHERE id = ?`, [...args, id]);
  }

  if (dati.tag) impostaTag(db, id, dati.tag);
}

export function disiscrivi(
  db: Database,
  id: number,
  via: DisiscrittoVia,
): void {
  const ora = Date.now();
  db.run(
    `UPDATE contatti
     SET iscritto = 0, disiscritto_il = ?, disiscritto_via = ?, aggiornato_il = ?
     WHERE id = ?`,
    [ora, via, ora, id],
  );
}

export function riscrivi(db: Database, id: number): void {
  const ora = Date.now();
  db.run(
    `UPDATE contatti
     SET iscritto = 1, disiscritto_il = NULL, disiscritto_via = NULL,
         aggiornato_il = ?
     WHERE id = ?`,
    [ora, id],
  );
}

export function risolviOCreaAzienda(db: Database, nome: string): number {
  const pulito = nome.trim();
  const esistente = db
    .query("SELECT id FROM aziende WHERE nome = ?")
    .get(pulito) as { id: number } | null;
  if (esistente) return esistente.id;

  const ora = Date.now();
  return (
    db
      .query(
        `INSERT INTO aziende (nome, creato_il, aggiornato_il)
         VALUES (?,?,?) RETURNING id`,
      )
      .get(pulito, ora, ora) as { id: number }
  ).id;
}

export function elencaAziende(
  db: Database,
): { id: number; nome: string; contatti: number }[] {
  return db
    .query(
      `SELECT a.id, a.nome, COUNT(c.id) AS contatti
       FROM aziende a
       LEFT JOIN contatti c ON c.azienda_id = a.id
       GROUP BY a.id ORDER BY a.nome`,
    )
    .all() as { id: number; nome: string; contatti: number }[];
}

export function aggiornaAzienda(
  db: Database,
  id: number,
  dati: {
    nome?: string;
    settore?: string | null;
    sito?: string | null;
    indirizzoRaw?: string | null;
    note?: string | null;
  },
): void {
  const colonne: Record<string, string> = {
    nome: "nome",
    settore: "settore",
    sito: "sito",
    indirizzoRaw: "indirizzo_raw",
    note: "note",
  };
  const set: string[] = [];
  const args: (string | null)[] = [];
  for (const [chiave, colonna] of Object.entries(colonne)) {
    if (!(chiave in dati)) continue;
    set.push(`${colonna} = ?`);
    args.push((dati as Record<string, string | null>)[chiave] ?? null);
  }
  if (set.length === 0) return;
  set.push("aggiornato_il = ?");
  db.run(`UPDATE aziende SET ${set.join(", ")} WHERE id = ?`, [
    ...args,
    Date.now(),
    id,
  ]);
}

/** I contatti sopravvivono: `azienda_id` va a NULL per la FK ON DELETE SET NULL. */
export function eliminaAzienda(db: Database, id: number): void {
  db.run("DELETE FROM aziende WHERE id = ?", [id]);
}

function risolviOCreaTag(db: Database, nome: string): number {
  const pulito = nome.trim().toLowerCase();
  const esistente = db.query("SELECT id FROM tag WHERE nome = ?").get(pulito) as
    | { id: number }
    | null;
  if (esistente) return esistente.id;
  return (
    db
      .query("INSERT INTO tag (nome) VALUES (?) RETURNING id")
      .get(pulito) as { id: number }
  ).id;
}

export function impostaTag(
  db: Database,
  contattoId: number,
  tag: string[],
): void {
  db.run("DELETE FROM contatti_tag WHERE contatto_id = ?", [contattoId]);
  unisciTag(db, contattoId, tag);
}

export function unisciTag(
  db: Database,
  contattoId: number,
  tag: string[],
): void {
  for (const nome of tag) {
    if (!nome.trim()) continue;
    const tagId = risolviOCreaTag(db, nome);
    db.run(
      `INSERT OR IGNORE INTO contatti_tag (contatto_id, tag_id) VALUES (?,?)`,
      [contattoId, tagId],
    );
  }
}

export function elencaTag(
  db: Database,
): { nome: string; contatti: number }[] {
  return db
    .query(
      `SELECT t.nome, COUNT(ct.contatto_id) AS contatti
       FROM tag t
       LEFT JOIN contatti_tag ct ON ct.tag_id = t.id
       GROUP BY t.id ORDER BY t.nome`,
    )
    .all() as { nome: string; contatti: number }[];
}
