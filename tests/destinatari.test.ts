import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { creaContatto, disiscrivi, impostaTag } from "../server/contatti";
import { risolviDestinatari } from "../server/destinatari";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

test("un contatto iscritto e sano è un destinatario", () => {
  creaContatto(db, { email: "mario@esempio.it" });
  expect(risolviDestinatari(db)).toEqual(["mario@esempio.it"]);
});

test("un disiscritto non riceve", () => {
  const id = creaContatto(db, { email: "mario@esempio.it" });
  disiscrivi(db, id, "telefono");
  expect(risolviDestinatari(db)).toEqual([]);
});

test("un rimbalzato non riceve, anche se iscritto", () => {
  creaContatto(db, {
    email: "rotto@esempio.it",
    statoTecnico: "rimbalzato",
  });
  expect(risolviDestinatari(db)).toEqual([]);
});

test("gli altri stati tecnici ricevono", () => {
  creaContatto(db, { email: "a@esempio.it", statoTecnico: "mai_verificato" });
  creaContatto(db, { email: "b@esempio.it", statoTecnico: "valido" });
  creaContatto(db, { email: "c@esempio.it", statoTecnico: "sospeso" });
  expect(risolviDestinatari(db).sort()).toEqual([
    "a@esempio.it",
    "b@esempio.it",
    "c@esempio.it",
  ]);
});

test("il filtro per tag restringe ai soli contatti taggati", () => {
  const id1 = creaContatto(db, { email: "a@esempio.it" });
  creaContatto(db, { email: "b@esempio.it" });
  impostaTag(db, id1, ["villaggi"]);
  expect(risolviDestinatari(db, { tag: "villaggi" })).toEqual(["a@esempio.it"]);
});

test("il filtro per tag rispetta comunque iscritto e stato tecnico", () => {
  const id1 = creaContatto(db, { email: "a@esempio.it" });
  const id2 = creaContatto(db, { email: "b@esempio.it" });
  impostaTag(db, id1, ["villaggi"]);
  impostaTag(db, id2, ["villaggi"]);
  disiscrivi(db, id2, "email");
  expect(risolviDestinatari(db, { tag: "villaggi" })).toEqual(["a@esempio.it"]);
});

test("un tag inesistente non dà destinatari", () => {
  creaContatto(db, { email: "a@esempio.it" });
  expect(risolviDestinatari(db, { tag: "inesistente" })).toEqual([]);
});

test("nessun contatto dà lista vuota, non un errore", () => {
  expect(risolviDestinatari(db)).toEqual([]);
});

test("le email non si ripetono", () => {
  const id = creaContatto(db, { email: "a@esempio.it" });
  impostaTag(db, id, ["villaggi", "bologna"]);
  expect(risolviDestinatari(db)).toEqual(["a@esempio.it"]);
});
