import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { creaDbDiTest } from "./helpers";
import {
  avanzaStato,
  creaEdizione,
  elencaEdizioni,
  leggiEdizione,
  normalizzaRef,
  trovaPerRef,
} from "../server/edizioni";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

test("la migration crea la tabella edizioni", () => {
  const riga = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='edizioni'")
    .get();
  expect(riga).not.toBeNull();
});

test("lo stato di default è bozza", () => {
  const ora = Date.now();
  db.run(
    `INSERT INTO edizioni (ref, oggetto, testo, html, creato_il, aggiornato_il)
     VALUES ('prova', 'Oggetto', 'testo', '<p>html</p>', ?, ?)`,
    [ora, ora],
  );
  const r = db.query("SELECT stato FROM edizioni").get() as { stato: string };
  expect(r.stato).toBe("bozza");
});

test("uno stato fuori dai quattro previsti è rifiutato", () => {
  const ora = Date.now();
  expect(() =>
    db.run(
      `INSERT INTO edizioni (ref, oggetto, testo, html, stato, creato_il, aggiornato_il)
       VALUES ('prova', 'Oggetto', 'testo', '<p>h</p>', 'inventato', ?, ?)`,
      [ora, ora],
    ),
  ).toThrow();
});

test("due edizioni con lo stesso ref non convivono", () => {
  const ora = Date.now();
  const inserisci = (ref: string) =>
    db.run(
      `INSERT INTO edizioni (ref, oggetto, testo, html, creato_il, aggiornato_il)
       VALUES (?, 'Oggetto', 'testo', '<p>h</p>', ?, ?)`,
      [ref, ora, ora],
    );
  inserisci("newsletter-2026-09");
  expect(() => inserisci("newsletter-2026-09")).toThrow();
});

test("normalizzaRef abbassa le maiuscole", () => {
  expect(normalizzaRef("Newsletter Settembre")).toBe("newsletter-settembre");
});

test("normalizzaRef collassa gli spazi multipli in un solo trattino", () => {
  expect(normalizzaRef("outreach  villaggi   autunno")).toBe(
    "outreach-villaggi-autunno",
  );
});

test("normalizzaRef taglia gli spazi ai bordi", () => {
  expect(normalizzaRef("  newsletter 2026-09  ")).toBe("newsletter-2026-09");
});

test("normalizzaRef sostituisce i caratteri non ammessi", () => {
  expect(normalizzaRef("news/settembre!2026")).toBe("news-settembre-2026");
});

test("normalizzaRef non lascia trattini ai bordi né doppi", () => {
  expect(normalizzaRef("--news---settembre--")).toBe("news-settembre");
});

test("normalizzaRef conserva accenti come trattini, non li sopprime", () => {
  expect(normalizzaRef("novità di settembre")).toBe("novit-di-settembre");
});

test("normalizzaRef su stringa senza caratteri utili dà stringa vuota", () => {
  expect(normalizzaRef("!!!")).toBe("");
});

const DATI = {
  ref: "newsletter-2026-09",
  oggetto: "Novità di settembre",
  testo: "Versione testuale.",
  html: "<p>Versione HTML.</p>",
};

test("creaEdizione nasce in bozza, senza campagna né timestamp di invio", () => {
  const id = creaEdizione(db, DATI);
  const e = leggiEdizione(db, id)!;
  expect(e.ref).toBe("newsletter-2026-09");
  expect(e.stato).toBe("bozza");
  expect(e.campagnaId).toBeNull();
  expect(e.accodataIl).toBeNull();
  expect(e.avviataIl).toBeNull();
  expect(e.destinatariN).toBeNull();
});

test("i corpi si conservano identici, byte per byte", () => {
  const html = '<p>Link <a href="mailto:a@esempio.it">qui</a> &amp; altro</p>';
  const id = creaEdizione(db, { ...DATI, testo: "  spazi  ", html });
  const e = leggiEdizione(db, id)!;
  expect(e.testo).toBe("  spazi  ");
  expect(e.html).toBe(html);
});

test("trovaPerRef ritrova l'edizione", () => {
  creaEdizione(db, DATI);
  expect(trovaPerRef(db, "newsletter-2026-09")!.oggetto).toBe(
    "Novità di settembre",
  );
  expect(trovaPerRef(db, "inesistente")).toBeNull();
});

test("leggiEdizione su id inesistente dà null", () => {
  expect(leggiEdizione(db, 999)).toBeNull();
});

test("elencaEdizioni filtra per stato", () => {
  creaEdizione(db, DATI);
  const id2 = creaEdizione(db, { ...DATI, ref: "outreach-autunno" });
  avanzaStato(db, id2, "pronta", { campagnaId: "abc", destinatariN: 12 });

  expect(elencaEdizioni(db).totale).toBe(2);
  expect(elencaEdizioni(db, { stato: "bozza" }).totale).toBe(1);
  expect(elencaEdizioni(db, { stato: "pronta" }).righe[0]!.ref).toBe(
    "outreach-autunno",
  );
});

test("avanzaStato registra campagna, destinatari e accodata_il", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", {
    campagnaId: "camp-123",
    destinatariN: 42,
    filtroTag: "villaggi",
  });
  const e = leggiEdizione(db, id)!;
  expect(e.stato).toBe("pronta");
  expect(e.campagnaId).toBe("camp-123");
  expect(e.destinatariN).toBe(42);
  expect(e.filtroTag).toBe("villaggi");
  expect(e.accodataIl).not.toBeNull();
  expect(e.avviataIl).toBeNull();
});

test("avanzaStato a in_invio segna avviata_il", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "camp-123" });
  avanzaStato(db, id, "in_invio");
  const e = leggiEdizione(db, id)!;
  expect(e.stato).toBe("in_invio");
  expect(e.avviataIl).not.toBeNull();
});

test("il percorso completo bozza → inviata è ammesso", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "c" });
  avanzaStato(db, id, "in_invio");
  avanzaStato(db, id, "inviata");
  expect(leggiEdizione(db, id)!.stato).toBe("inviata");
});

test("saltare uno stato è rifiutato", () => {
  const id = creaEdizione(db, DATI);
  expect(() => avanzaStato(db, id, "in_invio")).toThrow(
    /transizione non ammessa/,
  );
  expect(leggiEdizione(db, id)!.stato).toBe("bozza");
});

test("tornare indietro è rifiutato", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "c" });
  expect(() => avanzaStato(db, id, "bozza")).toThrow(/transizione non ammessa/);
});

test("da inviata non si va da nessuna parte", () => {
  const id = creaEdizione(db, DATI);
  avanzaStato(db, id, "pronta", { campagnaId: "c" });
  avanzaStato(db, id, "in_invio");
  avanzaStato(db, id, "inviata");
  expect(() => avanzaStato(db, id, "in_invio")).toThrow(
    /transizione non ammessa/,
  );
});

test("avanzaStato su edizione inesistente solleva", () => {
  expect(() => avanzaStato(db, 999, "pronta")).toThrow(/non trovata/);
});
