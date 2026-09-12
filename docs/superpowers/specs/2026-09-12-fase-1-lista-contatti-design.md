# Spec — Fase 1: Lista contatti

**Data**: 2026-09-12
**Stato**: approvata in brainstorming, da implementare
**Fase**: 1 di [ROADMAP.md](../../ROADMAP.md)

---

## Obiettivo

La lista dei contatti esiste, si popola da CSV, si cura dalla UI.

**Fatto quando**: importi un CSV, vedi i contatti, li modifichi, disiscrivi
qualcuno, reimporti lo stesso file e il disiscritto resta disiscritto.

---

## Una decisione che allarga il perimetro

La roadmap descriveva `contatti` come la lista dei destinatari. Questa spec la
tratta invece come **l'anagrafica delle persone**, di cui l'iscrizione alla
newsletter è un attributo fra tanti.

La ragione è l'outreach. I contatti che entreranno qui sono in larga parte
prospect, e su un prospect servono cose che a un destinatario non servono:
l'azienda, il ruolo, un indirizzo fisico per organizzare visite in zona.

Ne discendono due tabelle che la roadmap non prevedeva, `aziende` e i campi
d'indirizzo, e una conseguenza da assumere: **il costo di questa scelta è tutto
oggi, con la lista vuota**. Aggiungere `aziende` più tardi, su una tabella con
centinaia di ragioni sociali scritte a mano in varianti diverse, significa
scrivere uno script di deduplica che nessuno scrive volentieri.

L'azienda **non** è qui perché servano più contatti per azienda — caso raro per
un freelance. È qui perché è il posto dove appendere ciò che si sa dell'azienda:
settore, sito, note, esiti di analisi. Senza una riga propria, quelle
informazioni finiscono in note libere sulla persona, dove non sono
interrogabili e vanno riscritte per ogni contatto della stessa azienda.

Resta fuori perimetro tutto il resto del CRM: telefono, LinkedIn, città come
campo a sé, pipeline, stati di trattativa. Si aggiungono quando avranno un uso
concreto.

---

## Schema dati

Sei tabelle. Solo `contatti` e `tag` verranno lette dalle fasi successive.

### `aziende`

```sql
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
```

### `contatti`

```sql
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
```

### `tag`, `contatti_tag`

```sql
CREATE TABLE tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE contatti_tag (
  contatto_id INTEGER NOT NULL REFERENCES contatti(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tag(id)      ON DELETE CASCADE,
  PRIMARY KEY (contatto_id, tag_id)
);
```

### `import_csv`

```sql
CREATE TABLE import_csv (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  eseguito_il INTEGER NOT NULL,
  origine     TEXT    NOT NULL,
  righe_lette INTEGER NOT NULL,
  creati      INTEGER NOT NULL,
  aggiornati  INTEGER NOT NULL,
  rapporto    TEXT    NOT NULL
);
```

### Indici

```sql
CREATE INDEX idx_contatti_azienda   ON contatti(azienda_id);
CREATE INDEX idx_contatti_iscritto  ON contatti(iscritto);
CREATE INDEX idx_contatti_comune    ON contatti(comune);
CREATE INDEX idx_contatti_provincia ON contatti(provincia);
CREATE INDEX idx_aziende_provincia  ON aziende(provincia);
```

### Perché queste scelte

**`COLLATE NOCASE` su `email` e su `aziende.nome`.** L'idempotenza è
sull'email, e `Mario@Esempio.it` e `mario@esempio.it` sono la stessa casella.
Senza `NOCASE` il secondo import creerebbe un doppione, e un doppione in questa
tabella è un invio doppio in Fase 4. Si normalizza comunque a minuscolo in
scrittura: `NOCASE` è la rete di sicurezza sul vincolo `UNIQUE`.

**`CHECK` sui valori chiusi.** Il DB rifiuta uno `stato_tecnico` inventato
invece di accettarlo in silenzio. Costa una migration se un giorno si aggiunge
un valore; in cambio un bug di scrittura si manifesta subito, non mesi dopo
quando fa saltare il filtro dei destinatari.

**`ON DELETE SET NULL` su `azienda_id`, non `CASCADE`.** Cancellare un'azienda
non deve cancellare le persone: si perderebbero contatti iscritti per aver
ripulito un'anagrafica. Il contatto sopravvive, resta senza azienda.

**`indirizzo_raw` accanto ai campi scomposti.** Conserva la stringa come è
stata incollata, e non viene mai riscritta. Serve a tre cose: permette di
incollare un indirizzo senza compilare nulla; è l'input del parser della Fase 6;
ed è la fonte di verità se quel parser sbaglia, perché consente di rilanciarlo
su tutta la tabella senza aver perso l'originale.

**`lat`/`lon` previste ma non popolate.** Il filtro per provincia si ottiene
dalle colonne scomposte; il raggio in chilometri no — richiede geocodifica
esterna. Due colonne vuote costano nulla oggi ed evitano una migration domani.
La provincia è un cattivo proxy della distanza: due paesi a 8 km possono stare
in province diverse, e la stessa provincia può essere lunga 90 km.

**`import_csv` non è nella roadmap.** È aggiunta qui perché il criterio di
"fatto" della fase è un comportamento nel tempo — *reimporti e il disiscritto
resta disiscritto* — e senza uno storico quel comportamento si verifica solo
ispezionando le righe una per una.

### Migration

`migrations/20260909_000000_init.sql` **non si tocca**: potrebbe essere già
applicata in istanze esistenti. Si aggiunge un file nuovo che crea queste
tabelle ed elimina `righe`, la tabella demo dello scaffold.

---

## La regola di idempotenza

È il cuore della fase. Comportamento per ogni riga di CSV:

| Situazione | Cosa fa l'import |
| :--- | :--- |
| Email non esiste | Crea il contatto, `iscritto = 1`, `stato_tecnico = mai_verificato` |
| Esiste, `iscritto = 1` | Aggiorna i campi che il CSV porta; **unisce** i tag |
| Esiste, `iscritto = 0` | Aggiorna i campi e i tag, **non tocca** `iscritto`, `disiscritto_il`, `disiscritto_via` |

**La regola che non si negozia**: *l'import non scrive mai `iscritto = 1` su un
contatto esistente.* Chi si è disiscritto per telefono non rientra col prossimo
CSV. Va implementata come guardia esplicita nel codice, non come effetto
collaterale della query di update. La riscrizione è solo un'azione manuale
dalla UI.

**I tag si uniscono, non si sostituiscono.** Se un contatto ha `villaggi` e il
CSV porta `pilota`, dopo l'import ne ha due. Sostituirli renderebbe l'import
distruttivo su dati curati a mano, e un import non deve poter cancellare lavoro
manuale.

**Un campo vuoto nel CSV non cancella.** Nome vuoto significa "non ho questa
informazione", non "cancella il nome". Vale per tutti i campi opzionali.

**L'azienda si risolve o si crea.** La colonna `azienda` del CSV contiene una
ragione sociale, non un id: se esiste viene collegata, se non esiste viene
creata. Il confronto è case-insensitive, quindi non si duplica per differenza
di maiuscole.

---

## Contratto del CSV

Intestazioni fisse e obbligatorie. `email` è l'unica colonna richiesta; le
altre sono opzionali e possono mancare del tutto.

```csv
email,nome,cognome,azienda,ruolo,tag,provenienza,indirizzo_raw
mario@esempio.it,Mario,Rossi,Villaggio Sole,Direttore,"villaggi,pilota",export-2026,"Via Zenzalino Nord 145, 40054 Budrio (BO)"
```

I tag stanno in un solo campo, separati da virgola, racchiuso fra virgolette.

**Severità: l'import fallisce in blocco e non scrive nulla** se manca la
colonna `email`, se compare una colonna non riconosciuta, o se una riga
qualsiasi ha email vuota o non valida. Il rapporto dice quale riga e perché.

La ragione è la stessa della validazione di Fase 2: un file sbagliato si
corregge e si rilancia, mentre un import parziale lascia la lista in uno stato
che nessuno sa descrivere.

---

## Moduli e confini

Il vincolo viene dal devkit: le route ricevono `deps.db` già aperto, gli script
aprono il file da soli via `openPluginDb` (`@hub/plugin-db`), e i test devono
girare con `bun test tests/` **senza il core installato**.

```text
scripts/import-contatti.ts ─┐        wiring: qui, e solo qui, @hub/*
server/routes.ts ───────────┤
                            ▼
                    server/contatti.ts   CRUD, disiscrizione, riscrizione
                    server/import.ts     idempotenza, unione tag, rapporto
                    server/csv.ts        parsing e validazione del CSV
                            ▼
                      Database (bun:sqlite)
```

**La regola: sotto il wiring non si importa `@hub/*`.** I moduli ricevono un
`Database` come parametro e non sanno da dove venga. È ciò che rende i test
eseguibili su un DB in memoria, ed è il motivo per cui i file sono tre e non
uno.

`csv.ts` è separato da `import.ts` perché il parsing — leggere testo, validare
intestazioni ed email, produrre righe tipizzate — non tocca il DB ed è una
funzione pura. È la parte che si sbaglia più facilmente e quella che si testa
meglio in isolamento.

Lo script apre il DB con `openPluginDb(slug, projectRoot)` e imposta
`PRAGMA busy_timeout`: il devkit lo richiede per la concorrenza WAL con il
server. `projectRoot` si deriva con `resolve(process.cwd(), "..", "..")`.
Nessun fallback a `new Database(...)` grezzo: bypasserebbe le migration.

---

## Route

Montate sotto `/api/plugins/fboschetti-newsletter`.

| Metodo e path | Cosa fa |
| :--- | :--- |
| `GET /contatti` | Lista paginata; filtri per testo, tag, `iscritto`, `stato_tecnico`, provincia |
| `POST /contatti` | Crea a mano |
| `PATCH /contatti/:id` | Modifica campi, azienda, ruolo, indirizzo, tag |
| `POST /contatti/:id/disiscrivi` | Richiede `via`; imposta `iscritto = 0` e `disiscritto_il` |
| `POST /contatti/:id/riscrivi` | Azione deliberata; azzera `disiscritto_il` e `disiscritto_via` |
| `GET /aziende` | Lista con conteggio contatti |
| `POST /aziende` · `PATCH /aziende/:id` | Anagrafica aziende |
| `GET /tag` | Elenco per i filtri |
| `POST /import` | Upload CSV; `?dry_run=1` per l'anteprima |
| `GET /import` | Storico degli import |

**Non esiste `DELETE /contatti/:id`.** La roadmap è netta: un disiscritto non
si cancella, perché cancellarlo lo espone al reimport. Non si espone una rotta
che contraddice la regola centrale della fase.

**L'import ha un `dry_run`.** La stessa funzione calcola il rapporto senza
scrivere, in una transazione con rollback. Serve all'anteprima nella UI prima
della conferma, ed è anche la via più pulita per testare l'idempotenza.

---

## Pagina UI

Una sola pagina, `web/pages/index.tsx`, in sidebar con icona `mail` (palette
chiusa: `activity bot mail rocket terminal wrench zap`).

- Tabella dei contatti con barra dei filtri: ricerca testuale, tag, stato
  iscrizione, stato tecnico, provincia.
- Dialog di modifica: dati della persona, azienda con ricerca o creazione,
  ruolo, indirizzo, tag.
- Import con anteprima: si carica il file, si legge il rapporto in `dry_run`,
  si conferma.
- Azioni di disiscrizione e riscrizione, entrambe con il `via` richiesto.

**Un contatto disiscritto si vede a colpo d'occhio**, con un badge che riporta
anche il `via`. È l'informazione attorno a cui ruota la fase: se serve aprire
un dialog per scoprirla, la UI nasconde la cosa importante.

Componenti e token del core (`Table`, `Input`, `Select`, `Dialog`, `Badge`,
`Button`, `cn`, `bg-background`, `text-muted-foreground`). Niente classi
Tailwind con valori esadecimali arbitrari: le directory `plugins/*` sono
escluse dal purge del core e quelle classi non verrebbero compilate.

---

## Test

In `tests/`, su DB in memoria, senza core e senza browser.

- Reimportare lo stesso CSV non crea doppioni e non cambia i contatori.
- **Un disiscritto resta disiscritto dopo il reimport.** È il criterio di
  "fatto" della fase: il test che giustifica tutti gli altri.
- `Mario@Esempio.it` e `mario@esempio.it` sono lo stesso contatto.
- I tag si uniscono, non sostituiscono.
- Un campo vuoto nel CSV non cancella il valore esistente.
- Un'azienda viene risolta se esiste, creata se non esiste, mai duplicata per
  differenza di maiuscole.
- CSV con colonna mancante, colonna ignota o email non valida: import rifiutato
  in blocco, DB intatto.
- `dry_run` non scrive nulla e produce lo stesso rapporto dell'import reale.
- Cancellare un'azienda non cancella i suoi contatti (`SET NULL`), con
  `PRAGMA foreign_keys` attivo sulla connessione — dichiararlo nella migration
  non basta, il core applica le migration in transazione e SQLite ignora quel
  pragma dentro una transazione.

---

## Fuori perimetro

| Cosa | Dove vive |
| :--- | :--- |
| Parsing e scomposizione automatica dell'indirizzo | Fase 6 |
| Geocodifica, `lat`/`lon`, ricerca per raggio | Fase 6 |
| Telefono, LinkedIn, pipeline, stati di trattativa | Non previsti |
| Cancellazione di un contatto | Mai: contraddice l'idempotenza |
| Disiscrizione con link e token | Ponte, Progetto 3 |
| Scrittura automatica di `stato_tecnico` sui rimbalzi | Ponte, Progetto 3 |

In Fase 1 `stato_tecnico` esiste con il suo dominio completo e si modifica a
mano dalla UI: se si viene a sapere che un indirizzo è morto, lo si registra.
La fase che gestirà i rimbalzi lo troverà pronto, senza migration.
