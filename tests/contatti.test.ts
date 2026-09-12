import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import {
  aggiornaContatto,
  creaContatto,
  disiscrivi,
  elencaAziende,
  elencaContatti,
  elencaTag,
  eliminaAzienda,
  impostaTag,
  leggiContatto,
  riscrivi,
  risolviOCreaAzienda,
  trovaPerEmail,
  unisciTag,
} from "../server/contatti";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

test("un contatto nuovo nasce iscritto e mai verificato", () => {
  const id = creaContatto(db, { email: "mario@esempio.it", nome: "Mario" });
  const c = leggiContatto(db, id)!;
  expect(c.email).toBe("mario@esempio.it");
  expect(c.iscritto).toBe(true);
  expect(c.statoTecnico).toBe("mai_verificato");
  expect(c.disiscrittoIl).toBeNull();
  expect(c.tag).toEqual([]);
});

test("l'email si normalizza in scrittura", () => {
  const id = creaContatto(db, { email: "  Mario@Esempio.IT " });
  expect(leggiContatto(db, id)!.email).toBe("mario@esempio.it");
});

test("trovaPerEmail ignora le maiuscole", () => {
  creaContatto(db, { email: "mario@esempio.it" });
  expect(trovaPerEmail(db, "MARIO@ESEMPIO.IT")).not.toBeNull();
});

test("due contatti con la stessa email non convivono", () => {
  creaContatto(db, { email: "mario@esempio.it" });
  expect(() => creaContatto(db, { email: "Mario@Esempio.it" })).toThrow();
});

test("disiscrivi registra quando e come", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "telefono");
  const c = leggiContatto(db, id)!;
  expect(c.iscritto).toBe(false);
  expect(c.disiscrittoVia).toBe("telefono");
  expect(c.disiscrittoIl).toBeGreaterThan(0);
});

test("riscrivi azzera i campi della disiscrizione", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "email");
  riscrivi(db, id);
  const c = leggiContatto(db, id)!;
  expect(c.iscritto).toBe(true);
  expect(c.disiscrittoIl).toBeNull();
  expect(c.disiscrittoVia).toBeNull();
});

test("uno stato tecnico fuori dominio viene rifiutato dal DB", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  expect(() =>
    db.run("UPDATE contatti SET stato_tecnico = 'inventato' WHERE id = ?", [id]),
  ).toThrow();
});

test("risolviOCreaAzienda non duplica per differenza di maiuscole", () => {
  const a = risolviOCreaAzienda(db, "Villaggio Sole");
  const b = risolviOCreaAzienda(db, "villaggio sole");
  expect(b).toBe(a);
  expect(elencaAziende(db)).toHaveLength(1);
});

test("il contatto porta con sé il nome dell'azienda", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  const id = creaContatto(db, { email: "mario@esempio.it", aziendaId });
  expect(leggiContatto(db, id)!.aziendaNome).toBe("Villaggio Sole");
});

test("eliminare un'azienda non elimina i suoi contatti", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  const id = creaContatto(db, { email: "mario@esempio.it", aziendaId });
  eliminaAzienda(db, aziendaId);
  const c = leggiContatto(db, id);
  expect(c).not.toBeNull();
  expect(c!.aziendaId).toBeNull();
});

test("elencaAziende conta i contatti", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  creaContatto(db, { email: "mario@esempio.it", aziendaId });
  creaContatto(db, { email: "lucia@esempio.it", aziendaId });
  creaContatto(db, { email: "solo@esempio.it" });
  const aziende = elencaAziende(db);
  expect(aziende).toHaveLength(1);
  expect(aziende[0]!.contatti).toBe(2);
});

test("impostaTag sostituisce, unisciTag aggiunge", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  impostaTag(db, id, ["villaggi"]);
  expect(leggiContatto(db, id)!.tag).toEqual(["villaggi"]);
  unisciTag(db, id, ["pilota"]);
  expect(leggiContatto(db, id)!.tag.sort()).toEqual(["pilota", "villaggi"]);
  impostaTag(db, id, ["nord"]);
  expect(leggiContatto(db, id)!.tag).toEqual(["nord"]);
});

test("lo stesso tag su due contatti non crea due righe in tag", () => {
  const a = creaContatto(db, { email: "mario@esempio.it" });
  const b = creaContatto(db, { email: "lucia@esempio.it" });
  impostaTag(db, a, ["villaggi"]);
  impostaTag(db, b, ["Villaggi"]);
  const tag = elencaTag(db);
  expect(tag).toHaveLength(1);
  expect(tag[0]!.contatti).toBe(2);
});

test("cancellare un contatto libera le sue associazioni di tag", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  impostaTag(db, id, ["villaggi"]);
  db.run("DELETE FROM contatti WHERE id = ?", [id]);
  const n = db.query("SELECT COUNT(*) AS n FROM contatti_tag").get() as {
    n: number;
  };
  expect(n.n).toBe(0);
});

test("aggiornaContatto tocca solo i campi passati", () => {
  const id = creaContatto(db, {
    email: "mario@esempio.it",
    nome: "Mario",
    ruolo: "Direttore",
  });
  aggiornaContatto(db, id, { nome: "Maria" });
  const c = leggiContatto(db, id)!;
  expect(c.nome).toBe("Maria");
  expect(c.ruolo).toBe("Direttore");
});

test("aggiornaContatto non può riattivare un disiscritto", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "telefono");
  aggiornaContatto(db, id, { nome: "Mario" });
  expect(leggiContatto(db, id)!.iscritto).toBe(false);
});

test("aggiornaContatto aggiorna il timestamp", async () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  const prima = leggiContatto(db, id)!.aggiornatoIl;
  await Bun.sleep(5);
  aggiornaContatto(db, id, { nome: "Mario" });
  expect(leggiContatto(db, id)!.aggiornatoIl).toBeGreaterThan(prima);
});

test("elencaContatti filtra per testo su email, nome, cognome e azienda", () => {
  const aziendaId = risolviOCreaAzienda(db, "Villaggio Sole");
  creaContatto(db, { email: "mario@esempio.it", nome: "Mario", aziendaId });
  creaContatto(db, { email: "lucia@altro.it", cognome: "Bianchi" });
  expect(elencaContatti(db, { testo: "mario" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { testo: "bianchi" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { testo: "villaggio" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { testo: "esempio" }).righe).toHaveLength(1);
});

test("elencaContatti filtra per iscritto, tag e provincia", () => {
  const a = creaContatto(db, { email: "mario@esempio.it", provincia: "BO" });
  impostaTag(db, a, ["villaggi"]);
  const b = creaContatto(db, { email: "lucia@esempio.it", provincia: "VR" });
  disiscrivi(db, b, "manuale");

  expect(elencaContatti(db, { iscritto: true }).righe).toHaveLength(1);
  expect(elencaContatti(db, { iscritto: false }).righe).toHaveLength(1);
  expect(elencaContatti(db, { tag: "villaggi" }).righe).toHaveLength(1);
  expect(elencaContatti(db, { provincia: "BO" }).righe).toHaveLength(1);
});

test("elencaContatti pagina e riporta il totale", () => {
  for (let i = 0; i < 5; i++) {
    creaContatto(db, { email: `c${i}@esempio.it` });
  }
  const p = elencaContatti(db, { limite: 2, offset: 0 });
  expect(p.righe).toHaveLength(2);
  expect(p.totale).toBe(5);
});
