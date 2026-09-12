import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import createRoutes from "../server/routes";
import { creaContatto, leggiContatto } from "../server/contatti";
import { creaDbDiTest } from "./helpers";

/**
 * Test dello strato route HTTP: nessun task del piano lo copriva
 * singolarmente, i 4 finding di questi fix sono emersi solo dalla
 * revisione whole-branch.
 */

let db: Database;
let app: ReturnType<typeof createRoutes>;

beforeEach(() => {
  db = creaDbDiTest();
  app = createRoutes({ db, slug: "fboschetti-newsletter", projectRoot: "." });
});

describe("GET /contatti — paginazione robusta a input non numerici", () => {
  test("?limite=abc non risponde 500 e resta sui valori di default", async () => {
    creaContatto(db, { email: "mario@esempio.it" });
    const res = await app.request("/contatti?limite=abc");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(Array.isArray(corpo.righe)).toBe(true);
    expect(corpo.righe.length).toBe(1);
    expect(corpo.totale).toBe(1);
  });

  test("?offset=abc non risponde 500 e resta sui valori di default", async () => {
    creaContatto(db, { email: "mario@esempio.it" });
    const res = await app.request("/contatti?offset=abc");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(Array.isArray(corpo.righe)).toBe(true);
    expect(corpo.totale).toBe(1);
  });

  test("?limite=-5 non risponde 500", async () => {
    creaContatto(db, { email: "mario@esempio.it" });
    const res = await app.request("/contatti?limite=-5");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(Array.isArray(corpo.righe)).toBe(true);
    expect(corpo.totale).toBe(1);
  });
});

describe("PATCH /contatti/:id — validazione statoTecnico", () => {
  test("uno statoTecnico fuori dominio risponde 400 e non modifica il contatto", async () => {
    const id = creaContatto(db, { email: "mario@esempio.it" });
    const res = await app.request(`/contatti/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statoTecnico: "inventato" }),
    });
    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.errore).toBe("stato_tecnico_non_valido");

    const contatto = leggiContatto(db, id)!;
    expect(contatto.statoTecnico).toBe("mai_verificato");
  });

  test("uno statoTecnico valido continua a funzionare", async () => {
    const id = creaContatto(db, { email: "mario@esempio.it" });
    const res = await app.request(`/contatti/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statoTecnico: "valido" }),
    });
    expect(res.status).toBe(200);
    expect(leggiContatto(db, id)!.statoTecnico).toBe("valido");
  });
});

describe("POST /contatti — validazione email", () => {
  test("un'email sintatticamente non valida risponde 400 e non crea il contatto", async () => {
    const res = await app.request("/contatti", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "non-una-email" }),
    });
    expect(res.status).toBe(400);
    const corpo = await res.json();
    expect(corpo.errore).toBe("email_non_valida");

    const tutti = await app.request("/contatti");
    expect((await tutti.json()).totale).toBe(0);
  });

  test("un'email valida continua a rispondere 201", async () => {
    const res = await app.request("/contatti", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mario@esempio.it" }),
    });
    expect(res.status).toBe(201);
    const corpo = await res.json();
    expect(typeof corpo.id).toBe("number");
  });
});
