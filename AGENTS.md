# AGENTS.md — fboschetti-newsletter

Istruzioni per gli agenti che lavorano su questo plugin.

## Cos'è

Plugin Fboschetti Newsletter per Agentic Hub

Plugin Agentic Hub con slug `fboschetti-newsletter`. Il repository **è** la root del
plugin: `plugin.json` sta qui, non dentro una sottocartella.

## Il contratto

Come si scrivono manifest, job, agenti, route, migration e pagine è
documentato nel devkit, non qui:

- clone locale: `../ahub-plugin-devkit/docs/plugin/*.md`
- come dipendenza: `node_modules/ahub-plugin-devkit/docs/plugin/*.md`

Leggere il file dell'argomento che si tocca prima di modificarlo.

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
├── data/                    # runtime, gitignored, non versionare
└── db/                      # SQLite runtime, gitignored
```

## Regole

- Non committare `data/`, `db/`, `.env` o segreti.
- Le icone stanno in una palette chiusa: `activity bot mail rocket terminal wrench zap`.
  Ogni altro nome fa fallback silenzioso a `terminal`.
- Non riaprire il DB dentro `server/routes.ts`: arriva già aperto e
  migrato in `deps.db`.
- Non aprire il DB del core: per leggere run e backup ci sono
  `deps.coreRuns` / `deps.coreBackups` nelle route e `bun run runs` /
  `bun run backups` da script.

## ⚠️ Il package.json e i comandi del core

`bun run` cerca il `package.json` più vicino risalendo dalla cwd, e job
e agenti girano con cwd = la root di questo plugin. Il `package.json` qui
presente intercetta quindi la risoluzione, e i comandi del core falliscono
con `Script not found`.

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
