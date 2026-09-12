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
