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
import { accoda, avvia, prova, statoCampagna, type MailMinima } from "./campagne";
import { emailValida, normalizzaEmail } from "./csv";
import { risolviDestinatari } from "./destinatari";
import {
  avanzaStato,
  elencaEdizioni,
  leggiEdizione,
  type Stato,
} from "./edizioni";
import { importaCsv, storicoImport } from "./import";
import { ingestaDaPercorso } from "./ingestione";

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
const STATI_EDIZIONE: Stato[] = ["bozza", "pronta", "in_invio", "inviata"];

/** Corpo accettato da POST e PATCH: i dati del contatto più l'azienda per nome. */
type CorpoContatto = Partial<DatiContatto> & { aziendaNome?: string | null };

/**
 * Traduce `aziendaNome` in un `aziendaId`, creando l'azienda se non esiste.
 *
 * I tre esiti sono distinti e voluti: `undefined` significa "il campo non è
 * stato passato, non toccare l'azienda", `null` significa "stacca l'azienda".
 * Chi chiama decide se onorare il `null`: la POST lo ignora, la PATCH no.
 */
function risolviAziendaDaNome(
  db: Database,
  nome: string | null | undefined,
): number | null | undefined {
  if (nome === undefined) return undefined;
  const pulito = nome?.trim();
  return pulito ? risolviOCreaAzienda(db, pulito) : null;
}

/**
 * Vero solo per la violazione di UNIQUE sull'email dei contatti.
 *
 * Serve a non spacciare per "email già presente" ogni altro errore SQLite:
 * `aggiornaContatto` scrive anche i tag, e un fallimento lì non ha nulla a
 * che vedere con l'email.
 */
function eEmailDuplicata(errore: unknown): boolean {
  const messaggio = errore instanceof Error ? errore.message : String(errore);
  return /UNIQUE constraint failed:\s*contatti\.email/i.test(messaggio);
}

export default function createRoutes(deps: {
  db: Database;
  slug: string;
  projectRoot: string;
  // Opzionale: il core la passa sempre, i test delle route dei contatti no.
  // `null` significa core non disponibile, e le route che spediscono lo dicono.
  mail?: MailMinima | null;
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
    const limite = Number(q.limite);
    if (Number.isFinite(limite) && limite > 0) filtri.limite = limite;
    const offset = Number(q.offset);
    if (Number.isFinite(offset) && offset >= 0) filtri.offset = offset;
    return c.json(elencaContatti(db, filtri));
  });

  r.post("/contatti", async (c) => {
    const { aziendaNome, ...body }: CorpoContatto = await c.req
      .json<CorpoContatto>()
      .catch(() => ({}));
    if (!body.email) return c.json({ errore: "email_mancante" }, 400);
    if (!emailValida(normalizzaEmail(body.email))) {
      return c.json({ errore: "email_non_valida" }, 400);
    }
    // Un `aziendaId` esplicito vince sul nome; in creazione un nome vuoto non
    // ha nulla da staccare, quindi il `null` di ritorno si scarta.
    if (body.aziendaId == null) {
      const risolto = risolviAziendaDaNome(db, aziendaNome);
      if (risolto != null) body.aziendaId = risolto;
    }
    try {
      return c.json({ id: creaContatto(db, body as DatiContatto) }, 201);
    } catch (e) {
      if (eEmailDuplicata(e)) return c.json({ errore: "email_gia_presente" }, 409);
      throw e;
    }
  });

  r.patch("/contatti/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!leggiContatto(db, id)) return c.json({ errore: "non_trovato" }, 404);
    const { aziendaNome, ...body }: CorpoContatto = await c.req
      .json<CorpoContatto>()
      .catch(() => ({}));
    if (body.email !== undefined) {
      if (!body.email.trim() || !emailValida(normalizzaEmail(body.email))) {
        return c.json({ errore: "email_non_valida" }, 400);
      }
    }
    if (body.statoTecnico && !STATI_VALIDI.includes(body.statoTecnico as StatoTecnico)) {
      return c.json({ errore: "stato_tecnico_non_valido", attesi: STATI_VALIDI }, 400);
    }
    // Qui il `null` si onora: `aziendaNome` vuoto stacca l'azienda.
    const risolto = risolviAziendaDaNome(db, aziendaNome);
    if (risolto !== undefined) body.aziendaId = risolto;
    try {
      aggiornaContatto(db, id, body);
      return c.json({ ok: true });
    } catch (e) {
      if (eEmailDuplicata(e)) return c.json({ errore: "email_gia_presente" }, 409);
      throw e;
    }
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

  /**
   * Edizioni: ingestione, anteprima, prova, accodamento, avvio, stato.
   *
   * Accodare e avviare restano due route distinte perché è la semantica del
   * core: fra l'una e l'altra la campagna è ferma in `queued` e non parte
   * nulla. Fonderle in una toglierebbe l'unico momento in cui ci si può
   * fermare.
   */

  const mail = deps.mail ?? null;

  /** L'edizione o la risposta d'errore già pronta. */
  function edizioneDaParam(c: { req: { param: (k: string) => string } }) {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return null;
    return leggiEdizione(db, id);
  }

  r.get("/edizioni", (c) => {
    const stato = c.req.query("stato");
    if (stato && !STATI_EDIZIONE.includes(stato as Stato)) {
      return c.json({ errore: "stato_non_valido", attesi: STATI_EDIZIONE }, 400);
    }
    const filtri = stato ? { stato: stato as Stato } : {};
    const { righe, totale } = elencaEdizioni(db, filtri);
    // I corpi non servono all'elenco e sono grandi: si mandano nel dettaglio.
    const leggere = righe.map(({ testo, html, ...resto }) => resto);
    return c.json({ righe: leggere, totale });
  });

  r.post("/edizioni", async (c) => {
    const body: { percorso?: string; ref?: string; oggetto?: string } =
      await c.req.json().catch(() => ({}));
    if (!body.percorso?.trim()) return c.json({ errore: "percorso_mancante" }, 400);
    if (!body.ref?.trim()) return c.json({ errore: "ref_mancante" }, 400);
    if (!body.oggetto?.trim()) return c.json({ errore: "oggetto_mancante" }, 400);

    const esito = ingestaDaPercorso(db, {
      percorso: body.percorso,
      ref: body.ref,
      oggetto: body.oggetto,
    });
    if (!esito.ok) {
      const stato = esito.errore === "ref_gia_presente" ? 409 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    return c.json(
      { id: esito.id, ref: esito.ref, avvisoMailto: esito.avvisoMailto },
      201,
    );
  });

  r.get("/edizioni/:id", (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    return c.json(edizione);
  });

  r.get("/edizioni/:id/destinatari", (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    const tag = c.req.query("tag");
    const righe = risolviDestinatari(db, tag ? { tag } : {});
    return c.json({ righe, totale: righe.length });
  });

  r.post("/edizioni/:id/prova", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    const body: { a?: string } = await c.req.json().catch(() => ({}));
    // `prova` controlla di nuovo e direbbe `indirizzo_non_valido`: qui il
    // codice è più preciso perché distingue "non l'hai passato" da "non è
    // utilizzabile". Il doppio controllo è voluto: il modulo resta valido
    // anche se chiamato da altrove.
    if (!body.a?.trim()) return c.json({ errore: "indirizzo_mancante" }, 400);

    const esito = await prova(mail, edizione, body.a);
    if (!esito.ok) {
      const stato = esito.errore === "mail_non_disponibile" ? 503 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    return c.json({ ok: true, id: esito.dato.id });
  });

  r.post("/edizioni/:id/accoda", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    if (edizione.stato !== "bozza") {
      return c.json({ errore: "stato_non_accodabile", stato: edizione.stato }, 409);
    }
    const body: { tag?: string } = await c.req.json().catch(() => ({}));
    const tag = body.tag?.trim() || null;

    const destinatari = risolviDestinatari(db, tag ? { tag } : {});
    const esito = await accoda(mail, edizione, destinatari);
    if (!esito.ok) {
      const stato =
        esito.errore === "mail_non_disponibile"
          ? 503
          : esito.errore === "ref_gia_usato"
            ? 409
            : 400;
      return c.json({ errore: esito.errore }, stato);
    }

    avanzaStato(db, edizione.id, "pronta", {
      campagnaId: esito.dato.id,
      filtroTag: tag,
      destinatariN: destinatari.length,
    });
    return c.json({
      ok: true,
      campagnaId: esito.dato.id,
      destinatari: destinatari.length,
    });
  });

  r.post("/edizioni/:id/avvia", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    if (edizione.stato !== "pronta" || !edizione.campagnaId) {
      return c.json({ errore: "stato_non_avviabile", stato: edizione.stato }, 409);
    }

    const esito = await avvia(mail, edizione.campagnaId);
    if (!esito.ok) {
      const stato = esito.errore === "mail_non_disponibile" ? 503 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    avanzaStato(db, edizione.id, "in_invio");
    return c.json({ ok: true });
  });

  r.get("/edizioni/:id/stato", async (c) => {
    const edizione = edizioneDaParam(c);
    if (!edizione) return c.json({ errore: "non_trovata" }, 404);
    if (!edizione.campagnaId) {
      return c.json({ errore: "mai_accodata", stato: edizione.stato }, 409);
    }

    const esito = await statoCampagna(mail, edizione.campagnaId);
    if (!esito.ok) {
      const stato = esito.errore === "mail_non_disponibile" ? 503 : 400;
      return c.json({ errore: esito.errore }, stato);
    }
    if (!esito.dato) return c.json({ errore: "campagna_non_trovata" }, 404);

    // Il core è la verità: se ha finito, l'edizione lo rispecchia.
    const finita = esito.dato.status === "sent" || esito.dato.status === "sent_with_errors";
    if (finita && edizione.stato === "in_invio") {
      avanzaStato(db, edizione.id, "inviata");
    }
    return c.json(esito.dato);
  });

  return r;
}
