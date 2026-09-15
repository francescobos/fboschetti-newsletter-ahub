# AGENTS.md — fboschetti-newsletter

Istruzioni per gli agenti che lavorano su questo plugin.

## Cos'è

Riceve edizioni già pronte (`.txt` + `.html`), verifica che siano integre,
tiene l'anagrafica dei destinatari e le consegna al trasporto del core.
**Non scrive le newsletter e non le impagina.**

Slug `fboschetti-newsletter`. Il repository **è** la root del plugin:
`plugin.json` sta qui, non dentro una sottocartella.

Roadmap delle fasi: [docs/ROADMAP.md](docs/ROADMAP.md).

## Il contratto

Come si scrivono manifest, job, agenti, route, migration e pagine è documentato
nel devkit, non qui. Radice della documentazione:

- come dipendenza: `node_modules/ahub-plugin-devkit/docs/plugin/`
- clone locale: `../../agentic-hub/ahub-plugin-devkit/docs/plugin/`

**Leggere il file dell'argomento che si tocca, prima di toccarlo:**

| Cosa stai per fare | File da leggere |
|---|---|
| manifest, `jobs[]`, `requiresHubApi`, icone | `manifest-e-job.md` |
| `instanceConfig`, env `AGENTIC_HUB_*` | `config-istanza.md` |
| agenti, frontmatter, watcher, avvio con `args` | `agenti-e-watcher.md` |
| **route, DB, migration, pagine React** | `route-db-ui.md` |
| molte automazioni simili, script esterni, UI articolata | `pratiche-plugin-complessi.md` |
| API Gemini nelle route | `gemini.md` |
| LM Studio / LLM locali | `lmstudio.md` |
| leggere run del core e log dei backup | `core-runs-e-backup.md` |
| **mail singole e campagne di invio massivo** | `email-e-campagne.md` |

## Struttura

```text
fboschetti-newsletter/
├── plugin.json              # manifest, unico file obbligatorio
├── scripts/                 # job deterministici, CLI-first
├── server/                  # route API e logica
├── migrations/              # migration SQLite, ordine lessicografico
├── web/pages/               # pagine React nell'hub
├── config/                  # template di config d'istanza (.example)
├── tests/                   # test standalone, senza core
├── docs/                    # roadmap e calendario editoriale del progetto
├── data/                    # runtime, gitignored, non versionare
└── db/                      # SQLite runtime, gitignored
```

Le cartelle che il plugin non usa ancora si aggiungono quando servono: il
contratto è lo stesso, vedi la tabella sopra.

## Regole

- Non committare `data/`, `db/`, `.env` o segreti. Gli indirizzi dei contatti
  sono dati personali: non finiscono in file versionati, log o output di test.
- Le icone stanno in una palette chiusa: `activity bot mail rocket terminal
  wrench zap`. Ogni altro nome fa fallback silenzioso a `terminal`.
- Un job non può chiamarsi come un agente dello stesso plugin: la collisione fa
  fallire la discovery dell'intero plugin, non solo del job. Oggi i job sono
  `fboschetti-newsletter` e `import-contatti`, e non c'è `.claude/commands/`:
  aggiungendo un agente, non dargli uno di quei due nomi.
- Non riaprire il DB dentro `server/routes.ts`: arriva già aperto e migrato in
  `deps.db`.
- Non aprire il DB del core: per leggere run e backup ci sono `deps.coreRuns` /
  `deps.coreBackups` nelle route e `bun run runs` / `bun run backups` da script.
- Non esporre route proprie per lanciare run agente: le run le orchestra il core.
- Non dichiarare le `deps` come `any`: i tipi stanno nei barrel `@hub/*`.
- I corpi `testo` e `html` di un'edizione non si modificano mai: partono byte
  per byte come sono stati consegnati. Il blocco di disiscrizione lo scrive
  l'agente dei contenuti; il plugin verifica che ci sia e avvisa, non lo
  aggiunge.

## Regole UI

Valgono per ogni file sotto `web/pages/`.

- Il frontend del core deriva da **shadcn/ui** (React, TypeScript, Tailwind,
  Radix). Riusare i componenti già presenti nel core — `Button`, `Input`,
  `Select`, `Table`, `Card`, `Dialog`, `Badge`, `Tabs` — invece di ricostruirli
  con markup Tailwind a mano. Si importano con l'alias del core, per esempio
  `import { Button } from "@/components/ui/button"`.
- La pagina va dentro il layout dell'hub: `Header` (`@/components/layout/header`)
  e `Main` (`@/components/layout/main`), non un `<div>` a piacere.
- Usare i token di tema (`bg-background`, `bg-card`, `text-muted-foreground`,
  `border-border`) e l'utility `cn`, per restare allineati a tema, spacing e
  sidebar dell'hub.
- Niente valori arbitrari tipo `bg-[#327aed]`: `plugins/*` è fuori dalla
  scansione del purge Tailwind del core, quindi quelle classi non vengono
  generate e la pagina esce senza stile.
- Padding coerenti (`p-4`, `space-y-3`), non `p-2` compressi; verificare il
  layout desktop e mobile — qui la lista contatti è una tabella con email
  lunghe, quindi servono overflow controllato e truncation.

`web/pages/index.tsx` è conforme a queste regole e funge da modello per
altre pagine del plugin.

`web/` è fuori dall'`include` di `tsconfig.json`: l'alias `@/*` risolve solo
nella tsconfig del core, quindi `bun run check` qui non vede le pagine. La UI si
verifica dopo `bun run plugin install`, riavviando server e Vite.

Era incluso fino a poco fa, e passava solo perché la pagina non importava nulla
dal core: al primo `import { Button } from "@/components/ui/button"` il check
sarebbe fallito con `TS2307` su un import corretto, e la via d'uscita più comoda
sarebbe stata tornare al markup a mano — cioè il problema di partenza.

Il dettaglio completo è in `route-db-ui.md`.

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

Il manifest dichiara `"requiresHubApi": "^1.3"`, il minimo richiesto dalle
campagne: non abbassarlo senza verificare che l'API del core esposta a questo
plugin resti compatibile. La CLI `mail campaign` passa dall'API HTTP dell'hub
e oggi funziona solo con `AUTH_ENABLED=false`: in produzione le campagne vanno
accodate da una route, non lanciate da CLI.

Dettagli, stati e ripresa dopo riavvio in `email-e-campagne.md`.

## ⚠️ Il package.json e i comandi del core

`bun run` cerca il `package.json` più vicino risalendo dalla cwd, e job e agenti
girano con cwd = la root di questo plugin. Il `package.json` qui presente
intercetta quindi la risoluzione, e i comandi del core falliscono con
`Script not found`.

Da script e agenti usare sempre la root iniettata nell'env della run:

```bash
bun run --cwd "$AGENTIC_HUB_PROJECT_ROOT" mail notify-admin --subject "..." --text "..."
```

## Verifica

```bash
bun test tests/
bun run check
bun run plugin install .   # dalla root del core
bun run plugin list
```
