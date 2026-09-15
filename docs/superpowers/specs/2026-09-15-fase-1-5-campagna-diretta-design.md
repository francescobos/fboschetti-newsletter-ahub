# Spec — Fase 1.5: Campagna diretta nel Core

**Data**: 2026-09-15
**Stato**: approvata in brainstorming, da implementare
**Fase**: 1.5 di [ROADMAP.md](../../ROADMAP.md)

---

## Obiettivo

Mandare una campagna vera ai contatti, prima che esistano le validazioni.

**Fatto quando**: data una coppia `.txt` + `.html` su disco e un oggetto, viene
creata e avviata una campagna nel core per i contatti iscritti, e il core
restituisce lo stato di avanzamento.

---

## Cos'è questa fase, e cosa non è

È **la spina dorsale delle Fasi 2 e 4, costruita nella sua versione minima**.

La roadmap la descriveva come un'anticipazione per iniziare l'outreach mentre
il lavoro architetturale prosegue. Il rischio di quella formulazione è il
codice usa-e-getta: una route che accoda al volo, da buttare quando arrivano le
fasi vere. Questa spec lo evita prendendo dalle Fasi 2 e 4 il **percorso**, e
lasciando fuori i **controlli**.

| Preso ora | Rinviato |
| :--- | :--- |
| Tabella `edizioni` con macchina a stati | Validatore deterministico (Fase 2) |
| Import della coppia `.txt` + `.html` da percorso | Confronto strutturale testo/HTML (Fase 2) |
| Risoluzione dei destinatari dal DB | Validazione semantica LM Studio (Fase 3) |
| `ref` deterministico | Congelamento formale della lista (Fase 4) |
| `enqueueCampaign` + `startCampaign` + `getCampaign` | Forzature registrate (Fase 4) |
| Invio di prova a sé stessi | Storico e osservabilità (Fase 5) |
| Verifica della presenza del `mailto:` di disiscrizione | Link con token per destinatario (richiede modifica al core) |

La macchina a stati nasce già ora, con quattro stati:

```text
bozza ──► pronta ──► in_invio ──► inviata
  │          │           │
  │          │           └─ campagna avviata, il core la sta drenando
  │          └─ campagna accodata nel core, ferma in `queued`
  └─ coppia importata, nessun controllo (in 1.5 è già accodabile)
```

Le Fasi 2 e 3 **non la creano**: vi inseriscono `validata_tech` e
`validata_semantica` fra `bozza` e `pronta`, senza toccare gli altri stati. È
questo che rende il pezzo riusabile invece che sacrificabile.

**Nota sulla semantica di `pronta`.** Nella roadmap `pronta` significa
«validata, soggetto e destinatari risolti, `ref` calcolato: accodabile». Qui
significa «accodata nel core e in attesa di avvio», perché senza validazioni
un'edizione in `bozza` è già accodabile e uno stato intermedio sarebbe
irraggiungibile.

Quando le Fasi 2 e 3 introdurranno le validazioni, `pronta` tornerà a
significare «accodabile» e lo stato post-accodamento si chiamerà come serve.
È una divergenza temporanea e consapevole dalla roadmap, non una svista.

---

## Un vincolo del core, verificato

`mail-worker.ts:45` compone il messaggio per ogni destinatario così:

```ts
function messageFor(campaign: Campaign, toAddr: string): TransportMessage {
  return {
    to: [toAddr],
    subject: campaign.subject,
    text: campaign.textBody ?? undefined,
    html: campaign.htmlBody ?? undefined,
    // …
  };
}
```

I corpi vengono **dalla campagna**, identici per tutti. Cambia solo il
destinatario. Il core non supporta oggi dati variabili per destinatario.

**Conseguenza**: un link di disiscrizione con token personalizzato per contatto
è impossibile con una sola campagna. L'unica alternativa sarebbe accodare una
campagna per destinatario, che getterebbe via ritmo, contatori e idempotenza —
cioè tutto ciò per cui esistono le campagne. È fuori discussione.

**Dipendenza dichiarata**: la soluzione vera è il supporto a dati variabili per
destinatario nel core. È lavoro sul core, non su questo plugin, e non è
prerequisito di questa fase.

---

## Schema dati

Una tabella nuova. Nessuna modifica a quelle della Fase 1.

### `edizioni`

```sql
CREATE TABLE edizioni (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ref               TEXT NOT NULL UNIQUE,
  oggetto           TEXT NOT NULL,
  testo             TEXT NOT NULL,
  html              TEXT NOT NULL,
  percorso_origine  TEXT,
  stato             TEXT NOT NULL DEFAULT 'bozza'
                    CHECK (stato IN
                      ('bozza','pronta','in_invio','inviata')),
  campagna_id       TEXT,
  avviso_mailto     TEXT,
  filtro_tag        TEXT,
  destinatari_n     INTEGER,
  creato_il         INTEGER NOT NULL,
  aggiornato_il     INTEGER NOT NULL,
  accodata_il       INTEGER,
  avviata_il        INTEGER
);

CREATE INDEX idx_edizioni_stato ON edizioni(stato);
```

**Perché queste colonne.**

`ref` è `UNIQUE` anche qui, non solo nel core. La protezione del core scatta
all'accodamento; questa scatta all'ingestione, quando l'errore costa ancora
nulla. Due edizioni con lo stesso `ref` sono un errore a prescindere.

`campagna_id` è l'id restituito da `enqueueCampaign`. Si conserva perché
`startCampaign` lo richiede, mentre `getCampaign` accetta anche il `ref`.

`avviso_mailto` conserva l'esito della verifica di disiscrizione: `NULL` se il
blocco c'è, il testo dell'avviso se manca. Non blocca, si vede.

`destinatari_n` è il numero risolto al momento dell'accodamento. Non è un
contatore da mantenere: è una fotografia di quanti erano, scattata quando
contava. I contatori veri stanno nel core e si leggono da lì.

`testo` e `html` sono `NOT NULL`: una coppia incompleta non entra. È la regola
della Fase 2 applicata già ora, ed è l'unica che questa fase anticipa.

**Cosa non c'è**: nessuna colonna per gli stati di errore, nessun rapporto di
validazione, nessun registro di chi ha ricevuto cosa. Arrivano con le fasi che
li producono.

### Migration

`migrations/20260915_000000_edizioni.sql`, ordine lessicografico dopo
`20260912_000000_contatti.sql`. Solo `CREATE TABLE` e `CREATE INDEX`: non
tocca nulla di esistente.

---

## Il `ref`

Il `ref` è il nome che identifica una campagna, ed è ciò che impedisce di
mandarla due volte. Il core lo protegge con un vincolo di schema
(`schema.sql:111`):

```sql
UNIQUE (plugin, ref)
```

Riaccodare lo stesso `ref` fallisce a livello di database. Non è una
convenzione applicativa.

**Lo scrive l'utente**, non è derivato dal nome dei file. La derivazione
automatica sarebbe più a prova di distrazione, ma dipende da quanto
disciplinato è chi nomina i file: un agente che consegna sempre
`newsletter.txt` produrrebbe un `ref` già visto e un fallimento fastidioso
proprio perché formalmente corretto.

**Il plugin lo normalizza e mostra il risultato prima di confermare.**

```text
"Newsletter Settembre 2026"  →  newsletter-settembre-2026
"outreach villaggi  autunno" →  outreach-villaggi-autunno
```

Normalizzazione: minuscole, spazi e caratteri non ammessi convertiti in
trattini, trattini multipli collassati, trattini iniziali e finali rimossi.
Restano solo `[a-z0-9-]`.

**Perché normalizzare invece di rifiutare.** L'unicità è un confronto esatto:
`"newsletter settembre"` e `"newsletter  settembre"` sono `ref` diversi per il
database, e uno spazio finale incollato per sbaglio è invisibile. Il vincolo
che dovrebbe fermare il doppio invio non scatterebbe, e l'utente vedrebbe due
nomi apparentemente identici. È il modo in cui una protezione fallisce in
silenzio.

Il pericolo sta tutto nel non vedere gli spazi. Mostrare il `ref` normalizzato
prima della conferma lo elimina: **quello che si vede è quello che il vincolo
userà davvero**.

Il `ref` è inoltre immutabile dall'accodamento in poi.

---

## La disiscrizione

Finché il core non supporta dati variabili per destinatario, il link con token
è impossibile (vedi sopra). La forma adottata è un **`mailto:` con oggetto
precompilato**:

```text
mailto:indirizzo@dominio?subject=Vorrei%20disiscrivermi
```

È un link cliccabile a tutti gli effetti: un click apre il client di posta con
destinatario e oggetto già compilati, alla persona resta da premere invia.
Nessuna infrastruttura, nessun token, e nessuna promessa che il sistema non
può mantenere. Accanto al link, una riga che spiega brevemente perché per ora
la disiscrizione funziona così.

**Lo scrive l'agente dei contenuti, non il plugin.** La roadmap è esplicita: il
plugin «non deriva, non converte, non spoglia». Appendere un blocco HTML
significherebbe diventare un editor dei corpi — e appendere correttamente
dentro un HTML impaginato non è banale: dentro quale tag, con quale stile.

**Il plugin verifica e avvisa.** All'ingestione cerca un `mailto:` in entrambi
i corpi. Se manca, l'edizione entra comunque, con `avviso_mailto` valorizzato
e visibile nella UI. Avvisa, non blocca: un blocco duro in una fase minima
fermerebbe per un dettaglio di formattazione.

L'indirizzo è quello mittente del core. Il plugin **non lo verifica**: non ha
accesso a `mailFrom`, che è configurazione del core e non è esposta nelle
`deps`. Controlla che esista un `mailto:`, non a chi punta.

Quando qualcuno scrive, la disiscrizione si fa dalla UI dei contatti con
`disiscrivi(id, 'email')`, che esiste già dalla Fase 1.

---

## Moduli e confini

Quattro moduli, ognuno testabile senza il core.

### `server/edizioni.ts`

CRUD dell'edizione e transizioni di stato. **Non sa nulla di mail né di
contatti.**

```ts
creaEdizione(db, dati): number
leggiEdizione(db, id): Edizione | null
elencaEdizioni(db, filtri?): { righe: Edizione[]; totale: number }
avanzaStato(db, id, nuovo: Stato, dati?): void
normalizzaRef(grezzo: string): string
```

La macchina a stati vive qui, ed è qui che le Fasi 2 e 3 aggiungeranno i loro
stati. `avanzaStato` rifiuta le transizioni non previste: lo stato è un
cancello, non un'etichetta.

`normalizzaRef` è una funzione pura, testabile da sola.

### `server/ingestione.ts`

Dato un percorso, legge la coppia e crea l'edizione.

```ts
ingestaDaPercorso(db, { percorso, ref, oggetto }): EsitoIngestione
```

Il percorso è una directory contenente un `.txt` e un `.html`, oppure il
percorso di uno dei due file (l'altro si cerca con la stessa radice). Entrambi
obbligatori: coppia incompleta, niente edizione.

Qui dentro anche la verifica del `mailto:`, che popola `avviso_mailto`.

È il punto d'ingresso che l'agente dei contenuti userà. La Fase 2 innesta il
validatore **senza cambiarne la firma**.

### `server/destinatari.ts`

Funzione pura sul DB.

```ts
risolviDestinatari(db, filtri?: { tag?: string }): string[]
```

Applica `iscritto = 1 AND stato_tecnico != 'rimbalzato'`, più il tag se
indicato. Restituisce email normalizzate.

Questo modulo la Fase 4 lo prende **così com'è**.

### `server/campagne.ts`

Il wrapper su `deps.mail`. **Non tocca il DB dei contatti**: riceve la lista
già risolta.

```ts
accoda(mail, edizione, destinatari): Promise<{ id: string }>
avvia(mail, campagnaId): Promise<void>
statoCampagna(mail, ref): Promise<Campaign | null>
prova(mail, edizione, indirizzo): Promise<{ id: string }>
```

Gestisce `mail === null` (core non disponibile) restituendo un errore
esplicito, mai un fallimento silenzioso.

`prova` usa `mail.send()`, non una campagna: è sincrono, arriva subito e **non
consuma il `ref`**.

**Perché `destinatari` e `campagne` sono separati**: è ciò che permette di
testare la risoluzione senza il core e l'accodamento senza il DB dei contatti.

---

## Route

Montate sotto `/api/plugins/fboschetti-newsletter`.

| Metodo | Percorso | Cosa fa |
| :--- | :--- | :--- |
| `GET` | `/edizioni` | Elenco con stato |
| `POST` | `/edizioni` | Ingesta da percorso → `bozza` |
| `GET` | `/edizioni/:id` | Dettaglio, corpi inclusi |
| `GET` | `/edizioni/:id/destinatari` | Anteprima: quanti e quali |
| `POST` | `/edizioni/:id/prova` | `mail.send()` all'indirizzo indicato |
| `POST` | `/edizioni/:id/accoda` | `enqueueCampaign` → `pronta` |
| `POST` | `/edizioni/:id/avvia` | `startCampaign` → `in_invio` |
| `GET` | `/edizioni/:id/stato` | `getCampaign`, rispecchiato dal core |

### Una modifica alle route esistenti

`createRoutes` dichiara oggi `deps: { db, slug, projectRoot }`, mentre il core
passa anche `mail` (`plugin-server.ts:29`). Il tipo va esteso con
`mail: MailApi | null`.

È una riga, ma è il punto in cui il plugin acquisisce la capacità di spedire.

### Le protezioni sono nei passi, non in un flag

**Accodare e avviare sono due azioni distinte.** È già la semantica del core; la
UI la espone come due bottoni invece di fonderla in uno. Fra l'una e l'altra la
campagna è ferma in `queued` e non parte nulla.

**La prova precede il reale.** `POST /prova` usa `mail.send()`, quindi si può
ripetere quante volte serve senza toccare il `ref`.

**L'anteprima precede l'accodamento.** Il numero dei destinatari si vede prima,
non a invio partito.

**Il `ref` normalizzato si vede prima di confermare.** L'ingestione restituisce
il `ref` effettivo; è quello a finire nel vincolo di unicità.

### Stato: si legge, non si duplica

`GET /edizioni/:id/stato` chiama `getCampaign` e restituisce ciò che il core
dice. I contatori non si copiano nella tabella `edizioni`: `in_invio` e
`inviata` non sono verità del plugin.

---

## Pagina UI

`web/pages/edizioni.tsx`, accanto a quella dei contatti, sotto le stesse regole
(componenti del core, `Header` e `Main`, token di tema, niente valori
arbitrari). `web/pages/index.tsx` resta il modello.

Mostra l'elenco delle edizioni con il loro stato, e per ognuna **solo le azioni
disponibili in quello stato**: la UI rispecchia la macchina a stati, non la
aggira.

- In `bozza`: anteprima destinatari, invio di prova, accodamento.
- In `pronta`: avvio della campagna, e stato dal core (`queued`).
- In `in_invio`: stato e contatori dal core, aggiornabili.
- In `inviata`: contatori finali letti dal core.

L'`avviso_mailto`, se presente, è visibile sull'edizione: non è un errore, è
qualcosa da sapere prima di mandare.

Se `deps.mail` è `null` la pagina lo dice, invece di mostrare bottoni che
falliscono.

---

## Test

`bun test tests/`, senza core e senza mail vere.

| File | Copre |
| :--- | :--- |
| `tests/edizioni.test.ts` | Transizioni valide e rifiutate, `ref` duplicato, `normalizzaRef` |
| `tests/ingestione.test.ts` | Coppia completa, coppia incompleta, verifica `mailto:` |
| `tests/destinatari.test.ts` | Filtro iscritti e rimbalzati, filtro per tag |
| `tests/campagne.test.ts` | Accodamento, avvio, stato, `mail === null` |

`campagne.test.ts` usa un finto `MailApi`: nessun test manda mail. I casi che
contano sono il `ref` duplicato che fallisce in modo pulito e il `null`
gestito.

`normalizzaRef` va coperta sui casi che la motivano: spazi multipli, spazio
finale, maiuscole, caratteri non ammessi.

---

## Fuori perimetro

| Cosa | Dove |
| :--- | :--- |
| Validatore deterministico e confronto strutturale | Fase 2 |
| Validazione semantica LM Studio | Fase 3 |
| Stati di errore e forzature registrate | Fasi 2, 3, 4 |
| Storico di chi ha ricevuto cosa | Fase 5 |
| Job schedulabile di aggiornamento stato | Fase 5 |
| Link di disiscrizione con token | Dipende da dati variabili per destinatario nel core |
| Edge function per la disiscrizione | Superata dal `mailto:` |
| Modifica dei corpi da parte del plugin | Contraria al principio della roadmap |
