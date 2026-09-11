# ROADMAP — Plugin newsletter (Progetto 2)

**Data**: 2026-09-09
**Stato**: approvata
**Natura**: roadmap di fasi. Non è una spec: ogni fase avrà la sua sessione di
brainstorming, la sua spec e il suo piano.

Discende dalla mappa dei tre progetti, Progetto 2. Dove diverge dalla mappa, il
motivo è indicato.

> **Mappa di riferimento**: `STUDIO_42_BF/7.Sistemi-Informativi-IT/Progetti_Attivi/`
> `26-09-Sistema-Generale-Plugin-Newsletter/2026-08-20-newsletter-agentic-hub-mappa.md`

---

## Cos'è questo plugin

Il plugin `fboschetti-newsletter` **non scrive** le newsletter e **non le
impagina**. Riceve edizioni già pronte, verifica che siano integre, tiene la
lista dei destinatari e le consegna al trasporto del core.

È un ingestore e uno spedizioniere, non un authoring tool.

La campagna del core vuole due corpi, `text` e `html`, e **il plugin li riceve
entrambi già pronti**. Non deriva, non converte, non spoglia: qualunque
trasformazione qui dentro reintrodurrebbe proprio il rischio — testo mutilato,
sintassi residua, link persi — che la consegna di file pronti elimina. Ciò che
parte è, byte per byte, ciò che l'agente dei contenuti ha consegnato.

```text
agente contenuti ──► .txt + .html ──► [ plugin ] ──► campagna del core ──► Resend
                                        │
                                   lista contatti
```

---

## Cosa è cambiato rispetto alla mappa

Due fatti nuovi ridisegnano il perimetro.

**Il core fa più di quanto la mappa desse per fatto.** Il devkit
(`docs/plugin/email-e-campagne.md`) documenta non solo l'invio HTML+testo, ma
l'intera meccanica di volume: campagne asincrone, ritmo di 10 mail ogni 4
secondi, retry sui transitori, ripresa dopo riavvio, idempotenza via `ref`,
isolamento fra plugin. Le fasi 4 e 5 della mappa — HTML e liste vere — **non
sono più bloccate**: il vincolo «solo testo, cerchia ristretta» descriveva un
core che oggi non è più quello.

**Il contenuto arriva da fuori, in entrambe le forme.** L'agente dei contenuti
consegna il testo *e* l'HTML impaginato, già nella forma in cui partiranno. Cade
quindi dal perimetro del plugin tutto ciò che la mappa collocava qui: il guscio
di marca, il convertitore markdown → HTML, e la derivazione della versione
testuale.

Con una conseguenza da assumere consapevolmente: la mappa garantiva che HTML e
testo non divergessero facendoli derivare dallo stesso sorgente. Arrivando come
file separati e indipendenti, quella garanzia sparisce. La sostituisce la
**validazione in ingresso** (fasi 2 e 3), che è la sola ragione per cui esiste.

---

## Il concetto centrale: gli stati dell'edizione

Tutto il plugin ruota attorno alla macchina a stati di un'edizione. Le fasi
sono affettate lungo di essa: ognuna porta l'edizione un tratto più avanti.

```text
bozza ──► validata_tech ──► validata_semantica ──► pronta ──► in_invio ──► inviata
   │            │                    │
   │            ▼                    ▼
   │      errore_tech          errore_semantica
   │            │                    │
   └────────────┴────────────────────┘
              correggi i file e rivalida
```

| Stato | Significato |
| :--- | :--- |
| `bozza` | File importati, nessun controllo superato |
| `validata_tech` | Controllo deterministico superato |
| `errore_tech` | Controllo deterministico fallito, con rapporto |
| `validata_semantica` | Il modello locale conferma che testo e HTML dicono la stessa cosa |
| `errore_semantica` | Il modello rileva divergenza, con rapporto |
| `pronta` | Soggetto e destinatari risolti, `ref` calcolato: accodabile |
| `in_invio` | Campagna accodata e avviata nel core |
| `inviata` | Campagna conclusa (`sent` o `sent_with_errors`) |

Tre regole che valgono per tutte le fasi:

- **Un'edizione non in `pronta` non si accoda.** Lo stato è il cancello, non
  un'etichetta descrittiva.
- **Gli stati di errore non sono terminali.** Si correggono i file e si
  rivalida. In alternativa si forza l'avanzamento, ma con un'azione esplicita
  che resta registrata sull'edizione: chi ha forzato, quando, con quale
  rapporto davanti.
- **`in_invio` e `inviata` non sono verità del plugin.** La verità sta nel
  core; il plugin la rispecchia interrogando `getCampaign`. Non si duplicano i
  contatori del core, si leggono.

---

## Fase 1 — Lista contatti

**Obiettivo**: la lista esiste, si popola, si cura.

- Schema del contatto: indirizzo, nome, `iscritto`, stato tecnico, tag,
  provenienza, timestamp, `disiscritto_il`, `disiscritto_via`.
- Import da CSV, idempotente sull'indirizzo.
- CRUD e cura dalla UI: aggiunta manuale, modifica, disiscrizione.
- Pagina del plugin che mostra e filtra la lista.

**Due assi distinti, non uno.** `iscritto` è la volontà della persona; lo stato
tecnico è la salute dell'indirizzo (mai verificato, rimbalzato). Un indirizzo
può essere iscritto e rotto, oppure sano e disiscritto. L'invio richiede
entrambe le condizioni.

**La regola che non si negozia**: *l'import non riporta mai `iscritto` a vero.*
Può creare contatti nuovi e aggiornare nome e tag di quelli esistenti, ma su un
contatto disiscritto non tocca quel campo. Chi si è disiscritto per telefono non
deve poter rientrare col prossimo CSV. La riscrizione è un'azione manuale
deliberata.

Per la stessa ragione un contatto disiscritto **non si cancella**: cancellarlo
lo espone al reimport. `disiscritto_via` (`telefono`, `email`, `manuale`,
in futuro `ponte`) nasce ora perché la fase 6 lo troverà pronto.

**Fatto quando**: importi un CSV, vedi i contatti, li modifichi, disiscrivi
qualcuno, reimporti lo stesso file e il disiscritto resta disiscritto.

---

## Fase 2 — Ingestione dell'edizione e validazione tecnica

**Obiettivo**: un'edizione entra nel plugin e arriva a `validata_tech`.

- Schema dell'edizione e macchina a stati.
- Import della coppia `.txt` + `.html` da una directory, con i metadati del
  numero. Entrambi i file sono obbligatori: una coppia incompleta non entra.
- Validatore deterministico: HTML ben formato, testo non vuoto, confronto
  strutturale fra le due proiezioni — si estrae il testo dall'HTML *ai soli fini
  del confronto*, e lo si mette a paragone col `.txt` consegnato (lunghezze,
  titoli, numero di paragrafi, link). Indirizzi e URL sani.
- Anteprima di entrambe le proiezioni nella UI.
- Rapporto di validazione leggibile, salvato con l'edizione.

**Perché deterministico prima di semantico**: è veloce, non costa nulla, non
richiede LM Studio acceso, e da solo intercetta gli errori di caricamento più
grossolani — file scambiati, HTML troncato, coppia disallineata, `.txt` rimasto
a un'edizione precedente. Il modello serve per ciò che questo controllo non
vede.

**Una distinzione da non perdere**: il testo estratto dall'HTML serve *solo* a
confrontare. Non finisce mai nella campagna, che riceve il `.txt` consegnato.

**Fatto quando**: una coppia coerente passa; sostituendo il `.txt` con quello di
un altro numero, o troncando l'HTML, l'edizione si ferma in `errore_tech` con un
rapporto che dice cosa non torna.

---

## Fase 3 — Validazione semantica con LM Studio

**Obiettivo**: da `validata_tech` a `validata_semantica`.

- Prompt di confronto fra il `.txt` consegnato e il testo estratto dall'`.html`.
- Parsing dell'esito in un verdetto strutturato con motivazione.
- Comportamento quando LM Studio non è configurato o è spento: l'edizione non
  avanza, e il motivo è chiaro. L'assenza del modello non è un passaggio
  silenzioso.
- Forzatura esplicita, registrata sull'edizione.

Il core espone LM Studio sia da route (`deps.lmstudio`) sia da script
(`docs/plugin/lmstudio.md`). `deps.lmstudio` può essere `null`: va gestito.

**Testabilità**: il verdetto è una funzione pura sull'output del modello. I test
sostituiscono il client e non richiedono né LM Studio né il core.

**Fatto quando**: due file che dicono la stessa cosa passano; un `.html` a cui
manca un paragrafo si ferma in `errore_semantica` con la motivazione.

---

## Fase 4 — Invio

**Obiettivo**: da `pronta` a `inviata`.

- Risoluzione dei destinatari: tutti i contatti iscritti e sani, ristretti ai
  tag se l'edizione ne dichiara. La lista risolta si congela al momento
  dell'accodamento.
- Calcolo del `ref`, derivato dall'identità dell'edizione e mai dal tempo.
  Dall'accodamento in poi è immutabile: è ciò che protegge dal doppio invio.
- Invio di prova a sé stessi prima di quello reale.
- Accodamento e avvio della campagna via `deps.mail`.
- Rispecchiamento dello stato dal core.
- Riga di chiusura *«se non vuoi più riceverla, rispondi e ti tolgo»*, finché
  non c'è il ponte.

**Vincolo del core da rispettare**: la CLI `mail campaign` richiede
`AUTH_ENABLED=false` e su un'istanza autenticata fallisce con 401. Le campagne
si accodano **da una route**, non da un job. Il job resta legittimo per leggere
lo stato, non per far partire un invio.

**Fatto quando**: un'edizione `pronta` produce una campagna nel core, l'invio di
prova arriva, e rilanciare l'accodamento fallisce in modo pulito senza mandare
doppioni.

---

## Fase 5 — Cura e osservabilità

**Obiettivo**: sapere cosa è stato mandato, a chi, com'è andata.

- Storico delle edizioni con il loro stato.
- Chi ha ricevuto quale edizione.
- Contatori letti dal core, non ricalcolati.
- Destinatari in errore: cosa il plugin ne fa.
- Job schedulabile che aggiorna lo stato delle campagne in corso.

**Fatto quando**: dopo un invio la pagina racconta cosa è successo senza dover
aprire i log del core.

---

## Fase 6 — Comunicazione e Outreach

**Obiettivo**: raccontare l'architettura del plugin, divulgarne l'affidabilità e aprire l'opportunità di servizio di outreach e newsletter gestite oltre il perimetro pilota dei villaggi.

- **Piano e calendario editoriale**: serie di 4 post diluiti nel tempo (LinkedIn / canali professionali) su architettura, validazione semantica locale LM Studio, apertura del servizio a PMI/B2B e metriche reali.
- **Articolo cardine di approfondimento**: testo long-form che descrive il plugin, l'integrazione con Agentic Hub, la separazione dei ruoli (authoring vs validazione vs trasporto) e come questo stack rende scalabile e sicuro il servizio di newsletter per altri settori.
- Dettaglio completo e scaletta in [docs/CALENDARIO-EDITORIALE.md](file:///Users/fboschetti/Repo/fboschetti/fboschetti-newsletter-ahub/docs/CALENDARIO-EDITORIALE.md).

**Fatto quando**: piano e articolo cardine sono redatti e la sequenza temporale è schedulata nel cronoprogramma generale.

---

## Fuori perimetro

| Cosa | Dove vive | Quando |
| :--- | :--- | :--- |
| Guscio di marca, resa HTML, versione testuale | Agente dei contenuti | Non è di questo plugin |
| Disiscrizione con link e token opachi | Fase 6 della mappa | Dipende dal Ponte (Progetto 3) |
| Rimbalzi e segnalazioni | Fase 7 della mappa | Dipende dal Ponte e da Core Fase 3 |
| Più liste esplicite | — | Una lista sola più tag copre i casi reali |
| Iscrizione da form pubblico | Ponte | Se e quando servirà |

---

## Regole del contratto col core

Valgono per tutte le fasi e non si rinegoziano fase per fase.

- Mittente, API key e indirizzo admin sono **dell'istanza del core**, non del
  plugin: non vanno in `instanceConfig` e non si chiedono all'utente.
- Non si apre il DB del core per leggere campagne o registro mail: si passa da
  `deps.mail.getCampaign` o `bun run mail campaign status`.
- Non si simula una campagna con un ciclo di `send()`: niente ritmo, niente
  ripresa, niente idempotenza.
- Non si ricostruisce il ritmo d'invio nel plugin.
- Non si accodano indirizzi non validati: si filtra a monte.
- `deps.mail` e `deps.lmstudio` possono essere `null`: sempre da controllare.

---

## Ordine e indipendenza

Le fasi sono sequenziali: ognuna presuppone la precedente. Ma ognuna è
**autoconclusiva** — finisce in qualcosa che si usa e si verifica da solo, senza
la successiva.

Fase 1 e Fase 2 sono l'eccezione utile: non si toccano (contatti da una parte,
edizioni dall'altra) e potrebbero procedere in parallelo se mai servisse.
