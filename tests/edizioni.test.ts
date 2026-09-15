import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { creaDbDiTest } from "./helpers";

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
