# Fboschetti Newsletter

Plugin Fboschetti Newsletter per Agentic Hub

Plugin per [Agentic Hub](https://github.com/francescobos/agentic-hub-core).
Slug: `fboschetti-newsletter`.

## Installazione

Dalla root del core:

```bash
bun run plugin install /percorso/a/fboschetti-newsletter   # da path locale
bun run plugin install git@github.com:<utente>/ahub-fboschetti-newsletter.git
bun run plugin list
```

## Sviluppo

```bash
bun install
bun test tests/
bun run check
```

Il contratto con il core è documentato in
[ahub-plugin-devkit](https://github.com/francescobos/ahub-plugin-devkit).
