import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { contaRighe, inserisciRiga } from "./service";

/**
 * Route del plugin fboschetti-newsletter, montate sotto /api/plugins/fboschetti-newsletter.
 *
 * Il default export deve essere una funzione che restituisce un Hono: il core
 * carica il modulo e scarta il file se trova altro.
 *
 * `deps.db` arriva già aperto e migrato — non riaprirlo. I servizi del core
 * possono essere null quando non configurati: vanno sempre controllati.
 */
export default function createRoutes(deps: {
  db: Database;
  slug: string;
  projectRoot: string;
}) {
  const r = new Hono();

  r.get("/stato", (c) => c.json({ slug: deps.slug, righe: contaRighe(deps.db) }));

  r.post("/righe", async (c) => {
    // Il catch tipizzato evita che il fallback allarghi il tipo a unione.
    const body: { messaggio?: string } = await c.req
      .json<{ messaggio?: string }>()
      .catch(() => ({}));
    const messaggio = body.messaggio;
    if (!messaggio) return c.json({ error: "messaggio_mancante" }, 400);
    return c.json({ id: inserisciRiga(deps.db, messaggio) }, 201);
  });

  return r;
}
