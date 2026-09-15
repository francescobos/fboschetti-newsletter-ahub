import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Campagna, MailMinima } from "../server/campagne";
import { creaContatto } from "../server/contatti";
import { leggiEdizione } from "../server/edizioni";
import createRoutes from "../server/routes";
import { creaDbDiTest } from "./helpers";

const TESTO = "Novità.\n\nmailto:redazione@esempio.it?subject=Vorrei%20disiscrivermi";
const HTML = '<p>Novità.</p><p><a href="mailto:redazione@esempio.it">Esci</a></p>';

let db: Database;
let dir: string;
let app: ReturnType<typeof createRoutes>;
let avviate: string[];

function fintaMail(): MailMinima {
  return {
    async send() {
      return { id: "mail-1" };
    },
    async enqueueCampaign() {
      return { id: "camp-1" };
    },
    async startCampaign(id) {
      avviate.push(id);
    },
    async getCampaign() {
      return {
        id: "camp-1",
        ref: "newsletter-2026-09",
        subject: "Novità",
        status: "sending",
        total: 1,
        sentCount: 1,
        errorCount: 0,
        startedAt: "2026-09-15T10:00:00Z",
        finishedAt: null,
      } satisfies Campagna;
    },
  };
}

beforeEach(() => {
  db = creaDbDiTest();
  dir = mkdtempSync(join(tmpdir(), "route-ediz-"));
  writeFileSync(join(dir, "n.txt"), TESTO);
  writeFileSync(join(dir, "n.html"), HTML);
  avviate = [];
  app = createRoutes({
    db,
    slug: "fboschetti-newsletter",
    projectRoot: ".",
    mail: fintaMail(),
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function ingesta(ref = "newsletter-2026-09") {
  const res = await app.request("/edizioni", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ percorso: dir, ref, oggetto: "Novità" }),
  });
  return { res, corpo: await res.json() };
}

describe("POST /edizioni", () => {
  test("ingesta la coppia e restituisce il ref normalizzato", async () => {
    const { res, corpo } = await ingesta("  Newsletter 2026-09 ");
    expect(res.status).toBe(201);
    expect(corpo.ref).toBe("newsletter-2026-09");
    expect(corpo.avvisoMailto).toBeNull();
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("bozza");
  });

  test("percorso mancante è 400", async () => {
    const res = await app.request("/edizioni", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "r1", oggetto: "O" }),
    });
    expect(res.status).toBe(400);
  });

  test("un ref già usato è 409", async () => {
    await ingesta();
    const { res, corpo } = await ingesta();
    expect(res.status).toBe(409);
    expect(corpo.errore).toBe("ref_gia_presente");
  });
});

describe("GET /edizioni", () => {
  test("elenca le edizioni senza i corpi", async () => {
    await ingesta();
    const res = await app.request("/edizioni");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.totale).toBe(1);
    expect(corpo.righe[0].ref).toBe("newsletter-2026-09");
    expect(corpo.righe[0].testo).toBeUndefined();
  });

  test("uno stato non valido è 400", async () => {
    const res = await app.request("/edizioni?stato=inventato");
    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.errore).toBe("stato_non_valido");
    expect(corpo.attesi).toEqual(["bozza", "pronta", "in_invio", "inviata"]);
  });

  test("uno stato valido continua a filtrare", async () => {
    await ingesta();
    const res = await app.request("/edizioni?stato=bozza");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.totale).toBe(1);
    expect(corpo.righe[0].ref).toBe("newsletter-2026-09");
  });
});

describe("GET /edizioni/:id", () => {
  test("il dettaglio include i corpi", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}`);
    const dettaglio = await res.json();
    expect(dettaglio.testo).toBe(TESTO);
    expect(dettaglio.html).toBe(HTML);
  });

  test("id inesistente è 404", async () => {
    expect((await app.request("/edizioni/999")).status).toBe(404);
  });
});

describe("GET /edizioni/:id/destinatari", () => {
  test("mostra quanti e quali prima di accodare", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    creaContatto(db, { email: "b@esempio.it" });
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/destinatari`);
    const d = await res.json();
    expect(d.totale).toBe(2);
    expect(d.righe).toEqual(["a@esempio.it", "b@esempio.it"]);
  });
});

describe("POST /edizioni/:id/accoda", () => {
  test("accoda e porta l'edizione a pronta, senza avviare", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const e = leggiEdizione(db, corpo.id)!;
    expect(e.stato).toBe("pronta");
    expect(e.campagnaId).toBe("camp-1");
    expect(e.destinatariN).toBe(1);
    expect(avviate).toEqual([]);
  });

  test("senza destinatari è 400 e l'edizione resta in bozza", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("bozza");
  });

  test("accodare due volte è rifiutato dalla macchina a stati", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    const body = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };
    await app.request(`/edizioni/${corpo.id}/accoda`, body);
    const res = await app.request(`/edizioni/${corpo.id}/accoda`, body);
    expect(res.status).toBe(409);
  });
});

describe("POST /edizioni/:id/avvia", () => {
  test("avvia solo un'edizione già accodata", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    const body = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };
    await app.request(`/edizioni/${corpo.id}/accoda`, body);
    const res = await app.request(`/edizioni/${corpo.id}/avvia`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(avviate).toEqual(["camp-1"]);
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("in_invio");
  });

  test("avviare un'edizione in bozza è 409", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/avvia`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    expect(avviate).toEqual([]);
  });
});

describe("POST /edizioni/:id/prova", () => {
  test("manda la prova e non tocca lo stato", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/prova`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: "io@esempio.it" }),
    });
    expect(res.status).toBe(200);
    expect(leggiEdizione(db, corpo.id)!.stato).toBe("bozza");
  });

  test("indirizzo mancante è 400", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/prova`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /edizioni/:id/stato", () => {
  test("rispecchia i contatori del core", async () => {
    creaContatto(db, { email: "a@esempio.it" });
    const { corpo } = await ingesta();
    await app.request(`/edizioni/${corpo.id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await app.request(`/edizioni/${corpo.id}/stato`);
    const stato = await res.json();
    expect(stato.status).toBe("sending");
    expect(stato.sentCount).toBe(1);
  });

  test("un'edizione mai accodata non ha stato nel core", async () => {
    const { corpo } = await ingesta();
    const res = await app.request(`/edizioni/${corpo.id}/stato`);
    expect(res.status).toBe(409);
  });
});

describe("senza deps.mail", () => {
  test("le route che spediscono rispondono 503, l'ingestione no", async () => {
    const senza = createRoutes({
      db,
      slug: "fboschetti-newsletter",
      projectRoot: ".",
      mail: null,
    });
    const res = await senza.request("/edizioni", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ percorso: dir, ref: "r1", oggetto: "O" }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    creaContatto(db, { email: "a@esempio.it" });
    const accoda = await senza.request(`/edizioni/${id}/accoda`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(accoda.status).toBe(503);
  });
});
