# Fase 1.5 — Campagna diretta nel Core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mandare una campagna vera ai contatti iscritti partendo da una coppia `.txt` + `.html` su disco, delegando al core ritmo, ripresa e idempotenza.

**Architecture:** Una tabella `edizioni` con macchina a stati (`bozza → pronta → in_invio → inviata`) e quattro moduli separati: `edizioni.ts` (CRUD e stati, non sa nulla di mail né contatti), `ingestione.ts` (legge la coppia di file), `destinatari.ts` (risolve le email dal DB), `campagne.ts` (wrapper su `deps.mail`). La separazione permette di testare la risoluzione senza il core e l'accodamento senza il DB contatti.

**Tech Stack:** Bun, TypeScript strict, `bun:sqlite`, Hono, React 19 + shadcn/ui (per la pagina), `bun:test`.

**Spec:** [docs/superpowers/specs/2026-09-15-fase-1-5-campagna-diretta-design.md](../specs/2026-09-15-fase-1-5-campagna-diretta-design.md)

## Global Constraints

Regole del progetto (`AGENTS.md`) e della spec che valgono per **ogni** task:

- **Lingua del codice**: identificatori, tipi e commenti in italiano, come tutto il codice esistente. I commenti spiegano *perché*, non *cosa*.
- **Prefissare i comandi shell con `rtk`** (es. `rtk git commit`, `rtk bun test`). È sempre sicuro: se RTK non ha un filtro passa il comando invariato.
- **Non committare** `data/`, `db/`, `.env` o indirizzi email reali. Negli esempi e nei test usare solo domini fittizi (`esempio.it`).
- **Non riaprire il DB** dentro `server/routes.ts`: arriva già aperto e migrato in `deps.db`.
- **Non aprire il DB del core**: per le campagne si passa solo da `deps.mail`.
- **Non dichiarare le `deps` come `any`**: i tipi stanno nei barrel `@hub/*`.
- **`deps.mail` può essere `null`**: va sempre controllato, con errore esplicito mai silenzioso.
- **Il `ref` non contiene mai `Date.now()`**: deve derivare dall'identità dell'edizione.
- **Il plugin non modifica mai i corpi** `testo` e `html`: li conserva e li spedisce byte per byte.
- **Timestamp**: interi in millisecondi (`Date.now()`), come nelle tabelle della Fase 1.
- **TypeScript strict**: `bun run check` deve passare a ogni commit.
- **Icone**: solo dalla palette chiusa `activity bot mail rocket terminal wrench zap`.

**Verifica a ogni task**: `rtk bun test tests/` e `rtk bun run check` devono passare prima del commit.

---

## File Structure

| File | Responsabilità |
| :--- | :--- |
| `migrations/20260915_000000_edizioni.sql` | Tabella `edizioni` e suo indice. Solo `CREATE`, non tocca l'esistente. |
| `server/edizioni.ts` | CRUD edizione, macchina a stati, `normalizzaRef`. Non importa nulla di mail o contatti. |
| `server/ingestione.ts` | Legge la coppia `.txt` + `.html` da percorso, verifica il `mailto:`, crea l'edizione. |
| `server/destinatari.ts` | `risolviDestinatari(db, filtri)`: funzione pura sul DB contatti. |
| `server/campagne.ts` | Wrapper su `deps.mail`: accoda, avvia, stato, prova. Riceve la lista già risolta. |
| `server/routes.ts` | *Modifica*: estende `deps` con `mail` e monta le route `/edizioni`. |
| `web/pages/edizioni.tsx` | Pagina React: elenco, azioni per stato, avviso mailto. |
| `tests/helpers.ts` | *Modifica*: carica anche la nuova migration. |
| `tests/edizioni.test.ts` | Transizioni, `ref` duplicato, `normalizzaRef`. |
| `tests/ingestione.test.ts` | Coppia completa e incompleta, verifica `mailto:`. |
| `tests/destinatari.test.ts` | Filtri iscritti/rimbalzati/tag. |
| `tests/campagne.test.ts` | Accodamento, avvio, stato, `mail === null`, con finto `MailApi`. |
| `tests/routes-edizioni.test.ts` | Le route end-to-end con finto `MailApi`. |

**Ordine dei task**: 1 (migration) → 2 (`edizioni.ts`) → 3 (`destinatari.ts`) → 4 (`ingestione.ts`) → 5 (`campagne.ts`) → 6 (route) → 7 (UI) → 8 (docs).

I task 3 e 4 sono indipendenti fra loro: entrambi dipendono solo dal task 2.

---

## Task 1: Migration della tabella `edizioni`

**Files:**
- Create: `migrations/20260915_000000_edizioni.sql`
- Modify: `tests/helpers.ts`

**Interfaces:**
- Consumes: niente
- Produces: tabella `edizioni` con colonne `id, ref, oggetto, testo, html, percorso_origine, stato, campagna_id, avviso_mailto, filtro_tag, destinatari_n, creato_il, aggiornato_il, accodata_il, avviata_il`. `creaDbDiTest()` applica anche questa migration.

**Contesto:** `tests/helpers.ts` oggi carica una sola migration con un `readFileSync` hardcoded. Va reso capace di applicarne più d'una, in ordine lessicografico, altrimenti nessun test delle prossime task vedrà la tabella.

- [ ] **Step 1: Scrivere la migration**

Create `migrations/20260915_000000_edizioni.sql`:

```sql
-- Un'edizione è una coppia .txt + .html pronta per la spedizione.
-- `ref` è UNIQUE anche qui, non solo nel core: la protezione del core scatta
-- all'accodamento, questa all'ingestione, quando l'errore costa ancora nulla.
CREATE TABLE edizioni (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  oggetto          TEXT NOT NULL,
  testo            TEXT NOT NULL,
  html             TEXT NOT NULL,
  percorso_origine TEXT,
  stato            TEXT NOT NULL DEFAULT 'bozza'
                   CHECK (stato IN ('bozza','pronta','in_invio','inviata')),
  campagna_id      TEXT,
  avviso_mailto    TEXT,
  filtro_tag       TEXT,
  destinatari_n    INTEGER,
  creato_il        INTEGER NOT NULL,
  aggiornato_il    INTEGER NOT NULL,
  accodata_il      INTEGER,
  avviata_il       INTEGER
);

CREATE INDEX idx_edizioni_stato ON edizioni(stato);
```

- [ ] **Step 2: Estendere l'helper dei test**

Replace the whole body of `tests/helpers.ts`:

```ts
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
```

- [ ] **Step 3: Scrivere il test che verifica la tabella**

Create `tests/edizioni.test.ts`:

```ts
import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

test("la migration crea la tabella edizioni", () => {
  const riga = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='edizioni'")
    .get();
  expect(riga).not.toBeNull();
});

test("lo stato di default è bozza", () => {
  const ora = Date.now();
  db.run(
    `INSERT INTO edizioni (ref, oggetto, testo, html, creato_il, aggiornato_il)
     VALUES ('prova', 'Oggetto', 'testo', '<p>html</p>', ?, ?)`,
    [ora, ora],
  );
  const r = db.query("SELECT stato FROM edizioni").get() as { stato: string };
  expect(r.stato).toBe("bozza");
});

test("uno stato fuori dai quattro previsti è rifiutato", () => {
  const ora = Date.now();
  expect(() =>
    db.run(
      `INSERT INTO edizioni (ref, oggetto, testo, html, stato, creato_il, aggiornato_il)
       VALUES ('prova', 'Oggetto', 'testo', '<p>h</p>', 'inventato', ?, ?)`,
      [ora, ora],
    ),
  ).toThrow();
});

test("due edizioni con lo stesso ref non convivono", () => {
  const ora = Date.now();
  const inserisci = (ref: string) =>
    db.run(
      `INSERT INTO edizioni (ref, oggetto, testo, html, creato_il, aggiornato_il)
       VALUES (?, 'Oggetto', 'testo', '<p>h</p>', ?, ?)`,
      [ref, ora, ora],
    );
  inserisci("newsletter-2026-09");
  expect(() => inserisci("newsletter-2026-09")).toThrow();
});
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `rtk bun test tests/edizioni.test.ts`
Expected: PASS, 4 test. Se `creaDbDiTest` non fosse stato aggiornato, il primo test fallirebbe con tabella assente.

- [ ] **Step 5: Verificare che i test esistenti non si siano rotti**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi. L'helper ora carica due migration invece di una; `20260912_000000_contatti.sql` contiene un `DROP TABLE IF EXISTS righe` che resta innocuo.

- [ ] **Step 6: Commit**

```bash
rtk git add migrations/20260915_000000_edizioni.sql tests/helpers.ts tests/edizioni.test.ts
rtk git commit -m "feat: tabella edizioni con macchina a stati

L'helper dei test applica ora tutte le migration in ordine lessicografico:
una lista hardcoded dimenticherebbe ogni migration futura.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `server/edizioni.ts` — CRUD, stati e `normalizzaRef`

**Files:**
- Create: `server/edizioni.ts`
- Test: `tests/edizioni.test.ts` (aggiunte al file del Task 1)

**Interfaces:**
- Consumes: tabella `edizioni` (Task 1)
- Produces:
  - `type Stato = "bozza" | "pronta" | "in_invio" | "inviata"`
  - `type Edizione` (vedi Step 3)
  - `normalizzaRef(grezzo: string): string`
  - `creaEdizione(db, dati: DatiEdizione): number`
  - `leggiEdizione(db, id: number): Edizione | null`
  - `trovaPerRef(db, ref: string): Edizione | null`
  - `elencaEdizioni(db, filtri?: { stato?: Stato }): { righe: Edizione[]; totale: number }`
  - `avanzaStato(db, id: number, nuovo: Stato, dati?: DatiAvanzamento): void`
  - `type DatiEdizione`, `type DatiAvanzamento`

**Contesto:** `normalizzaRef` è il cuore della protezione anti-doppio-invio. L'unicità nel DB è un confronto esatto, quindi `"news settembre"` e `"news  settembre"` sarebbero `ref` diversi e il vincolo non scatterebbe. La normalizzazione elimina il problema alla radice.

- [ ] **Step 1: Scrivere i test di `normalizzaRef`**

Append to `tests/edizioni.test.ts`:

```ts
import {
  avanzaStato,
  creaEdizione,
  elencaEdizioni,
  leggiEdizione,
  normalizzaRef,
  trovaPerRef,
} from "../server/edizioni";

test("normalizzaRef abbassa le maiuscole", () => {
  expect(normalizzaRef("Newsletter Settembre")).toBe("newsletter-settembre");
});

test("normalizzaRef collassa gli spazi multipli in un solo trattino", () => {
  expect(normalizzaRef("outreach  villaggi   autunno")).toBe(
    "outreach-villaggi-autunno",
  );
});

test("normalizzaRef taglia gli spazi ai bordi", () => {
  expect(normalizzaRef("  newsletter 2026-09  ")).toBe("newsletter-2026-09");
});

test("normalizzaRef sostituisce i caratteri non ammessi", () => {
  expect(normalizzaRef("news/settembre!2026")).toBe("news-settembre-2026");
});

test("normalizzaRef non lascia trattini ai bordi né doppi", () => {
  expect(normalizzaRef("--news---settembre--")).toBe("news-settembre");
});

test("normalizzaRef conserva accenti come trattini, non li sopprime", () => {
  expect(normalizzaRef("novità di settembre")).toBe("novit-di-settembre");
});

test("normalizzaRef su stringa senza caratteri utili dà stringa vuota", () => {
  expect(normalizzaRef("!!!")).toBe("");
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `rtk bun test tests/edizioni.test.ts`
Expected: FAIL con errore di modulo non trovato (`Cannot find module '../server/edizioni'`).

- [ ] **Step 3: Scrivere il modulo**

Create `server/edizioni.ts`:

```ts
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
```

- [ ] **Step 4: Eseguire i test di `normalizzaRef` e verificare che passino**

Run: `rtk bun test tests/edizioni.test.ts`
Expected: PASS.

- [ ] **Step 5: Scrivere i test di CRUD e transizioni**

Append to `tests/edizioni.test.ts`:

```ts
const DATI = {
  ref: "newsletter-2026-09",
  oggetto: "Novità di settembre",
  testo: "Versione testuale.",
  html: "<p>Versione HTML.</p>",
};

test("creaEdizione nasce in bozza, senza campagna né timestamp di invio", () => {
  const id = creaEdizione(db, DATI);
  const e = leggiEdizione(db, id)!;
  expect(e.ref).toBe("newsletter-2026-09");
  expect(e.stato).toBe("bozza");
  expect(e.campagnaId).toBeNull();
  expect(e.accodataIl).toBeNull();
  expect(e.avviataIl).toBeNull();
  expect(e.destinatariN).toBeNull();
});

test("i corpi si conservano identici, byte per byte", () => {
  const html = '<p>Link <a href="mailto:a@esempio.it">qui</a> &amp; altro</p>';
  const id = creaEdizione(db, { ...DATI, testo: "  spazi  ", html });
  const e = leggiEdizione(db, id)!;
  expect(e.testo).toBe("  spazi  ");
  expect(e.html).toBe(html);
});

test("trovaPerRef ritrova l'edizione", () => {
  creaEdizione(db, DATI);
  expect(trovaPerRef(db, "newsletter-2026-09")!.oggetto).toBe(
    "Novità di settembre",
  );
  expect(trovaPerRef(db, "inesistente")).toBeNull();
});

test("leggiEdizione su id inesistente dà null", () => {
  expect(leggiEdizione(db, 999)).toBeNull();
});

test("elencaEdizioni filtra per stato", () => {
  creaEdizione(db, DATI);
  const id2 = creaEdizione(db, { ...DATI, ref: "outreach-autunno" });
  avanzaStato(db, id2, "pronta", { campagnaId: "abc", destinatariN: 12 });

  expect(elencaEdizioni(db).totale).toBe(2);
  expect(elencaEdizioni(db, { stato: "bozza" }).totale).toBe(1);
  expect(elencaEdizioni(db, { stato: "pronta" }).righe[0]!.ref).toBe(
    "outreach-autunno",
  );
});

test("avanzaStato registra campagna, destinatari e accodata_il", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", {
    campagnaId: "camp-123",
    destinatariN: 42,
    filtroTag: "villaggi",
  });
  const e = leggiEdizione(db, id)!;
  expect(e.stato).toBe("pronta");
  expect(e.campagnaId).toBe("camp-123");
  expect(e.destinatariN).toBe(42);
  expect(e.filtroTag).toBe("villaggi");
  expect(e.accodataIl).not.toBeNull();
  expect(e.avviataIl).toBeNull();
});

test("avanzaStato a in_invio segna avviata_il", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "camp-123" });
  avanzaStato(db, id, "in_invio");
  const e = leggiEdizione(db, id)!;
  expect(e.stato).toBe("in_invio");
  expect(e.avviataIl).not.toBeNull();
});

test("il percorso completo bozza → inviata è ammesso", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "c" });
  avanzaStato(db, id, "in_invio");
  avanzaStato(db, id, "inviata");
  expect(leggiEdizione(db, id)!.stato).toBe("inviata");
});

test("saltare uno stato è rifiutato", () => {
  const id = creaEdizione(db, DATI);
  expect(() => avanzaStato(db, id, "in_invio")).toThrow(
    /transizione non ammessa/,
  );
  expect(leggiEdizione(db, id)!.stato).toBe("bozza");
});

test("tornare indietro è rifiutato", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "c" });
  expect(() => avanzaStato(db, id, "bozza")).toThrow(/transizione non ammessa/);
});

test("da inviata non si va da nessuna parte", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "c" });
  avanzaStato(db, id, "in_invio");
  avanzaStato(db, id, "inviata");
  expect(() => avanzaStato(db, id, "in_invio")).toThrow(
    /transizione non ammessa/,
  );
});

test("avanzaStato su edizione inesistente solleva", () => {
  expect(() => avanzaStato(db, 999, "pronta")).toThrow(/non trovata/);
});
```

- [ ] **Step 6: Eseguire tutti i test e verificare che passino**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi.

- [ ] **Step 7: Commit**

```bash
rtk git add server/edizioni.ts tests/edizioni.test.ts
rtk git commit -m "feat: modulo edizioni con macchina a stati e normalizzaRef

Le transizioni ammesse sono una tabella esplicita: lo stato è un cancello,
non un'etichetta. normalizzaRef riduce il ref a [a-z0-9-] perché l'unicità
nel DB è un confronto esatto e uno spazio invisibile annullerebbe la
protezione contro il doppio invio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `server/destinatari.ts` — risoluzione dal DB contatti

**Files:**
- Create: `server/destinatari.ts`
- Test: `tests/destinatari.test.ts`

**Interfaces:**
- Consumes: tabelle `contatti`, `tag`, `contatti_tag` (Fase 1)
- Produces: `risolviDestinatari(db: Database, filtri?: FiltriDestinatari): string[]` e `type FiltriDestinatari = { tag?: string }`

**Contesto:** La regola è nella roadmap: si spedisce a chi è `iscritto = 1` **e** non ha lo stato tecnico `rimbalzato`. Sono due assi distinti — la volontà della persona e la salute dell'indirizzo — e servono entrambe le condizioni. Questo modulo la Fase 4 lo riuserà così com'è.

- [ ] **Step 1: Scrivere i test**

Create `tests/destinatari.test.ts`:

```ts
import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { creaContatto, disiscrivi, impostaTag } from "../server/contatti";
import { risolviDestinatari } from "../server/destinatari";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

test("un contatto iscritto e sano è un destinatario", () => {
  creaContatto(db, { email: "mario@esempio.it" });
  expect(risolviDestinatari(db)).toEqual(["mario@esempio.it"]);
});

test("un disiscritto non riceve", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "telefono");
  expect(risolviDestinatari(db)).toEqual([]);
});

test("un rimbalzato non riceve, anche se iscritto", () => {
  creaContatto(db, {
    email: "rotto@esempio.it",
    statoTecnico: "rimbalzato",
  });
  expect(risolviDestinatari(db)).toEqual([]);
});

test("gli altri stati tecnici ricevono", () => {
  creaContatto(db, { email: "a@esempio.it", statoTecnico: "mai_verificato" });
  creaContatto(db, { email: "b@esempio.it", statoTecnico: "valido" });
  creaContatto(db, { email: "c@esempio.it", statoTecnico: "sospeso" });
  expect(risolviDestinatari(db).sort()).toEqual([
    "a@esempio.it",
    "b@esempio.it",
    "c@esempio.it",
  ]);
});

test("il filtro per tag restringe ai soli contatti taggati", () => {
  const id1 = creaContatto(db, { email: "a@esempio.it" });
  creaContatto(db, { email: "b@esempio.it" });
  impostaTag(db, id1, ["villaggi"]);
  expect(risolviDestinatari(db, { tag: "villaggi" })).toEqual(["a@esempio.it"]);
});

test("il filtro per tag rispetta comunque iscritto e stato tecnico", () => {
  const id1 = creaContatto(db, { email: "a@esempio.it" });
  const id2 = creaContatto(db, { email: "b@esempio.it" });
  impostaTag(db, id1, ["villaggi"]);
  impostaTag(db, id2, ["villaggi"]);
  disiscrivi(db, id2, "email");
  expect(risolviDestinatari(db, { tag: "villaggi" })).toEqual(["a@esempio.it"]);
});

test("un tag inesistente non dà destinatari", () => {
  creaContatto(db, { email: "a@esempio.it" });
  expect(risolviDestinatari(db, { tag: "inesistente" })).toEqual([]);
});

test("nessun contatto dà lista vuota, non un errore", () => {
  expect(risolviDestinatari(db)).toEqual([]);
});

test("le email non si ripetono", () => {
  const id = creaContatto(db, { email: "a@esempio.it" });
  impostaTag(db, id, ["villaggi", "bologna"]);
  expect(risolviDestinatari(db)).toEqual(["a@esempio.it"]);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `rtk bun test tests/destinatari.test.ts`
Expected: FAIL con `Cannot find module '../server/destinatari'`.

- [ ] **Step 3: Scrivere il modulo**

Create `server/destinatari.ts`:

```ts
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
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `rtk bun test tests/destinatari.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 5: Verificare la suite completa**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi.

- [ ] **Step 6: Commit**

```bash
rtk git add server/destinatari.ts tests/destinatari.test.ts
rtk git commit -m "feat: risoluzione destinatari dalla lista contatti

Due condizioni distinte: iscritto è la volontà della persona, stato_tecnico
la salute dell'indirizzo. Spedire richiede entrambe. I rimbalzati si
escludono a monte per non sporcare errorCount della campagna.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `server/ingestione.ts` — lettura della coppia e verifica `mailto:`

**Files:**
- Create: `server/ingestione.ts`
- Test: `tests/ingestione.test.ts`

**Interfaces:**
- Consumes: `creaEdizione`, `normalizzaRef`, `trovaPerRef` da `server/edizioni.ts` (Task 2)
- Produces:
  - `ingestaDaPercorso(db, opzioni: OpzioniIngestione): EsitoIngestione`
  - `type OpzioniIngestione = { percorso: string; ref: string; oggetto: string }`
  - `type EsitoIngestione = { ok: true; id: number; ref: string; avvisoMailto: string | null } | { ok: false; errore: string }`
  - `verificaMailto(testo: string, html: string): string | null`

**Contesto:** Il percorso può essere una directory contenente la coppia, oppure uno dei due file (l'altro si cerca con la stessa radice). Entrambi obbligatori. La verifica del `mailto:` **avvisa e non blocca**: un blocco duro in una fase minima fermerebbe per un dettaglio di formattazione.

- [ ] **Step 1: Scrivere i test**

Create `tests/ingestione.test.ts`:

```ts
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leggiEdizione } from "../server/edizioni";
import { ingestaDaPercorso, verificaMailto } from "../server/ingestione";
import { creaDbDiTest } from "./helpers";

let db: Database;
let dir: string;

const TESTO = `Novità di settembre.

Se non vuoi più riceverla: mailto:redazione@esempio.it?subject=Vorrei%20disiscrivermi`;

const HTML = `<p>Novità di settembre.</p>
<p><a href="mailto:redazione@esempio.it?subject=Vorrei%20disiscrivermi">Disiscriviti</a></p>`;

beforeEach(() => {
  db = creaDbDiTest();
  dir = mkdtempSync(join(tmpdir(), "ingestione-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function scriviCoppia(nome: string, testo = TESTO, html = HTML): string {
  writeFileSync(join(dir, `${nome}.txt`), testo);
  writeFileSync(join(dir, `${nome}.html`), html);
  return dir;
}

test("una coppia completa in una directory entra come edizione", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "newsletter-2026-09",
    oggetto: "Novità di settembre",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  const e = leggiEdizione(db, esito.id)!;
  expect(e.stato).toBe("bozza");
  expect(e.testo).toBe(TESTO);
  expect(e.html).toBe(HTML);
  expect(e.avvisoMailto).toBeNull();
});

test("il ref si normalizza e l'esito riporta quello effettivo", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "  Newsletter Settembre 2026 ",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.ref).toBe("newsletter-settembre-2026");
  expect(leggiEdizione(db, esito.id)!.ref).toBe("newsletter-settembre-2026");
});

test("indicare il .txt trova l'.html con la stessa radice", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: join(dir, "newsletter.txt"),
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
});

test("indicare l'.html trova il .txt con la stessa radice", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: join(dir, "newsletter.html"),
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
});

test("una coppia incompleta non entra", () => {
  writeFileSync(join(dir, "solo.txt"), TESTO);
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("coppia_incompleta");
});

test("un percorso inesistente dà errore, non un'eccezione", () => {
  const esito = ingestaDaPercorso(db, {
    percorso: join(dir, "non-esiste"),
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("percorso_inesistente");
});

test("due file .txt nella stessa directory sono un'ambiguità, non una scelta", () => {
  scriviCoppia("uno");
  scriviCoppia("due");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("coppia_ambigua");
});

test("un ref già usato non entra due volte", () => {
  scriviCoppia("newsletter");
  ingestaDaPercorso(db, { percorso: dir, ref: "r1", oggetto: "Oggetto" });
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("ref_gia_presente");
});

test("un ref che si normalizza a vuoto è rifiutato", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "!!!",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("ref_non_valido");
});

test("un oggetto vuoto è rifiutato", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "   ",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("oggetto_mancante");
});

test("un file vuoto è rifiutato", () => {
  scriviCoppia("newsletter", "", HTML);
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("corpo_vuoto");
});

test("senza mailto l'edizione entra, ma con l'avviso", () => {
  scriviCoppia("newsletter", "Solo testo.", "<p>Solo html.</p>");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.avvisoMailto).not.toBeNull();
  expect(leggiEdizione(db, esito.id)!.avvisoMailto).toContain("testo");
});

test("il mailto in uno solo dei due corpi avvisa comunque", () => {
  scriviCoppia("newsletter", "Solo testo, niente link.", HTML);
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.avvisoMailto).toContain("testo");
});

test("verificaMailto tace quando entrambi i corpi ce l'hanno", () => {
  expect(verificaMailto(TESTO, HTML)).toBeNull();
});

test("verificaMailto nomina entrambi i corpi quando mancano entrambi", () => {
  const avviso = verificaMailto("niente", "<p>niente</p>")!;
  expect(avviso).toContain("testo");
  expect(avviso).toContain("HTML");
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `rtk bun test tests/ingestione.test.ts`
Expected: FAIL con `Cannot find module '../server/ingestione'`.

- [ ] **Step 3: Scrivere il modulo**

Create `server/ingestione.ts`:

```ts
import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { creaEdizione, normalizzaRef, trovaPerRef } from "./edizioni";

/**
 * Ingestione della coppia `.txt` + `.html` da un percorso su disco.
 *
 * È il punto d'ingresso che l'agente dei contenuti userà. La Fase 2 innesterà
 * qui il validatore deterministico senza cambiarne la firma.
 */

export type OpzioniIngestione = {
  percorso: string;
  ref: string;
  oggetto: string;
};

export type EsitoIngestione =
  | { ok: true; id: number; ref: string; avvisoMailto: string | null }
  | { ok: false; errore: string };

/**
 * Cerca un `mailto:` di disiscrizione nei due corpi.
 *
 * Avvisa, non blocca: i corpi li scrive l'agente dei contenuti e il plugin
 * non li modifica mai. Un blocco duro in questa fase fermerebbe l'invio per
 * un dettaglio di formattazione.
 *
 * Non verifica a quale indirizzo punti: `mailFrom` è configurazione del core
 * e non è esposta al plugin.
 */
export function verificaMailto(testo: string, html: string): string | null {
  const mancanti: string[] = [];
  if (!/mailto:/i.test(testo)) mancanti.push("testo");
  if (!/mailto:/i.test(html)) mancanti.push("HTML");
  if (mancanti.length === 0) return null;
  return `Nessun link mailto: di disiscrizione trovato nel corpo ${mancanti.join(" e nel corpo ")}.`;
}

/** La coppia di file trovata a partire dal percorso indicato. */
type Coppia = { testo: string; html: string };

function trovaCoppia(percorso: string): Coppia | { errore: string } {
  if (!existsSync(percorso)) return { errore: "percorso_inesistente" };

  // Un file indicato: l'altro ha la stessa radice nella stessa directory.
  if (statSync(percorso).isFile()) {
    const radice = percorso.replace(/\.(txt|html)$/i, "");
    const txt = `${radice}.txt`;
    const html = `${radice}.html`;
    if (!existsSync(txt) || !existsSync(html)) {
      return { errore: "coppia_incompleta" };
    }
    return { testo: txt, html };
  }

  // Una directory: deve contenere esattamente una coppia.
  const file = readdirSync(percorso);
  const txt = file.filter((n) => n.toLowerCase().endsWith(".txt"));
  const html = file.filter((n) => n.toLowerCase().endsWith(".html"));
  if (txt.length === 0 || html.length === 0) {
    return { errore: "coppia_incompleta" };
  }
  // Più coppie non sono una scelta da indovinare: chi chiama indichi il file.
  if (txt.length > 1 || html.length > 1) return { errore: "coppia_ambigua" };
  return { testo: join(percorso, txt[0]!), html: join(percorso, html[0]!) };
}

export function ingestaDaPercorso(
  db: Database,
  opzioni: OpzioniIngestione,
): EsitoIngestione {
  const ref = normalizzaRef(opzioni.ref);
  if (!ref) return { ok: false, errore: "ref_non_valido" };
  if (!opzioni.oggetto.trim()) return { ok: false, errore: "oggetto_mancante" };
  if (trovaPerRef(db, ref)) return { ok: false, errore: "ref_gia_presente" };

  const coppia = trovaCoppia(opzioni.percorso);
  if ("errore" in coppia) return { ok: false, errore: coppia.errore };

  const testo = readFileSync(coppia.testo, "utf8");
  const html = readFileSync(coppia.html, "utf8");
  if (!testo.trim() || !html.trim()) {
    return { ok: false, errore: "corpo_vuoto" };
  }

  const avvisoMailto = verificaMailto(testo, html);
  const id = creaEdizione(db, {
    ref,
    oggetto: opzioni.oggetto.trim(),
    testo,
    html,
    percorsoOrigine: dirname(coppia.testo),
    avvisoMailto,
  });

  return { ok: true, id, ref, avvisoMailto };
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `rtk bun test tests/ingestione.test.ts`
Expected: PASS, 15 test.

Nota: `basename` è importato ma potrebbe risultare inutilizzato. Se `bun run check` lo segnala, rimuovilo dall'import.

- [ ] **Step 5: Verificare la suite completa**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi.

- [ ] **Step 6: Commit**

```bash
rtk git add server/ingestione.ts tests/ingestione.test.ts
rtk git commit -m "feat: ingestione della coppia txt+html da percorso

Entrambi i file sono obbligatori: una coppia incompleta non entra. La
verifica del mailto: di disiscrizione avvisa senza bloccare, perché i corpi
li scrive l'agente dei contenuti e il plugin non li modifica mai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `server/campagne.ts` — wrapper su `deps.mail`

**Files:**
- Create: `server/campagne.ts`
- Test: `tests/campagne.test.ts`

**Interfaces:**
- Consumes: `type Edizione` da `server/edizioni.ts` (Task 2)
- Produces:
  - `type MailMinima` (il sottoinsieme di `MailApi` che serve)
  - `accoda(mail, edizione, destinatari): Promise<EsitoCampagna<{ id: string }>>`
  - `avvia(mail, campagnaId): Promise<EsitoCampagna<null>>`
  - `statoCampagna(mail, idOrRef): Promise<EsitoCampagna<Campagna | null>>`
  - `prova(mail, edizione, indirizzo): Promise<EsitoCampagna<{ id: string }>>`
  - `type EsitoCampagna<T> = { ok: true; dato: T } | { ok: false; errore: string }`

**Contesto:** Il tipo `MailApi` vive in `@hub/mail-api`, che esiste **solo** quando il plugin gira dentro il core: non è risolvibile da `bun run check` né dai test. Per questo il modulo dichiara `MailMinima`, un tipo strutturale con le sole firme che usa. `MailApi` lo soddisfa, e i test possono passare un finto senza il core installato.

Il modulo **non tocca il DB**: riceve l'edizione e la lista già risolta. È ciò che permette di testare l'accodamento senza il DB contatti.

- [ ] **Step 1: Scrivere i test**

Create `tests/campagne.test.ts`:

```ts
import { beforeEach, expect, test } from "bun:test";
import {
  accoda,
  avvia,
  prova,
  statoCampagna,
  type Campagna,
  type MailMinima,
} from "../server/campagne";
import type { Edizione } from "../server/edizioni";

const EDIZIONE: Edizione = {
  id: 1,
  ref: "newsletter-2026-09",
  oggetto: "Novità di settembre",
  testo: "Versione testuale.",
  html: "<p>Versione HTML.</p>",
  percorsoOrigine: "/tmp/edizioni",
  stato: "bozza",
  campagnaId: null,
  avvisoMailto: null,
  filtroTag: null,
  destinatariN: null,
  creatoIl: 1,
  aggiornatoIl: 1,
  accodataIl: null,
  avviataIl: null,
};

/** Finto `MailApi` che registra le chiamate, così i test non mandano mail. */
function creaFintaMail(opzioni: { refUsati?: string[] } = {}) {
  const refUsati = new Set(opzioni.refUsati ?? []);
  const chiamate: {
    accodate: { ref: string; recipients: string[] }[];
    avviate: string[];
    inviate: { to: string; subject: string }[];
  } = { accodate: [], avviate: [], inviate: [] };

  const mail: MailMinima = {
    async send(input) {
      chiamate.inviate.push({ to: String(input.to), subject: input.subject });
      return { id: "mail-1" };
    },
    async enqueueCampaign(input) {
      if (refUsati.has(input.ref)) {
        throw new Error(`UNIQUE constraint failed: email_campaigns.ref`);
      }
      refUsati.add(input.ref);
      chiamate.accodate.push({
        ref: input.ref,
        recipients: input.recipients,
      });
      return { id: `camp-${chiamate.accodate.length}` };
    },
    async startCampaign(id) {
      chiamate.avviate.push(id);
    },
    async getCampaign(idOrRef) {
      if (!refUsati.has(idOrRef) && !idOrRef.startsWith("camp-")) return null;
      return {
        id: "camp-1",
        ref: "newsletter-2026-09",
        subject: "Novità di settembre",
        status: "sending",
        total: 2,
        sentCount: 1,
        errorCount: 0,
        startedAt: "2026-09-15T10:00:00Z",
        finishedAt: null,
      } as Campagna;
    },
  };

  return { mail, chiamate };
}

let finta: ReturnType<typeof creaFintaMail>;
beforeEach(() => {
  finta = creaFintaMail();
});

test("accoda passa ref, oggetto e i due corpi al core", async () => {
  const esito = await accoda(finta.mail, EDIZIONE, [
    "a@esempio.it",
    "b@esempio.it",
  ]);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.dato.id).toBe("camp-1");
  expect(finta.chiamate.accodate[0]!.ref).toBe("newsletter-2026-09");
  expect(finta.chiamate.accodate[0]!.recipients).toEqual([
    "a@esempio.it",
    "b@esempio.it",
  ]);
});

test("accodare senza destinatari è un errore, non una campagna vuota", async () => {
  const esito = await accoda(finta.mail, EDIZIONE, []);
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("nessun_destinatario");
  expect(finta.chiamate.accodate.length).toBe(0);
});

test("un ref già usato fallisce in modo pulito, senza eccezione", async () => {
  const conRef = creaFintaMail({ refUsati: ["newsletter-2026-09"] });
  const esito = await accoda(conRef.mail, EDIZIONE, ["a@esempio.it"]);
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("ref_gia_usato");
});

test("accoda con mail null dà errore esplicito", async () => {
  const esito = await accoda(null, EDIZIONE, ["a@esempio.it"]);
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

test("avvia chiama startCampaign con l'id della campagna", async () => {
  await accoda(finta.mail, EDIZIONE, ["a@esempio.it"]);
  const esito = await avvia(finta.mail, "camp-1");
  expect(esito.ok).toBe(true);
  expect(finta.chiamate.avviate).toEqual(["camp-1"]);
});

test("avvia con mail null dà errore esplicito", async () => {
  const esito = await avvia(null, "camp-1");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

test("statoCampagna restituisce i contatori del core", async () => {
  await accoda(finta.mail, EDIZIONE, ["a@esempio.it", "b@esempio.it"]);
  const esito = await statoCampagna(finta.mail, "camp-1");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.dato!.status).toBe("sending");
  expect(esito.dato!.sentCount).toBe(1);
});

test("statoCampagna su campagna inesistente dà null, non un errore", async () => {
  const esito = await statoCampagna(finta.mail, "inesistente");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.dato).toBeNull();
});

test("statoCampagna con mail null dà errore esplicito", async () => {
  const esito = await statoCampagna(null, "camp-1");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

test("prova usa send e non consuma il ref", async () => {
  const esito = await prova(finta.mail, EDIZIONE, "io@esempio.it");
  expect(esito.ok).toBe(true);
  expect(finta.chiamate.inviate[0]!.to).toBe("io@esempio.it");
  expect(finta.chiamate.accodate.length).toBe(0);

  // Ripetibile: il ref resta libero per la campagna vera.
  await prova(finta.mail, EDIZIONE, "io@esempio.it");
  const reale = await accoda(finta.mail, EDIZIONE, ["a@esempio.it"]);
  expect(reale.ok).toBe(true);
});

test("prova segnala l'oggetto come prova, per non confonderla col reale", async () => {
  await prova(finta.mail, EDIZIONE, "io@esempio.it");
  expect(finta.chiamate.inviate[0]!.subject).toContain("PROVA");
  expect(finta.chiamate.inviate[0]!.subject).toContain("Novità di settembre");
});

test("prova con indirizzo vuoto è rifiutata", async () => {
  const esito = await prova(finta.mail, EDIZIONE, "  ");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("indirizzo_non_valido");
});

test("prova con mail null dà errore esplicito", async () => {
  const esito = await prova(null, EDIZIONE, "io@esempio.it");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `rtk bun test tests/campagne.test.ts`
Expected: FAIL con `Cannot find module '../server/campagne'`.

- [ ] **Step 3: Scrivere il modulo**

Create `server/campagne.ts`:

```ts
import type { Edizione } from "./edizioni";

/**
 * Wrapper sul servizio mail del core.
 *
 * Non tocca il DB: riceve l'edizione e la lista dei destinatari già risolta.
 * È questa separazione che permette di testare l'accodamento senza il DB dei
 * contatti, e la risoluzione senza il core.
 *
 * Il ritmo d'invio, i retry sui transitori, la ripresa dopo riavvio e
 * l'idempotenza sono del core: qui non si ricostruisce nulla di tutto ciò.
 */

/** Ciò che il core restituisce su una campagna. Solo i campi che usiamo. */
export type Campagna = {
  id: string;
  ref: string;
  subject: string;
  status: "queued" | "sending" | "paused" | "sent" | "sent_with_errors";
  total: number;
  sentCount: number;
  errorCount: number;
  startedAt: string | null;
  finishedAt: string | null;
};

/**
 * Il sottoinsieme di `MailApi` che serve a questo modulo.
 *
 * `@hub/mail-api` esiste solo quando il plugin gira dentro il core, quindi
 * non è risolvibile da `bun run check` né dai test. Un tipo strutturale
 * risolve entrambi: `MailApi` lo soddisfa, e i test possono passare un finto.
 */
export type MailMinima = {
  send(input: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<{ id: string }>;
  enqueueCampaign(input: {
    ref: string;
    subject: string;
    text?: string;
    html?: string;
    recipients: string[];
  }): Promise<{ id: string }>;
  startCampaign(id: string): Promise<void>;
  getCampaign(idOrRef: string): Promise<Campagna | null>;
};

export type EsitoCampagna<T> =
  | { ok: true; dato: T }
  | { ok: false; errore: string };

/** Vero solo per la violazione di unicità sul `ref` delle campagne. */
function eRefDuplicato(errore: unknown): boolean {
  const messaggio = errore instanceof Error ? errore.message : String(errore);
  return /UNIQUE constraint failed[^]*ref|ref.*(gi[aà] (usato|presente)|duplicat)/i.test(
    messaggio,
  );
}

/**
 * Accoda la campagna nel core. **Non spedisce**: serve `avvia`.
 *
 * Il `ref` è quello dell'edizione, derivato dalla sua identità e mai dal
 * tempo: è ciò che rende sicuro rilanciare l'accodamento.
 */
export async function accoda(
  mail: MailMinima | null,
  edizione: Edizione,
  destinatari: string[],
): Promise<EsitoCampagna<{ id: string }>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  if (destinatari.length === 0) {
    return { ok: false, errore: "nessun_destinatario" };
  }
  try {
    const { id } = await mail.enqueueCampaign({
      ref: edizione.ref,
      subject: edizione.oggetto,
      text: edizione.testo,
      html: edizione.html,
      recipients: destinatari,
    });
    return { ok: true, dato: { id } };
  } catch (e) {
    if (eRefDuplicato(e)) return { ok: false, errore: "ref_gia_usato" };
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `accodamento_fallito: ${messaggio}` };
  }
}

/** Da qui il core comincia a drenare la campagna. */
export async function avvia(
  mail: MailMinima | null,
  campagnaId: string,
): Promise<EsitoCampagna<null>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  try {
    await mail.startCampaign(campagnaId);
    return { ok: true, dato: null };
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `avvio_fallito: ${messaggio}` };
  }
}

/**
 * Lo stato della campagna secondo il core.
 *
 * I contatori si leggono, non si duplicano: `in_invio` e `inviata` non sono
 * verità del plugin.
 */
export async function statoCampagna(
  mail: MailMinima | null,
  idOrRef: string,
): Promise<EsitoCampagna<Campagna | null>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  try {
    return { ok: true, dato: await mail.getCampaign(idOrRef) };
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `lettura_fallita: ${messaggio}` };
  }
}

/**
 * Invio di prova a un solo indirizzo.
 *
 * Usa `send()` e non una campagna: è sincrono, arriva subito e soprattutto
 * **non consuma il `ref`**, quindi si può ripetere quante volte serve prima
 * dell'invio reale.
 */
export async function prova(
  mail: MailMinima | null,
  edizione: Edizione,
  indirizzo: string,
): Promise<EsitoCampagna<{ id: string }>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  const a = indirizzo.trim();
  if (!a) return { ok: false, errore: "indirizzo_non_valido" };
  try {
    const { id } = await mail.send({
      to: a,
      subject: `[PROVA] ${edizione.oggetto}`,
      text: edizione.testo,
      html: edizione.html,
    });
    return { ok: true, dato: { id } };
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `prova_fallita: ${messaggio}` };
  }
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `rtk bun test tests/campagne.test.ts`
Expected: PASS, 13 test.

- [ ] **Step 5: Verificare la suite completa**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi.

- [ ] **Step 6: Commit**

```bash
rtk git add server/campagne.ts tests/campagne.test.ts
rtk git commit -m "feat: wrapper sulle campagne del core

MailMinima è un tipo strutturale: @hub/mail-api esiste solo dentro il core e
non è risolvibile da check e test, mentre MailApi lo soddisfa e i test
possono passare un finto. Il modulo non tocca il DB: riceve la lista già
risolta, così accodamento e risoluzione si testano separatamente.

L'invio di prova usa send() e non consuma il ref: è ripetibile prima
dell'invio reale.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Route `/edizioni` e `deps.mail`

**Files:**
- Modify: `server/routes.ts`
- Test: `tests/routes-edizioni.test.ts`

**Interfaces:**
- Consumes: tutti i moduli dei Task 2-5
- Produces: le otto route sotto `/edizioni`; `createRoutes` accetta `mail?: MailMinima | null`

**Contesto:** `createRoutes` oggi dichiara `deps: { db, slug, projectRoot }` mentre il core passa anche `mail` (`plugin-server.ts:29`). Il campo va aggiunto **opzionale**, altrimenti i test esistenti in `tests/routes.test.ts`, che chiamano `createRoutes({ db, slug, projectRoot })`, smetterebbero di compilare.

Le protezioni stanno nei passi, non in un flag: accodare e avviare restano due route distinte.

- [ ] **Step 1: Scrivere i test delle route**

Create `tests/routes-edizioni.test.ts`:

```ts
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Campagna, MailMinima } from "../server/campagne";
import { creaContatto } from "../server/contatti";
import { leggiEdizione } from "../server/edizioni";
import createRoutes from "../server/routes";
import { creaDbDiTest } from "./helpers";

const TESTO = "Novità.\n\nmailto:redazione@esempio.it?subject=Vorrei%20disiscrivermi";
const HTML = '<p>Novità.</p><p><a href="mailto:redazione@esempio.it">Esci</a></p>';

let db: Database;
let dir: string;
let app: ReturnType<typeof createRoutes>;
let avviate: string[];

function fintaMail(): MailMinima {
  return {
    async send() {
      return { id: "mail-1" };
    },
    async enqueueCampaign() {
      return { id: "camp-1" };
    },
    async startCampaign(id) {
      avviate.push(id);
    },
    async getCampaign() {
      return {
        id: "camp-1",
        ref: "newsletter-2026-09",
        subject: "Novità",
        status: "sending",
        total: 1,
        sentCount: 1,
        errorCount: 0,
        startedAt: "2026-09-15T10:00:00Z",
        finishedAt: null,
      } satisfies Campagna;
    },
  };
}

beforeEach(() => {
  db = creaDbDiTest();
  dir = mkdtempSync(join(tmpdir(), "route-ediz-"));
  writeFileSync(join(dir, "n.txt"), TESTO);
  writeFileSync(join(dir, "n.html"), HTML);
  avviate = [];
  app = createRoutes({
    db,
    slug: "fboschetti-newsletter",
    projectRoot: ".",
    mail: fintaMail(),
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function ingesta(ref = "newsletter-2026-09") {
  const res = await app.request("/edizioni", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ percorso: dir, ref, oggetto: "Novità" }),
  });
  return { res, corpo: await res.json() };
}

describe("POST /edizioni", () => {
  test("ingesta la coppia e restituisce il ref normalizzato", async () => {
    const { res, corpo } = await ingesta("  Newsletter 2026-09 ");
    expect(res.status).toBe(201);
    expect(corpo.ref).toBe("newsletter-2026-09");
    expect(corpo.avvisoMailto).toBeNull();
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("bozza");
  });

  test("percorso mancante è 400", async () => {
    const res = await app.request("/edizioni", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "r1", oggetto: "O" }),
    });
    expect(res.status).toBe(400);
  });

  test("un ref già usato è 409", async () => {
    await ingesta();
    const { res, corpo } = await ingesta();
    expect(res.status).toBe(409);
    expect(corpo.errore).toBe("ref_gia_presente");
  });
});

describe("GET /edizioni", () => {
  test("elenca le edizioni senza i corpi", async () => {
    await ingesta();
    const res = await app.request("/edizioni");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.totale).toBe(1);
    expect(corpo.righe[0].ref).toBe("newsletter-2026-09");
    expect(corpo.righe[0].testo).toBeUndefined();
  });
});

describe("GET /edizioni/:id", () => {
  test("il dettaglio include i corpi", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}`);
    const dettaglio = await res.json();
    expect(dettaglio.testo).toBe(TESTO);
    expect(dettaglio.html).toBe(HTML);
  });

  test("id inesistente è 404", async () => {
    expect((await app.request("/edizioni/999")).status).toBe(404);
  });
});

describe("GET /edizioni/:id/destinatari", () => {
  test("mostra quanti e quali prima di accodare", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    creaContatto(db, { email: "b@esempio.it" });
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/destinatari`);
    const d = await res.json();
    expect(d.totale).toBe(2);
    expect(d.righe).toEqual(["a@esempio.it", "b@esempio.it"]);
  });
});

describe("POST /edizioni/:id/accoda", () => {
  test("accoda e porta l'edizione a pronta, senza avviare", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const e = leggiEdizione(db, corpo.id)!;
    expect(e.stato).toBe("pronta");
    expect(e.campagnaId).toBe("camp-1");
    expect(e.destinatariN).toBe(1);
    expect(avviate).toEqual([]);
  });

  test("senza destinatari è 400 e l'edizione resta in bozza", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("bozza");
  });

  test("accodare due volte è rifiutato dalla macchina a stati", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    const body = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };
    await app.request(`/edizioni/${corpo.id}/accoda`, body);
    const res = await app.request(`/edizioni/${corpo.id}/accoda`, body);
    expect(res.status).toBe(409);
  });
});

describe("POST /edizioni/:id/avvia", () => {
  test("avvia solo un'edizione già accodata", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    const body = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };
    await app.request(`/edizioni/${corpo.id}/accoda`, body);
    const res = await app.request(`/edizioni/${corpo.id}/avvia`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(avviate).toEqual(["camp-1"]);
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("in_invio");
  });

  test("avviare un'edizione in bozza è 409", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/avvia`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect(avviate).toEqual([]);
  });
});

describe("POST /edizioni/:id/prova", () => {
  test("manda la prova e non tocca lo stato", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/prova`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: "io@esempio.it" }),
    });
    expect(res.status).toBe(200);
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("bozza");
  });

  test("indirizzo mancante è 400", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/prova`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /edizioni/:id/stato", () => {
  test("rispecchia i contatori del core", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    await app.request(`/edizioni/${corpo.id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await app.request(`/edizioni/${corpo.id}/stato`);
    const stato = await res.json();
    expect(stato.status).toBe("sending");
    expect(stato.sentCount).toBe(1);
  });

  test("un'edizione mai accodata non ha stato nel core", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/stato`);
    expect(res.status).toBe(409);
  });
});

describe("senza deps.mail", () => {
  test("le route che spediscono rispondono 503, l'ingestione no", async () => {
    const senza = createRoutes({
      db,
      slug: "fboschetti-newsletter",
      projectRoot: ".",
      mail: null,
    });
    const res = await senza.request("/edizioni", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ percorso: dir, ref: "r1", oggetto: "O" }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    creaContatto(db, { email: "a@esempio.it" });
    const accoda = await senza.request(`/edizioni/${id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(accoda.status).toBe(503);
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `rtk bun test tests/routes-edizioni.test.ts`
Expected: FAIL — le route `/edizioni` non esistono ancora (404 invece degli stati attesi).

- [ ] **Step 3: Estendere il tipo `deps` in `server/routes.ts`**

In `server/routes.ts`, aggiungere gli import in cima al file, dopo quelli esistenti:

```ts
import { accoda, avvia, prova, statoCampagna, type MailMinima } from "./campagne";
import { risolviDestinatari } from "./destinatari";
import {
  avanzaStato,
  elencaEdizioni,
  leggiEdizione,
  type Stato,
} from "./edizioni";
import { ingestaDaPercorso } from "./ingestione";
```

Poi sostituire la firma di `createRoutes`:

```ts
export default function createRoutes(deps: {
  db: Database;
  slug: string;
  projectRoot: string;
  // Opzionale: il core la passa sempre, i test delle route dei contatti no.
  // `null` significa core non disponibile, e le route che spediscono lo dicono.
  mail?: MailMinima | null;
}) {
```

- [ ] **Step 4: Aggiungere le route `/edizioni`**

In `server/routes.ts`, subito prima di `return r;`, inserire:

```ts
  /**
   * Edizioni: ingestione, anteprima, prova, accodamento, avvio, stato.
   *
   * Accodare e avviare restano due route distinte perché è la semantica del
   * core: fra l'una e l'altra la campagna è ferma in `queued` e non parte
   * nulla. Fonderle in una toglierebbe l'unico momento in cui ci si può
   * fermare.
   */

  const mail = deps.mail ?? null;

  /** L'edizione o la risposta d'errore già pronta. */
  function edizioneDaParam(c: { req: { param: (k: string) => string } }) {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return null;
    return leggiEdizione(db, id);
  }

  r.get("/edizioni", (c) => {
    const stato = c.req.query("stato");
    const filtri = stato ? { stato: stato as Stato } : {};
    const { righe, totale } = elencaEdizioni(db, filtri);
    // I corpi non servono all'elenco e sono grandi: si mandano nel dettaglio.
    const leggere = righe.map(({ testo, html, ...resto }) => resto);
    return c.json({ righe: leggere, totale });
  });

  r.post("/edizioni", async (c) => {
    const body: { percorso?: string; ref?: string; oggetto?: string } =
      await c.req.json().catch(() => ({}));
    if (!body.percorso?.trim()) return c.json({ errore: "percorso_mancante" }, 400);
    if (!body.ref?.trim()) return c.json({ errore: "ref_mancante" }, 400);
    if (!body.oggetto?.trim()) return c.json({ errore: "oggetto_mancante" }, 400);

    const esito = ingestaDaPercorso(db, {
      percorso: body.percorso,
      ref: body.ref,
      oggetto: body.oggetto,
    });
    if (!esito.ok) {
      const stato = esito.errore === "ref_gia_presente" ? 409 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    return c.json(
      { id: esito.id, ref: esito.ref, avvisoMailto: esito.avvisoMailto },
      201,
    );
  });

  r.get("/edizioni/:id", (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    return c.json(edizione);
  });

  r.get("/edizioni/:id/destinatari", (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    const tag = c.req.query("tag");
    const righe = risolviDestinatari(db, tag ? { tag } : {});
    return c.json({ righe, totale: righe.length });
  });

  r.post("/edizioni/:id/prova", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    const body: { a?: string } = await c.req.json().catch(() => ({}));
    // `prova` controlla di nuovo e direbbe `indirizzo_non_valido`: qui il
    // codice è più preciso perché distingue "non l'hai passato" da "non è
    // utilizzabile". Il doppio controllo è voluto: il modulo resta valido
    // anche se chiamato da altrove.
    if (!body.a?.trim()) return c.json({ errore: "indirizzo_mancante" }, 400);

    const esito = await prova(mail, edizione, body.a);
    if (!esito.ok) {
      const stato = esito.errore === "mail_non_disponibile" ? 503 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    return c.json({ ok: true, id: esito.dato.id });
  });

  r.post("/edizioni/:id/accoda", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    if (edizione.stato !== "bozza") {
      return c.json({ errore: "stato_non_accodabile", stato: edizione.stato }, 409);
    }
    const body: { tag?: string } = await c.req.json().catch(() => ({}));
    const tag = body.tag?.trim() || null;

    const destinatari = risolviDestinatari(db, tag ? { tag } : {});
    const esito = await accoda(mail, edizione, destinatari);
    if (!esito.ok) {
      const stato =
        esito.errore === "mail_non_disponibile"
          ? 503
          : esito.errore === "ref_gia_usato"
            ? 409
            : 400;
      return c.json({ errore: esito.errore }, stato);
    }

    avanzaStato(db, edizione.id, "pronta", {
      campagnaId: esito.dato.id,
      filtroTag: tag,
      destinatariN: destinatari.length,
    });
    return c.json({
      ok: true,
      campagnaId: esito.dato.id,
      destinatari: destinatari.length,
    });
  });

  r.post("/edizioni/:id/avvia", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    if (edizione.stato !== "pronta" || !edizione.campagnaId) {
      return c.json({ errore: "stato_non_avviabile", stato: edizione.stato }, 409);
    }

    const esito = await avvia(mail, edizione.campagnaId);
    if (!esito.ok) {
      const stato = esito.errore === "mail_non_disponibile" ? 503 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    avanzaStato(db, edizione.id, "in_invio");
    return c.json({ ok: true });
  });

  r.get("/edizioni/:id/stato", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    if (!edizione.campagnaId) {
      return c.json({ errore: "mai_accodata", stato: edizione.stato }, 409);
    }

    const esito = await statoCampagna(mail, edizione.campagnaId);
    if (!esito.ok) {
      const stato = esito.errore === "mail_non_disponibile" ? 503 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    if (!esito.dato) return c.json({ errore: "campagna_non_trovata" }, 404);

    // Il core è la verità: se ha finito, l'edizione lo rispecchia.
    const finita = esito.dato.status === "sent" || esito.dato.status === "sent_with_errors";
    if (finita && edizione.stato === "in_invio") {
      avanzaStato(db, edizione.id, "inviata");
    }
    return c.json(esito.dato);
  });
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `rtk bun test tests/routes-edizioni.test.ts`
Expected: PASS.

Se `edizioneDaParam` dà problemi di tipo con Hono, sostituisci la firma con `(c: Context)` importando `import type { Context } from "hono"`.

- [ ] **Step 6: Verificare che i test delle route esistenti non si siano rotti**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi. `tests/routes.test.ts` chiama `createRoutes` senza `mail`: funziona perché il campo è opzionale.

- [ ] **Step 7: Commit**

```bash
rtk git add server/routes.ts tests/routes-edizioni.test.ts
rtk git commit -m "feat: route delle edizioni e accesso a deps.mail

Accodare e avviare restano due route distinte: è la semantica del core, e
fra l'una e l'altra la campagna è ferma in queued. Fonderle toglierebbe
l'unico momento in cui ci si può fermare.

deps.mail è opzionale nel tipo perché i test delle route dei contatti non lo
passano; null significa core non disponibile e le route che spediscono
rispondono 503 invece di fallire in silenzio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Pagina UI `web/pages/edizioni.tsx`

**Files:**
- Create: `web/pages/edizioni.tsx`

**Interfaces:**
- Consumes: le route del Task 6
- Produces: pagina nella sidebar dell'hub

**Contesto — leggere prima di scrivere:** `web/` è **fuori** dall'`include` di `tsconfig.json`, quindi `bun run check` non vede questo file e l'alias `@/*` non risolve qui. La verifica si fa con `bun run plugin install` dalla root del core, riavviando server e Vite.

Valgono le regole UI di `AGENTS.md`: componenti shadcn/ui del core, `Header` e `Main`, token di tema, **niente valori arbitrari** tipo `bg-[#327aed]` (`plugins/*` è fuori dal purge Tailwind del core: quelle classi non verrebbero generate). `web/pages/index.tsx` è il modello.

- [ ] **Step 1: Rileggere il modello**

Run: `rtk sed -n '1,60p' web/pages/index.tsx`

Osservare: blocco `meta`, costante `API`, import dei componenti del core, uso di `Header`/`Main`.

- [ ] **Step 2: Scrivere la pagina**

Create `web/pages/edizioni.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const meta = {
  title: "Edizioni",
  icon: "rocket",
  sidebar: true,
  order: 110,
};

const API = "/api/plugins/fboschetti-newsletter";

type Stato = "bozza" | "pronta" | "in_invio" | "inviata";

type Edizione = {
  id: number;
  ref: string;
  oggetto: string;
  stato: Stato;
  campagnaId: string | null;
  avvisoMailto: string | null;
  filtroTag: string | null;
  destinatariN: number | null;
  creatoIl: number;
};

type StatoCampagna = {
  status: string;
  total: number;
  sentCount: number;
  errorCount: number;
};

const ETICHETTA: Record<Stato, string> = {
  bozza: "Bozza",
  pronta: "Accodata",
  in_invio: "In invio",
  inviata: "Inviata",
};

export default function PaginaEdizioni() {
  const [righe, setRighe] = useState<Edizione[]>([]);
  const [percorso, setPercorso] = useState("");
  const [ref, setRef] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [indirizzoProva, setIndirizzoProva] = useState("");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [stati, setStati] = useState<Record<number, StatoCampagna>>({});

  async function carica() {
    const res = await fetch(`${API}/edizioni`);
    const corpo = await res.json();
    setRighe(corpo.righe ?? []);
  }

  useEffect(() => {
    void carica();
  }, []);

  /** Centralizza l'esito: ogni azione o dice cosa ha fatto, o perché no. */
  async function agisci(
    url: string,
    opzioni: RequestInit,
    successo: (corpo: Record<string, unknown>) => string,
  ) {
    setMessaggio(null);
    setErrore(null);
    const res = await fetch(url, opzioni);
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrore(String(corpo.errore ?? `errore ${res.status}`));
      return false;
    }
    setMessaggio(successo(corpo));
    await carica();
    return true;
  }

  async function ingesta(e: React.FormEvent) {
    e.preventDefault();
    await agisci(
      `${API}/edizioni`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ percorso, ref, oggetto }),
      },
      (corpo) =>
        `Edizione creata con ref "${corpo.ref}".` +
        (corpo.avvisoMailto ? ` Attenzione: ${corpo.avvisoMailto}` : ""),
    );
  }

  async function anteprima(id: number) {
    setMessaggio(null);
    setErrore(null);
    const res = await fetch(`${API}/edizioni/${id}/destinatari`);
    const corpo = await res.json();
    setMessaggio(`${corpo.totale} destinatari risolti.`);
  }

  async function mandaProva(id: number) {
    if (!indirizzoProva.trim()) {
      setErrore("Indica un indirizzo per la prova.");
      return;
    }
    await agisci(
      `${API}/edizioni/${id}/prova`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: indirizzoProva }),
      },
      () => `Prova inviata a ${indirizzoProva}.`,
    );
  }

  async function accoda(id: number) {
    await agisci(
      `${API}/edizioni/${id}/accoda`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      (corpo) =>
        `Campagna accodata per ${corpo.destinatari} destinatari. ` +
        `Nessuna mail è ancora partita: serve avviarla.`,
    );
  }

  async function avvia(id: number) {
    await agisci(`${API}/edizioni/${id}/avvia`, { method: "POST" }, () =>
      "Campagna avviata: il core la sta drenando.",
    );
  }

  async function aggiornaStato(id: number) {
    const res = await fetch(`${API}/edizioni/${id}/stato`);
    const corpo = await res.json();
    if (!res.ok) {
      setErrore(String(corpo.errore ?? `errore ${res.status}`));
      return;
    }
    setStati((s) => ({ ...s, [id]: corpo as StatoCampagna }));
    await carica();
  }

  return (
    <>
      <Header />
      <Main>
        <div className="space-y-4 p-4">
          <div>
            <h1 className="text-2xl font-semibold">Edizioni</h1>
            <p className="text-muted-foreground text-sm">
              Importa una coppia .txt + .html e mandala ai contatti iscritti.
            </p>
          </div>

          {messaggio && (
            <Alert>
              <AlertTitle>Fatto</AlertTitle>
              <AlertDescription>{messaggio}</AlertDescription>
            </Alert>
          )}
          {errore && (
            <Alert variant="destructive">
              <AlertTitle>Non è andata</AlertTitle>
              <AlertDescription>{errore}</AlertDescription>
            </Alert>
          )}

          <Card className="p-4">
            <form onSubmit={ingesta} className="space-y-3">
              <h2 className="font-medium">Nuova edizione</h2>
              <Input
                placeholder="Percorso della cartella o di uno dei due file"
                value={percorso}
                onChange={(e) => setPercorso(e.target.value)}
              />
              <Input
                placeholder="Oggetto della mail"
                value={oggetto}
                onChange={(e) => setOggetto(e.target.value)}
              />
              <Input
                placeholder="Riferimento, es. newsletter-2026-09"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Il riferimento viene normalizzato in minuscole e trattini, e
                protegge dal doppio invio: non può essere riusato.
              </p>
              <Button type="submit">Importa</Button>
            </form>
          </Card>

          <Card className="p-4">
            <div className="space-y-3">
              <h2 className="font-medium">Invio di prova</h2>
              <Input
                placeholder="Il tuo indirizzo, per la prova"
                value={indirizzoProva}
                onChange={(e) => setIndirizzoProva(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                La prova non consuma il riferimento: si può ripetere.
              </p>
            </div>
          </Card>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Riferimento</TableHead>
                  <TableHead>Oggetto</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Destinatari</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {righe.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-[16rem] truncate font-mono text-xs">
                      {e.ref}
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate">
                      {e.oggetto}
                      {e.avvisoMailto && (
                        <span className="text-muted-foreground block text-xs">
                          {e.avvisoMailto}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ETICHETTA[e.stato]}</Badge>
                    </TableCell>
                    <TableCell>
                      {stati[e.id]
                        ? `${stati[e.id]!.sentCount}/${stati[e.id]!.total}`
                        : (e.destinatariN ?? "—")}
                    </TableCell>
                    <TableCell className="space-x-2">
                      {e.stato === "bozza" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => anteprima(e.id)}
                          >
                            Destinatari
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => mandaProva(e.id)}
                          >
                            Prova
                          </Button>
                          <Button size="sm" onClick={() => accoda(e.id)}>
                            Accoda
                          </Button>
                        </>
                      )}
                      {e.stato === "pronta" && (
                        <Button size="sm" onClick={() => avvia(e.id)}>
                          Avvia invio
                        </Button>
                      )}
                      {(e.stato === "in_invio" || e.stato === "inviata") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => aggiornaStato(e.id)}
                        >
                          Aggiorna stato
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {righe.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-muted-foreground py-6 text-center"
                    >
                      Nessuna edizione. Importane una qui sopra.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Main>
    </>
  );
}
```

- [ ] **Step 3: Verificare che i test non si siano rotti**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi. `web/` è fuori dall'`include`, quindi `check` non guarda questo file.

- [ ] **Step 4: Verificare la pagina nell'hub**

Dalla root del core (`/Users/fboschetti/Repo/agentic-hub/agentic-hub-core`):

```bash
rtk bun run plugin install /Users/fboschetti/Repo/fboschetti/fboschetti-newsletter-ahub
rtk bun run plugin list
```

Poi riavviare server e Vite, e aprire la pagina "Edizioni" nella sidebar.

Controllare: la pagina si apre senza errori in console, i componenti hanno lo stile dell'hub (se appaiono senza stile, c'è un valore Tailwind arbitrario da togliere), il layout regge a larghezza ridotta.

**Se l'installazione o il riavvio non sono possibili in questa sessione**, annotarlo nel commit e segnalarlo: la verifica UI resta in sospeso, i test automatici non la coprono.

- [ ] **Step 5: Commit**

```bash
rtk git add web/pages/edizioni.tsx
rtk git commit -m "feat: pagina edizioni

La UI rispecchia la macchina a stati: ogni edizione mostra solo le azioni
possibili nel suo stato. Accoda e Avvia sono due bottoni distinti, e
l'accodamento dice esplicitamente che nessuna mail è ancora partita.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Documentazione e chiusura

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: tutto il lavoro dei Task 1-7
- Produces: documentazione allineata

**Contesto:** `AGENTS.md` dice oggi «Email e campagne — **Non ancora implementate**: oggi il plugin non chiama né `mail.send` né le campagne». Dopo questo lavoro è falso, e un agente che lo legge verrebbe sviato.

- [ ] **Step 1: Aggiornare la sezione email di `AGENTS.md`**

In `AGENTS.md`, sostituire l'intera sezione `## Email e campagne` con:

```markdown
## Email e campagne

Implementate dalla Fase 1.5. Le route sotto `/edizioni` accodano e avviano le
campagne via `deps.mail`; `server/campagne.ts` è l'unico punto che parla col
servizio mail del core.

Tre cose da sapere prima di toccarle:

Accodare **non** spedisce: `POST /edizioni/:id/accoda` crea la campagna ferma
in `queued`, e solo `POST /edizioni/:id/avvia` la fa partire. Le due azioni
restano separate di proposito.

Il `ref` della campagna è univoco per plugin ed è la protezione contro il
doppio invio: lo scrive l'utente, `normalizzaRef` lo riduce a `[a-z0-9-]`, e
non deriva **mai** da `Date.now()`.

`deps.mail` può essere `null`: le route che spediscono rispondono 503, mai in
silenzio. Il tipo usato è `MailMinima` in `server/campagne.ts`, strutturale,
perché `@hub/mail-api` non è risolvibile fuori dal core.

Dettagli, stati e ripresa dopo riavvio in `email-e-campagne.md`.
```

- [ ] **Step 2: Aggiungere le nuove tabelle alla sezione struttura**

In `AGENTS.md`, nella sezione `## Regole`, aggiungere in fondo all'elenco:

```markdown
- I corpi `testo` e `html` di un'edizione non si modificano mai: partono byte
  per byte come sono stati consegnati. Il blocco di disiscrizione lo scrive
  l'agente dei contenuti; il plugin verifica che ci sia e avvisa, non lo
  aggiunge.
```

- [ ] **Step 3: Segnare la Fase 1.5 come completata nella roadmap**

In `docs/ROADMAP.md`, sostituire l'intestazione della fase:

```markdown
## Fase 1.5 — Campagna diretta nel Core (Invio e Outreach anticipato) ✅ (Completata)

**Stato**: completata (2026-09-15)
```

e aggiungere in fondo alla sezione, prima di `---`:

```markdown
Spec: [superpowers/specs/2026-09-15-fase-1-5-campagna-diretta-design.md](superpowers/specs/2026-09-15-fase-1-5-campagna-diretta-design.md).
Piano: [superpowers/plans/2026-09-15-fase-1-5-campagna-diretta.md](superpowers/plans/2026-09-15-fase-1-5-campagna-diretta.md).

**Cosa lascia alle fasi successive**: la tabella `edizioni` con la macchina a
stati, `server/destinatari.ts` e `server/campagne.ts` riusabili così come
sono. Le Fasi 2 e 3 inseriscono `validata_tech` e `validata_semantica` fra
`bozza` e `pronta`, senza rifare il percorso.

**Una divergenza consapevole**: qui `pronta` significa «accodata nel core, in
attesa di avvio», non «validata e accodabile» come nella roadmap originale.
Senza validazioni uno stato intermedio sarebbe irraggiungibile. Le Fasi 2 e 3
rimetteranno le cose a posto.

**Nota sulla disiscrizione**: il link con token per destinatario richiede che
il core supporti dati variabili per destinatario, cosa che oggi non fa
(`mail-worker.ts` usa i corpi della campagna per tutti). Finché non c'è, la
disiscrizione passa da un `mailto:` con oggetto precompilato, scritto
dall'agente dei contenuti.
```

- [ ] **Step 4: Verificare tutto un'ultima volta**

Run: `rtk bun test tests/` e `rtk bun run check`
Expected: PASS entrambi. Riportare il numero di test eseguiti.

- [ ] **Step 5: Commit**

```bash
rtk git add AGENTS.md docs/ROADMAP.md
rtk git commit -m "docs: allinea AGENTS.md e roadmap alla Fase 1.5

AGENTS.md dichiarava le campagne non implementate: dopo questo lavoro è
falso e svierebbe chi lo legge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Riepilogo finale**

Riportare a Francesco:
- Numero di test e loro esito.
- Se la verifica UI nell'hub è stata fatta o è rimasta in sospeso.
- Qualunque scostamento dal piano, con il motivo.

**Non** fare merge su `main` e **non** aprire una PR senza che Francesco lo chieda.

---

## Note per chi esegue

**Ordine**: i task vanno in sequenza. I task 3 e 4 dipendono solo dal 2 e sono indipendenti fra loro.

**Se un test fallisce in modo inatteso**: usare `superpowers:systematic-debugging` prima di cambiare il codice a tentativi. Un test che fallisce sta dicendo qualcosa.

**Se il piano è sbagliato**: il piano può contenere errori. Se un'interfaccia non torna o un test rivela che il design non regge, fermarsi e segnalarlo invece di forzare il codice perché assomigli al piano.

**Cosa non fare mai**, nemmeno per far passare un test:
- Mandare mail vere: tutti i test usano il finto `MailApi`.
- Usare `Date.now()` nel `ref`.
- Modificare i corpi `testo` e `html`.
- Aprire il DB del core.
- Committare indirizzi email reali.
