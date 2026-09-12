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
