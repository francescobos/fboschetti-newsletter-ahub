# Fase 1 — Lista contatti: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare al plugin un'anagrafica di contatti e aziende che si popola da CSV in modo idempotente, si cura dalla UI, e non riattiva mai chi si è disiscritto.

**Architecture:** Tre strati. I moduli in `server/` contengono la logica e ricevono un `Database` come parametro, senza mai importare `@hub/*`: è ciò che li rende testabili con `bun test tests/` senza il core installato. Sopra di essi due chiamanti — le route Hono (che ricevono `deps.db` già aperto) e uno script CLI (che apre il DB da sé via `openPluginDb`). La pagina React consuma solo le route, mai il DB.

**Tech Stack:** Bun, TypeScript strict, `bun:sqlite`, Hono, React 19, Tailwind con i token del core, `bun:test`.

**Spec:** [docs/superpowers/specs/2026-09-12-fase-1-lista-contatti-design.md](../specs/2026-09-12-fase-1-lista-contatti-design.md)

## Global Constraints

Questi vincoli valgono per **ogni** task. Violarli rompe il plugin in modi che i test non sempre intercettano.

- **Sotto il wiring non si importa `@hub/*`.** Solo `scripts/import-contatti.ts` può farlo. I moduli in `server/` ricevono `Database` come parametro.
- **Non riaprire il DB in `server/routes.ts`**: arriva già aperto e migrato in `deps.db`.
- **Non toccare `migrations/20260909_000000_init.sql`**: può essere già applicata in istanze esistenti. Le migration si applicano in ordine lessicografico.
- **Le email si normalizzano sempre a minuscolo e trimmate** prima di qualunque scrittura o confronto.
- **L'import non scrive mai `iscritto = 1` su un contatto che esiste già.** È la regola centrale della fase.
- **Nessuna rotta `DELETE /contatti/:id`.** Cancellare un disiscritto lo espone al reimport.
- **Icone**: solo `activity bot mail rocket terminal wrench zap`. Altri nomi fanno fallback silenzioso a `terminal`.
- **Niente classi Tailwind con valori arbitrari** (`bg-[#327aed]`): le directory `plugins/*` sono escluse dal purge del core e non verrebbero compilate. Usare i token (`bg-background`, `text-muted-foreground`, `border-border`, `bg-muted/30`).
- **TypeScript strict**: `bun run check` deve passare a ogni commit.
- Messaggi di commit in italiano, corpo che spiega il perché. Chiudere con:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## Struttura dei file

| File | Responsabilità |
| :--- | :--- |
| `migrations/20260912_000000_contatti.sql` | Crea le sei tabelle e gli indici, elimina `righe` |
| `server/csv.ts` | Parsing CSV e validazione: funzioni pure, non tocca il DB |
| `server/contatti.ts` | CRUD contatti, aziende, tag, disiscrizione, riscrizione |
| `server/import.ts` | Idempotenza, unione tag, risoluzione azienda, rapporto |
| `server/routes.ts` | Route Hono (modifica: oggi è la demo dello scaffold) |
| `scripts/import-contatti.ts` | Wiring CLI: apre il DB via `openPluginDb`, stampa il rapporto |
| `web/pages/index.tsx` | Pagina contatti (modifica: oggi è la demo) |
| `tests/csv.test.ts` | Parsing e validazione |
| `tests/contatti.test.ts` | CRUD, disiscrizione, riscrizione, cascade |
| `tests/import.test.ts` | Idempotenza, tag, aziende, dry-run |
| `tests/helpers.ts` | `creaDbDiTest()` condiviso |

`server/service.ts` e `tests/fboschetti-newsletter.test.ts` sono la demo dello scaffold: si eliminano nel Task 1.

---

## Task 1: Migration e pulizia dello scaffold

**Files:**
- Create: `migrations/20260912_000000_contatti.sql`
- Create: `tests/helpers.ts`
- Delete: `server/service.ts`, `tests/fboschetti-newsletter.test.ts`
- Modify: `server/routes.ts` (rimuovere le route demo)

**Interfaces:**
- Consumes: niente, è il primo task.
- Produces: `creaDbDiTest(): Database` in `tests/helpers.ts` — un DB in memoria con lo schema applicato e `PRAGMA foreign_keys = ON`. Tutti i task successivi lo usano.

- [ ] **Step 1: Scrivere la migration**

Creare `migrations/20260912_000000_contatti.sql`:

```sql
DROP TABLE IF EXISTS righe;

CREATE TABLE aziende (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  settore       TEXT,
  sito          TEXT,
  indirizzo_raw TEXT,
  via           TEXT,
  comune        TEXT,
  provincia     TEXT,
  regione       TEXT,
  cap           TEXT,
  lat           REAL,
  lon           REAL,
  note          TEXT,
  creato_il     INTEGER NOT NULL,
  aggiornato_il INTEGER NOT NULL
);

CREATE TABLE contatti (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome            TEXT,
  cognome         TEXT,
  azienda_id      INTEGER REFERENCES aziende(id) ON DELETE SET NULL,
  ruolo           TEXT,
  indirizzo_raw   TEXT,
  via             TEXT,
  comune          TEXT,
  provincia       TEXT,
  regione         TEXT,
  cap             TEXT,
  lat             REAL,
  lon             REAL,
  iscritto        INTEGER NOT NULL DEFAULT 1,
  stato_tecnico   TEXT NOT NULL DEFAULT 'mai_verificato'
                  CHECK (stato_tecnico IN
                    ('mai_verificato','valido','rimbalzato','sospeso')),
  provenienza     TEXT,
  creato_il       INTEGER NOT NULL,
  aggiornato_il   INTEGER NOT NULL,
  disiscritto_il  INTEGER,
  disiscritto_via TEXT CHECK (disiscritto_via IS NULL OR disiscritto_via IN
                    ('telefono','email','manuale','ponte'))
);

CREATE TABLE tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE contatti_tag (
  contatto_id INTEGER NOT NULL REFERENCES contatti(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tag(id)      ON DELETE CASCADE,
  PRIMARY KEY (contatto_id, tag_id)
);

CREATE TABLE import_csv (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  eseguito_il INTEGER NOT NULL,
  origine     TEXT    NOT NULL,
  righe_lette INTEGER NOT NULL,
  creati      INTEGER NOT NULL,
  aggiornati  INTEGER NOT NULL,
  rapporto    TEXT    NOT NULL
);

CREATE INDEX idx_contatti_azienda   ON contatti(azienda_id);
CREATE INDEX idx_contatti_iscritto  ON contatti(iscritto);
CREATE INDEX idx_contatti_comune    ON contatti(comune);
CREATE INDEX idx_contatti_provincia ON contatti(provincia);
CREATE INDEX idx_aziende_provincia  ON aziende(provincia);
```

- [ ] **Step 2: Scrivere l'helper di test**

Creare `tests/helpers.ts`. Legge la migration dal file vero: così i test falliscono se lo schema diverge, invece di testare una copia che nessuno aggiorna.

```ts
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
```

- [ ] **Step 3: Verificare che l'helper funzioni**

Creare un test temporaneo `tests/schema.test.ts`:

```ts
import { expect, test } from "bun:test";
import { creaDbDiTest } from "./helpers";

test("lo schema si applica e le tabelle esistono", () => {
  const db = creaDbDiTest();
  const nomi = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const trovate = nomi.map((r) => r.name);
  expect(trovate).toContain("contatti");
  expect(trovate).toContain("aziende");
  expect(trovate).toContain("tag");
  expect(trovate).toContain("contatti_tag");
  expect(trovate).toContain("import_csv");
  expect(trovate).not.toContain("righe");
});

test("le foreign key sono attive sulla connessione", () => {
  const db = creaDbDiTest();
  const r = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(r.foreign_keys).toBe(1);
});
```

Run: `bun test tests/schema.test.ts`
Expected: PASS, entrambi.

- [ ] **Step 4: Eliminare la demo dello scaffold**

```bash
rm server/service.ts tests/fboschetti-newsletter.test.ts
```

Sostituire il contenuto di `server/routes.ts` con la versione minima (le route vere arrivano nel Task 6):

```ts
import type { Database } from "bun:sqlite";
import { Hono } from "hono";

export default function createRoutes(deps: {
  db: Database;
  slug: string;
  projectRoot: string;
}) {
  const r = new Hono();
  r.get("/stato", (c) => c.json({ slug: deps.slug }));
  return r;
}
```

- [ ] **Step 5: Verificare che tutto passi**

Run: `bun test tests/ && bun run check`
Expected: i test di `schema.test.ts` passano, `tsc` non riporta errori.

- [ ] **Step 6: Commit**

```bash
git add migrations/ tests/ server/routes.ts
git rm --cached server/service.ts 2>/dev/null; true
git commit -m "$(cat <<'EOF'
feat: schema di contatti, aziende e tag

Sei tabelle nuove e la rimozione di `righe`, la tabella demo dello
scaffold. La migration è un file nuovo e non tocca la init esistente,
che potrebbe essere già applicata in istanze installate.

L'helper di test legge la migration dal file vero invece di ricopiarne
lo schema: così un divergere fra i due fa fallire i test, che è il solo
modo perché qualcuno se ne accorga.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Parser CSV

**Files:**
- Create: `server/csv.ts`
- Create: `tests/csv.test.ts`
- Delete: `tests/schema.test.ts` (era temporaneo, il Task 3 copre lo schema)

**Interfaces:**
- Consumes: niente.
- Produces:

```ts
export type RigaCsv = {
  email: string;          // già normalizzata: trim + minuscolo
  nome?: string;
  cognome?: string;
  azienda?: string;
  ruolo?: string;
  tag: string[];          // sempre presente, eventualmente vuoto
  provenienza?: string;
  indirizzoRaw?: string;
};

export type EsitoCsv =
  | { ok: true; righe: RigaCsv[] }
  | { ok: false; errore: string };

export function parseCsv(testo: string): EsitoCsv;
export function normalizzaEmail(valore: string): string;
export function emailValida(valore: string): boolean;
```

**Nota per chi implementa:** non esiste un parser CSV fra le dipendenze e non va aggiunto. Va scritto a mano, e **deve gestire le virgolette**: i tag arrivano come `"villaggi,pilota"` in un solo campo. Uno `split(",")` ingenuo li spezzerebbe in due colonne e sfaserebbe tutta la riga. È l'errore più probabile di questo task.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `tests/csv.test.ts`:

```ts
import { expect, test } from "bun:test";
import { emailValida, normalizzaEmail, parseCsv } from "../server/csv";

const INTESTAZIONE =
  "email,nome,cognome,azienda,ruolo,tag,provenienza,indirizzo_raw";

test("legge una riga completa", () => {
  const esito = parseCsv(
    `${INTESTAZIONE}\nmario@esempio.it,Mario,Rossi,Villaggio Sole,Direttore,"villaggi,pilota",export-2026,"Via Roma 1, Budrio (BO)"`,
  );
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  const r = esito.righe[0]!;
  expect(r.email).toBe("mario@esempio.it");
  expect(r.nome).toBe("Mario");
  expect(r.cognome).toBe("Rossi");
  expect(r.azienda).toBe("Villaggio Sole");
  expect(r.ruolo).toBe("Direttore");
  expect(r.tag).toEqual(["villaggi", "pilota"]);
  expect(r.provenienza).toBe("export-2026");
  expect(r.indirizzoRaw).toBe("Via Roma 1, Budrio (BO)");
});

test("i campi fra virgolette conservano le virgole", () => {
  const esito = parseCsv(
    `email,tag\nmario@esempio.it,"villaggi,pilota,nord"`,
  );
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.tag).toEqual(["villaggi", "pilota", "nord"]);
});

test("le virgolette doppie interne si riducono a una", () => {
  const esito = parseCsv(`email,nome\nmario@esempio.it,"Mario ""il Grande"""`);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.nome).toBe('Mario "il Grande"');
});

test("bastano le colonne che servono", () => {
  const esito = parseCsv("email\nmario@esempio.it");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.email).toBe("mario@esempio.it");
  expect(esito.righe[0]!.tag).toEqual([]);
});

test("l'email si normalizza a minuscolo e trimmata", () => {
  const esito = parseCsv("email\n  Mario@Esempio.IT  ");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.email).toBe("mario@esempio.it");
});

test("senza la colonna email il file è rifiutato", () => {
  const esito = parseCsv("nome,cognome\nMario,Rossi");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toContain("email");
});

test("una colonna sconosciuta fa rifiutare il file", () => {
  const esito = parseCsv("email,telefono\nmario@esempio.it,123");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toContain("telefono");
});

test("un'email non valida fa rifiutare il file e dice quale riga", () => {
  const esito = parseCsv(
    "email\nmario@esempio.it\nnon-una-email\nlucia@esempio.it",
  );
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toContain("3"); // riga 3 del file, intestazione inclusa
});

test("un'email vuota fa rifiutare il file", () => {
  const esito = parseCsv("email,nome\n,Mario");
  expect(esito.ok).toBe(false);
});

test("le righe vuote si ignorano senza far fallire", () => {
  const esito = parseCsv("email\nmario@esempio.it\n\n\nlucia@esempio.it\n");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe).toHaveLength(2);
});

test("un file con la sola intestazione dà zero righe", () => {
  const esito = parseCsv(INTESTAZIONE);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe).toHaveLength(0);
});

test("i campi vuoti restano undefined, non stringa vuota", () => {
  const esito = parseCsv("email,nome,cognome\nmario@esempio.it,,");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.nome).toBeUndefined();
  expect(esito.righe[0]!.cognome).toBeUndefined();
});

test("i tag si normalizzano: trim, minuscolo, niente vuoti", () => {
  const esito = parseCsv(`email,tag\nmario@esempio.it," Villaggi , PILOTA ,, "`);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.tag).toEqual(["villaggi", "pilota"]);
});

test("il CRLF di Windows non finisce nei valori", () => {
  const esito = parseCsv("email,nome\r\nmario@esempio.it,Mario\r\n");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.nome).toBe("Mario");
});

test("emailValida accetta e rifiuta i casi ovvi", () => {
  expect(emailValida("mario@esempio.it")).toBe(true);
  expect(emailValida("mario.rossi+tag@sub.esempio.co.uk")).toBe(true);
  expect(emailValida("non-una-email")).toBe(false);
  expect(emailValida("senza@dominio")).toBe(false);
  expect(emailValida("@esempio.it")).toBe(false);
  expect(emailValida("con spazio@esempio.it")).toBe(false);
});

test("normalizzaEmail trimma e abbassa", () => {
  expect(normalizzaEmail("  Mario@Esempio.IT ")).toBe("mario@esempio.it");
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `bun test tests/csv.test.ts`
Expected: FAIL — `Cannot find module '../server/csv'`.

- [ ] **Step 3: Implementare il parser**

Creare `server/csv.ts`:

```ts
/**
 * Parsing e validazione del CSV dei contatti.
 *
 * Funzioni pure: non toccano il DB e non importano nulla di `@hub/*`.
 *
 * Il parser gestisce le virgolette perché i tag arrivano in un solo campo
 * (`"villaggi,pilota"`): uno split sulla virgola li spezzerebbe e sfaserebbe
 * l'intera riga.
 */

export type RigaCsv = {
  email: string;
  nome?: string;
  cognome?: string;
  azienda?: string;
  ruolo?: string;
  tag: string[];
  provenienza?: string;
  indirizzoRaw?: string;
};

export type EsitoCsv =
  | { ok: true; righe: RigaCsv[] }
  | { ok: false; errore: string };

const COLONNE_NOTE = [
  "email",
  "nome",
  "cognome",
  "azienda",
  "ruolo",
  "tag",
  "provenienza",
  "indirizzo_raw",
] as const;

export function normalizzaEmail(valore: string): string {
  return valore.trim().toLowerCase();
}

export function emailValida(valore: string): boolean {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(valore);
}

/** Divide una riga CSV rispettando le virgolette. `""` interno vale `"`. */
function dividiRiga(riga: string): string[] {
  const campi: string[] = [];
  let corrente = "";
  let fraVirgolette = false;

  for (let i = 0; i < riga.length; i++) {
    const c = riga[i]!;
    if (fraVirgolette) {
      if (c === '"') {
        if (riga[i + 1] === '"') {
          corrente += '"';
          i++;
        } else {
          fraVirgolette = false;
        }
      } else {
        corrente += c;
      }
    } else if (c === '"') {
      fraVirgolette = true;
    } else if (c === ",") {
      campi.push(corrente);
      corrente = "";
    } else {
      corrente += c;
    }
  }
  campi.push(corrente);
  return campi;
}

/** Stringa vuota o solo spazi diventa undefined: un campo vuoto non è un dato. */
function opzionale(valore: string | undefined): string | undefined {
  const v = valore?.trim();
  return v ? v : undefined;
}

function parseTag(valore: string | undefined): string[] {
  if (!valore) return [];
  return valore
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

export function parseCsv(testo: string): EsitoCsv {
  const righeTesto = testo.replace(/\r\n/g, "\n").split("\n");
  const primaNonVuota = righeTesto.findIndex((r) => r.trim().length > 0);
  if (primaNonVuota === -1) return { ok: false, errore: "il file è vuoto" };

  const intestazione = dividiRiga(righeTesto[primaNonVuota]!).map((c) =>
    c.trim().toLowerCase(),
  );

  const ignote = intestazione.filter(
    (c) => !COLONNE_NOTE.includes(c as (typeof COLONNE_NOTE)[number]),
  );
  if (ignote.length > 0) {
    return {
      ok: false,
      errore: `colonne non riconosciute: ${ignote.join(", ")}. Attese: ${COLONNE_NOTE.join(", ")}`,
    };
  }
  if (!intestazione.includes("email")) {
    return { ok: false, errore: "manca la colonna obbligatoria: email" };
  }

  const indice = (nome: string) => intestazione.indexOf(nome);
  const campo = (campi: string[], nome: string): string | undefined => {
    const i = indice(nome);
    return i === -1 ? undefined : campi[i];
  };

  const righe: RigaCsv[] = [];
  for (let n = primaNonVuota + 1; n < righeTesto.length; n++) {
    const testoRiga = righeTesto[n]!;
    if (testoRiga.trim().length === 0) continue;

    const campi = dividiRiga(testoRiga);
    const email = normalizzaEmail(campo(campi, "email") ?? "");
    // Numero di riga umano: 1-based, intestazione inclusa.
    const numeroRiga = n + 1;
    if (!email) {
      return { ok: false, errore: `riga ${numeroRiga}: email mancante` };
    }
    if (!emailValida(email)) {
      return {
        ok: false,
        errore: `riga ${numeroRiga}: email non valida (${email})`,
      };
    }

    righe.push({
      email,
      nome: opzionale(campo(campi, "nome")),
      cognome: opzionale(campo(campi, "cognome")),
      azienda: opzionale(campo(campi, "azienda")),
      ruolo: opzionale(campo(campi, "ruolo")),
      tag: parseTag(opzionale(campo(campi, "tag"))),
      provenienza: opzionale(campo(campi, "provenienza")),
      indirizzoRaw: opzionale(campo(campi, "indirizzo_raw")),
    });
  }

  return { ok: true, righe };
}
```

- [ ] **Step 4: Eseguire i test**

Run: `bun test tests/csv.test.ts && bun run check`
Expected: PASS, tutti. Se il test sulle virgolette fallisce, il bug è in `dividiRiga`.

- [ ] **Step 5: Rimuovere il test temporaneo dello schema**

```bash
rm tests/schema.test.ts
```

Lo schema viene coperto dai test veri a partire dal Task 3.

- [ ] **Step 6: Commit**

```bash
git add server/csv.ts tests/csv.test.ts
git rm --cached tests/schema.test.ts 2>/dev/null; true
git commit -m "$(cat <<'EOF'
feat: parser CSV dei contatti

Scritto a mano perché non c'è un parser fra le dipendenze e non vale
aggiungerne uno per un formato che controlliamo noi. Gestisce le
virgolette: i tag arrivano in un campo solo ("villaggi,pilota") e uno
split sulla virgola sfaserebbe l'intera riga.

Severo in ingresso: colonna mancante, colonna ignota o email non valida
fanno rifiutare il file intero, indicando la riga. Un import parziale
lascerebbe la lista in uno stato che nessuno sa descrivere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: CRUD contatti e aziende

**Files:**
- Create: `server/contatti.ts`
- Create: `tests/contatti.test.ts`

**Interfaces:**
- Consumes: `creaDbDiTest()` da `tests/helpers.ts`; `normalizzaEmail` da `server/csv.ts`.
- Produces:

```ts
export type Contatto = {
  id: number;
  email: string;
  nome: string | null;
  cognome: string | null;
  aziendaId: number | null;
  aziendaNome: string | null;   // risolto in JOIN, comodo per la UI
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

export type StatoTecnico = "mai_verificato" | "valido" | "rimbalzato" | "sospeso";
export type DisiscrittoVia = "telefono" | "email" | "manuale" | "ponte";

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

export function creaContatto(db: Database, dati: DatiContatto): number;
export function leggiContatto(db: Database, id: number): Contatto | null;
export function trovaPerEmail(db: Database, email: string): Contatto | null;
export function elencaContatti(
  db: Database,
  filtri?: FiltriContatti,
): { righe: Contatto[]; totale: number };
export function aggiornaContatto(
  db: Database,
  id: number,
  dati: Partial<DatiContatto>,
): void;
export function disiscrivi(db: Database, id: number, via: DisiscrittoVia): void;
export function riscrivi(db: Database, id: number): void;

export function risolviOCreaAzienda(db: Database, nome: string): number;
export function elencaAziende(
  db: Database,
): { id: number; nome: string; contatti: number }[];
export function aggiornaAzienda(
  db: Database,
  id: number,
  dati: { nome?: string; settore?: string | null; sito?: string | null;
          indirizzoRaw?: string | null; note?: string | null },
): void;
export function eliminaAzienda(db: Database, id: number): void;

export function impostaTag(db: Database, contattoId: number, tag: string[]): void;
export function unisciTag(db: Database, contattoId: number, tag: string[]): void;
export function elencaTag(db: Database): { nome: string; contatti: number }[];
```

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `tests/contatti.test.ts`:

```ts
import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import {
  aggiornaContatto,
  creaContatto,
  disiscrivi,
  elencaAziende,
  elencaContatti,
  elencaTag,
  eliminaAzienda,
  impostaTag,
  leggiContatto,
  riscrivi,
  risolviOCreaAzienda,
  trovaPerEmail,
  unisciTag,
} from "../server/contatti";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

test("un contatto nuovo nasce iscritto e mai verificato", () => {
  const id = creaContatto(db, { email: "mario@esempio.it", nome: "Mario" });
  const c = leggiContatto(db, id)!;
  expect(c.email).toBe("mario@esempio.it");
  expect(c.iscritto).toBe(true);
  expect(c.statoTecnico).toBe("mai_verificato");
  expect(c.disiscrittoIl).toBeNull();
  expect(c.tag).toEqual([]);
});

test("l'email si normalizza in scrittura", () => {
  const id = creaContatto(db, { email: "  Mario@Esempio.IT " });
  expect(leggiContatto(db, id)!.email).toBe("mario@esempio.it");
});

test("trovaPerEmail ignora le maiuscole", () => {
  creaContatto(db, { email: "mario@esempio.it" });
  expect(trovaPerEmail(db, "MARIO@ESEMPIO.IT")).not.toBeNull();
});

test("due contatti con la stessa email non convivono", () => {
  creaContatto(db, { email: "mario@esempio.it" });
  expect(() => creaContatto(db, { email: "Mario@Esempio.it" })).toThrow();
});

test("disiscrivi registra quando e come", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "telefono");
  const c = leggiContatto(db, id)!;
  expect(c.iscritto).toBe(false);
  expect(c.disiscrittoVia).toBe("telefono");
  expect(c.disiscrittoIl).toBeGreaterThan(0);
});

test("riscrivi azzera i campi della disiscrizione", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "email");
  riscrivi(db, id);
  const c = leggiContatto(db, id)!;
  expect(c.iscritto).toBe(true);
  expect(c.disiscrittoIl).toBeNull();
  expect(c.disiscrittoVia).toBeNull();
});

test("uno stato tecnico fuori dominio viene rifiutato dal DB", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  expect(() =>
    db.run("UPDATE contatti SET stato_tecnico = 'inventato' WHERE id = ?", [id]),
  ).toThrow();
});

test("risolviOCreaAzienda non duplica per differenza di maiuscole", () => {
  const a = risolviOCreaAzienda(db, "Villaggio Sole");
  const b = risolviOCreaAzienda(db, "villaggio sole");
  expect(b).toBe(a);
  expect(elencaAziende(db)).toHaveLength(1);
});

test("il contatto porta con sé il nome dell'azienda", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  const id = creaContatto(db, { email: "mario@esempio.it", aziendaId });
  expect(leggiContatto(db, id)!.aziendaNome).toBe("Villaggio Sole");
});

test("eliminare un'azienda non elimina i suoi contatti", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  const id = creaContatto(db, { email: "mario@esempio.it", aziendaId });
  eliminaAzienda(db, aziendaId);
  const c = leggiContatto(db, id);
  expect(c).not.toBeNull();
  expect(c!.aziendaId).toBeNull();
});

test("elencaAziende conta i contatti", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  creaContatto(db, { email: "mario@esempio.it", aziendaId });
  creaContatto(db, { email: "lucia@esempio.it", aziendaId });
  creaContatto(db, { email: "solo@esempio.it" });
  const aziende = elencaAziende(db);
  expect(aziende).toHaveLength(1);
  expect(aziende[0]!.contatti).toBe(2);
});

test("impostaTag sostituisce, unisciTag aggiunge", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  impostaTag(db, id, ["villaggi"]);
  expect(leggiContatto(db, id)!.tag).toEqual(["villaggi"]);
  unisciTag(db, id, ["pilota"]);
  expect(leggiContatto(db, id)!.tag.sort()).toEqual(["pilota", "villaggi"]);
  impostaTag(db, id, ["nord"]);
  expect(leggiContatto(db, id)!.tag).toEqual(["nord"]);
});

test("lo stesso tag su due contatti non crea due righe in tag", () => {
  const a = creaContatto(db, { email: "mario@esempio.it" });
  const b = creaContatto(db, { email: "lucia@esempio.it" });
  impostaTag(db, a, ["villaggi"]);
  impostaTag(db, b, ["Villaggi"]);
  const tag = elencaTag(db);
  expect(tag).toHaveLength(1);
  expect(tag[0]!.contatti).toBe(2);
});

test("cancellare un contatto libera le sue associazioni di tag", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  impostaTag(db, id, ["villaggi"]);
  db.run("DELETE FROM contatti WHERE id = ?", [id]);
  const n = db.query("SELECT COUNT(*) AS n FROM contatti_tag").get() as {
    n: number;
  };
  expect(n.n).toBe(0);
});

test("aggiornaContatto tocca solo i campi passati", () => {
  const id = creaContatto(db, {
    email: "mario@esempio.it",
    nome: "Mario",
    ruolo: "Direttore",
  });
  aggiornaContatto(db, id, { nome: "Maria" });
  const c = leggiContatto(db, id)!;
  expect(c.nome).toBe("Maria");
  expect(c.ruolo).toBe("Direttore");
});

test("aggiornaContatto non può riattivare un disiscritto", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "telefono");
  aggiornaContatto(db, id, { nome: "Mario" });
  expect(leggiContatto(db, id)!.iscritto).toBe(false);
});

test("aggiornaContatto aggiorna il timestamp", async () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  const prima = leggiContatto(db, id)!.aggiornatoIl;
  await Bun.sleep(5);
  aggiornaContatto(db, id, { nome: "Mario" });
  expect(leggiContatto(db, id)!.aggiornatoIl).toBeGreaterThan(prima);
});

test("elencaContatti filtra per testo su email, nome, cognome e azienda", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  creaContatto(db, { email: "mario@esempio.it", nome: "Mario", aziendaId });
  creaContatto(db, { email: "lucia@altro.it", cognome: "Bianchi" });
  expect(elencaContatti(db, { testo: "mario" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { testo: "bianchi" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { testo: "villaggio" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { testo: "esempio" }).righe).toHaveLength(1);
});

test("elencaContatti filtra per iscritto, tag e provincia", () => {
  const a = creaContatto(db, { email: "mario@esempio.it", provincia: "BO" });
  impostaTag(db, a, ["villaggi"]);
  const b = creaContatto(db, { email: "lucia@esempio.it", provincia: "VR" });
  disiscrivi(db, b, "manuale");

  expect(elencaContatti(db, { iscritto: true }).righe).toHaveLength(1);
  expect(elencaContatti(db, { iscritto: false }).righe).toHaveLength(1);
  expect(elencaContatti(db, { tag: "villaggi" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { provincia: "BO" }).righe).toHaveLength(1);
});

test("elencaContatti pagina e riporta il totale", () => {
  for (let i = 0; i < 5; i++) {
    creaContatto(db, { email: `c${i}@esempio.it` });
  }
  const p = elencaContatti(db, { limite: 2, offset: 0 });
  expect(p.righe).toHaveLength(2);
  expect(p.totale).toBe(5);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `bun test tests/contatti.test.ts`
Expected: FAIL — `Cannot find module '../server/contatti'`.

- [ ] **Step 3: Implementare il modulo**

Creare `server/contatti.ts`:

```ts
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
```

- [ ] **Step 4: Eseguire i test**

Run: `bun test tests/contatti.test.ts && bun run check`
Expected: PASS, tutti.

- [ ] **Step 5: Commit**

```bash
git add server/contatti.ts tests/contatti.test.ts
git commit -m "$(cat <<'EOF'
feat: CRUD di contatti, aziende e tag

`aggiornaContatto` non espone `iscritto` di proposito: la volontà della
persona si cambia solo con disiscrivi e riscrivi, mai come effetto
collaterale di una modifica anagrafica.

Eliminare un'azienda porta `azienda_id` a NULL e lascia vivi i contatti:
ripulire l'anagrafica non deve far sparire indirizzi iscritti.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Import idempotente

**Files:**
- Create: `server/import.ts`
- Create: `tests/import.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `RigaCsv` da `server/csv.ts`; `risolviOCreaAzienda`, `unisciTag`, `trovaPerEmail`, `creaContatto` da `server/contatti.ts`; `creaDbDiTest` da `tests/helpers.ts`.
- Produces:

```ts
export type RapportoImport = {
  righeLette: number;
  creati: number;
  aggiornati: number;
  disiscrittiIntatti: number;   // esistenti e disiscritti: iscritto non toccato
  aziendeCreate: number;
};

export type EsitoImport =
  | { ok: true; rapporto: RapportoImport }
  | { ok: false; errore: string };

export function importaCsv(
  db: Database,
  testo: string,
  opzioni?: { origine?: string; dryRun?: boolean },
): EsitoImport;

export function storicoImport(
  db: Database,
  limite?: number,
): {
  id: number;
  eseguitoIl: number;
  origine: string;
  righeLette: number;
  creati: number;
  aggiornati: number;
  rapporto: string;
}[];
```

**Nota per chi implementa:** questo è il task che contiene la regola centrale della fase. `iscritto` non compare **mai** nella `UPDATE` di un contatto esistente. Non è un'ottimizzazione: è ciò che impedisce a un CSV di riattivare chi si è disiscritto per telefono.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `tests/import.test.ts`:

```ts
import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import {
  disiscrivi,
  elencaAziende,
  elencaContatti,
  leggiContatto,
  trovaPerEmail,
} from "../server/contatti";
import { importaCsv, storicoImport } from "../server/import";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

const CSV = `email,nome,cognome,azienda,ruolo,tag,provenienza
mario@esempio.it,Mario,Rossi,Villaggio Sole,Direttore,"villaggi,pilota",export
lucia@esempio.it,Lucia,Bianchi,Villaggio Sole,Marketing,villaggi,export`;

test("il primo import crea i contatti", () => {
  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.creati).toBe(2);
  expect(esito.rapporto.aggiornati).toBe(0);
  expect(esito.rapporto.righeLette).toBe(2);
  expect(elencaContatti(db).totale).toBe(2);
});

test("reimportare lo stesso file non crea doppioni", () => {
  importaCsv(db, CSV);
  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.creati).toBe(0);
  expect(esito.rapporto.aggiornati).toBe(2);
  expect(elencaContatti(db).totale).toBe(2);
});

// Il criterio di "fatto" della fase.
test("un disiscritto resta disiscritto dopo il reimport", () => {
  importaCsv(db, CSV);
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  disiscrivi(db, c.id, "telefono");

  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.disiscrittiIntatti).toBe(1);

  const dopo = trovaPerEmail(db, "mario@esempio.it")!;
  expect(dopo.iscritto).toBe(false);
  expect(dopo.disiscrittoVia).toBe("telefono");
  expect(dopo.disiscrittoIl).toBe(c.disiscrittoIl);
});

test("su un disiscritto l'import aggiorna comunque i dati anagrafici", () => {
  importaCsv(db, "email,nome\nmario@esempio.it,Mario");
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  disiscrivi(db, c.id, "email");

  importaCsv(db, "email,nome,ruolo\nmario@esempio.it,Mario,Direttore");
  const dopo = trovaPerEmail(db, "mario@esempio.it")!;
  expect(dopo.ruolo).toBe("Direttore");
  expect(dopo.iscritto).toBe(false);
});

test("l'email con maiuscole diverse è lo stesso contatto", () => {
  importaCsv(db, "email\nmario@esempio.it");
  const esito = importaCsv(db, "email\nMario@Esempio.IT");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.creati).toBe(0);
  expect(elencaContatti(db).totale).toBe(1);
});

test("i tag si uniscono, non sostituiscono", () => {
  importaCsv(db, `email,tag\nmario@esempio.it,villaggi`);
  importaCsv(db, `email,tag\nmario@esempio.it,pilota`);
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  expect(c.tag.sort()).toEqual(["pilota", "villaggi"]);
});

test("un campo vuoto non cancella il valore esistente", () => {
  importaCsv(db, "email,nome,ruolo\nmario@esempio.it,Mario,Direttore");
  importaCsv(db, "email,nome,ruolo\nmario@esempio.it,,");
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  expect(c.nome).toBe("Mario");
  expect(c.ruolo).toBe("Direttore");
});

test("un campo pieno sovrascrive il valore esistente", () => {
  importaCsv(db, "email,ruolo\nmario@esempio.it,Direttore");
  importaCsv(db, "email,ruolo\nmario@esempio.it,Presidente");
  expect(trovaPerEmail(db, "mario@esempio.it")!.ruolo).toBe("Presidente");
});

test("l'azienda si crea una volta sola per due contatti", () => {
  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.aziendeCreate).toBe(1);
  expect(elencaAziende(db)).toHaveLength(1);
  expect(trovaPerEmail(db, "mario@esempio.it")!.aziendaNome).toBe(
    "Villaggio Sole",
  );
});

test("l'azienda non si duplica per differenza di maiuscole", () => {
  importaCsv(db, "email,azienda\nmario@esempio.it,Villaggio Sole");
  importaCsv(db, "email,azienda\nlucia@esempio.it,villaggio sole");
  expect(elencaAziende(db)).toHaveLength(1);
});

test("un CSV rifiutato non scrive nulla", () => {
  importaCsv(db, "email\nmario@esempio.it");
  const esito = importaCsv(
    db,
    "email\nlucia@esempio.it\nnon-una-email\nanna@esempio.it",
  );
  expect(esito.ok).toBe(false);
  expect(elencaContatti(db).totale).toBe(1);
});

test("il dry-run non scrive ma calcola lo stesso rapporto", () => {
  const prova = importaCsv(db, CSV, { dryRun: true });
  expect(prova.ok).toBe(true);
  if (!prova.ok) return;
  expect(prova.rapporto.creati).toBe(2);
  expect(elencaContatti(db).totale).toBe(0);

  const vero = importaCsv(db, CSV);
  expect(vero.ok).toBe(true);
  if (!vero.ok) return;
  expect(vero.rapporto).toEqual(prova.rapporto);
});

test("il dry-run non lascia aziende né tag dietro di sé", () => {
  importaCsv(db, CSV, { dryRun: true });
  expect(elencaAziende(db)).toHaveLength(0);
  const n = db.query("SELECT COUNT(*) AS n FROM tag").get() as { n: number };
  expect(n.n).toBe(0);
});

test("l'import reale finisce nello storico, il dry-run no", () => {
  importaCsv(db, CSV, { origine: "prova.csv", dryRun: true });
  expect(storicoImport(db)).toHaveLength(0);

  importaCsv(db, CSV, { origine: "prova.csv" });
  const storico = storicoImport(db);
  expect(storico).toHaveLength(1);
  expect(storico[0]!.origine).toBe("prova.csv");
  expect(storico[0]!.creati).toBe(2);
});

test("i contatti importati nascono iscritti", () => {
  importaCsv(db, CSV);
  expect(trovaPerEmail(db, "mario@esempio.it")!.iscritto).toBe(true);
});

test("l'indirizzo grezzo si conserva com'è", () => {
  const raw = "Via Zenzalino Nord, 145 Budrio 40054 (BO)";
  importaCsv(db, `email,indirizzo_raw\nmario@esempio.it,"${raw}"`);
  expect(trovaPerEmail(db, "mario@esempio.it")!.indirizzoRaw).toBe(raw);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `bun test tests/import.test.ts`
Expected: FAIL — `Cannot find module '../server/import'`.

- [ ] **Step 3: Implementare l'import**

Creare `server/import.ts`:

```ts
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
```

- [ ] **Step 4: Eseguire i test**

Run: `bun test tests/import.test.ts && bun run check`
Expected: PASS, tutti. Se fallisce *"un disiscritto resta disiscritto"*, cercare un `iscritto` finito nella `UPDATE`: è il bug che quel test esiste per intercettare.

- [ ] **Step 5: Eseguire l'intera suite**

Run: `bun test tests/`
Expected: PASS, tutti e tre i file.

- [ ] **Step 6: Commit**

```bash
git add server/import.ts tests/import.test.ts
git commit -m "$(cat <<'EOF'
feat: import CSV idempotente sull'email

`iscritto` non compare mai nella UPDATE di un contatto esistente: è la
regola che impedisce a un CSV di riattivare chi si è disiscritto per
telefono. Il test che la verifica è il criterio di "fatto" della fase.

I tag si uniscono invece di sostituirsi, e un campo vuoto non cancella:
un import non deve poter distruggere lavoro fatto a mano dalla UI.

Il dry-run scrive e fa rollback invece di simulare, così il rapporto
dell'anteprima è per costruzione identico a quello dell'import vero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Script CLI di import

**Files:**
- Modify: `scripts/import-contatti.ts` (creare; `scripts/fboschetti-newsletter.ts` resta com'è)
- Modify: `plugin.json` (aggiungere il job)

**Interfaces:**
- Consumes: `importaCsv` da `server/import.ts`.
- Produces: il job `import-contatti` nel manifest.

**Nota per chi implementa:** questo è l'**unico** file che può importare `@hub/*`. `openPluginDb` applica già WAL, foreign keys e migration: non rifarle. Va aggiunto solo `PRAGMA busy_timeout`, perché il server può scrivere in parallelo sullo stesso file.

- [ ] **Step 1: Scrivere lo script**

Creare `scripts/import-contatti.ts`:

```ts
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
```

- [ ] **Step 2: Dichiarare il job nel manifest**

In `plugin.json`, aggiungere al vettore `jobs` (dopo il job esistente):

```json
    {
      "name": "import-contatti",
      "description": "Importa un CSV nella lista contatti",
      "command": "bun run scripts/import-contatti.ts",
      "icon": "mail",
      "schedulable": false
    }
```

`schedulable: false` perché l'import vuole un file scelto a mano: schedularlo non ha senso.

- [ ] **Step 3: Verificare che il manifest sia JSON valido e che il tipo regga**

Run: `bun -e "JSON.parse(require('fs').readFileSync('plugin.json','utf8')); console.log('json ok')" && bun run check`
Expected: `json ok`, e `tsc` senza errori.

Nota: `@hub/plugin-db` non è risolvibile fuori dal core, quindi `tsc` potrebbe segnalarlo. Se accade, l'import dinamico dentro la funzione (com'è scritto) basta a non farlo fallire in compilazione. Se `tsc` si lamenta comunque, aggiungere in cima al file:

```ts
// @ts-expect-error — @hub/* è risolvibile solo dentro il core
```

- [ ] **Step 4: Verificare la suite**

Run: `bun test tests/`
Expected: PASS. I test non toccano lo script, che è solo wiring.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-contatti.ts plugin.json
git commit -m "$(cat <<'EOF'
feat: job CLI per l'import dei contatti

Unico file del plugin che importa @hub/*: la logica sta in server/import.ts
e resta testabile senza il core installato.

openPluginDb applica già WAL, foreign key e migration, quindi qui si
aggiunge solo busy_timeout, che serve perché il server può scrivere sullo
stesso file mentre la CLI gira.

Non schedulabile: l'import vuole un file scelto a mano.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Route HTTP

**Files:**
- Modify: `server/routes.ts`

**Interfaces:**
- Consumes: tutto `server/contatti.ts` e `server/import.ts`.
- Produces: le route sotto `/api/plugins/fboschetti-newsletter`, consumate dal Task 7.

| Metodo e path | Corpo / query | Risposta |
| :--- | :--- | :--- |
| `GET /contatti` | `?testo=&tag=&iscritto=&stato_tecnico=&provincia=&limite=&offset=` | `{ righe, totale }` |
| `POST /contatti` | `DatiContatto` | `201 { id }` |
| `PATCH /contatti/:id` | `Partial<DatiContatto>` | `{ ok: true }` |
| `POST /contatti/:id/disiscrivi` | `{ via }` | `{ ok: true }` |
| `POST /contatti/:id/riscrivi` | — | `{ ok: true }` |
| `GET /aziende` | — | `{ righe }` |
| `POST /aziende` | `{ nome }` | `201 { id }` |
| `PATCH /aziende/:id` | dati azienda | `{ ok: true }` |
| `GET /tag` | — | `{ righe }` |
| `POST /import` | multipart `file`, `?dry_run=1` | `{ rapporto }` o `400 { errore }` |
| `GET /import` | — | `{ righe }` |

- [ ] **Step 1: Scrivere le route**

Sostituire il contenuto di `server/routes.ts`:

```ts
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  aggiornaAzienda,
  aggiornaContatto,
  creaContatto,
  disiscrivi,
  elencaAziende,
  elencaContatti,
  elencaTag,
  leggiContatto,
  riscrivi,
  risolviOCreaAzienda,
  type DatiContatto,
  type DisiscrittoVia,
  type FiltriContatti,
  type StatoTecnico,
} from "./contatti";
import { importaCsv, storicoImport } from "./import";

/**
 * Route del plugin, montate sotto /api/plugins/fboschetti-newsletter.
 *
 * `deps.db` arriva già aperto e migrato dal core: non si riapre.
 *
 * Non esiste una DELETE sui contatti: cancellare un disiscritto lo
 * esporrebbe al reimport, che è esattamente ciò che la fase impedisce.
 */

const VIE_VALIDE: DisiscrittoVia[] = ["telefono", "email", "manuale", "ponte"];
const STATI_VALIDI: StatoTecnico[] = [
  "mai_verificato",
  "valido",
  "rimbalzato",
  "sospeso",
];

export default function createRoutes(deps: {
  db: Database;
  slug: string;
  projectRoot: string;
}) {
  const r = new Hono();
  const db = deps.db;

  r.get("/stato", (c) =>
    c.json({ slug: deps.slug, contatti: elencaContatti(db, { limite: 1 }).totale }),
  );

  r.get("/contatti", (c) => {
    const q = c.req.query();
    const filtri: FiltriContatti = {};
    if (q.testo) filtri.testo = q.testo;
    if (q.tag) filtri.tag = q.tag;
    if (q.iscritto === "true") filtri.iscritto = true;
    if (q.iscritto === "false") filtri.iscritto = false;
    if (q.stato_tecnico && STATI_VALIDI.includes(q.stato_tecnico as StatoTecnico)) {
      filtri.statoTecnico = q.stato_tecnico as StatoTecnico;
    }
    if (q.provincia) filtri.provincia = q.provincia;
    if (q.limite) filtri.limite = Number(q.limite);
    if (q.offset) filtri.offset = Number(q.offset);
    return c.json(elencaContatti(db, filtri));
  });

  r.post("/contatti", async (c) => {
    const body: Partial<DatiContatto> = await c.req
      .json<Partial<DatiContatto>>()
      .catch(() => ({}));
    if (!body.email) return c.json({ errore: "email_mancante" }, 400);
    try {
      return c.json({ id: creaContatto(db, body as DatiContatto) }, 201);
    } catch {
      return c.json({ errore: "email_gia_presente" }, 409);
    }
  });

  r.patch("/contatti/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!leggiContatto(db, id)) return c.json({ errore: "non_trovato" }, 404);
    const body: Partial<DatiContatto> = await c.req
      .json<Partial<DatiContatto>>()
      .catch(() => ({}));
    aggiornaContatto(db, id, body);
    return c.json({ ok: true });
  });

  r.post("/contatti/:id/disiscrivi", async (c) => {
    const id = Number(c.req.param("id"));
    if (!leggiContatto(db, id)) return c.json({ errore: "non_trovato" }, 404);
    const body: { via?: string } = await c.req
      .json<{ via?: string }>()
      .catch(() => ({}));
    if (!body.via || !VIE_VALIDE.includes(body.via as DisiscrittoVia)) {
      return c.json({ errore: "via_non_valida", attese: VIE_VALIDE }, 400);
    }
    disiscrivi(db, id, body.via as DisiscrittoVia);
    return c.json({ ok: true });
  });

  r.post("/contatti/:id/riscrivi", (c) => {
    const id = Number(c.req.param("id"));
    if (!leggiContatto(db, id)) return c.json({ errore: "non_trovato" }, 404);
    riscrivi(db, id);
    return c.json({ ok: true });
  });

  r.get("/aziende", (c) => c.json({ righe: elencaAziende(db) }));

  r.post("/aziende", async (c) => {
    const body: { nome?: string } = await c.req
      .json<{ nome?: string }>()
      .catch(() => ({}));
    if (!body.nome?.trim()) return c.json({ errore: "nome_mancante" }, 400);
    return c.json({ id: risolviOCreaAzienda(db, body.nome) }, 201);
  });

  r.patch("/aziende/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json<Record<string, string | null>>().catch(() => ({}));
    aggiornaAzienda(db, id, body);
    return c.json({ ok: true });
  });

  r.get("/tag", (c) => c.json({ righe: elencaTag(db) }));

  r.post("/import", async (c) => {
    const dryRun = c.req.query("dry_run") === "1";
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) {
      return c.json({ errore: "file_mancante" }, 400);
    }
    const testo = await file.text();
    const esito = importaCsv(db, testo, { origine: file.name, dryRun });
    if (!esito.ok) return c.json({ errore: esito.errore }, 400);
    return c.json({ rapporto: esito.rapporto, dryRun });
  });

  r.get("/import", (c) => c.json({ righe: storicoImport(db) }));

  return r;
}
```

- [ ] **Step 2: Verificare tipi e suite**

Run: `bun run check && bun test tests/`
Expected: nessun errore di tipo, test verdi.

- [ ] **Step 3: Verificare che il modulo esporti una factory valida**

Run:

```bash
bun -e "
const mod = await import('./server/routes.ts');
const { Database } = await import('bun:sqlite');
const { readFileSync } = await import('node:fs');
const db = new Database(':memory:');
db.run('PRAGMA foreign_keys = ON');
db.run(readFileSync('migrations/20260912_000000_contatti.sql','utf8'));
const app = mod.default({ db, slug: 'fboschetti-newsletter', projectRoot: '.' });
const res = await app.request('/contatti');
console.log(res.status, await res.text());
"
```

Expected: `200 {"righe":[],"totale":0}`.

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts
git commit -m "$(cat <<'EOF'
feat: route di contatti, aziende, tag e import

Nessuna DELETE sui contatti: cancellare un disiscritto lo esporrebbe al
reimport, che è ciò che la fase esiste per impedire. La disiscrizione
richiede sempre un `via` fra quelli previsti.

L'import accetta dry_run=1 e restituisce lo stesso rapporto dell'import
reale, così la UI può mostrare l'anteprima prima della conferma.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pagina dei contatti

**Files:**
- Modify: `web/pages/index.tsx`

**Interfaces:**
- Consumes: le route del Task 6.
- Produces: la pagina in sidebar.

**Nota per chi implementa:** il browser non legge il DB, solo le route. Niente classi Tailwind con esadecimali: i `plugins/*` sono fuori dal purge del core. Un contatto disiscritto **deve essere visibile nella tabella senza aprire nulla**: è l'informazione attorno a cui ruota la fase.

- [ ] **Step 1: Scrivere la pagina**

Sostituire il contenuto di `web/pages/index.tsx`:

```tsx
import { useEffect, useState } from "react";

export const meta = {
  title: "Contatti",
  icon: "mail",
  sidebar: true,
  order: 100,
};

const API = "/api/plugins/fboschetti-newsletter";

type Contatto = {
  id: number;
  email: string;
  nome: string | null;
  cognome: string | null;
  aziendaNome: string | null;
  ruolo: string | null;
  comune: string | null;
  provincia: string | null;
  iscritto: boolean;
  statoTecnico: string;
  disiscrittoVia: string | null;
  tag: string[];
};

type Rapporto = {
  righeLette: number;
  creati: number;
  aggiornati: number;
  disiscrittiIntatti: number;
  aziendeCreate: number;
};

export default function PaginaContatti() {
  const [righe, setRighe] = useState<Contatto[]>([]);
  const [totale, setTotale] = useState(0);
  const [testo, setTesto] = useState("");
  const [iscritto, setIscritto] = useState<string>("");
  const [tag, setTag] = useState("");
  const [tagDisponibili, setTagDisponibili] = useState<string[]>([]);
  const [anteprima, setAnteprima] = useState<Rapporto | null>(null);
  const [fileScelto, setFileScelto] = useState<File | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  async function carica() {
    setCaricamento(true);
    const q = new URLSearchParams();
    if (testo) q.set("testo", testo);
    if (iscritto) q.set("iscritto", iscritto);
    if (tag) q.set("tag", tag);
    const res = await fetch(`${API}/contatti?${q}`);
    const dati = (await res.json()) as { righe: Contatto[]; totale: number };
    setRighe(dati.righe);
    setTotale(dati.totale);
    setCaricamento(false);
  }

  useEffect(() => {
    void carica();
    void fetch(`${API}/tag`)
      .then((r) => r.json() as Promise<{ righe: { nome: string }[] }>)
      .then((d) => setTagDisponibili(d.righe.map((t) => t.nome)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testo, iscritto, tag]);

  async function inviaFile(file: File, dryRun: boolean) {
    setErrore(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/import?dry_run=${dryRun ? "1" : "0"}`, {
      method: "POST",
      body: form,
    });
    const dati = (await res.json()) as { rapporto?: Rapporto; errore?: string };
    if (!res.ok || dati.errore) {
      setErrore(dati.errore ?? "import fallito");
      setAnteprima(null);
      return null;
    }
    return dati.rapporto ?? null;
  }

  async function scegliFile(file: File) {
    setFileScelto(file);
    setAnteprima(await inviaFile(file, true));
  }

  async function confermaImport() {
    if (!fileScelto) return;
    await inviaFile(fileScelto, false);
    setAnteprima(null);
    setFileScelto(null);
    await carica();
  }

  async function azione(id: number, percorso: string, corpo?: unknown) {
    await fetch(`${API}/contatti/${id}/${percorso}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo ?? {}),
    });
    await carica();
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Contatti</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {totale} contatti in anagrafica
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="border-border bg-background rounded border px-3 py-1.5 text-sm"
          placeholder="Cerca per email, nome, azienda…"
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
        />
        <select
          className="border-border bg-background rounded border px-3 py-1.5 text-sm"
          value={iscritto}
          onChange={(e) => setIscritto(e.target.value)}
        >
          <option value="">Tutti</option>
          <option value="true">Iscritti</option>
          <option value="false">Disiscritti</option>
        </select>
        <select
          className="border-border bg-background rounded border px-3 py-1.5 text-sm"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">Tutti i tag</option>
          {tagDisponibili.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="border-border bg-muted/30 hover:bg-muted cursor-pointer rounded border px-3 py-1.5 text-sm">
          Importa CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scegliFile(f);
            }}
          />
        </label>
      </div>

      {errore && (
        <div className="border-border bg-muted/30 rounded border p-4 text-sm">
          <span className="font-medium">CSV rifiutato.</span> {errore}
        </div>
      )}

      {anteprima && (
        <div className="border-border bg-muted/30 space-y-3 rounded border p-4">
          <p className="text-sm font-medium">Anteprima dell'import</p>
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li>{anteprima.righeLette} righe lette</li>
            <li>{anteprima.creati} contatti nuovi</li>
            <li>{anteprima.aggiornati} contatti aggiornati</li>
            <li>
              {anteprima.disiscrittiIntatti} disiscritti che resteranno tali
            </li>
            <li>{anteprima.aziendeCreate} aziende nuove</li>
          </ul>
          <div className="flex gap-2">
            <button
              className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs font-medium hover:opacity-85"
              onClick={() => void confermaImport()}
            >
              Conferma import
            </button>
            <button
              className="border-border rounded border px-3 py-1 text-xs"
              onClick={() => {
                setAnteprima(null);
                setFileScelto(null);
              }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      <div className="border-border overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Azienda</th>
              <th className="px-3 py-2 font-medium">Zona</th>
              <th className="px-3 py-2 font-medium">Tag</th>
              <th className="px-3 py-2 font-medium">Stato</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {righe.map((c) => (
              <tr key={c.id} className="border-border border-t">
                <td className="px-3 py-2">{c.email}</td>
                <td className="px-3 py-2">
                  {[c.nome, c.cognome].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="px-3 py-2">
                  {c.aziendaNome ?? "—"}
                  {c.ruolo && (
                    <span className="text-muted-foreground"> · {c.ruolo}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.comune ?? "—"}
                  {c.provincia && (
                    <span className="text-muted-foreground"> ({c.provincia})</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.tag.map((t) => (
                      <span
                        key={t}
                        className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {c.iscritto ? (
                    <span className="text-muted-foreground text-xs">iscritto</span>
                  ) : (
                    <span className="border-border rounded border px-1.5 py-0.5 text-xs font-medium">
                      disiscritto{c.disiscrittoVia ? ` · ${c.disiscrittoVia}` : ""}
                    </span>
                  )}
                  {c.statoTecnico !== "mai_verificato" && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      · {c.statoTecnico}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.iscritto ? (
                    <button
                      className="border-border rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        const via = window.prompt(
                          "Come si è disiscritto? telefono / email / manuale",
                          "manuale",
                        );
                        if (via) void azione(c.id, "disiscrivi", { via });
                      }}
                    >
                      Disiscrivi
                    </button>
                  ) : (
                    <button
                      className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs font-medium hover:opacity-85"
                      onClick={() => void azione(c.id, "riscrivi")}
                    >
                      Riscrivi
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {righe.length === 0 && !caricamento && (
              <tr>
                <td
                  colSpan={7}
                  className="text-muted-foreground px-3 py-8 text-center"
                >
                  Nessun contatto. Importa un CSV per cominciare.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificare i tipi**

Run: `bun run check`
Expected: nessun errore.

- [ ] **Step 3: Verificare che non ci siano classi Tailwind arbitrarie**

Run: `grep -n "\[#" web/pages/index.tsx || echo "nessuna classe arbitraria"`
Expected: `nessuna classe arbitraria`.

- [ ] **Step 4: Commit**

```bash
git add web/pages/index.tsx
git commit -m "$(cat <<'EOF'
feat: pagina dei contatti con filtri e import

Lo stato di disiscrizione si vede in tabella, col suo `via`, senza dover
aprire nulla: è l'informazione attorno a cui ruota la fase, e nasconderla
in un dialog vorrebbe dire nascondere la cosa importante.

L'import passa dall'anteprima in dry-run e chiede conferma: il numero di
disiscritti che resteranno tali è in cima al rapporto.

Solo token di tema, nessuna classe Tailwind arbitraria: le directory
plugins/* sono escluse dal purge del core e non verrebbero compilate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Verifica end-to-end e documentazione

**Files:**
- Create: `config/contatti.csv.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: tutto quanto precede.
- Produces: nulla di consumabile da altri task; chiude la fase.

- [ ] **Step 1: Creare un CSV di esempio**

Creare `config/contatti.csv.example`:

```csv
email,nome,cognome,azienda,ruolo,tag,provenienza,indirizzo_raw
mario.rossi@esempio.it,Mario,Rossi,Villaggio Sole,Direttore,"villaggi,pilota",export-2026,"Via Zenzalino Nord 145, 40054 Budrio (BO)"
lucia.bianchi@esempio.it,Lucia,Bianchi,Villaggio Sole,Marketing,villaggi,export-2026,
anna.verdi@esempio.it,Anna,Verdi,,,"pilota",contatto-diretto,"Via Emilia 12, 40100 Bologna (BO)"
```

- [ ] **Step 2: Eseguire la prova end-to-end dell'import**

Run:

```bash
bun -e "
const { Database } = await import('bun:sqlite');
const { readFileSync } = await import('node:fs');
const { importaCsv } = await import('./server/import.ts');
const { elencaContatti, trovaPerEmail, disiscrivi } = await import('./server/contatti.ts');

const db = new Database(':memory:');
db.run('PRAGMA foreign_keys = ON');
db.run(readFileSync('migrations/20260912_000000_contatti.sql','utf8'));
const csv = readFileSync('config/contatti.csv.example','utf8');

console.log('primo import  ', importaCsv(db, csv).rapporto);
const c = trovaPerEmail(db, 'mario.rossi@esempio.it');
disiscrivi(db, c.id, 'telefono');
console.log('secondo import', importaCsv(db, csv).rapporto);
const dopo = trovaPerEmail(db, 'mario.rossi@esempio.it');
console.log('mario iscritto?', dopo.iscritto, '| via:', dopo.disiscrittoVia);
console.log('totale contatti:', elencaContatti(db).totale);
"
```

Expected:
- primo import: `creati: 3, aggiornati: 0, aziendeCreate: 1`
- secondo import: `creati: 0, aggiornati: 3, disiscrittiIntatti: 1`
- `mario iscritto? false | via: telefono`
- `totale contatti: 3`

Se `mario iscritto?` stampa `true`, la regola centrale è rotta: tornare al Task 4 e cercare `iscritto` nella `UPDATE`.

- [ ] **Step 3: Aggiornare il README**

Sostituire il contenuto di `README.md`:

```markdown
# Fboschetti Newsletter

Plugin Agentic Hub con slug `fboschetti-newsletter`.

Riceve edizioni già pronte (`.txt` + `.html`), verifica che siano integre,
tiene l'anagrafica dei destinatari e le consegna al trasporto del core.
Non scrive le newsletter e non le impagina.

Roadmap delle fasi: [docs/ROADMAP.md](docs/ROADMAP.md).

## Stato

Fase 1 — anagrafica dei contatti: fatta.

## Anagrafica contatti

Contatti e aziende, con tag, indirizzo e doppio stato: `iscritto` è la
volontà della persona, `stato_tecnico` la salute dell'indirizzo. L'invio
richiederà entrambe le condizioni.

### Import da CSV

```bash
bun run scripts/import-contatti.ts data/contatti.csv --dry-run   # prova
bun run scripts/import-contatti.ts data/contatti.csv             # importa
```

Formato in `config/contatti.csv.example`. `email` è l'unica colonna
obbligatoria; le altre possono mancare.

L'import è idempotente sull'email e **non riporta mai un disiscritto fra
gli iscritti**: chi si è disiscritto per telefono non rientra col prossimo
CSV. La riscrizione è un'azione manuale dalla pagina del plugin.

Un file con una colonna ignota o un'email non valida viene rifiutato
intero, senza scrivere nulla.

## Verifica

```bash
bun test tests/
bun run check
```
```

- [ ] **Step 4: Eseguire l'intera verifica**

Run: `bun test tests/ && bun run check`
Expected: tutti i test verdi, nessun errore di tipo.

- [ ] **Step 5: Commit**

```bash
git add config/contatti.csv.example README.md
git commit -m "$(cat <<'EOF'
docs: CSV di esempio e README della Fase 1

Il CSV di esempio serve anche da verifica end-to-end: importarlo due
volte, con una disiscrizione in mezzo, esercita la regola centrale della
fase su dati veri invece che su fixture di test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Verifica finale della fase

Il criterio di "fatto" della roadmap: *importi un CSV, vedi i contatti, li
modifichi, disiscrivi qualcuno, reimporti lo stesso file e il disiscritto resta
disiscritto.*

- [ ] `bun test tests/` — tutti verdi
- [ ] `bun run check` — nessun errore di tipo
- [ ] Il comando end-to-end del Task 8 stampa `mario iscritto? false`
- [ ] Installazione nel core, dalla root del core:
      `bun run plugin install <path-del-plugin>` poi `bun run plugin list`
- [ ] Con il server avviato, la pagina "Contatti" compare in sidebar
      (Vite va riavviato perché una pagina nuova compaia)
- [ ] Dopo lo stop del server non restano file `-wal`/`-shm`:
      `ls plugins/fboschetti-newsletter/db/db.sqlite-wal 2>/dev/null && echo "residui" || echo "ok"`

Gli ultimi tre passi richiedono il core installato e non sono eseguibili in
isolamento: vanno fatti da Francesco, o in una sessione con il core a
disposizione.
